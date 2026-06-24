const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { getAIMove, aiAmbush } = require('./ai-pool');
const { validateMessage, createRateLimiter } = require('./validate');
const CONFIG = require('./config/rules');

const PORT = process.env.PORT || 3000;

// ── 静态文件服务（带目录穿越防护）──
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MIME_TYPES = {
  '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.webp':'image/webp', '.ico':'image/x-icon',
  '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.map':'application/json', '.txt':'text/plain',
};
const TEXT_TYPES = new Set(['.html','.js','.mjs','.css','.json','.svg','.txt','.map']);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
};

function sendError(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
  res.end(msg);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method Not Allowed');

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  } catch { return sendError(res, 400, 'Bad Request'); }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.resolve(PUBLIC_DIR, '.' + urlPath);
  // 防止目录穿越：必须仍在 PUBLIC_DIR 内
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendError(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendError(res, 404, 'Not Found');
    const ext = path.extname(filePath).toLowerCase();
    const baseType = MIME_TYPES[ext] || 'application/octet-stream';
    const contentType = TEXT_TYPES.has(ext) ? baseType + '; charset=utf-8' : baseType;
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cache, ...SECURITY_HEADERS });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: CONFIG.net.maxPayloadBytes });

const N = CONFIG.board.N;
const EMPTY = 0, P1 = 1, P2 = 2, P3 = 3, RUIN = 4, RIFT = 5;
const DECAY_TURNS = CONFIG.rules.decayTurns;
const RIFT_INTERVAL = CONFIG.rules.rift.interval;
const RIFT_DURATION = CONFIG.rules.rift.duration;
const RUIN_DURATION = CONFIG.rules.ruinDuration;
const MOUNTAIN_MIN_TURN = CONFIG.rules.mountainMinTurn;
const BLOOD_FIVE_COUNT = CONFIG.rules.blood.fiveCount;
const BLOOD_SCORE_TO_WIN = CONFIG.rules.blood.scoreToWin;
const BLOOD_MOUNTAIN_SCORE = CONFIG.rules.blood.mountainScore;
const COOLDOWN_SANDSTORM = CONFIG.skills.sandstorm.cooldown;
const COOLDOWN_SWAPPOS = CONFIG.skills.swapPos.cooldown;
const COOLDOWN_MOVE = CONFIG.skills.move.cooldown;
const SWAP_DURATION = CONFIG.skills.swap.duration;
const PENDING_TIMER_MS = CONFIG.skills.pendingTimerMs;
const NAME_MAX_LEN = CONFIG.limits.nameMaxLen;
const CHAT_MAX_LEN = CONFIG.limits.chatMaxLen;

// All available skills
const { ALL_SKILLS } = require('./src/skills/all');
const skillRegistry = require('./src/skills/registry');
const {
  findLines, applyDevour,
  applyDecay, spawnRifts, ageRifts, ageRuins, processSwaps,
  postMove, advanceTurn, isImpervious,
  applyGravity,
} = require('./src/rules/board');
const { bloodClear, checkBloodWin } = require('./src/rules/blood');
const { snap, personalSnap } = require('./src/rules/snapshot');
const { undoLastMove, handleUndoRequest, handleUndoResponse } = require('./src/rules/undo');
const { createRoom, initSkillState, resetRoom } = require('./src/state/room');

const rooms = new Map();
const playerRoom = new Map();

// ── AI 伪连接 ──
class AIConnection {
  constructor(roomId, difficulty) {
    this.readyState = 1; // OPEN
    this.isAlive = true;
    this._roomId = roomId;
    this._difficulty = difficulty;
    this._isAI = true;
  }
  send(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    processAIMessage(this._roomId, msg, this._difficulty);
  }
  ping() { this.isAlive = true; }
  terminate() {}
}

function processAIMessage(roomId, msg, difficulty) {
  const room = rooms.get(roomId);
  if (!room || room.gameOver) return;

  // 在AI回合时触发AI行动
  const aiIdx = room.players.findIndex(p => p && p._isAI);
  if (aiIdx < 0) return;
  const aiRole = room.roles[aiIdx];

  if (msg.type === 'update' || msg.type === 'skill' || msg.type === 'restarted' || msg.type === 'skillApplied' || msg.type === 'intercept') {
    if (msg.snapshot) {
      // 更新房间状态（snapshot已经由主逻辑维护了，这里只需检查是否轮到AI）
    }
    if (room.currentPlayer === aiRole && !room.gameOver && !room.pendingSkill && !room.ambushState) {
      scheduleAIMove(roomId, difficulty);
    }
  }
  if (msg.type === 'gameStart') {
    if (room.currentPlayer === aiRole && !room.gameOver) {
      scheduleAIMove(roomId, difficulty);
    }
  }
  if (msg.type === 'ambushFake' && msg.player === aiRole) {
    // AI暗度陈仓：假棋子已落，接下来自动下真棋子
    // ambushState已设为real阶段
    scheduleAIMove(roomId, difficulty, 300);
  }
}

