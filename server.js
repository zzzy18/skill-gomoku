const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  const ext = path.extname(filePath);
  const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type':(mime[ext]||'text/plain')+'; charset=utf-8'});
    res.end(data);
  });
});

const wss = new WebSocket.Server({server});

const N = 15;
const EMPTY = 0, P1 = 1, P2 = 2, P3 = 3, RUIN = 4, RIFT = 5;
const DECAY_TURNS = 12, RIFT_INTERVAL = 5, RIFT_DURATION = 4;

// All available skills
const ALL_SKILLS = [
  {id:'sandstorm',   name:'飞沙走石', type:'active',  desc:'移除棋盘上一枚棋子并留下废墟，每5回合可用一次'},
  {id:'stillwater',  name:'静如止水', type:'active',  desc:'选择一名角色跳过一个落子回合'},
  {id:'intercept',   name:'擒拿',     type:'passive', desc:'当飞沙走石发动时可打断其效果'},
  {id:'mountain',    name:'力拔山兮', type:'active',  desc:'回合≥50时直接获胜'},
  {id:'swap',        name:'偷梁换柱', type:'active',  desc:'将一枚棋子变为己方3回合，期间不计胜利'},
  {id:'move',        name:'斗转星移', type:'active',  desc:'移动任意一颗棋子到空位，冷却5回合'},
  {id:'impervious',  name:'无懈可击', type:'passive', desc:'己方棋子无法被技能选中'},
  {id:'ambush',      name:'暗度陈仓', type:'active',  desc:'连下2子：第1子为假(对手可见但不计胜利)，第2子为真(对手不可见)，全局只能用一次'},
];

const rooms = new Map();
const playerRoom = new Map();

function createRoom(id, mode, names) {
  const count = mode === 3 ? 3 : 2;
  const players = new Array(count).fill(null);
  const roles = count === 3 ? [P1, P2, P3] : [P1, P2];
  return {
    id, mode, count, players, roles, names,
    board: Array.from({length:N},()=>Array(N).fill(EMPTY)),
    stoneAge: Array.from({length:N},()=>Array(N).fill(0)),
    riftAge: Array.from({length:N},()=>Array(N).fill(0)),
    // swap tracking: board stores original owner temporarily
    swapMap: {}, // "r,c" -> {owner, turnsLeft}
    // ambush hidden stones: 真棋子对其他玩家隐藏
    ambushHidden: {}, // "r,c" -> player (真棋子位置，只有该玩家可见)
    currentPlayer: P1,
    totalMoves: 0,
    history: [],
    gameOver: false,
    winCells: [],
    novaLine: null,
    scores: {},
    ready: new Array(count).fill(false),
    gameStarted: false,
    globalSettings: {devour:true,decay:true,nova:true,rift:true},
    // Player skill state
    equipped: {}, // role -> [skillId, skillId] (chosen at start)
    skillState: {}, // role -> {id: cooldown/used/etc}
    skipNext: new Set(),
    pendingSkill: null,
    pendingTimer: null,
    // Ambush state
    ambushState: null, // {player, phase:'fake'|'real'}
    // Skill usage limits
    ambushUsed: new Set(), // roles who have used ambush (全局只能用一次)
    sandstormLastUsed: {}, // role -> lastUsedMove (飞沙走石上次使用的回合数)
    // Undo request state
    undoRequest: null, // {from: role} - 悔棋请求
    lastActivity: Date.now()
  };
}

function initSkillState(room) {
  for (const role of room.roles) {
    room.skillState[role] = {};
    const equipped = room.equipped[role] || [];
    for (const sid of equipped) {
      room.skillState[role][sid] = sid === 'move' ? 0 : 0; // move has cooldown, start at 0
    }
  }
}

function getRoomId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id=''; for(let i=0;i<5;i++) id+=c[Math.floor(Math.random()*c.length)]; } while(rooms.has(id));
  return id;
}

function playerRole(ws) {
  const rid = playerRoom.get(ws);
  if (!rid) return null;
  const room = rooms.get(rid);
  if (!room) return null;
  const idx = room.players.indexOf(ws);
  return idx >= 0 ? room.roles[idx] : null;
}

function broadcastAll(room, msg) {
  const data = JSON.stringify(msg);
  for (const p of room.players) if (p && p.readyState === WebSocket.OPEN) p.send(data);
}

function broadcastExcept(room, msg, excludeWs) {
  const data = JSON.stringify(msg);
  for (const p of room.players) if (p && p !== excludeWs && p.readyState === WebSocket.OPEN) p.send(data);
}

function snap(room) {
  // For ambush: hide real stone from non-ambush players
  const board = room.board.map(row => [...row]);
  const ambush = room.ambushState;

  // 从 ambushHidden 中找出假棋子位置
  const fakePositions = [];
  for (const key of Object.keys(room.ambushHidden)) {
    if (key.startsWith('fake_')) {
      const parts = key.split('_');
      fakePositions.push([parseInt(parts[1]), parseInt(parts[2]), room.ambushHidden[key]]);
    }
  }

  return {
    board,
    stoneAge: room.stoneAge,
    riftAge: room.riftAge,
    currentPlayer: room.currentPlayer,
    totalMoves: room.totalMoves,
    gameOver: room.gameOver,
    winCells: room.winCells,
    novaLine: room.novaLine,
    scores: room.scores,
    skipNext: [...room.skipNext],
    globalSettings: room.globalSettings,
    pendingSkill: room.pendingSkill ? {
      type: room.pendingSkill.type,
      player: room.pendingSkill.player,
      r: room.pendingSkill.r,
      c: room.pendingSkill.c
    } : null,
    equipped: room.equipped,
    skillState: room.skillState,
    ambushPhase: ambush ? ambush.phase : null,
    ambushPlayer: ambush ? ambush.player : null,
    ambushFakePos: ambush ? ambush.fakePos : null, // 当前进行中的假棋子
    ambushRealPos: ambush ? ambush.realPos : null, // 当前进行中的真棋子
    ambushHidden: room.ambushHidden, // 暗度陈仓真棋子（已完成）
    ambushFakePositions: fakePositions, // 已完成的假棋子位置列表
    swapMap: room.swapMap
  };
}

// Personalized snapshot: hide ambush real stone from others
function personalSnap(room, role) {
  const s = snap(room);
  // 隐藏暗度陈仓的真棋子（其他玩家看不到）
  // 注意：只处理 "r,c" 格式的 key（真棋子），跳过 "fake_r_c" 格式（假棋子）
  for (const key of Object.keys(room.ambushHidden)) {
    // 跳过假棋子记录
    if (key.startsWith('fake_')) continue;
    
    const hiddenOwner = room.ambushHidden[key];
    if (hiddenOwner !== role) {
      const [hr, hc] = key.split(',').map(Number);
      if (hr >= 0 && hr < N && hc >= 0 && hc < N) {
        s.board[hr][hc] = EMPTY;
      }
    }
  }
  // ambushState 正在进行时，隐藏真棋子
  if (room.ambushState && room.ambushState.phase === 'real' && room.ambushState.player !== role) {
    if (room.ambushState.realPos) {
      const [rr, rc] = room.ambushState.realPos;
      s.board[rr][rc] = EMPTY;
    }
  }
  return s;
}

function advanceTurn(room) {
  let idx = room.roles.indexOf(room.currentPlayer);
  for (let i = 0; i < room.count; i++) {
    idx = (idx + 1) % room.count;
    const next = room.roles[idx];
    if (room.skipNext.has(next)) { room.skipNext.delete(next); continue; }
    room.currentPlayer = next;
    return;
  }
  room.currentPlayer = room.roles[0];
}

function findLines(board, r, c, player, length, excludePos = null) {
  // excludePos: 排除的位置（假棋子），在检测时被视为 EMPTY
  const dirs=[[0,1],[1,0],[1,1],[1,-1]], results=[];
  for (const [dr,dc] of dirs) {
    let cells=[[r,c]];
    // 检查 cells 中的位置是否被排除
    const isExcluded = (nr, nc) => excludePos && excludePos[0] === nr && excludePos[1] === nc;
    
    for(let i=1;i<length;i++){
      const nr=r+dr*i,nc=c+dc*i;
      if(nr<0||nr>=N||nc<0||nc>=N)break;
      if(isExcluded(nr,nc))break; // 排除假棋子
      if(board[nr][nc]!==player)break;
      cells.push([nr,nc]);
    }
    for(let i=1;i<length;i++){
      const nr=r-dr*i,nc=c-dc*i;
      if(nr<0||nr>=N||nc<0||nc>=N)break;
      if(isExcluded(nr,nc))break; // 排除假棋子
      if(board[nr][nc]!==player)break;
      cells.unshift([nr,nc]);
    }
    if(cells.length>=length) results.push(cells.slice(0,length));
  }
  return results;
}

function applyDevour(room, r, c, player) {
  const enemies = room.roles.filter(p => p !== player);
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
  const allDevoured = [];
  for (let chain = 0; chain < 3; chain++) {
    const toDevour = [];
    const sources = chain === 0 ? [[r,c]] : allDevoured.slice(-5);
    const checked = new Set();
    for (const [sr,sc] of sources) {
      for (const [dr,dc] of dirs) {
        const nr=sr+dr,nc=sc+dc;
        if(nr<0||nr>=N||nc<0||nc>=N)continue;
        const cell=room.board[nr][nc];
        if(!enemies.includes(cell))continue;
        const key=nr*N+nc;
        if(checked.has(key))continue;
        checked.add(key);
        let surr=0;
        for(const [dr2,dc2] of dirs){const ar=nr+dr2,ac=nc+dc2;if(ar<0||ar>=N||ac<0||ac>=N)continue;if(room.board[ar][ac]===player)surr++;}
        if(surr>=3) toDevour.push([nr,nc,cell]);
      }
    }
    if(toDevour.length===0)break;
    for(const [dr,dc] of toDevour){room.board[dr][dc]=player;room.stoneAge[dr][dc]=0;allDevoured.push([dr,dc]);}
  }
  return allDevoured;
}