function scheduleAIMove(roomId, difficulty, delayMs) {
  const delay = delayMs || (500 + Math.random() * 1000);
  setTimeout(() => {
    const room = rooms.get(roomId);
    if (!room || room.gameOver) return;
    const aiIdx = room.players.findIndex(p => p && p._isAI);
    if (aiIdx < 0) return;
    const aiRole = room.roles[aiIdx];
    if (room.currentPlayer !== aiRole) return;
    if (room.pendingSkill || room.ambushState) return;
    executeAIMove(roomId, difficulty).catch(err => {
      console.error('[AI] executeAIMove error:', err);
    });
  }, delay);
}

async function executeAIMove(roomId, difficulty) {
  const room = rooms.get(roomId);
  if (!room || room.gameOver) return;
  const aiIdx = room.players.findIndex(p => p && p._isAI);
  if (aiIdx < 0) return;
  const aiRole = room.roles[aiIdx];
  if (room.currentPlayer !== aiRole && !(room.ambushState && room.ambushState.player === aiRole)) return;

  // 暗度陈仓假棋子阶段：用AI引擎算假位置
  if (room.ambushState && room.ambushState.player === aiRole && room.ambushState.phase === 'fake') {
    const humanRole = room.roles.find(r => r !== aiRole);
    const ambushPlan = await aiAmbush(room, aiRole, humanRole);
    const fakePos = ambushPlan ? ambushPlan.fakePos : [7, 7]; // fallback center
    if (handleAmbushFake(room, fakePos[0], fakePos[1], aiRole)) {
      return; // 假棋子已落，等真棋子阶段
    }
    // 如果假位置无效，随机选
    const empties = getAllEmptyAI(room.board);
    if (empties.length > 0) {
      const [fr, fc] = empties[Math.floor(Math.random() * empties.length)];
      handleAmbushFake(room, fr, fc, aiRole);
    }
    return;
  }

  // 暗度陈仓真棋子阶段：用AI引擎算真位置
  if (room.ambushState && room.ambushState.player === aiRole && room.ambushState.phase === 'real') {
    const humanRole = room.roles.find(r => r !== aiRole);
    const ambushPlan = await aiAmbush(room, aiRole, humanRole);
    const realPos = ambushPlan ? ambushPlan.realPos : null;
    // 真位置必须不同于假位置且为空
    if (realPos && room.board[realPos[0]][realPos[1]] === EMPTY) {
      const result = handlePlace(room, realPos[0], realPos[1], aiRole);
      if (!result.error) broadcastAISnapshots(room, result);
      return;
    }
    // fallback: 选最佳空位
    const candidates = getCandidatesAI(room.board);
    for (const [r, c] of candidates) {
      if (room.board[r][c] === EMPTY) {
        const result = handlePlace(room, r, c, aiRole);
        if (!result.error) { broadcastAISnapshots(room, result); return; }
      }
    }
    return;
  }

  const decision = await getAIMove(room, difficulty);

  if (decision.action === 'skill') {
    await handleAISkill(room, aiRole, decision, roomId, difficulty);
  } else {
    handleAIPlace(room, aiRole, decision, roomId, difficulty);
  }
}

function getAllEmptyAI(board) {
  const result = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (board[r][c] === EMPTY) result.push([r, c]);
  return result;
}

function getCandidatesAI(board, dist = 2) {
  const hasStone = new Set();
  const candidates = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] !== EMPTY && board[r][c] !== 4 && board[r][c] !== 5) {
        for (let dr = -dist; dr <= dist; dr++) {
          for (let dc = -dist; dc <= dist; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < N && nc >= 0 && nc < N && board[nr][nc] === EMPTY) {
              const key = nr * N + nc;
              if (!hasStone.has(key)) { hasStone.add(key); candidates.push([nr, nc]); }
            }
          }
        }
      }
    }
  }
  if (candidates.length === 0) candidates.push([7, 7]);
  return candidates;
}