// 悔棋功能：撤销上一手棋
function undoLastMove(room) {
  if(room.history.length === 0) return {error:'没有可悔棋的历史'};
  if(room.gameOver) return {error:'游戏已结束，无法悔棋'};
  if(room.ambushState) return {error:'暗度陈仓进行中，无法悔棋'};
  if(room.pendingSkill) return {error:'技能结算中，无法悔棋'};

  // 获取最后一手
  const lastMove = room.history.pop();
  if(!lastMove) return {error:'历史记录为空'};

  // 撤销棋子
  const {r, c, player, type} = lastMove;
  if(type === 'place'){
    // 检查是否是暗度陈仓的真棋子（需要同时清除假棋子）
    const ambushKey = `${r},${c}`;
    if(room.ambushHidden[ambushKey] === player){
      // 清除真棋子记录
      delete room.ambushHidden[ambushKey];
      // 找并清除假棋子
      for(const key of Object.keys(room.ambushHidden)){
        if(key.startsWith('fake_') && room.ambushHidden[key] === player){
          const parts = key.split('_');
          const fr = parseInt(parts[1]), fc = parseInt(parts[2]);
          room.board[fr][fc] = EMPTY;
          room.stoneAge[fr][fc] = 0;
          delete room.ambushHidden[key];
        }
      }
    }
    // 清除棋子
    room.board[r][c] = EMPTY;
    room.stoneAge[r][c] = 0;
    // 回退回合
    room.totalMoves--;
    // 悔棋后回合回到悔棋的玩家（让他重新落子）
    room.currentPlayer = player;
    // 清除胜利状态
    room.winCells = [];
    room.novaLine = null;
    console.log(`[悔棋] 玩家${player} 撤销 (${r},${c})，回合回到 ${room.currentPlayer}`);
    return {ok:true, undone:{r,c,player}, snapshot:snap(room)};
  }
  return {error:'无法撤销该类型操作'};
}

// 处理悔棋请求
function handleUndoRequest(room, player) {
  if(room.gameOver) return {error:'游戏已结束'};
  if(room.ambushState) return {error:'暗度陈仓进行中'};
  if(room.pendingSkill) return {error:'技能结算中'};
  if(room.history.length === 0) return {error:'没有可悔棋的历史'};
  if(room.undoRequest) return {error:'已有悔棋请求待处理'};
  // 只有刚落子的玩家（当前回合的前一个玩家）才能请求悔棋
  const roles = room.roles;
  const idx = roles.indexOf(room.currentPlayer);
  const prevPlayer = roles[(idx - 1 + room.count) % room.count];
  if(player !== prevPlayer) return {error:'只有刚落子的玩家才能请求悔棋'};

  room.undoRequest = {from: player};
  console.log(`[悔棋请求] 玩家${player} 请求悔棋`);
  return {ok:true, undoRequest: true, from: player};
}

// 处理悔棋响应
function handleUndoResponse(room, player, accepted) {
  if(!room.undoRequest) return {error:'没有悔棋请求'};
  if(room.undoRequest.from === player) return {error:'不能响应自己的悔棋请求'};
  room.undoRequest = null;
  if(accepted){
    const result = undoLastMove(room);
    if(result.error) return result;
    console.log(`[悔棋] 玩家${player} 同意悔棋`);
    return {ok:true, undoAccepted: true, ...result};
  }else{
    console.log(`[悔棋] 玩家${player} 拒绝悔棋`);
    return {ok:true, undoRejected: true};
  }
}

function applyDecay(room) {
  let d=0;
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    if(room.roles.includes(room.board[r][c])){
      room.stoneAge[r][c]++;
      if(room.stoneAge[r][c]>=DECAY_TURNS){room.board[r][c]=RUIN;room.stoneAge[r][c]=0;d++;}
    }
  }
  return d;
}

function spawnRifts(room) {
  const count=Math.random()>0.5?2:1;
  const empty=[];
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(room.board[r][c]===EMPTY) empty.push([r,c]);
  for(let i=empty.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[empty[i],empty[j]]=[empty[j],empty[i]];}
  let s=0;
  for(let i=0;i<Math.min(count,empty.length);i++){const [r,c]=empty[i];room.board[r][c]=RIFT;room.riftAge[r][c]=0;s++;}
  return s;
}

function ageRifts(room) {
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    if(room.board[r][c]===RIFT){room.riftAge[r][c]++;if(room.riftAge[r][c]>=RIFT_DURATION){room.board[r][c]=EMPTY;room.riftAge[r][c]=0;}}
  }
}

// Process swap timer each move
function processSwaps(room) {
  const toRevert = [];
  for (const key of Object.keys(room.swapMap)) {
    const s = room.swapMap[key];
    s.turnsLeft--;
    if (s.turnsLeft <= 0) {
      const [r,c] = key.split(',').map(Number);
      room.board[r][c] = s.owner;
      room.stoneAge[r][c] = 0;
      toRevert.push(key);
    }
  }
  for (const k of toRevert) delete room.swapMap[k];
  return toRevert.length;
}

function postMove(room) {
  if(room.globalSettings.decay) applyDecay(room);
  if(room.globalSettings.rift && room.totalMoves>0 && room.totalMoves%RIFT_INTERVAL===0) spawnRifts(room);
  ageRifts(room);
  processSwaps(room);
  // Decrement move skill cooldowns
  for (const role of room.roles) {
    const ss = room.skillState[role];
    if (ss) {
      for (const sid of Object.keys(ss)) {
        if (sid === 'move' && ss[sid] > 0) ss[sid]--;
      }
    }
  }
  let empties=0;
  for(let i=0;i<N;i++) for(let j=0;j<N;j++) if(room.board[i][j]===EMPTY) empties++;
  if(empties===0) room.gameOver=true;
}

// Check if a cell is protected by impervious
function isImpervious(room, r, c) {
  const owner = room.board[r][c];
  if (!room.roles.includes(owner)) return false;
  const equipped = room.equipped[owner] || [];
  return equipped.includes('impervious');
}

function handlePlace(room, r, c, player) {
  if(room.gameOver) return {error:'游戏已结束'};
  
  // Ambush real phase: 允许该玩家在 ambush 状态下落子（即使不是当前回合）
  if (room.ambushState && room.ambushState.player === player && room.ambushState.phase === 'real') {
    if(room.board[r][c]!==EMPTY) return {error:'此处不可落子'};
    console.log(`[暗度陈仓] 玩家${player} 下真棋子于 (${r},${c})，假棋子位置: ${room.ambushState.fakePos}`);
    
    // 假棋子已经在棋盘上了（对手可见），不需要再放
    // 只需要放真棋子（对手不可见）
    room.board[r][c] = player;
    room.stoneAge[r][c] = 0;
    room.ambushState.realPos = [r, c];
    
    // 记录真棋子到 ambushHidden，对手看不到
    room.ambushHidden[`${r},${c}`] = player;
    
    const fakePos = room.ambushState.fakePos; // 假棋子位置
    room.ambushState = null; // ambush complete
    room.history.push({r,c,player,type:'place'});
    room.totalMoves++;
    console.log(`[暗度陈仓] 完成！假棋子(对手可见)和真棋子(对手不可见)都已落下`);

    const devoured = room.globalSettings.devour ? applyDevour(room,r,c,player) : [];
    // Check win — ambush real stone CAN win (it's a normal stone)
    // 假棋子不参与胜利检测
    room.novaLine = null;
    if(room.globalSettings.nova){const four=findLines(room.board,r,c,player,4,fakePos);if(four.length>0)room.novaLine={cells:four[0],player};}
    const five=findLines(room.board,r,c,player,5,fakePos);
    if(five.length>0){room.gameOver=true;room.winCells=five[0];room.scores[player]=(room.scores[player]||0)+1;room.novaLine=null;}

    if(!room.gameOver){postMove(room);if(!room.novaLine)advanceTurn(room);}
    return {ok:true,devoured,action:'place',ambushComplete:true,fakePos,snapshot:snap(room)};
  }
  
  // 正常回合检查（非 ambush 状态）
  if(room.currentPlayer!==player) return {error:'不是你的回合'};
  if(room.pendingSkill) return {error:'等待技能结算'};

  // 检查该位置是否有其他玩家的暗度陈仓真棋子
  const ambushKey = `${r},${c}`;
  if(room.ambushHidden[ambushKey] && room.ambushHidden[ambushKey] !== player){
    // 暴露真棋子！清除隐藏状态，对手能看到真棋子了
    const realOwner = room.ambushHidden[ambushKey];
    delete room.ambushHidden[ambushKey];
    // 清除该玩家的假棋子（如果存在）
    // 假棋子位置需要从 ambushState 的历史记录中找
    // 由于 ambushState 已清空，我们需要另一种方式跟踪假棋子
    // 暂时通过检查是否有该玩家的 ambushHidden 其他位置来推断
    // 更好的方式：在 ambushHidden 记录假棋子位置
    // 让我们返回一个特殊消息通知对手
    return {error:`此处已有 ${room.names[realOwner]||'?'} 的「暗度陈仓」真棋子！`, ambushExposed: true, ambushOwner: realOwner, ambushPos: [r, c]};
  }

  if(room.board[r][c]!==EMPTY) return {error:'此处不可落子'};

  room.board[r][c]=player; room.stoneAge[r][c]=0;
  room.history.push({r,c,player,type:'place'});
  room.totalMoves++;

  const devoured = room.globalSettings.devour ? applyDevour(room,r,c,player) : [];
  room.novaLine = null;
  
  // 获取假棋子位置（如果有），用于排除胜利检测
  const fakePos = room.ambushState ? room.ambushState.fakePos : null;
  
  if(room.globalSettings.nova){const four=findLines(room.board,r,c,player,4,fakePos);if(four.length>0)room.novaLine={cells:four[0],player};}

  // Check win: skip if this stone is swap-converted (shouldn't happen on normal place but safety)
  const five=findLines(room.board,r,c,player,5,fakePos);
  if(five.length>0){room.gameOver=true;room.winCells=five[0];room.scores[player]=(room.scores[player]||0)+1;room.novaLine=null;}

  if(!room.gameOver){postMove(room);if(!room.novaLine)advanceTurn(room);}
  return {ok:true,devoured,action:'place',snapshot:snap(room)};
}