function handleAIPlace(room, aiRole, decision, roomId, difficulty) {
  const { r, c } = decision;

  // 暗度陈仓假棋子阶段
  if (room.ambushState && room.ambushState.player === aiRole && room.ambushState.phase === 'fake') {
    if (handleAmbushFake(room, r, c, aiRole)) {
      // 假棋子落下后，会进入real阶段
      // 通过 processAIMessage 的 ambushFake 触发真棋子
      return;
    }
  }

  // 暗度陈仓真棋子阶段
  if (room.ambushState && room.ambushState.player === aiRole && room.ambushState.phase === 'real') {
    const result = handlePlace(room, r, c, aiRole);
    if (!result.error) {
      broadcastAISnapshots(room, result);
    }
    return;
  }

  const result = handlePlace(room, r, c, aiRole);
  if (result.error) {
    // AI尝试的位置无效，重新选择
    // 回退：随机选一个空位
    const empties = [];
    for (let rr = 0; rr < N; rr++)
      for (let cc = 0; cc < N; cc++)
        if (room.board[rr][cc] === EMPTY) empties.push([rr, cc]);
    if (empties.length > 0) {
      const [fr, fc] = empties[Math.floor(Math.random() * empties.length)];
      const fallback = handlePlace(room, fr, fc, aiRole);
      if (!fallback.error) broadcastAISnapshots(room, fallback);
    }
    return;
  }
  broadcastAISnapshots(room, result);
}

async function handleAISkill(room, aiRole, decision, roomId, difficulty) {
  const msg = { type: 'useSkill', skill: decision.skill };

  switch (decision.skill) {
    case 'sandstorm':
      msg.r = decision.r;
      msg.c = decision.c;
      break;
    case 'swapPos':
      msg.myR = decision.myR;
      msg.myC = decision.myC;
      msg.opR = decision.opR;
      msg.opC = decision.opC;
      break;
    case 'mountain':
      break;
    case 'swap':
      msg.r = decision.r;
      msg.c = decision.c;
      break;
    case 'move':
      msg.fr = decision.fr;
      msg.fc = decision.fc;
      msg.tr = decision.tr;
      msg.tc = decision.tc;
      break;
    case 'ambush':
      // AI使用暗度陈仓：先激活技能，再落假棋子和真棋子
      break;
    case 'barrier':
    case 'phoenix':
    case 'meteor':
      msg.r = decision.r;
      msg.c = decision.c;
      break;
  }

  const result = handleSkill(room, msg, aiRole);
  if (result.error) {
    // 技能使用失败，改为落子
    const fallback = await getAIMove(room, difficulty);
    if (fallback.action === 'place') {
      handleAIPlace(room, aiRole, fallback, roomId, difficulty);
    }
    return;
  }

  // 广播技能结果
  for (const p of room.players) {
    if (p && p.readyState === 1 && !p._isAI) {
      const pRole = playerRole(p);
      if (!pRole) continue;
      const ps = personalSnap(room, pRole);
      p.send(JSON.stringify({ type: 'skill', ...result, snapshot: ps }));
    }
  }
  // AI自己也收到消息（通过processAIMessage处理后续回合）

  // 暗度陈仓特殊处理：AI需要继续落假棋子
  if (decision.skill === 'ambush' && result.ok) {
    // ambushState已设为fake阶段，AI需要在假棋子阶段落子
    scheduleAIMove(roomId, difficulty, 600);
    return;
  }

  // 飞沙走石是pending状态，等resolveSandstorm后再触发AI
  if (decision.skill === 'sandstorm') return;
  // 偷梁换柱和移形换影也是pending状态，等resolve后再触发AI
  if (decision.skill === 'swap' || decision.skill === 'swapPos') return;

  // 检查是否又轮到AI
  if (room.aiMode && !room.gameOver && !room.pendingSkill) {
    const aiIdx = room.players.findIndex(p => p && p._isAI);
    if (aiIdx >= 0 && room.currentPlayer === room.roles[aiIdx]) {
      scheduleAIMove(roomId, difficulty);
    }
  }
}

function broadcastAISnapshots(room, result) {
  for (const p of room.players) {
    if (p && p.readyState === 1 && !p._isAI) {
      const pRole = playerRole(p);
      if (!pRole) continue;
      const ps = personalSnap(room, pRole);
      p.send(JSON.stringify({ type: 'update', ...result, snapshot: ps }));
    }
  }
  // 检查是否又轮到AI
  if (room.aiMode && !room.gameOver && !room.pendingSkill && !room.ambushState) {
    const aiIdx = room.players.findIndex(p => p && p._isAI);
    if (aiIdx >= 0 && room.currentPlayer === room.roles[aiIdx]) {
      scheduleAIMove(room.id, room.aiDifficulty);
    }
  }
}

// （createRoom / initSkillState 已迁移至 src/state/room.js）

// 使用 crypto 随机生成不可猜测的房间 ID（仅大写字母与数字，去除易混字符 0/O/1/I）
// 字符集 32 个，5 位 ≈ 33M 组合；冲突极小，但仍保留最大重试以防极端情况
const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function getRoomId() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = crypto.randomBytes(5);
    let id = '';
    for (let i = 0; i < 5; i++) id += ROOM_ID_ALPHABET[bytes[i] & 31]; // 32 个字符，掩码 0x1F
    if (!rooms.has(id)) return id;
  }
  // 兜底：在极端冲突场景下退化为更长的 ID，确保函数始终能返回
  return 'R' + Date.now().toString(36).toUpperCase();
}

// 生成 sessionToken（base64url 32 字节，足够防猜）
function genSessionToken() {
  return crypto.randomBytes(24).toString('base64url');
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
  for (const p of room.players) if (p && p.readyState === 1) p.send(data);
}

function broadcastExcept(room, msg, excludeWs) {
  const data = JSON.stringify(msg);
  for (const p of room.players) if (p && p !== excludeWs && p.readyState === 1) p.send(data);
}

// （snap / personalSnap 已迁移至 src/rules/snapshot.js）

// （悔棋相关函数 undoLastMove / handleUndoRequest / handleUndoResponse 已迁移至 src/rules/undo.js）

// （applyDecay / spawnRifts / ageRifts / ageRuins / processSwaps / postMove / isImpervious
//   均已迁移至 src/rules/board.js）

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
    if(room.globalSettings.nova && room.gameMode!=='blood'){const four=findLines(room.board,r,c,player,4,fakePos);if(four.length>0)room.novaLine={cells:four[0],player};}
    const five=findLines(room.board,r,c,player,5,fakePos);
    if(five.length>0){
      room.winCells=five[0];room.novaLine=null;
      if(room.gameMode==='blood'){
        const bloodResult = bloodClear(room, five[0], player);
        room.scores[player]=(room.scores[player]||0)+1;
        const reachedTarget = checkBloodWin(room, player);
        if(reachedTarget) room.gameOver=true;
        else room.winCells=[];
        if(!room.gameOver){postMove(room);advanceTurn(room);}
        return {ok:true,devoured,action:'place',ambushComplete:true,fakePos,bloodClear:bloodResult,bloodMode:true,snapshot:snap(room)};
      }else{
        room.gameOver=true;room.scores[player]=(room.scores[player]||0)+1;
      }
    }

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
  
  if(room.globalSettings.nova && room.gameMode!=='blood'){const four=findLines(room.board,r,c,player,4,fakePos);if(four.length>0)room.novaLine={cells:four[0],player};}

  // Check win: skip if this stone is swap-converted (shouldn't happen on normal place but safety)
  const five=findLines(room.board,r,c,player,5,fakePos);
  if(five.length>0){
    room.winCells=five[0];room.novaLine=null;
    if(room.gameMode==='blood'){
      // Blood mode: clear area, award score, check if target reached
      const bloodResult = bloodClear(room, five[0], player);
      room.scores[player]=(room.scores[player]||0)+1;
      const reachedTarget = checkBloodWin(room, player);
      if(reachedTarget) room.gameOver=true;
      else room.winCells=[]; // clear win cells since game continues
      if(!room.gameOver){postMove(room);advanceTurn(room);}
      return {ok:true,devoured,action:'place',bloodClear:bloodResult,bloodMode:true,snapshot:snap(room)};
    }else{
      room.gameOver=true;room.scores[player]=(room.scores[player]||0)+1;
    }
  }

  // 全局法则 · 引力：未结束时触发裂隙坍缩为废墟
  let gravity = [];
  if(!room.gameOver) gravity = applyGravity(room, r, c, player);

  if(!room.gameOver){postMove(room);if(!room.novaLine)advanceTurn(room);}
  return {ok:true,devoured,gravity,action:'place',snapshot:snap(room)};
}

// Blood mode: clear cells around five-in-a-row and award score
// （bloodClear / checkBloodWin 已迁移至 src/rules/blood.js）

function handleSupernova(room, player) {
  if(!room.novaLine||room.gameOver) return {error:'无法引爆'};
  if(room.novaLine.player!==player) return {error:'不是你的连珠'};
  if(room.gameMode==='blood') return {error:'血战模式中无法引爆超新星'};
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
  room.board[ps.r][ps.c]=RUIN;room.stoneAge[ps.r][ps.c]=0;room.ruinAge[ps.r][ps.c]=0;
  delete room.swapMap[`${ps.r},${ps.c}`];
  // 清除暗度陈仓隐藏棋子记录（如果该位置有）
  delete room.ambushHidden[`${ps.r},${ps.c}`];
  room.pendingSkill=null;room.pendingTimer=null;
  console.log(`[飞沙走石] (${ps.r},${ps.c}) 从 ${prevValue} 变为废墟(RUIN=4)`);
  room.totalMoves++;postMove(room);advanceTurn(room);
  broadcastAll(room,{type:'skillApplied',skill:'sandstorm',player:ps.player,r:ps.r,c:ps.c,snapshot:snap(room)});
}