function handleSupernova(room, player) {
  if(!room.novaLine||room.gameOver) return {error:'无法引爆'};
  if(room.novaLine.player!==player) return {error:'不是你的连珠'};
  const cells=room.novaLine.cells;const destroyed=[];
  for(const [lr,lc] of cells){
    for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++){
      const nr=lr+dr,nc=lc+dc;if(nr<0||nr>=N||nc<0||nc>=N)continue;
      if(room.board[nr][nc]!==EMPTY&&room.board[nr][nc]!==RIFT){
        if(isImpervious(room,nr,nc)) continue; // impervious protects
        destroyed.push([nr,nc,room.board[nr][nc]]);
        room.board[nr][nc]=EMPTY;room.stoneAge[nr][nc]=0;
        delete room.swapMap[`${nr},${nc}`];
      }
    }
  }
  room.novaLine=null;room.totalMoves++;postMove(room);advanceTurn(room);
  return {ok:true,destroyed,action:'supernova',snapshot:snap(room)};
}

function handleDismissNova(room, player) {
  if(!room.novaLine||room.novaLine.player!==player) return {error:'无法放弃'};
  room.novaLine=null;advanceTurn(room);
  return {ok:true,action:'dismissNova',snapshot:snap(room)};
}

function resolveSandstorm(room) {
  const ps=room.pendingSkill;if(!ps)return;
  const prevValue = room.board[ps.r][ps.c];
  // 飞沙走石后生成废墟，而不是空位
  room.board[ps.r][ps.c]=RUIN;room.stoneAge[ps.r][ps.c]=0;
  delete room.swapMap[`${ps.r},${ps.c}`];
  // 清除暗度陈仓隐藏棋子记录（如果该位置有）
  delete room.ambushHidden[`${ps.r},${ps.c}`];
  room.pendingSkill=null;room.pendingTimer=null;
  console.log(`[飞沙走石] (${ps.r},${ps.c}) 从 ${prevValue} 变为废墟(RUIN=4)`);
  room.totalMoves++;postMove(room);advanceTurn(room);
  broadcastAll(room,{type:'skillApplied',skill:'sandstorm',player:ps.player,r:ps.r,c:ps.c,snapshot:snap(room)});
}