function resolveSwapPos(room) {
  const ps=room.pendingSkill;if(!ps)return;
  room.pendingSkill=null;room.pendingTimer=null;
  room.totalMoves++;postMove(room);advanceTurn(room);
  broadcastAll(room,{type:'skillApplied',skill:'swapPos',player:ps.player,myR:ps.myR,myC:ps.myC,opR:ps.opR,opC:ps.opC,snapshot:snap(room)});
}

function resolveSwap(room) {
  const ps=room.pendingSkill;if(!ps)return;
  room.pendingSkill=null;room.pendingTimer=null;
  room.totalMoves++;postMove(room);advanceTurn(room);
  broadcastAll(room,{type:'skillApplied',skill:'swap',player:ps.player,r:ps.r,c:ps.c,from:ps.from,to:ps.player,snapshot:snap(room)});
}

function handleSkill(room, msg, player) {
  if (room.gameOver) return { error: '游戏已结束' };
  if (room.currentPlayer !== player) return { error: '不是你的回合' };
  if (room.pendingSkill) return { error: '等待技能结算' };

  const sid = msg.skill;
  const equipped = room.equipped[player] || [];
  if (!equipped.includes(sid)) return { error: '未装备该技能' };

  // 走插件化注册表分派
  return skillRegistry.dispatch(sid, {
    room, msg, player,
    deps: {
      // 棋盘 & 常量
      N, EMPTY, PENDING_TIMER_MS,
      // 纯函数
      findLines, isImpervious, postMove, advanceTurn, snap, checkBloodWin,
      // pending 结算回调（隶属 server.js 内部，需要回调访问 broadcastAll/room.pendingTimer）
      resolveSandstorm, resolveSwap, resolveSwapPos,
      // 网络层注入
      broadcastAll,
    },
  });
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
  const interceptableTypes = ['sandstorm','swap','swapPos'];
  if(!room.pendingSkill||!interceptableTypes.includes(room.pendingSkill.type)) return {error:'无待响应技能'};
  if(player===room.pendingSkill.player) return {error:'不能响应自己的技能'};
  if(!(room.equipped[player]||[]).includes('intercept')) return {error:'未装备擒拿'};
  if(room.pendingTimer){clearTimeout(room.pendingTimer);room.pendingTimer=null;}
  const originalPlayer=room.pendingSkill.player;
  const interceptedSkill = room.pendingSkill.type;
  // If swap or swapPos was intercepted, revert the swap
  if(interceptedSkill==='swap'){
    const ps=room.pendingSkill;
    room.board[ps.r][ps.c]=ps.from; // revert to original owner
    room.stoneAge[ps.r][ps.c]=0;
    delete room.swapMap[`${ps.r},${ps.c}`];
  }
  if(interceptedSkill==='swapPos'){
    const ps=room.pendingSkill;
    // Revert swap positions
    const temp1 = room.board[ps.myR][ps.myC];
    const temp2 = room.board[ps.opR][ps.opC];
    room.board[ps.myR][ps.myC] = temp2;
    room.board[ps.opR][ps.opC] = temp1;
  }
  room.pendingSkill=null;room.totalMoves++;postMove(room);advanceTurn(room);
  return {ok:true,action:'intercept',interceptor:player,originalPlayer,interceptedSkill,snapshot:snap(room)};
}

// （resetRoom 已迁移至 src/state/room.js）

// ── WebSocket ──
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const allow = createRateLimiter(40, 20); // 容量 40，每秒补 20 个令牌

  ws.on('message', raw => {
    // 限流
    if (!allow()) {
      try { ws.send(JSON.stringify({ type: 'error', message: '请求过于频繁，请稍候再试' })); } catch {}
      return;
    }
    // 解析 JSON
    let msg;
    try { msg = JSON.parse(raw); } catch {
      try { ws.send(JSON.stringify({ type: 'error', message: '消息格式错误' })); } catch {}
      return;
    }
    // 统一字段校验
    const v = validateMessage(msg);
    if (!v.ok) {
      try { ws.send(JSON.stringify({ type: 'error', message: v.message })); } catch {}
      return;
    }

    switch(msg.type){
      case 'create':{
        const id=getRoomId();
        const mode=msg.mode||2;
        const names=msg.names||{1:'星辰',2:'虚空',3:'极光'};
        const gameMode=msg.gameMode||'classic';
        const room=createRoom(id,mode,names,gameMode);
        rooms.set(id,room);
        room.players[0]=ws;
        playerRoom.set(ws,id);

        // 人机对战模式：AI自动加入P2位
        if(msg.aiMode && msg.aiDifficulty){
          room.aiMode = true;
          room.aiDifficulty = msg.aiDifficulty;
          const aiConn = new AIConnection(id, msg.aiDifficulty);
          room.players[1] = aiConn;
          const aiRole = room.roles[1];
          room.names[aiRole] = `AI·${msg.aiDifficulty === 'simple' ? '初学' : msg.aiDifficulty === 'medium' ? '进阶' : '宗师'}`;
          // AI随机选2个技能
          const activeSkills = ALL_SKILLS.filter(s => s.type === 'active').map(s => s.id);
          const shuffled = activeSkills.sort(() => Math.random() - 0.5);
          room.equipped[aiRole] = shuffled.slice(0, 2);
          console.log(`[创建AI] 房间${id} AI难度=${msg.aiDifficulty} 技能=${room.equipped[aiRole].join(',')}`);
        }

        console.log(`[创建] 房间${id} ${mode}人${msg.aiMode?' (AI '+msg.aiDifficulty+')':''} ${gameMode}`);
        const creatorToken = genSessionToken();
        room.playerTokens[0] = creatorToken;
        ws.send(JSON.stringify({type:'joined',roomId:id,role:room.roles[0],playerIndex:0,mode,names:room.names,aiMode:room.aiMode||false,aiDifficulty:room.aiDifficulty||null,gameMode,sessionToken:creatorToken}));
        ws.send(JSON.stringify({type:'roomUpdate',players:room.players.map(p=>p!==null),settings:room.globalSettings,names:room.names,mode,allSkills:ALL_SKILLS,equipped:room.equipped,aiMode:room.aiMode||false,aiDifficulty:room.aiDifficulty||null,gameMode}));
        break;
      }
      case 'join':{
        const id=msg.roomId?.toUpperCase();
        const room=rooms.get(id);
        if(!room){ws.send(JSON.stringify({type:'error',message:'房间不存在'}));return;}
        if(room.gameStarted){ws.send(JSON.stringify({type:'error',message:'游戏已开始'}));return;}
        if(room.aiMode){ws.send(JSON.stringify({type:'error',message:'人机对战房间无法加入'}));return;}
        const emptyIdx=room.players.findIndex(p=>p===null);
        if(emptyIdx===-1){ws.send(JSON.stringify({type:'error',message:'房间已满'}));return;}
        room.players[emptyIdx]=ws;
        const assignedRole=room.roles[emptyIdx];
        playerRoom.set(ws,id);
        if(msg.name&&msg.name.trim()) room.names[assignedRole]=msg.name.trim().slice(0,NAME_MAX_LEN);
        console.log(`[加入] 房间${id} → 位${emptyIdx}`);
        const joinerToken = genSessionToken();
        room.playerTokens[emptyIdx] = joinerToken;
        ws.send(JSON.stringify({type:'joined',roomId:id,role:assignedRole,playerIndex:emptyIdx,mode:room.mode,names:room.names,sessionToken:joinerToken}));
        broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS,gameMode:room.gameMode});
        break;
      }
      case 'reconnect':{
        const id=msg.roomId?.toUpperCase();
        const room=rooms.get(id);
        if(!room){ws.send(JSON.stringify({type:'error',message:'房间不存在或已过期'}));return;}
        const idx = room.playerTokens.findIndex(t => t && t === msg.sessionToken);
        if(idx < 0){ws.send(JSON.stringify({type:'error',message:'会话凭证无效'}));return;}
        // 清掉宽限期 timer
        const pd = room.pendingDisconnect[idx];
        if(pd && pd.timer){clearTimeout(pd.timer);}
        room.pendingDisconnect[idx] = null;
        // 关闭旧的占位连接（如有）
        const oldWs = room.players[idx];
        if(oldWs && oldWs !== ws && !oldWs._isAI && oldWs.readyState === 1){
          try{ oldWs.close(4001, 'reconnected elsewhere'); }catch{}
        }
        room.players[idx] = ws;
        playerRoom.set(ws, id);
        const role = room.roles[idx];
        room.lastActivity = Date.now();
        console.log(`[重连] 房间${id} → 位${idx} (role=${role})`);
        // 回放：joined + 个性化快照
        ws.send(JSON.stringify({
          type:'joined', roomId:id, role, playerIndex:idx, mode:room.mode,
          names:room.names, aiMode:room.aiMode||false,
          aiDifficulty:room.aiDifficulty||null, gameMode:room.gameMode,
          sessionToken: msg.sessionToken, reconnected: true,
        }));
        ws.send(JSON.stringify({
          type:'roomUpdate',
          players:room.players.map(p=>p!==null),
          settings:room.globalSettings, names:room.names, mode:room.mode,
          allSkills:ALL_SKILLS, equipped:room.equipped,
          aiMode:room.aiMode||false, aiDifficulty:room.aiDifficulty||null,
          gameMode:room.gameMode,
        }));
        if(room.gameStarted){
          ws.send(JSON.stringify({
            type:'update', action:'reconnect', snapshot: personalSnap(room, role),
          }));
        }
        // 通知其他玩家
        broadcastExcept(room,{type:'playerReconnected',playerIndex:idx,role}, ws);
        break;
      }
      case 'setName':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        if(msg.name&&msg.name.trim()) room.names[role]=msg.name.trim().slice(0,NAME_MAX_LEN);
        broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS,gameMode:room.gameMode});
        break;
      }
      case 'toggleSetting':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        if(room.players.indexOf(ws)!==0)return;
        const key=msg.key;
        if(room.globalSettings.hasOwnProperty(key)){
          room.globalSettings[key]=!room.globalSettings[key];
          broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS,gameMode:room.gameMode});
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
        broadcastAll(room,{type:'roomUpdate',players:room.players.map(Boolean),settings:room.globalSettings,names:room.names,mode:room.mode,allSkills:ALL_SKILLS,equipped:room.equipped,gameMode:room.gameMode});
        break;
      }
      case 'startGame':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        if(room.players.indexOf(ws)!==0)return;
        // AI房间的AI位不是null
        const hasEmptySlot = room.players.some(p => p === null);
        if(hasEmptySlot) return;
        // Check all players equipped skills (AI已自动装备)
        for(const role of room.roles){
          if(!room.equipped[role]||room.equipped[role].length===0){
            return ws.send(JSON.stringify({type:'error',message:`${room.names[role]}尚未选择技能`}));
          }
        }
        room.gameStarted=true;
        for(const r of room.roles){ room.scores[r]=0; room.bloodScores[r]=0; }
        initSkillState(room);
        console.log(`[开始] 房间${rid}`);
        broadcastAll(room,{type:'gameStart',snapshot:snap(room),names:room.names,mode:room.mode,aiMode:room.aiMode||false,gameMode:room.gameMode});
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
            if(!pRole) continue; // 跳过无效角色（包括AI）
            const ps=personalSnap(room,pRole);
            p.send(JSON.stringify({type:'update',...result,snapshot:ps}));
          }
        }
        // AI回合触发
        if(room.aiMode && !room.gameOver && !room.pendingSkill && !room.ambushState){
          const aiIdx=room.players.findIndex(p=>p&&p._isAI);
          if(aiIdx>=0 && room.currentPlayer===room.roles[aiIdx]){
            scheduleAIMove(rid, room.aiDifficulty);
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
            if(!pRole) continue;
            const ps=personalSnap(room,pRole);
            p.send(JSON.stringify({type:'skill',...result,snapshot:ps}));
          }
        }
        // AI回合触发（非sandstorm pending状态）
        if(room.aiMode && !room.gameOver && !room.pendingSkill){
          const aiIdx=room.players.findIndex(p=>p&&p._isAI);
          if(aiIdx>=0 && room.currentPlayer===room.roles[aiIdx]){
            scheduleAIMove(rid, room.aiDifficulty);
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
        if(room.aiMode && !room.gameOver && !room.pendingSkill){
          const aiIdx=room.players.findIndex(p=>p&&p._isAI);
          if(aiIdx>=0 && room.currentPlayer===room.roles[aiIdx]){
            scheduleAIMove(rid, room.aiDifficulty);
          }
        }
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
        // AI房间：人类请求直接重启
        if(room.aiMode){
          const settings=room.globalSettings;const equipped=room.equipped;
          const gameMode=room.gameMode; // 保持游戏模式
          resetRoom(room);room.globalSettings=settings;room.equipped=equipped;room.gameStarted=true;
          room.aiMode=true;room.aiDifficulty=room.aiDifficulty||'medium';
          room.gameMode=gameMode; // 恢复游戏模式
          // 血战模式重置分数
          for(const r of room.roles){room.scores[r]=0;room.bloodScores[r]=0;}
          initSkillState(room);
          broadcastAll(room,{type:'restarted',snapshot:snap(room),names:room.names,mode:room.mode,gameMode:room.gameMode});
          break;
        }
        for(const opp of room.players){if(opp&&opp!==ws&&opp.readyState===1)opp.send(JSON.stringify({type:'restartRequested'}));}
        if(room.ready.every(Boolean)){
          const settings=room.globalSettings;const equipped=room.equipped;
          const gameMode=room.gameMode;
          resetRoom(room);room.globalSettings=settings;room.equipped=equipped;room.gameStarted=true;
          room.gameMode=gameMode;
          for(const r of room.roles){room.scores[r]=0;room.bloodScores[r]=0;}
          initSkillState(room);
          broadcastAll(room,{type:'restarted',snapshot:snap(room),names:room.names,mode:room.mode,gameMode:room.gameMode});
        }
        break;
      }
      case 'chat':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        broadcastExcept(room,{type:'chat',from:role,text:(msg.text||'').slice(0,CHAT_MAX_LEN)},ws);
        break;
      }
      case 'undoRequest':{
        const rid=playerRoom.get(ws);if(!rid)return;
        const room=rooms.get(rid);if(!room)return;
        const role=playerRole(ws);if(!role)return;
        const result = handleUndoRequest(room, role);
        if(result.error){ws.send(JSON.stringify({type:'error',message:result.error}));return;}
        // AI房间：AI自动接受悔棋
        if(room.aiMode){
          const aiIdx=room.players.findIndex(p=>p&&p._isAI);
          const aiRole=aiIdx>=0?room.roles[aiIdx]:null;
          if(aiRole){
            const undoResult = handleUndoResponse(room, aiRole, true);
            if(undoResult.undoAccepted){
              broadcastAll(room,{type:'undoAccepted',from:aiRole,undone:undoResult.undone,snapshot:undoResult.snapshot});
            }
          }
          break;
        }
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
    playerRoom.delete(ws);
    // AI房间：人类离开时立即清理整个房间（保持原行为）
    if(room.aiMode){
      room.players[pi]=null;
      if(room.pendingTimer){clearTimeout(room.pendingTimer);room.pendingTimer=null;}
      room.pendingSkill=null;
      const aiIdx=room.players.findIndex(p=>p&&p._isAI);
      if(aiIdx>=0) room.players[aiIdx]=null;
      rooms.delete(rid);
      console.log(`[AI房间关闭] 房间${rid}`);
      return;
    }
    // 普通房间：先进入断线宽限期，仍占着座位，允许 reconnect
    if(room.gameStarted && room.playerTokens[pi]){
      // 通知其他玩家"暂时断开"
      broadcastExcept(room,{type:'playerDisconnected',playerIndex:pi,role,graceMs:CONFIG.net.reconnectGraceMs}, ws);
      const graceTimer = setTimeout(()=>{
        const r = rooms.get(rid);
        if(!r) return;
        if(r.players[pi] !== ws) return; // 已被新连接顶替
        r.players[pi] = null;
        r.playerTokens[pi] = null;
        r.pendingDisconnect[pi] = null;
        if(r.pendingTimer){clearTimeout(r.pendingTimer);r.pendingTimer=null;}
        r.pendingSkill = null;
        console.log(`[超时清座] 房间${rid} 位${pi}`);
        broadcastAll(r,{type:'playerLeft',playerIndex:pi,role});
        if(r.players.every(p=>p===null))setTimeout(()=>{if(r.players.every(p=>p===null))rooms.delete(rid);},30 * 1000);
      }, CONFIG.net.reconnectGraceMs);
      room.pendingDisconnect[pi] = { timer: graceTimer, role };
      console.log(`[断线宽限] 房间${rid} 位${pi} (role=${role}) 等待 ${CONFIG.net.reconnectGraceMs}ms`);
      return;
    }
    // 未开局或未签发 token：保持旧逻辑——立即清座位
    room.players[pi]=null;
    room.playerTokens[pi]=null;
    if(room.pendingTimer){clearTimeout(room.pendingTimer);room.pendingTimer=null;}
    room.pendingSkill=null;
    broadcastAll(room,{type:'playerLeft',playerIndex:pi,role});
    if(room.players.every(p=>p===null))setTimeout(()=>{if(room.players.every(p=>p===null))rooms.delete(rid);},30 * 1000);
  });
});