function handleSkill(room, msg, player) {
  if(room.gameOver) return {error:'游戏已结束'};
  if(room.currentPlayer!==player) return {error:'不是你的回合'};
  if(room.pendingSkill) return {error:'等待技能结算'};

  const sid = msg.skill;
  const equipped = room.equipped[player] || [];
  if (!equipped.includes(sid)) return {error:'未装备该技能'};

  if(sid==='sandstorm'){
    const {r,c}=msg;
    if(r<0||r>=N||c<0||c>=N) return {error:'无效位置'};
    if(!room.roles.includes(room.board[r][c])) return {error:'该位置无棋子'};
    if(isImpervious(room,r,c)) return {error:'该棋子受无懈可击保护'};
    // 飞沙走石：每5回合可用一次
    const lastUsed = room.sandstormLastUsed[player] || 0;
    const movesSinceLastUse = room.totalMoves - lastUsed;
    if(lastUsed > 0 && movesSinceLastUse < 5){
      return {error:`飞沙走石冷却中，还需 ${5 - movesSinceLastUse} 回合`};
    }
    room.sandstormLastUsed[player] = room.totalMoves; // 记录使用回合
    room.pendingSkill={type:'sandstorm',player,r,c};
    broadcastAll(room,{type:'skillPending',skill:'sandstorm',player,r,c});
    room.pendingTimer=setTimeout(()=>{if(room.pendingSkill&&room.pendingSkill.type==='sandstorm')resolveSandstorm(room);},1200);
    return {ok:true,action:'skill',skill:'sandstorm',pending:true,player};
  }

  if(sid==='stillwater'){
    const target=msg.target;
    if(!room.roles.includes(target)||target===player) return {error:'无效目标'};
    room.skipNext.add(target);
    room.totalMoves++;postMove(room);advanceTurn(room);
    return {ok:true,action:'skill',skill:'stillwater',player,target,snapshot:snap(room)};
  }

  if(sid==='mountain'){
    if(room.totalMoves<=50) return {error:'回合数不足50'};
    room.gameOver=true;room.winCells=[];room.scores[player]=(room.scores[player]||0)+1;
    return {ok:true,action:'skill',skill:'mountain',winner:player,snapshot:snap(room)};
  }

  if(sid==='swap'){
    const {r,c}=msg;
    if(r<0||r>=N||c<0||c>=N) return {error:'无效位置'};
    const target = room.board[r][c];
    if(!room.roles.includes(target) || target===player) return {error:'只能对敌方棋子使用'};
    if(isImpervious(room,r,c)) return {error:'该棋子受无懈可击保护'};
    // Convert to player's stone for 3 turns
    room.swapMap[`${r},${c}`] = {owner: target, turnsLeft: 3};
    room.board[r][c] = player;
    room.stoneAge[r][c] = 0;
    room.totalMoves++;
    // Do NOT check win — swap cannot win this turn
    postMove(room);advanceTurn(room);
    return {ok:true,action:'skill',skill:'swap',player,r,c,from:target,to:player,snapshot:snap(room)};
  }

  if(sid==='move'){
    const {fr,fc,tr,tc}=msg; // from and to
    if(fr<0||fr>=N||fc<0||fc>=N||tr<0||tr>=N||tc<0||tc>=N) return {error:'无效位置'};
    if(!room.roles.includes(room.board[fr][fc])) return {error:'起始位置无棋子'};
    if(room.board[tr][tc]!==EMPTY) return {error:'目标位置必须为空'};
    if(isImpervious(room,fr,fc)) return {error:'该棋子受无懈可击保护'};
    // Check cooldown
    const ss = room.skillState[player] || {};
    if(ss.move > 0) return {error:`斗转星移冷却中，还需${ss.move}回合`};
    // Move stone
    room.board[tr][tc] = room.board[fr][fc];
    room.stoneAge[tr][tc] = room.stoneAge[fr][fc];
    room.board[fr][fc] = EMPTY;
    room.stoneAge[fr][fc] = 0;
    // Transfer swap tracking if exists
    const swapKey = `${fr},${fc}`;
    if(room.swapMap[swapKey]){
      room.swapMap[`${tr},${tc}`] = room.swapMap[swapKey];
      delete room.swapMap[swapKey];
    }
    ss.move = 5; // cooldown
    room.skillState[player] = ss;
    room.totalMoves++;postMove(room);advanceTurn(room);
    return {ok:true,action:'skill',skill:'move',player,fr,fc,tr,tc,snapshot:snap(room)};
  }

  if(sid==='ambush'){
    // 暗度陈仓：全局只能使用一次
    if(room.ambushUsed.has(player)){
      return {error:'暗度陈仓全局只能使用一次，你已经用过了'};
    }
    room.ambushUsed.add(player); // 标记已使用
    // Phase 1: place a fake stone (next place will be fake, then real)
    room.ambushState = {player, phase:'fake', fakePos:null, realPos:null};
    console.log(`[暗度陈仓] 玩家${player} 启动技能，phase=fake（全局只能用一次）`);
    return {ok:true,action:'skill',skill:'ambush',phase:'fake',player,snapshot:snap(room)};
  }

  return {error:'未知技能'};
}

// Handle ambush fake placement
function handleAmbushFake(room, r, c, player) {
  if (!room.ambushState || room.ambushState.player !== player || room.ambushState.phase !== 'fake') return false;
  if(room.board[r][c]!==EMPTY) return false;

  // 假棋子放到公共棋盘上，对手可见（但不参与胜利检测）
  room.board[r][c] = player;
  room.stoneAge[r][c] = 0;
  room.ambushState.fakePos = [r, c];
  room.ambushState.phase = 'real'; // next placement is the real one
  // 记录假棋子位置到 ambushHidden（用于胜利检测时排除）
  room.ambushHidden[`fake_${r}_${c}`] = player;

  // 不增加 totalMoves，不推进回合
  console.log(`[暗度陈仓] 玩家${player} 下假棋子于 (${r},${c})，对手可见（不计胜利）`);
  
  // 广播给所有玩家
  broadcastAll(room, {type:'ambushFake', player, r, c, snapshot:snap(room)});
  return true;
}

function handleIntercept(room, player) {
  if(!room.pendingSkill||room.pendingSkill.type!=='sandstorm') return {error:'无待响应技能'};
  if(player===room.pendingSkill.player) return {error:'不能响应自己的技能'};
  if(!(room.equipped[player]||[]).includes('intercept')) return {error:'未装备擒拿'};
  if(room.pendingTimer){clearTimeout(room.pendingTimer);room.pendingTimer=null;}
  const originalPlayer=room.pendingSkill.player;
  room.pendingSkill=null;room.totalMoves++;postMove(room);advanceTurn(room);
  return {ok:true,action:'intercept',interceptor:player,originalPlayer,snapshot:snap(room)};
}