// 仅当作为入口直接运行时，才启动监听与后台定时器；
// 被 require（例如单元测试）时不副作用，方便复用纯函数。
if (require.main === module) {
  setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.isAlive)return ws.terminate();ws.isAlive=false;ws.ping();});},CONFIG.net.heartbeatMs);
  setInterval(()=>{for(const[id,r]of rooms){if(Date.now()-r.lastActivity>CONFIG.net.roomIdleMaxMs&&r.players.every(p=>p===null))rooms.delete(id);}},CONFIG.net.roomIdleSweepMs);

  server.listen(PORT,()=>console.log(`星虚对弈服务器: http://localhost:${PORT}`));
}

// 导出供单元测试使用的纯函数与常量
module.exports = {
  // 常量
  N, EMPTY, P1, P2, P3, RUIN, RIFT,
  // 房间
  createRoom, resetRoom, initSkillState,
  // 棋局
  findLines, applyDevour, applyDecay, spawnRifts, ageRifts, ageRuins,
  processSwaps, postMove, advanceTurn,
  // 落子 / 技能 / 胜负
  handlePlace, handleSkill, handleSupernova, handleDismissNova,
  handleAmbushFake, handleIntercept, resolveSandstorm, resolveSwap, resolveSwapPos,
  bloodClear, checkBloodWin, isImpervious,
  // 悔棋
  undoLastMove, handleUndoRequest, handleUndoResponse,
  // 快照
  snap, personalSnap,
  // 全局表
  rooms, ALL_SKILLS,
};