function resetRoom(room) {
  room.board=Array.from({length:N},()=>Array(N).fill(EMPTY));
  room.stoneAge=Array.from({length:N},()=>Array(N).fill(0));
  room.riftAge=Array.from({length:N},()=>Array(N).fill(0));
  room.swapMap={};
  room.ambushHidden={}; // 清空暗度陈仓隐藏棋子
  room.currentPlayer=P1;room.totalMoves=0;room.history=[];
  room.gameOver=false;room.winCells=[];room.novaLine=null;
  room.ready=new Array(room.count).fill(false);
  room.skipNext=new Set();room.pendingSkill=null;
  room.ambushState=null;
  room.ambushUsed=new Set(); // 重置暗度陈仓使用记录
  room.sandstormLastUsed={}; // 重置飞沙走石使用记录
  room.undoRequest=null; // 重置悔棋请求
  if(room.pendingTimer){clearTimeout(room.pendingTimer);room.pendingTimer=null;}
  initSkillState(room);
}

// ── WebSocket ──
wss.on('connection', ws => {
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true;});

  ws.on('message', raw => {
    let msg;
    try{msg=JSON.parse(raw)}catch{return;}

    switch(msg.type){
      case 'create':{
        const id=getRoomId();
        const mode=msg.mode||2;
        const names=msg.names||{1:'星辰',2:'虚空',3:'极光'};
        const room=createRoom(id,mode,names);
        rooms.set(id,room);
        room.players[0]=ws;
        playerRoom.set(ws,id);
        console.log(`[创建] 房间${id} ${mode}人`);
        ws.send(JSON.stringify({type:'joined',roomId:id,role:room.roles[0],playerIndex:0,mode,names:room.names}));
        ws.send(JSON.stringify({type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode,allSkills:ALL_SKILLS}));
        break;
      }
      case 'join':{
        const id=msg.roomId?.toUpperCase();
        const room=rooms.get(id);
        if(!room){ws.send(JSON.stringify({type:'error',message:'房间不存在'}));return;}
        if(room.gameStarted){ws.send(JSON.stringify({type:'error',message:'游戏已开始'}));return;}
        const emptyIdx=room.players.findIndex(p=>p===null);
        if(emptyIdx===-1){ws.send(JSON.stringify({type:'error',message:'房间已满'}));return;}
        room.players[emptyIdx]=ws;
        const assignedRole=room.roles[emptyIdx];
        playerRoom.set(ws,id);
        if(msg.name&&msg.name.trim()) room.names[assignedRole]=msg.name.trim().slice(0,8);
        console.log(`[加入] 房间${id} → 位${emptyIdx}`);
        ws.send(JSON.stringify({type:'joined',roomId:id,role:assignedRole,playerIndex:emptyIdx,mode:room.mode,names:room.names}));
        broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS});
        break;
      }
      case 'setName':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        if(msg.name&&msg.name.trim()) room.names[role]=msg.name.trim().slice(0,8);
        broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS});
        break;
      }
      case 'toggleSetting':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        if(room.players.indexOf(ws)!==0)return;
        const key=msg.key;
        if(room.globalSettings.hasOwnProperty(key)){
          room.globalSettings[key]=!room.globalSettings[key];
          broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS});
        }
        break;
      }
      case 'equipSkills':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const skills=msg.skills||[];
        if(skills.length>2) return ws.send(JSON.stringify({type:'error',message:'最多选2个技能'}));
        room.equipped[role]=skills.slice(0,2);
        broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS,equipped:room.equipped});
        break;
      }
      case 'startGame':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        if(room.players.indexOf(ws)!==0)return;
        if(room.players.some(p=>p===null))return;
        // Check all players equipped skills
        for(const role of room.roles){
          if(!room.equipped[role]||room.equipped[role].length===0){
            return ws.send(JSON.stringify({type:'error',message:`${room.names[role]}尚未选择技能`}));
          }
        }
        room.gameStarted=true;
        for(const r of room.roles) room.scores[r]=0;
        initSkillState(room);
        console.log(`[开始] 房间${rid}`);
        broadcastAll(room,{type:'gameStart',snapshot:snap(room),names:room.names,mode:room.mode});
        break;
      }
      case 'place':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;

        // Ambush fake phase: intercept normal place
        if(room.ambushState && room.ambushState.player===role && room.ambushState.phase==='fake'){
          if(handleAmbushFake(room, msg.r, msg.c, role)){
            // After fake, turn stays with same player for real placement
            // Don't advance turn
            return;
          }
        }

        const result=handlePlace(room,msg.r,msg.c,role);
        if(result.error){
          ws.send(JSON.stringify({type:'error',message:result.error}));
          // 暗度陈仓被揭露
          if(result.ambushExposed && result.ambushOwner){
            // 清除假棋子
            // 查找该玩家的假棋子位置
            for(const key of Object.keys(room.ambushHidden)){
              if(key.startsWith('fake_') && room.ambushHidden[key] === result.ambushOwner){
                const parts = key.split('_');
                const fr = parseInt(parts[1]), fc = parseInt(parts[2]);
                room.board[fr][fc] = EMPTY;
                room.stoneAge[fr][fc] = 0;
                delete room.ambushHidden[key];
              }
            }
            // 广播通知
            broadcastAll(room,{type:'ambushExposed',owner:result.ambushOwner,pos:result.ambushPos,snapshot:snap(room)});
          }
          return;
        }
        // Send personalized snapshots for ambush
        for(const p of room.players){
          if(p&&p.readyState===1){
            const pRole=playerRole(p);
            if(!pRole) continue; // 跳过无效角色
            const ps=personalSnap(room,pRole);
            p.send(JSON.stringify({type:'update',...result,snapshot:ps}));
          }
        }
        break;
      }
      case 'useSkill':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const result=handleSkill(room,msg,role);
        if(result.error){ws.send(JSON.stringify({type:'error',message:result.error}));return;}
        // Send personalized snapshots
        for(const p of room.players){
          if(p&&p.readyState===1){
            const pRole=playerRole(p);
            const ps=personalSnap(room,pRole);
            p.send(JSON.stringify({type:'skill',...result,snapshot:ps}));
          }
        }
        break;
      }
      case 'intercept':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const result=handleIntercept(room,role);
        if(result.error){ws.send(JSON.stringify({type:'error',message:result.error}));return;}
        broadcastAll(room,{type:'intercept',...result});
        break;
      }
      case 'supernova':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const result=handleSupernova(room,role);
        if(result.error){ws.send(JSON.stringify({type:'error',message:result.error}));return;}
        broadcastAll(room,{type:'update',...result});
        break;
      }
      case 'dismissNova':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const result=handleDismissNova(room,role);
        if(result.error){ws.send(JSON.stringify({type:'error',message:result.error}));return;}
        broadcastAll(room,{type:'update',...result});
        break;
      }
      case 'restart':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const pi=room.players.indexOf(ws);if(pi<0)return;
        room.ready[pi]=true;
        for(const opp of room.players){if(opp&&opp!==ws&&opp.readyState===1)opp.send(JSON.stringify({type:'restartRequested'}));}
        if(room.ready.every(Boolean)){
          const scores=room.scores;const settings=room.globalSettings;const equipped=room.equipped;
          resetRoom(room);room.scores=scores;room.globalSettings=settings;room.equipped=equipped;room.gameStarted=true;
          initSkillState(room);
          broadcastAll(room,{type:'restarted',snapshot:snap(room),names:room.names,mode:room.mode});
        }
        break;
      }
      case 'chat':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        broadcastExcept(room,{type:'chat',from:role,text:(msg.text||'').slice(0,200)},ws);
        break;
      }
      case 'undoRequest':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const result = handleUndoRequest(room, role);
        if(result.error){ws.send(JSON.stringify({type:'error',message:result.error}));return;}
        broadcastAll(room,{type:'undoRequestPending',from:role,snapshot:snap(room)});
        break;
      }
      case 'undoResponse':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const accepted = msg.accepted === true;
        const result = handleUndoResponse(room, role, accepted);
        if(result.error){ws.send(JSON.stringify({type:'error',message:result.error}));return;}
        if(result.undoAccepted){
          broadcastAll(room,{type:'undoAccepted',from:role,undone:result.undone,snapshot:result.snapshot});
        }else{
          broadcastAll(room,{type:'undoRejected',from:role});
        }
        break;
      }
    }
  });

  ws.on('close',()=>{
    const rid=playerRoom.get(ws);if(!rid)return;
    const room=rooms.get(rid);if(!room)return;
    const pi=room.players.indexOf(ws);if(pi<0)return;
    const role=room.roles[pi];
    room.players[pi]=null;playerRoom.delete(ws);
    if(room.pendingTimer){clearTimeout(room.pendingTimer);room.pendingTimer=null;}
    room.pendingSkill=null;
    broadcastAll(room,{type:'playerLeft',playerIndex:pi,role});
    if(room.players.every(p=>p===null))setTimeout(()=>{if(room.players.every(p=>p===null))rooms.delete(rid);},30000);
  });
});

setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.isAlive)return ws.terminate();ws.isAlive=false;ws.ping();});},30000);
setInterval(()=>{for(const[id,r]of rooms){if(Date.now()-r.lastActivity>3600000&&r.players.every(p=>p===null))rooms.delete(id);}},300000);

server.listen(PORT,()=>console.log(`星虚对弈服务器: http://localhost:${PORT}`));
