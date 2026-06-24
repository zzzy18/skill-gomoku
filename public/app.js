// ═══════════════════════════════════════
const N=15, EMPTY=0, P1=1, P2=2, P3=3, RUIN=4, RIFT=5;
const DEFAULT_NAMES={1:'星辰',2:'虚空',3:'极光'};
const PC={[P1]:'255,216,155',[P2]:'122,95,255',[P3]:'80,232,192'};
const PCSS={[P1]:'c1',[P2]:'c2',[P3]:'c3'};
const PSCSS={[P1]:'pc1',[P2]:'pc2',[P3]:'pc3'};

// 技能定义（默认 fallback；服务端会通过 roomUpdate.allSkills 推送权威列表，含扩展技能）
let ALL_SKILLS=[
  {id:'sandstorm',name:'飞沙走石',type:'active',desc:'移除一枚棋子并留下废墟，每5回合可用一次'},
  {id:'swapPos',name:'移形换影',type:'active',desc:'选择己方一枚棋子与对手一枚棋子交换位置，冷却4回合'},
  {id:'intercept',name:'擒拿',type:'passive',desc:'飞沙走石、偷梁换柱、移形换影发动时可打断'},
  {id:'mountain',name:'力拔山兮',type:'active',desc:'回合≥50直接获胜'},
  {id:'swap',name:'偷梁换柱',type:'active',desc:'将敌方棋子变为己方3回合，期间不计胜利'},
  {id:'move',name:'斗转星移',type:'active',desc:'移动任意棋子到空位，冷却5回合'},
  {id:'impervious',name:'无懈可击',type:'passive',desc:'己方棋子无法被技能选中'},
  {id:'ambush',name:'暗度陈仓',type:'active',desc:'连下2子：第1子为假(对手可见但不计胜利)，第2子为真(对手不可见)，全局只能用一次'},
];

let cellSize,pad,boardPx;
const bCvs=document.getElementById('board-canvas'),bCtx=bCvs.getContext('2d');
const bgCvs=document.getElementById('bg-canvas'),bgCtx=bgCvs.getContext('2d');

let myRole=null,roomId=null,ws=null,snap=null;
let isCreator=false,gameMode=2,names={...DEFAULT_NAMES};
let myEquipped=[]; // skills I've chosen
let selectedSkills=[]; // during selection in room
let lastRoomUpdate=null; // cache last room state for UI rebuild
let hoverPos=null,ripples=[],particles=[],winGlow=0;
let sandstormMode=false,swapMode=false,moveFromMode=false,moveFrom=null;
let swapPosStep=0,swapPosMy=null; // 0=not active, 1=select own, 2=select opponent
let aiMode=false,aiDifficulty='medium'; // 人机对战模式
let bloodMode=false; // 血战模式

// ═══════════════════════════════════════
//  Lobby
// ═══════════════════════════════════════
function selectMode(m){
  if(m==='ai'){
    gameMode=2;aiMode=true;
    document.getElementById('ai-difficulty').style.display='block';
  }else{
    gameMode=m;aiMode=false;
    document.getElementById('ai-difficulty').style.display='none';
  }
  document.querySelectorAll('.mode-btn:not(.ai-diff)').forEach(b=>b.classList.toggle('selected',b.dataset.mode===(aiMode?'ai':m)));
}
function selectAIDiff(d){
  aiDifficulty=d;
  document.querySelectorAll('.ai-diff').forEach(b=>b.classList.toggle('selected',b.dataset.diff===d));
}
function selectBloodMode(m){
  bloodMode=m==='blood';
  document.querySelectorAll('[data-bm]').forEach(b=>b.classList.toggle('selected',b.dataset.bm===m));
  document.getElementById('blood-hint').style.display=bloodMode?'block':'none';
}
function getMyName(){return document.getElementById('my-name').value.trim()||DEFAULT_NAMES[P1]}
function createRoom(){
  if(!ws||ws.readyState!==1){notify('未连接','error');return;}
  const n=getMyName();const initNames={...DEFAULT_NAMES};initNames[P1]=n;
  const gm=bloodMode?'blood':'classic';
  if(aiMode){
    send({type:'create',mode:2,names:initNames,aiMode:true,aiDifficulty,gameMode:gm});
  }else{
    send({type:'create',mode:gameMode,names:initNames,gameMode:gm});
  }
}
function joinRoom(){const code=document.getElementById('join-code').value.trim().toUpperCase();if(code.length!==5){notify('请输入5位房间号','error');return;}send({type:'join',roomId:code,name:getMyName()})}
function copyCode(){
  if(!roomId){notify('无房间号','error');return;}
  // iOS Safari 兼容：尝试多种复制方式
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(roomId).then(()=>notify('已复制','info')).catch(()=>{
      fallbackCopy(roomId);
    });
  }else{
    fallbackCopy(roomId);
  }
}
function fallbackCopy(text){
  // 传统复制方法（兼容旧浏览器和 iOS）
  const ta=document.createElement('textarea');
  ta.value=text;
  ta.style.position='fixed';
  ta.style.left='-9999px';
  ta.style.top='0';
  ta.readOnly=false;
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0,9999);
  try{
    const ok=document.execCommand('copy');
    if(ok)notify('已复制','info');
    else{notify('复制失败，请手动复制: '+text,'error');}
  }catch(e){
    notify('复制失败，请手动复制: '+text,'error');
  }
  document.body.removeChild(ta);
}
function leaveRoom(){if(ws)ws.close();myRole=null;roomId=null;snap=null;aiMode=false;bloodMode=false;showScreen('lobby')}
function updateAIThinking(){
  const el=document.getElementById('ai-thinking');
  if(!el||!aiMode||!snap)return;
  const aiRole=getRoles().find(r=>r!==myRole);
  const isAITurn=snap.currentPlayer===aiRole&&!snap.gameOver;
  el.style.display=isAITurn?'block':'none';
}
document.getElementById('join-code').addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom()});
// iOS 键盘弹出时滚动输入框到可视区域
// iOS 键盘弹出处理 - 使用 visualViewport 动态调整布局
function handleKeyboardPopup(){
  if(!visualViewport)return;
  const lobby=document.getElementById('lobby');
  const vpHeight=visualViewport.height;
  const scale=visualViewport.scale||1;
  // 键盘弹出时，将 lobby 内容向上移动
  const offset=Math.max(0,window.innerHeight-vpHeight);
  if(offset>100){
    lobby.style.paddingBottom=offset+100+'px';
    lobby.scrollTop=lobby.scrollHeight;
  }else{
    lobby.style.paddingBottom='200px';
  }
}
if(visualViewport){
  visualViewport.addEventListener('resize',()=>{
    calcSize();
    handleKeyboardPopup();
  });
  visualViewport.addEventListener('scroll',()=>window.scrollTo(0,0));
}

document.getElementById('join-code').addEventListener('focus',e=>{
  setTimeout(()=>{
    e.target.scrollIntoView({behavior:'smooth',block:'center'});
    handleKeyboardPopup();
  },150);
});
document.getElementById('my-name').addEventListener('focus',e=>{
  setTimeout(()=>{
    e.target.scrollIntoView({behavior:'smooth',block:'center'});
    handleKeyboardPopup();
  },150);
});

function showScreen(n){document.getElementById('lobby').classList.toggle('hidden',n!=='lobby');document.getElementById('room-screen').classList.toggle('show',n==='room');document.getElementById('game').classList.toggle('show',n==='game')}

// ═══════════════════════════════════════
//  WebSocket
// ═══════════════════════════════════════
// 断线重连：存到 sessionStorage，标签关闭即清除
const SESSION_KEY = 'gomoku.session';
function saveSession(roomId, token){
  try{ sessionStorage.setItem(SESSION_KEY, JSON.stringify({roomId, token, ts: Date.now()})); }catch{}
}
function loadSession(){
  try{
    const s = sessionStorage.getItem(SESSION_KEY);
    if(!s) return null;
    const obj = JSON.parse(s);
    // token 在服务端宽限期内有效（默认 60s）；客户端略宽松，给 90s 窗口
    if(Date.now() - (obj.ts||0) > 90 * 1000) return null;
    return obj;
  }catch{ return null; }
}
function clearSession(){
  try{ sessionStorage.removeItem(SESSION_KEY); }catch{}
}

let reconnectBackoffMs = 1000;
function connectWS(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => {
    const el = document.getElementById('conn');
    el.textContent = '已连接'; el.className = 'conn ok';
    reconnectBackoffMs = 1000;
    // 如果本地有会话，尝试自动重连
    const sess = loadSession();
    if (sess && sess.roomId && sess.token){
      ws.send(JSON.stringify({type:'reconnect', roomId: sess.roomId, sessionToken: sess.token}));
    }
  };
  ws.onclose = () => {
    const el = document.getElementById('conn');
    el.textContent = '已断开'; el.className = 'conn bad';
    // 指数退避重连：1s → 2s → 4s → 8s（封顶）
    setTimeout(connectWS, Math.min(reconnectBackoffMs, 8000));
    reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, 8000);
  };
  ws.onerror = () => {};
  ws.onmessage = e => {let m; try{m = JSON.parse(e.data)}catch{return} handleMsg(m)};
}
function send(msg){if(ws && ws.readyState===1) ws.send(JSON.stringify(msg))}

function handleMsg(m){
  switch(m.type){
    case 'joined':
      myRole=m.role;roomId=m.roomId;isCreator=m.playerIndex===0;
      gameMode=m.mode||2;names={...DEFAULT_NAMES,...(m.names||{})};
      aiMode=m.aiMode||false;aiDifficulty=m.aiDifficulty||'medium';
      bloodMode=m.gameMode==='blood';
      selectedSkills=[];myEquipped=[];
      document.getElementById('room-code-display');// just ensure room screen renders
      if(!isCreator)selectedSkills=[]; // reset for new room
      // 保存 sessionToken 以支持断线重连
      if(m.sessionToken) saveSession(m.roomId, m.sessionToken);
      // 重连成功时不切回房间界面，等服务端的 snapshot
      if(m.reconnected){
        const el = document.getElementById('conn');
        if(el){ el.textContent = '已重连'; el.className = 'conn ok'; }
        break;
      }
      showScreen('room');
      break;
    case 'roomUpdate':
      names={...DEFAULT_NAMES,...(m.names||{})};gameMode=m.mode||2;
      if(m.aiMode)aiMode=true;
      if(m.gameMode) bloodMode=m.gameMode==='blood';
      // 服务端权威技能表（含扩展技能）
      if(Array.isArray(m.allSkills) && m.allSkills.length){ ALL_SKILLS = m.allSkills; }
      // Update equipped display
      if(m.equipped&&m.equipped[myRole]) myEquipped=m.equipped[myRole];
      buildRoomUI(m);
      break;
    case 'gameStart':
      snap=m.snapshot;names={...DEFAULT_NAMES,...(m.names||{})};gameMode=m.mode||2;
      aiMode=m.aiMode||false;
      if(m.gameMode) bloodMode=m.gameMode==='blood';
      myEquipped=(snap.equipped&&snap.equipped[myRole])||[];
      showScreen('game');notify('对弈开始！','info');
      addSystemChat('对弈开始！');
      updateAIThinking();
      break;
    case 'update':case 'skill':case 'nova':
      if(m.snapshot){
        const prev=snap?snap.board:null;snap=m.snapshot;
        if(prev)detectChanges(prev,snap.board);
        if(m.devoured&&m.devoured.length){notify(`吞噬！${m.devoured.length}子转化`,'info');addSystemChat(`吞噬！${m.devoured.length}子被转化`);}
        if(m.destroyed){notify(`超新星！${m.destroyed.length}子湮灭`,'info');addSystemChat(`超新星爆发！${m.destroyed.length}子湮灭`);}
        if(m.skill==='mountain'&&m.winner){notify(`${names[m.winner]||'?'}力拔山兮！`,'info');addSystemChat(`${names[m.winner]||'?'} 使用了「力拔山兮」，直接获胜！`);}
        if(m.skill==='swap'&&m.player){addSystemChat(`${names[m.player]||'?'} 使用了「偷梁换柱」，将 (${m.r+1},${m.c+1}) 变为己方3回合`);}
        if(m.skill==='swapPos'&&m.player){addSystemChat(`${names[m.player]||'?'} 使用了「移形换影」，交换了棋子位置`);}
        if(m.skill==='move'&&m.player){addSystemChat(`${names[m.player]||'?'} 使用了「斗转星移」，移动了棋子`);}
        if(m.skill==='ambush'&&m.player){
        // 只对使用者自己显示通知，对手不知道
        if(m.player===myRole) addSystemChat(`你启动了「暗度陈仓」，现在下假棋子（对手可见但不计胜利）`);
      }
        // ── 扩展技能事件 ──
        if(m.skill==='barrier'&&m.player){
          notify(`${names[m.player]||'?'} 金钟罩护盾`,'info');
          addSystemChat(`${names[m.player]||'?'} 使用了「金钟罩」，棋子获得 ${m.duration||3} 回合护盾`);
        }
        if(m.skill==='phoenix'&&m.player){
          notify(`${names[m.player]||'?'} 凤凰涅槃`,'info');
          addSystemChat(`${names[m.player]||'?'} 使用了「凤凰涅槃」，(${m.r+1},${m.c+1}) 废墟复活！`);
        }
        if(m.skill==='meteor'&&m.player){
          const n = (m.destroyed||[]).length;
          notify(`${names[m.player]||'?'} 陨石坠落 — ${n}子`,'warn');
          addSystemChat(`${names[m.player]||'?'} 使用了「陨石坠落」，摧毁 ${n} 枚敌方棋子`);
        }
        if(m.skill==='sandstorm'&&m.pending&&m.player){addSystemChat(`${names[m.player]||'?'} 使用了「飞沙走石」...`);}
        // Blood mode: five-in-a-row clear + score
        if(m.bloodMode&&m.bloodClear){
          const bc=m.bloodClear;
          notify(`五连！+${bc.score}分 (${bc.totalBloodScore}分/${snap.scores[myRole]||0}连)`,'warn');
          addSystemChat(`五连得分！清除${bc.cleared.length}子，获得${bc.score}分 (共${bc.totalBloodScore}分/${snap.scores[myRole]||0}连)`);
          // Blood clear particles — cleared cells explode
          if(bc.cleared){
            for(const [cr,cc,cval] of bc.cleared){
              const cx=pad+cc*cellSize,cy=pad+cr*cellSize;
              const clr=PC[cval]||'200,200,200';
              for(let i=0;i<8;i++){const a=Math.random()*Math.PI*2,sp=Math.random()*3+1;particles.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-.8,r:Math.random()*3+1,life:1,color:clr});}
            }
          }
        }
        // Mountain skill in blood mode
        if(m.skill==='mountain'&&m.bloodMode){
          notify(`力拔山兮！+3分 (${m.bloodScore}分)`,'warn');
          addSystemChat(`${names[m.player]||'?'} 使用「力拔山兮」，获得3分！(共${m.bloodScore}分)`);
        }
        // 暗度陈仓完成时的通知
        if(m.ambushComplete){
          // 检查是否有真棋子是自己的（在 ambushHidden 中）
          let isMyAmbush = false;
          for(const key of Object.keys(snap.ambushHidden||{})){
            if(!key.startsWith('fake_') && snap.ambushHidden[key]===myRole){
              isMyAmbush = true;
              break;
            }
          }
          if(isMyAmbush){
            // 使用者看到完成提示
            addSystemChat(`暗度陈仓完成！假棋子和真棋子都已落下`);
          }else{
            // 对手看到的是"对手落下一子"，不知道是暗度陈仓
            // 找出是谁下的（通过 fakePos 的 ambushHidden 值）
            const fakeOwner = snap.ambushHidden[`fake_${m.fakePos[0]}_${m.fakePos[1]}`];
            if(fakeOwner) addSystemChat(`${names[fakeOwner]||'对手'} 下一子`);
          }
        }
        updateGameUI(); // 强制刷新UI，更新回合指示器
        updateAIThinking();
      }
      break;
    case 'ambushFake':
      if(m.snapshot)snap=m.snapshot;
      // 假棋子对手可见，但不知道是暗度陈仓
      if(m.player===myRole){
        addSystemChat(`你落下了假棋子（对手可见但不计胜利），现在下真棋子（对手不可见）`);
      }else{
        // 对手看到棋子落下，不知道是暗度陈仓的假棋子
        addSystemChat(`${names[m.player]||'对手'} 落下一子`);
      }
      updateGameUI(); // 强制刷新UI
      break;
    case 'skillPending':
      if(m.skill==='sandstorm'&&m.player){
        notify(`${names[m.player]||'?'}使用飞沙走石！`,'warn');
        addSystemChat(`${names[m.player]||'?'} 使用了「飞沙走石」...`);
        if(m.player!==myRole && myEquipped.includes('intercept')) showInterceptBanner('飞沙走石');
      }
      if(m.skill==='swap'&&m.player){
        notify(`${names[m.player]||'?'}使用偷梁换柱！`,'warn');
        addSystemChat(`${names[m.player]||'?'} 使用了「偷梁换柱」...`);
        if(m.player!==myRole && myEquipped.includes('intercept')) showInterceptBanner('偷梁换柱');
      }
      if(m.skill==='swapPos'&&m.player){
        notify(`${names[m.player]||'?'}使用移形换影！`,'warn');
        addSystemChat(`${names[m.player]||'?'} 使用了「移形换影」...`);
        if(m.player!==myRole && myEquipped.includes('intercept')) showInterceptBanner('移形换影');
      }
      break;
    case 'skillApplied':
      if(m.snapshot)snap=m.snapshot;
      if(m.skill==='sandstorm'){
        notify('飞沙走石生效','info');
        addSystemChat(`飞沙走石生效，(${m.r+1},${m.c+1}) 棋子移除`);
      }
      if(m.skill==='swap'){
        notify('偷梁换柱生效','info');
        addSystemChat(`偷梁换柱生效，(${m.r+1},${m.c+1}) 变为己方`);
      }
      if(m.skill==='swapPos'){
        notify('移形换影生效','info');
        addSystemChat(`移形换影生效，位置交换`);
      }
      removeInterceptBanner();
      updateGameUI();
      break;
    case 'intercept':
      if(m.snapshot)snap=m.snapshot;
      const skillName=m.interceptedSkill==='swap'?'偷梁换柱':m.interceptedSkill==='swapPos'?'移形换影':'飞沙走石';
      notify(`擒拿！${skillName}被打断`,'warn');
      addSystemChat(`${names[m.interceptor]||'?'} 使用「擒拿」打断了${skillName}！`);
      removeInterceptBanner();
      updateGameUI();
      break;
    case 'restarted':
      snap=m.snapshot;names={...DEFAULT_NAMES,...(m.names||{})};gameMode=m.mode||2;
      myEquipped=(snap.equipped&&snap.equipped[myRole])||[];
      ripples=[];particles=[];winGlow=0;sandstormMode=false;swapMode=false;moveFromMode=false;moveFrom=null;swapPosStep=0;swapPosMy=null;
      document.getElementById('overlay').classList.remove('show');
      document.getElementById('nova-btn').style.display='none';
      notify('新一局开始','info');addSystemChat('新一局开始');
      updateAIThinking();
      break;
    case 'playerLeft':if(m.snapshot)snap=m.snapshot;notify(`${names[m.role]||'?'}已离开`,'info');break;
    case 'restartRequested':notify('对手请求重新开始','info');break;
    case 'chat':addChat(m.from,m.text);break;
    case 'ambushExposed':
      if(m.snapshot)snap=m.snapshot;
      notify(`${names[m.owner]||'?'}的暗度陈仓被揭露！`,'warn');
      addSystemChat(`${names[m.owner]||'?'} 的「暗度陈仓」真棋子被发现，假棋子已清除！`);
      updateGameUI();
      break;
    case 'undoRequestPending':
      if(m.from!==myRole){
        showUndoBanner(m.from);
        addSystemChat(`${names[m.from]||'对手'} 请求悔棋`);
      }else{
        notify('悔棋请求已发送','info');
      }
      break;
    case 'undoAccepted':
      if(m.snapshot)snap=m.snapshot;
      notify('悔棋成功','info');
      addSystemChat(`${names[m.from]||'对手'} 同意悔棋`);
      removeUndoBanner();
      updateGameUI();
      break;
    case 'undoRejected':
      notify('悔棋被拒绝','warn');
      addSystemChat(`${names[m.from]||'对手'} 拒绝悔棋`);
      removeUndoBanner();
      break;
    case 'error':
      notify(m.message||'错误','error');
      // 如果是重连失败（房间不存在或 token 无效），清掉缓存的会话，回到大厅
      if(/会话|不存在|过期/.test(m.message||'')){
        clearSession();
        showScreen('lobby');
      }
      break;
    case 'playerDisconnected':
      notify(`玩家暂时断线，${Math.ceil((m.graceMs||60000)/1000)}秒内可重连`,'info');
      break;
    case 'playerReconnected':
      notify('玩家已重连','ok');
      break;
  }
  if(snap&&document.getElementById('game').classList.contains('show')){updateGameUI();updateAIThinking();}
}

// ═══════════════════════════════════════
//  Room UI (rebuilt each update)
// ═══════════════════════════════════════
function buildRoomUI(m){
  lastRoomUpdate=m; // 缓存房间状态
  const count=gameMode;const roles=count===3?[P1,P2,P3]:[P1,P2];
  const equipped=m.equipped||{};
  const mySelectedSkills=selectedSkills.length>0?selectedSkills:(equipped[myRole]||[]);

  let html=`<h2>战前准备</h2>`;

  // AI房间不需要分享房间号
  if(!aiMode){
    html+=`<div class="room-code-area">
      <div class="code" id="room-code-display">${roomId||'-----'}</div>
      <div class="hint">将房间号告知对手${bloodMode?' · <span style="color:#ff7766">血战模式</span>':''}</div>
      <button class="copy-btn" onclick="copyCode()">复制</button>
    </div>`;
  }else{
    const diffLabel=aiDifficulty==='simple'?'初学':aiDifficulty==='medium'?'进阶':'宗师';
    const bloodLabel=bloodMode?' · <span style="color:#ff7766">血战</span>':'';
    html+=`<div class="room-code-area">
      <div class="code" style="font-size:16px;letter-spacing:3px">&#x1F916; 人机对战 · ${diffLabel}${bloodLabel}</div>
    </div>`;
  }

  // Players
  html+=`<div class="players-row">`;
  for(let i=0;i<count;i++){
    const role=roles[i];const css=PSCSS[role];const filled=m.players[i];const nm=names[role]||DEFAULT_NAMES[role];
    const eq=equipped[role]||[];
    const eqStr=eq.length?eq.map(s=>ALL_SKILLS.find(a=>a.id===s)?.name||s).join(' + '):'未选择';
    const isAIPlayer=aiMode&&i===1;
    html+=`<div class="player-slot ${css} ${filled?'filled':'pc-empty'}">
      <div class="icon"></div>
      <div class="name-label">${esc(nm)}${isAIPlayer?' <span style="font-size:9px;opacity:.4">&#x1F916;</span>':''}</div>
      <div class="wait">${filled?'已加入':'等待...'}</div>
      <div class="equipped-label">${isAIPlayer?'自动选择':eqStr}</div>
    </div>`;
  }
  html+=`</div>`;

  // Skill selection — only for human player (AI auto-selects)
  html+=`<div class="skill-select-section">
    <h3>${aiMode?'选择你的技能':'选择技能'} (选2个)</h3>
    <div class="skill-grid">`;
  for(const sk of ALL_SKILLS){
    const isSel=mySelectedSkills.includes(sk.id);
    html+=`<div class="skill-pick ${isSel?'selected':''}"
      onclick="toggleSkillPick('${sk.id}')" ontouchend="event.preventDefault();toggleSkillPick('${sk.id}')">
      <div class="sp-name">${sk.name}</div>
      <div class="sp-desc">${sk.desc}</div>
      <div class="sp-type">${sk.type==='passive'?'被动':'主动'}</div>
    </div>`;
  }
  html+=`</div></div>`;

  // Settings
  html+=`<div class="settings-section"><h3>全局法则 (创建者可调整)</h3>`;
  const sLabels={devour:'吞噬',decay:'衰变',nova:'超新星',rift:'裂隙',gravity:'引力'};
  const sDescs={devour:'三面被围即转化',decay:'12手后化为废墟',nova:'四连珠可引爆清场',rift:'每5手随机封锁',gravity:'落子点旁裂隙被三面围则坍缩为废墟'};
  for(const [k,v] of Object.entries(m.settings)){
    // 血战模式禁用超新星
    const disabledKey=(k==='nova'&&bloodMode);
    html+=`<div class="setting-row"><span class="label">${sLabels[k]} — ${sDescs[k]}${disabledKey?' (血战模式禁用)':''}</span>
      <button class="toggle ${v?'on':''}" data-key="${k}" onclick="toggleSetting(this)" ${isCreator&&!disabledKey?'':'disabled'}></button></div>`;
  }
  html+=`</div>`;

  // Start
  const allJoined=m.players.slice(0,count).every(Boolean);
  const allEquipped=roles.every(r=>(equipped[r]&&equipped[r].length>=2));
  const canStart=allJoined&&allEquipped;
  html+=`<button class="start-btn" onclick="startGame()" ${canStart&&isCreator?'':'disabled'}>${!allJoined?'等待玩家加入...':!allEquipped?(aiMode?'请选择2个技能...':'等待所有人选择2个技能...'):isCreator?'开始对弈':'等待创建者开始...'}</button>`;

  document.getElementById('room-box').innerHTML=html;
}

function toggleSkillPick(id){
  const idx=selectedSkills.indexOf(id);
  if(idx>=0) selectedSkills.splice(idx,1);
  else if(selectedSkills.length<2) selectedSkills.push(id);
  else{ notify('最多选2个技能','error');return; }
  send({type:'equipSkills',skills:selectedSkills});
  // 强制刷新UI以显示最新选中状态
  buildRoomUI(lastRoomUpdate||{});
}

function toggleSetting(el){
  if(!isCreator)return;el.classList.toggle('on');
  send({type:'toggleSetting',key:el.dataset.key});
}
function startGame(){send({type:'startGame'})}

// ═══════════════════════════════════════
//  Game actions
// ═══════════════════════════════════════
function getRoles(){return gameMode===3?[P1,P2,P3]:[P1,P2]}
function requestRestart(){send({type:'restart'});notify('已请求重新开始','info')}
function requestUndo(){send({type:'undoRequest'});notify('已请求悔棋','info')}
function acceptUndo(){send({type:'undoResponse',accepted:true});removeUndoBanner()}
function rejectUndo(){send({type:'undoResponse',accepted:false});removeUndoBanner()}
function showUndoBanner(from){
  const c=document.getElementById('undo-container');
  c.innerHTML=`<div class="undo-banner"><h3>悔棋请求</h3><p>${names[from]||'对手'} 请求悔棋，是否同意？</p>
    <div class="undo-btns">
      <button class="undo-btn" onclick="acceptUndo()">同意</button>
      <button class="undo-btn reject" onclick="rejectUndo()">拒绝</button>
    </div></div>`;
}
function removeUndoBanner(){document.getElementById('undo-container').innerHTML=''}
function triggerSupernova(){send({type:'supernova'})}
function triggerIntercept(){send({type:'intercept'});removeInterceptBanner()}

function useSkill(skill,extra){
  if(!snap||snap.gameOver)return;
  if(snap.currentPlayer!==myRole)return;
  if(snap.pendingSkill)return;
  send({type:'useSkill',skill,...extra});
}

function enterSandstormMode(){sandstormMode=true;swapMode=false;moveFromMode=false;bCvs.classList.add('target-mode','sandstorm');notify('点击要移除的棋子','warn')}
function enterSwapMode(){swapMode=true;sandstormMode=false;moveFromMode=false;bCvs.classList.add('target-mode','sandstorm');notify('点击要转化的敌方棋子','warn')}
function enterMoveMode(){moveFromMode=true;sandstormMode=false;swapMode=false;bCvs.classList.add('target-mode','sandstorm');notify('点击要移动的棋子','warn')}
function cancelTargetMode(){sandstormMode=false;swapMode=false;moveFromMode=false;moveFrom=null;barrierMode=false;phoenixMode=false;meteorMode=false;bCvs.classList.remove('target-mode','sandstorm')}

// ── 扩展技能交互 ──
let barrierMode=false, phoenixMode=false, meteorMode=false;
function enterBarrierMode(){barrierMode=true;phoenixMode=false;meteorMode=false;cancelOtherSkillModes('barrier');bCvs.classList.add('target-mode');notify('点击要施加护盾的己方棋子','warn')}
function enterPhoenixMode(){phoenixMode=true;barrierMode=false;meteorMode=false;cancelOtherSkillModes('phoenix');bCvs.classList.add('target-mode');notify('点击一枚废墟（衰变后的棋子）','warn')}
function enterMeteorMode(){meteorMode=true;barrierMode=false;phoenixMode=false;cancelOtherSkillModes('meteor');bCvs.classList.add('target-mode');notify('点击中心格（3×3 内敌方棋子会被陨石击毁）','warn')}
function cancelOtherSkillModes(except){
  sandstormMode=false; swapMode=false; moveFromMode=false; moveFrom=null;
  if(except!=='barrier') barrierMode=false;
  if(except!=='phoenix') phoenixMode=false;
  if(except!=='meteor')  meteorMode=false;
}

// 通用冷却进度条
function cooldownBar(left, total, color){
  const pct = (total - left) / total * 100;
  return `<div style="display:flex;align-items:center;gap:4px;margin-top:2px">
    <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:2px"></div>
    </div>
    <span style="font-size:8px;opacity:.4">${left}</span>
  </div>`;
}

function useAmbush(){useSkill('ambush',{})}

function enterSwapPosMode(){swapPosStep=1;swapPosMy=null;sandstormMode=false;swapMode=false;moveFromMode=false;bCvs.classList.add('target-mode');notify('点击己方棋子','warn')}
function cancelSwapPosMode(){swapPosStep=0;swapPosMy=null;bCvs.classList.remove('target-mode')}
function cancelTargetMode(){sandstormMode=false;swapMode=false;moveFromMode=false;moveFrom=null;swapPosStep=0;swapPosMy=null;bCvs.classList.remove('target-mode','sandstorm')}

function showInterceptBanner(skillName){
  const c=document.getElementById('intercept-container');
  c.innerHTML=`<div class="intercept-banner"><h3>${skillName||'技能'}</h3><p>是否使用「擒拿」打断？</p>
    <button class="intercept-btn" onclick="triggerIntercept()">擒拿打断</button>
    <div class="intercept-timer"><div class="intercept-timer-fill" id="intercept-fill" style="width:100%"></div></div></div>`;
  requestAnimationFrame(()=>{const f=document.getElementById('intercept-fill');if(f){f.style.transition='width 1.5s linear';requestAnimationFrame(()=>{if(f)f.style.width='0%'})}});
}
function removeInterceptBanner(){document.getElementById('intercept-container').innerHTML=''}

// Chat
function sendChat(){const i=document.getElementById('chat-input');const t=i.value.trim();if(!t)return;send({type:'chat',text:t});addChat(myRole,t,true);i.value=''}
function addChat(from,text,isSelf){const el=document.getElementById('chat-messages');if(!el)return;el.innerHTML+=`<div style="${isSelf?'opacity:.55':'opacity:1'}"><span style="color:rgb(${PC[from]||'200,200,200'})">${esc(names[from]||'?')}</span>: ${esc(text)}</div>`;el.scrollTop=el.scrollHeight}
function addSystemChat(text){const el=document.getElementById('chat-messages');if(!el)return;el.innerHTML+=`<div style="opacity:.45;font-style:italic"><span style="color:#998877">⚔</span> ${esc(text)}</div>`;el.scrollTop=el.scrollHeight}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

// ═══════════════════════════════════════
//  Game UI
// ═══════════════════════════════════════
function updateGameUI(){
  if(!snap)return;
  const bar=document.getElementById('info-bar');let h='';
  const isBlood=snap.gameMode==='blood';
  for(const r of getRoles()){
    const css=PCSS[r];const act=snap.currentPlayer===r&&!snap.gameOver?'active':'';
    const me=r===myRole?'me':'';
    const aiLabel=aiMode&&r!==myRole?' <span style="font-size:8px;opacity:.35">&#x1F916;</span>':'';
    const scoreDisplay=isBlood?`${snap.scores[r]||0}连/${snap.bloodScores[r]||0}分`:(snap.scores[r]||0);
    h+=`<div class="player-ind ${css} ${act} ${me}"><div class="dot ${css}"></div><span>${esc(names[r]||'?')}${aiLabel}</span><span class="score-text">${scoreDisplay}</span></div>`;
  }
  bar.innerHTML=h;
  document.getElementById('move-count').textContent=`第 ${snap.totalMoves} 手` + (isBlood?' · 血战':'');

  if(snap.novaLine&&snap.novaLine.player===myRole)showNovaBtn(snap.novaLine.cells);
  else document.getElementById('nova-btn').style.display='none';

  buildSidePanel();

  // Win (only show overlay when game is truly over, not on blood mode five-in-a-row)
  if(snap.gameOver&&!document.getElementById('overlay').classList.contains('show')){
    updateAIThinking(); // hide thinking on game over
    let winner=null,sub='';
    if(isBlood){
      // 血战模式：找到最高分的玩家
      let maxScore=-1, maxFive=0;
      for(const r of getRoles()){
        const bs=snap.bloodScores[r]||0;
        const fc=snap.scores[r]||0;
        if(bs>maxScore || fc>maxFive){maxScore=bs;maxFive=fc;winner=r;}
      }
      // 检查胜利原因
      if((snap.scores[winner]||0) >= 5) sub=`五连${snap.scores[winner]}次，势不可挡`;
      else if((snap.bloodScores[winner]||0) >= 20) sub=`血战分数${snap.bloodScores[winner]}，统治全场`;
      else sub='血战到底，分出胜负';
    }else if(snap.winCells&&snap.winCells.length>0){
      winner=snap.board[snap.winCells[0][0]][snap.winCells[0][1]];
      sub=winner===P1?'宇宙归于秩序':winner===P2?'宇宙归于混沌':'宇宙归于平衡';
      for(const [wr,wc] of snap.winCells){const wx=pad+wc*cellSize,wy=pad+wr*cellSize;
        for(let i=0;i<10;i++){const a=Math.random()*Math.PI*2,sp=Math.random()*2.5+1;particles.push({x:wx,y:wy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-1,r:Math.random()*3+1,life:1,color:PC[winner]});}}
    } else {for(const r of getRoles()){if(snap.scores[r]>0)winner=r;}sub='山岳崩颓，天地翻覆';}
    if(winner){document.getElementById('winner-text').textContent=`${names[winner]||'某方'} 胜`;document.getElementById('winner-sub').textContent=sub;setTimeout(()=>document.getElementById('overlay').classList.add('show'),600);}
  }
}

function buildSidePanel(){
  if(!snap||!myRole)return;
  const s=snap;const isMyTurn=s.currentPlayer===myRole&&!s.gameOver&&!s.pendingSkill;
  const eq=s.equipped[myRole]||[];const ss=s.skillState[myRole]||{};
  let html='';

  // Global rules
  html+=`<div class="card"><h3>全局法则</h3>`;
  const gL={devour:'吞噬',decay:'衰变',nova:'超新星',rift:'裂隙',gravity:'引力'};
  const gD={devour:'三面被围即转化',decay:'12手后化为废墟',nova:'四连珠可引爆',rift:'每5手随机封锁',gravity:'裂隙坍缩为废墟'};
  const isBloodGame=s.gameMode==='blood';
  for(const [k,v] of Object.entries(s.globalSettings)){
    if(k==='nova'&&isBloodGame) continue; // blood mode hides nova
    html+=`<div style="margin-bottom:2px;opacity:${v?.6:.18}"><b>${gL[k]}</b> <span style="opacity:.45;font-size:8px">${gD[k]}</span></div>`;
  }
  if(isBloodGame) html+=`<div style="margin-bottom:2px;opacity:.6;color:#ff7766"><b>血战模式</b> <span style="opacity:.45;font-size:8px">五连清除得分，5连或20分胜</span></div>`;
  html+=`</div>`;

  // My skills
  html+=`<div class="card"><h3>我的技能</h3>`;
  for(const sid of eq){
    const sk=ALL_SKILLS.find(a=>a.id===sid);if(!sk)continue;
    const skInfo=ss[sid];
    const disabled=!isMyTurn||(sid==='move'&&skInfo>0)||(sid==='swapPos'&&skInfo>0)||(sid==='mountain'&&s.totalMoves<50);
    let btnHtml='';

    if(sid==='swapPos'){
      if(skInfo>0) btnHtml=`<div style="display:flex;align-items:center;gap:4px;margin-top:2px">
        <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden">
          <div style="width:${(4-skInfo)/4*100}%;height:100%;background:#66bbff;border-radius:2px"></div>
        </div>
        <span style="font-size:8px;opacity:.4">${skInfo}</span>
      </div>`;
      else btnHtml=`<button class="skill-btn s_swapPos" onclick="enterSwapPosMode()" ${disabled?'disabled':''}>选择交换</button>`;
    }else if(sid==='intercept'){
      btnHtml=`<span style="font-size:9px;opacity:.4">被动 — 自动响应</span>`;
    }else if(sid==='mountain'){
      if(s.totalMoves<50) btnHtml=`<span style="font-size:9px;opacity:.25">还需 ${50-s.totalMoves} 回合</span>`;
      else if(isBloodGame) btnHtml=`<button class="skill-btn s_mountain" onclick="useSkill('mountain')" ${disabled?'disabled':''}>力拔山兮 +3分</button>`;
      else btnHtml=`<button class="skill-btn s_mountain" onclick="useSkill('mountain')" ${disabled?'disabled':''}>力拔山兮！</button>`;
    }else if(sid==='swap'){
      btnHtml=`<button class="skill-btn s_swap" onclick="enterSwapMode()" ${disabled?'disabled':''}>选择敌方棋子</button>`;
    }else if(sid==='move'){
      if(skInfo>0) btnHtml=`<div style="display:flex;align-items:center;gap:4px;margin-top:2px">
        <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden">
          <div style="width:${(5-skInfo)/5*100}%;height:100%;background:#66ccff;border-radius:2px"></div>
        </div>
        <span style="font-size:8px;opacity:.4">${skInfo}</span>
      </div>`;
      else btnHtml=`<button class="skill-btn s_move" onclick="enterMoveMode()" ${disabled?'disabled':''}>选择棋子</button>`;
    }else if(sid==='sandstorm'){
      // 飞沙走石冷却显示（5回合冷却）
      const lastUsed = snap.sandstormLastUsed && snap.sandstormLastUsed[myRole] || 0;
      const cooldownLeft = Math.max(0, 5 - (snap.totalMoves - lastUsed));
      if(cooldownLeft > 0) {
        btnHtml=`<div style="display:flex;align-items:center;gap:4px;margin-top:2px">
          <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden">
            <div style="width:${(5-cooldownLeft)/5*100}%;height:100%;background:#ffaa55;border-radius:2px"></div>
          </div>
          <span style="font-size:8px;opacity:.4">${cooldownLeft}</span>
        </div>`;
      } else {
        btnHtml=`<button class="skill-btn s_sandstorm" onclick="enterSandstormMode()" ${disabled?'disabled':''}>选择目标</button>`;
      }
    }else if(sid==='impervious'){
      btnHtml=`<span style="font-size:9px;opacity:.4">被动 — 己方棋子免疫技能</span>`;
    }else if(sid==='ambush'){
      btnHtml=`<button class="skill-btn s_ambush" onclick="useAmbush()" ${disabled?'disabled':''}>暗度陈仓</button>`;
    }else if(sid==='barrier'){
      if(skInfo>0) btnHtml=cooldownBar(skInfo, 6, '#aaccff');
      else btnHtml=`<button class="skill-btn s_barrier" onclick="enterBarrierMode()" ${disabled?'disabled':''}>选择己方棋子</button>`;
    }else if(sid==='phoenix'){
      if(skInfo>0) btnHtml=cooldownBar(skInfo, 8, '#ff8844');
      else btnHtml=`<button class="skill-btn s_phoenix" onclick="enterPhoenixMode()" ${disabled?'disabled':''}>选择废墟</button>`;
    }else if(sid==='meteor'){
      if(skInfo>0) btnHtml=cooldownBar(skInfo, 10, '#ffcc55');
      else btnHtml=`<button class="skill-btn s_meteor" onclick="enterMeteorMode()" ${disabled?'disabled':''}>选择中心格</button>`;
    }

    html+=`<div class="skill-card"><h4 style="color:${skillColor(sid)}">${sk.name} <span style="font-size:8px;opacity:.3">${sk.type==='passive'?'被动':'主动'}</span></h4>
      <p>${sk.desc}</p>${btnHtml}</div>`;
  }
  html+=`</div>`;

  // Swap tracking
  if(s.swapMap&&Object.keys(s.swapMap).length>0){
    html+=`<div class="card"><h3>偷梁换柱</h3>`;
    for(const [key,val] of Object.entries(s.swapMap)){
      const [r,c]=key.split(',');
      html+=`<p>(${+r+1},${+c+1}) ${names[val.owner]}→${names[s.board[+r][+c]]} 剩${val.turnsLeft}回合</p>`;
    }
    html+=`</div>`;
  }

  // Ambush state - 显示当前阶段提示
  if(s.ambushPhase==='fake'&&s.ambushPlayer===myRole){
    html+=`<div class="card" style="border-color:rgba(80,200,120,.2)"><h3 style="color:#55cc77">暗度陈仓</h3><p>技能已启动！请点击棋盘下<strong>假棋子</strong>（可见但不参与胜利）</p></div>`;
  }
  if(s.ambushPhase==='real'&&s.ambushPlayer===myRole){
    html+=`<div class="card" style="border-color:rgba(80,200,120,.2)"><h3 style="color:#55cc77">暗度陈仓</h3><p>假棋已落！请点击<strong>其他空位</strong>下真棋子（对手不可见）</p></div>`;
  }

  // Chat
  html+=`<div class="chat-box"><h3>对话</h3><div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-row"><input class="chat-input" id="chat-input" placeholder="..." maxlength="200" onkeydown="if(event.key==='Enter')sendChat()">
    <button class="chat-send" onclick="sendChat()">发</button></div></div>`;

  const chatEl=document.getElementById('chat-messages');const chatHTML=chatEl?chatEl.innerHTML:'';
  document.getElementById('side-panel').innerHTML=html;
  const nc=document.getElementById('chat-messages');if(nc){nc.innerHTML=chatHTML;nc.scrollTop=nc.scrollHeight}
}

function skillColor(sid){return{sandstorm:'#ffaa55',swapPos:'#66bbff',intercept:'#ff7766',mountain:'#ccaa55',swap:'#cc77ff',move:'#66ccff',impervious:'#aaa',ambush:'#55cc77',barrier:'#aaccff',phoenix:'#ff8844',meteor:'#ffcc55'}[sid]||'#d8d0c4'}

function showNovaBtn(cells){
  const btn=document.getElementById('nova-btn');const midR=cells[Math.floor(cells.length/2)][0];const midC=cells[Math.floor(cells.length/2)][1];
  const cr=bCvs.getBoundingClientRect();const pr=bCvs.parentElement.getBoundingClientRect();
  btn.style.left=(cr.left-pr.left+pad+midC*cellSize-40)+'px';btn.style.top=(cr.top-pr.top+pad+midR*cellSize-28)+'px';btn.style.display='block';
}

// ═══════════════════════════════════════
//  Board input
// ═══════════════════════════════════════
function getGridPos(e){
  const rect=bCvs.getBoundingClientRect();let cx,cy;
  if(e.clientX!==undefined){cx=e.clientX;cy=e.clientY;}
  else if(e.touches&&e.touches[0]){cx=e.touches[0].clientX;cy=e.touches[0].clientY;}
  else return null;
  const c=Math.round((cx-rect.left-pad)/cellSize);const r=Math.round((cy-rect.top-pad)/cellSize);
  if(r<0||r>=N||c<0||c>=N)return null;return{r,c};
}

bCvs.addEventListener('mousemove',e=>{hoverPos=getGridPos(e)});
bCvs.addEventListener('mouseleave',()=>{hoverPos=null});
bCvs.addEventListener('touchmove',e=>{e.preventDefault();hoverPos=getGridPos(e.touches[0])},{passive:false});
bCvs.addEventListener('touchend',()=>{hoverPos=null});

function handleBoardClick(pos){
  if(!snap||snap.gameOver||!pos)return;
  const roles=getRoles();

  // Sandstorm mode
  if(sandstormMode){
    if(roles.includes(snap.board[pos.r][pos.c])){sandstormMode=false;bCvs.classList.remove('target-mode','sandstorm');useSkill('sandstorm',{r:pos.r,c:pos.c});}
    else notify('请选择一枚棋子','error');
    return;
  }
  // Swap mode
  if(swapMode){
    const target=snap.board[pos.r][pos.c];
    if(roles.includes(target)&&target!==myRole){swapMode=false;bCvs.classList.remove('target-mode','sandstorm');useSkill('swap',{r:pos.r,c:pos.c});}
    else notify('请选择敌方棋子','error');
    return;
  }
  // Move from mode
  if(moveFromMode&&!moveFrom){
    if(roles.includes(snap.board[pos.r][pos.c])){moveFrom={r:pos.r,c:pos.c};notify('现在点击目标空位','info');}
    else notify('请选择一枚棋子','error');
    return;
  }
  // Move to
  if(moveFromMode&&moveFrom){
    if(snap.board[pos.r][pos.c]===EMPTY){
      moveFromMode=false;bCvs.classList.remove('target-mode','sandstack');
      useSkill('move',{fr:moveFrom.r,fc:moveFrom.c,tr:pos.r,tc:pos.c});moveFrom=null;
    }else notify('目标必须为空位','error');
    return;
  }
  // ── 扩展技能 ──
  if(barrierMode){
    if(snap.board[pos.r][pos.c]===myRole){barrierMode=false;bCvs.classList.remove('target-mode');useSkill('barrier',{r:pos.r,c:pos.c});}
    else notify('只能选择己方棋子','error');
    return;
  }
  if(phoenixMode){
    if(snap.board[pos.r][pos.c]===4){phoenixMode=false;bCvs.classList.remove('target-mode');useSkill('phoenix',{r:pos.r,c:pos.c});}
    else notify('只能选择废墟（淡灰色方块）','error');
    return;
  }
  if(meteorMode){
    meteorMode=false;bCvs.classList.remove('target-mode');useSkill('meteor',{r:pos.r,c:pos.c});
    return;
  }
  // SwapPos step 1: select own stone
  if(swapPosStep===1){
    if(snap.board[pos.r][pos.c]===myRole){swapPosMy={r:pos.r,c:pos.c};swapPosStep=2;notify('现在点击对手棋子','info');}
    else notify('请选择己方棋子','error');
    return;
  }
  // SwapPos step 2: select opponent stone
  if(swapPosStep===2&&swapPosMy){
    const target=snap.board[pos.r][pos.c];
    if(roles.includes(target)&&target!==myRole){
      swapPosStep=0;bCvs.classList.remove('target-mode');
      useSkill('swapPos',{myR:swapPosMy.r,myC:swapPosMy.c,opR:pos.r,opC:pos.c});swapPosMy=null;
    }else notify('请选择对手棋子','error');
    return;
  }

  if(snap.currentPlayer!==myRole)return;
  if(snap.novaLine&&snap.novaLine.player===myRole){send({type:'dismissNova'});return;}
  if(snap.pendingSkill)return;
  if(snap.board[pos.r][pos.c]===EMPTY) send({type:'place',r:pos.r,c:pos.c});
}

bCvs.addEventListener('click',e=>{handleBoardClick(getGridPos(e))});
bCvs.addEventListener('touchstart',e=>{
  e.preventDefault();
  const pos=getGridPos(e.touches[0]);
  // 添加触摸反馈涟漪
  if(pos && hoverPos){
    const tx=pad+pos.c*cellSize,ty=pad+pos.r*cellSize;
    ripples.push({x:tx,y:ty,radius:cellSize*.1,alpha:.3,color:'150,150,150',fade:.02});
  }
  handleBoardClick(pos);
},{passive:false});

// ═══════════════════════════════════════
//  VFX
// ═══════════════════════════════════════
function detectChanges(prev,curr){
  const roles=getRoles();
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    if(prev[r][c]===curr[r][c])continue;
    const x=pad+c*cellSize,y=pad+r*cellSize;
    if(roles.includes(curr[r][c])){ripples.push({x,y,radius:cellSize*.35,alpha:.5,color:PC[curr[r][c]]});ripples.push({x,y,radius:cellSize*.15,alpha:.3,color:PC[curr[r][c]]});}
    if(curr[r][c]===RIFT) ripples.push({x,y,radius:5,alpha:.6,color:'80,180,255'});
    if(curr[r][c]===RUIN){for(let i=0;i<4;i++){const a=Math.random()*Math.PI*2,sp=Math.random()*1.5+.5;particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:Math.random()*2+1,life:1,color:'150,150,150'});}}
    if(roles.includes(prev[r][c])&&roles.includes(curr[r][c])&&prev[r][c]!==curr[r][c]){for(let i=0;i<6;i++){const a=Math.random()*Math.PI*2,sp=Math.random()*2+.8;particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-.5,r:Math.random()*2.5+1,life:1,color:PC[curr[r][c]]});}}
    if(roles.includes(prev[r][c])&&curr[r][c]===EMPTY){for(let i=0;i<8;i++){const a=Math.random()*Math.PI*2,sp=Math.random()*2.5+1;particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-.8,r:Math.random()*3+1,life:1,color:PC[prev[r][c]]});}}
  }
}

function notify(text,type){const c=document.getElementById('notif-container');const el=document.createElement('div');el.className='notif';const b={warn:'border-left:3px solid #ffaa55',error:'border-left:3px solid #ff5555',info:'border-left:3px solid #666'};el.style.cssText=b[type]||b.info;el.textContent=text;c.appendChild(el);setTimeout(()=>{el.classList.add('fade');setTimeout(()=>el.remove(),400)},2200)}

// ═══════════════════════════════════════
//  BG
// ═══════════════════════════════════════
let bgStars=[];
function initBg(){bgCvs.width=innerWidth;bgCvs.height=innerHeight;bgStars=[];for(let i=0;i<80;i++)bgStars.push({x:Math.random()*bgCvs.width,y:Math.random()*bgCvs.height,r:Math.random()*1+.2,dx:(Math.random()-.5)*.06,dy:(Math.random()-.5)*.06,a:Math.random()*.25+.04,hue:[40,260,165][Math.floor(Math.random()*3)]})}
function drawBg(t){bgCtx.clearRect(0,0,bgCvs.width,bgCvs.height);for(const s of bgStars){s.x+=s.dx;s.y+=s.dy;if(s.x<0)s.x=bgCvs.width;if(s.x>bgCvs.width)s.x=0;if(s.y<0)s.y=bgCvs.height;if(s.y>bgCvs.height)s.y=0;const fl=.5+.5*Math.sin(t*.0006+s.x*.008);bgCtx.beginPath();bgCtx.arc(s.x,s.y,s.r,0,Math.PI*2);bgCtx.fillStyle=`hsla(${s.hue},40%,66%,${s.a*fl})`;bgCtx.fill()}}

// ═══════════════════════════════════════
//  Sizing
// ═══════════════════════════════════════
function isMobile(){return innerWidth<=860}
function calcSize(){
  const mb=isMobile();
  // Mobile: board fills width, reserve minimal height for top bar
  const maxH=mb?innerHeight-80:innerHeight-100;
  const maxW=mb?innerWidth-12:innerWidth-240;
  const m=Math.min(maxH,maxW,mb?innerWidth-12:540);
  cellSize=Math.max(Math.floor(m/(N+1)),14);
  pad=cellSize;boardPx=cellSize*(N-1)+pad*2;
  bCvs.width=boardPx;bCvs.height=boardPx;
  bCvs.style.width=boardPx+'px';bCvs.style.height=boardPx+'px';
}

// ═══════════════════════════════════════
//  Drawing
// ═══════════════════════════════════════
function drawBoard(t){
  bCtx.clearRect(0,0,boardPx,boardPx);if(!snap)return;
  const{board,stoneAge,riftAge,ruinAge,currentPlayer,totalMoves,gameOver,winCells,novaLine,globalSettings,pendingSkill,swapMap}=snap;
  const roles=getRoles();

  const bg=bCtx.createRadialGradient(boardPx/2,boardPx/2,0,boardPx/2,boardPx/2,boardPx*.7);
  bg.addColorStop(0,'#12121e');bg.addColorStop(1,'#0a0a14');bCtx.fillStyle=bg;bCtx.fillRect(0,0,boardPx,boardPx);

  const breathe=.18+.04*Math.sin(t*.001);
  bCtx.strokeStyle=`rgba(200,190,175,${breathe})`;bCtx.lineWidth=.7;
  for(let i=0;i<N;i++){const p=pad+i*cellSize;bCtx.beginPath();bCtx.moveTo(p,pad);bCtx.lineTo(p,pad+(N-1)*cellSize);bCtx.stroke();bCtx.beginPath();bCtx.moveTo(pad,p);bCtx.lineTo(pad+(N-1)*cellSize,p);bCtx.stroke();}
  bCtx.fillStyle=`rgba(200,190,175,${breathe*1.8})`;for(const r of [3,7,11])for(const c of [3,7,11]){bCtx.beginPath();bCtx.arc(pad+c*cellSize,pad+r*cellSize,2.5,0,Math.PI*2);bCtx.fill();}

  // ── 扩展技能视觉：金钟罩护盾光环 ──
  if(snap.tempImpervious){
    for(const key of Object.keys(snap.tempImpervious)){
      const [tr, tc] = key.split(',').map(Number);
      const tx = pad + tc * cellSize, ty = pad + tr * cellSize;
      const pulse = 0.5 + 0.3 * Math.sin(t * 0.005);
      bCtx.strokeStyle = `rgba(170,204,255,${pulse})`;
      bCtx.lineWidth = 2;
      bCtx.beginPath(); bCtx.arc(tx, ty, cellSize * 0.55, 0, Math.PI * 2); bCtx.stroke();
    }
  }
  // Hover
  if(hoverPos&&!gameOver){
    const hx=pad+hoverPos.c*cellSize,hy=pad+hoverPos.r*cellSize;
    if(sandstormMode&&roles.includes(board[hoverPos.r][hoverPos.c])){bCtx.strokeStyle='rgba(255,150,60,0.6)';bCtx.lineWidth=2;bCtx.beginPath();bCtx.arc(hx,hy,cellSize*.48,0,Math.PI*2);bCtx.stroke();}
    else if(swapMode&&roles.includes(board[hoverPos.r][hoverPos.c])&&board[hoverPos.r][hoverPos.c]!==myRole){bCtx.strokeStyle='rgba(200,100,255,0.6)';bCtx.lineWidth=2;bCtx.beginPath();bCtx.arc(hx,hy,cellSize*.48,0,Math.PI*2);bCtx.stroke();}
    else if(moveFromMode){bCtx.strokeStyle='rgba(100,200,255,0.6)';bCtx.lineWidth=2;bCtx.beginPath();bCtx.arc(hx,hy,cellSize*.48,0,Math.PI*2);bCtx.stroke();}
    else if(swapPosStep===1&&board[hoverPos.r][hoverPos.c]===myRole){bCtx.strokeStyle='rgba(80,180,255,0.6)';bCtx.lineWidth=2;bCtx.beginPath();bCtx.arc(hx,hy,cellSize*.48,0,Math.PI*2);bCtx.stroke();}
    else if(swapPosStep===2&&roles.includes(board[hoverPos.r][hoverPos.c])&&board[hoverPos.r][hoverPos.c]!==myRole){bCtx.strokeStyle='rgba(80,180,255,0.6)';bCtx.lineWidth=2;bCtx.setLineDash([4,4]);bCtx.beginPath();bCtx.arc(hx,hy,cellSize*.48,0,Math.PI*2);bCtx.stroke();bCtx.setLineDash([]);}
    else if(barrierMode && board[hoverPos.r][hoverPos.c]===myRole){
      bCtx.strokeStyle='rgba(170,204,255,0.7)';bCtx.lineWidth=2;bCtx.beginPath();bCtx.arc(hx,hy,cellSize*.55,0,Math.PI*2);bCtx.stroke();
    }
    else if(phoenixMode && board[hoverPos.r][hoverPos.c]===4){ // RUIN
      bCtx.strokeStyle='rgba(255,136,68,0.7)';bCtx.lineWidth=2;bCtx.beginPath();bCtx.arc(hx,hy,cellSize*.5,0,Math.PI*2);bCtx.stroke();
    }
    else if(meteorMode){
      // 3x3 红色提示
      bCtx.fillStyle='rgba(255,80,80,0.10)';
      bCtx.fillRect(hx-cellSize*1.5, hy-cellSize*1.5, cellSize*3, cellSize*3);
      bCtx.strokeStyle='rgba(255,150,80,0.8)';bCtx.lineWidth=2;
      bCtx.strokeRect(hx-cellSize*1.5, hy-cellSize*1.5, cellSize*3, cellSize*3);
    }
    else if(!sandstormMode&&!swapMode&&!moveFromMode&&currentPlayer===myRole&&board[hoverPos.r][hoverPos.c]===EMPTY){
      const hc=PC[myRole];const hg=bCtx.createRadialGradient(hx,hy,0,hx,hy,cellSize*.6);
      hg.addColorStop(0,`rgba(${hc},0.12)`);hg.addColorStop(1,`rgba(${hc},0)`);
      bCtx.fillStyle=hg;bCtx.fillRect(hx-cellSize,hy-cellSize,cellSize*2,cellSize*2);
      bCtx.globalAlpha=.25;drawStone(hx,hy,myRole,1,0,t);bCtx.globalAlpha=1;
    }
  }

  // Pending skill
  if(pendingSkill&&pendingSkill.type==='sandstorm'){const px=pad+pendingSkill.c*cellSize,py=pad+pendingSkill.r*cellSize;const pulse=.4+.3*Math.sin(t*.008);bCtx.strokeStyle=`rgba(255,150,60,${pulse})`;bCtx.lineWidth=2.5;bCtx.beginPath();bCtx.arc(px,py,cellSize*.52,0,Math.PI*2);bCtx.stroke();}
  if(pendingSkill&&pendingSkill.type==='swap'){const px=pad+pendingSkill.c*cellSize,py=pad+pendingSkill.r*cellSize;const pulse=.4+.3*Math.sin(t*.008);bCtx.strokeStyle=`rgba(200,100,255,${pulse})`;bCtx.lineWidth=2.5;bCtx.beginPath();bCtx.arc(px,py,cellSize*.52,0,Math.PI*2);bCtx.stroke();}
  if(pendingSkill&&pendingSkill.type==='swapPos'){
    const pulse=.4+.3*Math.sin(t*.008);
    if(pendingSkill.myR!==undefined){const px1=pad+pendingSkill.myC*cellSize,py1=pad+pendingSkill.myR*cellSize;bCtx.strokeStyle=`rgba(80,180,255,${pulse})`;bCtx.lineWidth=2.5;bCtx.beginPath();bCtx.arc(px1,py1,cellSize*.52,0,Math.PI*2);bCtx.stroke();}
    if(pendingSkill.opR!==undefined){const px2=pad+pendingSkill.opC*cellSize,py2=pad+pendingSkill.opR*cellSize;bCtx.strokeStyle=`rgba(80,180,255,${pulse})`;bCtx.setLineDash([4,4]);bCtx.lineWidth=2.5;bCtx.beginPath();bCtx.arc(px2,py2,cellSize*.52,0,Math.PI*2);bCtx.stroke();bCtx.setLineDash([]);}
  }

  // Cells
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    const x=pad+c*cellSize,y=pad+r*cellSize,v=board[r][c];
    if(v===EMPTY)continue;
    if(v===RUIN){drawRuin(x,y,ruinAge[r][c],t);continue;}
    if(v===RIFT){drawRift(x,y,riftAge[r][c],t);continue;}
    if(!roles.includes(v))continue;
    const isWin=winCells&&winCells.some(w=>w[0]===r&&w[1]===c);
    const glow=isWin?.6+.4*Math.sin(winGlow):0;
    const age=stoneAge[r][c]||0;
    const decayRatio=globalSettings.decay?Math.min(age/12,1):0;
    
    // 暗度陈仓假棋子判断：
    // 1. 当前进行中的假棋子（ambushFakePos + ambushPlayer === myRole）
    // 2. 已完成的假棋子（ambushFakePositions 中存在该位置且属于 myRole）
    const isCurrentFake=snap.ambushFakePos&&snap.ambushFakePos[0]===r&&snap.ambushFakePos[1]===c&&snap.ambushPlayer===myRole;
    const isCompletedFake=snap.ambushFakePositions&&snap.ambushFakePositions.some(fp=>fp[0]===r&&fp[1]===c&&fp[2]===myRole);
    const isAmbushFake=isCurrentFake||isCompletedFake;
    
    // 暗度陈仓真棋子（只有自己能看到）
    const ambushHiddenKey=`${r},${c}`;
    const isAmbushReal=snap.ambushHidden&&snap.ambushHidden[ambushHiddenKey]===myRole;
    
    bCtx.globalAlpha=(1-decayRatio*.55)*(isAmbushFake?.35:1);
    drawStone(x,y,v,1,glow,t);
    
    // 假棋子标记（虚线圈 + "假"字）
    if(isAmbushFake){
      bCtx.strokeStyle='rgba(150,150,150,0.4)';
      bCtx.lineWidth=1.5;
      bCtx.setLineDash([4,4]);
      bCtx.beginPath();
      bCtx.arc(x,y,cellSize*.46,0,Math.PI*2);
      bCtx.stroke();
      bCtx.setLineDash([]);
      bCtx.fillStyle='rgba(150,150,150,0.6)';
      bCtx.font=`${cellSize*.25}px sans-serif`;
      bCtx.textAlign='center';
      bCtx.textBaseline='middle';
      bCtx.fillText('假',x,y);
    }
    // 真棋子标记（实线圈 + "真"字） - 不要同时显示假和真标记
    if(isAmbushReal&&!isAmbushFake){
      bCtx.strokeStyle='rgba(80,200,120,0.6)';
      bCtx.lineWidth=1.5;
      bCtx.beginPath();
      bCtx.arc(x,y,cellSize*.46,0,Math.PI*2);
      bCtx.stroke();
      bCtx.fillStyle='rgba(80,200,120,0.8)';
      bCtx.font=`${cellSize*.25}px sans-serif`;
      bCtx.textAlign='center';
      bCtx.textBaseline='middle';
      bCtx.fillText('真',x,y);
    }
    
    // Swap indicator
    const swapKey=`${r},${c}`;
    if(swapMap&&swapMap[swapKey]){bCtx.strokeStyle='rgba(200,100,255,0.5)';bCtx.lineWidth=1.5;bCtx.setLineDash([3,3]);bCtx.beginPath();bCtx.arc(x,y,cellSize*.46,0,Math.PI*2);bCtx.stroke();bCtx.setLineDash([]);}
    if(decayRatio>.4&&!isAmbushFake)drawCracks(x,y,decayRatio);
    bCtx.globalAlpha=1;
    if(age>0&&!isAmbushFake){const angle=(age/12)*Math.PI*2;bCtx.beginPath();bCtx.arc(x,y,cellSize*.48,-Math.PI/2,-Math.PI/2+angle);bCtx.strokeStyle=`rgba(${PC[v]},${.15+decayRatio*.25})`;bCtx.lineWidth=1.5;bCtx.stroke();}
    // 衰变倒计时：剩余5回合或更少时显示数字
    if(age>=7&&!isAmbushFake&&globalSettings.decay){
      const turnsLeft=12-age;
      bCtx.fillStyle=`rgba(255,100,100,0.8)`;
      bCtx.font=`bold ${cellSize*.28}px sans-serif`;
      bCtx.textAlign='center';
      bCtx.textBaseline='middle';
      bCtx.fillText(turnsLeft.toString(),x,y-cellSize*.08);
    }
  }

  // Nova
  if(novaLine&&!gameOver){const cells=novaLine.cells;const pulse=.3+.2*Math.sin(t*.005);bCtx.strokeStyle=`rgba(255,180,60,${pulse})`;bCtx.lineWidth=3;bCtx.shadowColor='#ffb43c';bCtx.shadowBlur=15;bCtx.beginPath();bCtx.moveTo(pad+cells[0][1]*cellSize,pad+cells[0][0]*cellSize);bCtx.lineTo(pad+cells[cells.length-1][1]*cellSize,pad+cells[cells.length-1][0]*cellSize);bCtx.stroke();bCtx.shadowBlur=0;}

  // Win line
  if(winCells&&winCells.length>=2){const f=winCells[0],l=winCells[winCells.length-1];const x1=pad+f[1]*cellSize,y1=pad+f[0]*cellSize,x2=pad+l[1]*cellSize,y2=pad+l[0]*cellSize;const wc=PC[board[winCells[0][0]][winCells[0][1]]];const lg=bCtx.createLinearGradient(x1,y1,x2,y2);lg.addColorStop(0,`rgba(${wc},0)`);lg.addColorStop(.5,`rgba(${wc},0.7)`);lg.addColorStop(1,`rgba(${wc},0)`);bCtx.strokeStyle=lg;bCtx.lineWidth=3;bCtx.shadowColor=`rgb(${wc})`;bCtx.shadowBlur=18;bCtx.beginPath();bCtx.moveTo(x1,y1);bCtx.lineTo(x2,y2);bCtx.stroke();bCtx.shadowBlur=0;}

  // Ripples & particles
  for(let i=ripples.length-1;i>=0;i--){const rp=ripples[i];rp.radius+=1;rp.alpha-=rp.fade||.01;if(rp.alpha<=0){ripples.splice(i,1);continue;}bCtx.beginPath();bCtx.arc(rp.x,rp.y,rp.radius,0,Math.PI*2);bCtx.strokeStyle=`rgba(${rp.color},${rp.alpha})`;bCtx.lineWidth=1;bCtx.stroke();}
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vy+=.015;p.life-=.01;if(p.life<=0){particles.splice(i,1);continue;}bCtx.beginPath();bCtx.arc(p.x,p.y,p.r*p.life,0,Math.PI*2);bCtx.fillStyle=`rgba(${p.color},${p.life*.7})`;bCtx.fill();}
}

function drawStone(x,y,type,scale,glow,t){
  const r=cellSize*.4*scale;bCtx.save();
  const sc={[P1]:'#ffd89b',[P2]:'#7a5fff',[P3]:'#50e8c0'};
  if(glow>0){bCtx.shadowColor=sc[type]||'#fff';bCtx.shadowBlur=20*glow;}
  const gs={[P1]:[['#fffdf5',.08],['#ffd89b',.4],['#c9963a',.85],['#8a6420',1]],[P2]:[['#b39dff',.05],['#7a5fff',.35],['#3a1f9e',.8],['#120838',1]],[P3]:[['#d0fff0',.08],['#50e8c0',.35],['#1a9e7a',.8],['#0a4a3a',1]]};
  const gd=gs[type]||gs[P1];const g=bCtx.createRadialGradient(x-r*.2,y-r*.2,r*.05,x,y,r);for(const[cl,st]of gd)g.addColorStop(st,cl);
  bCtx.fillStyle=g;bCtx.beginPath();bCtx.arc(x,y,r,0,Math.PI*2);bCtx.fill();
  const sh=.1+.07*Math.sin((t||0)*.003+x+y);
  const stc={[P1]:`rgba(255,240,200,${sh})`,[P2]:`rgba(180,160,255,${sh})`,[P3]:`rgba(160,255,224,${sh})`};
  bCtx.strokeStyle=stc[type]||stc[P1];bCtx.lineWidth=.7;bCtx.stroke();
  if(type===P2){const cg=bCtx.createRadialGradient(x,y,0,x,y,r*.35);cg.addColorStop(0,'rgba(0,0,0,0.35)');cg.addColorStop(1,'rgba(0,0,0,0)');bCtx.fillStyle=cg;bCtx.beginPath();bCtx.arc(x,y,r*.35,0,Math.PI*2);bCtx.fill();}
  if(type===P3){const cg=bCtx.createRadialGradient(x,y,0,x,y,r*.35);cg.addColorStop(0,'rgba(0,40,30,0.3)');cg.addColorStop(1,'rgba(0,40,30,0)');bCtx.fillStyle=cg;bCtx.beginPath();bCtx.arc(x,y,r*.35,0,Math.PI*2);bCtx.fill();}
  bCtx.restore();
}

function drawCracks(x,y,ratio){const r=cellSize*.4,intensity=(ratio-.4)/.6;bCtx.save();bCtx.globalAlpha=intensity*.6;bCtx.strokeStyle='#888';bCtx.lineWidth=.5;const seed=Math.floor(x*7+y*13);for(let i=0;i<3;i++){const a=(seed+i*2.1)%6.28;const len=r*(.3+intensity*.5);bCtx.beginPath();bCtx.moveTo(x+Math.cos(a)*r*.15,y+Math.sin(a)*r*.15);bCtx.lineTo(x+Math.cos(a)*len,y+Math.sin(a)*len);bCtx.stroke();}bCtx.restore();}
function drawRuin(x,y,age,t){
  const s=cellSize*.35;const ageRatio=Math.min((age||0)/10,1);
  bCtx.save();
  bCtx.globalAlpha=.55-ageRatio*.15;
  bCtx.beginPath();
  bCtx.moveTo(x-s,y-s*.6);bCtx.lineTo(x+s*.3,y-s);bCtx.lineTo(x+s,y-s*.4);
  bCtx.lineTo(x+s*.7,y+s*.3);bCtx.lineTo(x+s,y+s);bCtx.lineTo(x-s*.4,y+s*.8);
  bCtx.lineTo(x-s,y+s*.5);bCtx.closePath();
  // 灰紫色废墟颜色，区别于棋子
  const g=bCtx.createRadialGradient(x,y,0,x,y,s*1.2);
  g.addColorStop(0,'#8a8a9a');g.addColorStop(.5,'#5a5a6a');g.addColorStop(1,'#3a3a4a');
  bCtx.fillStyle=g;bCtx.fill();
  bCtx.strokeStyle='#2a2a3a';bCtx.lineWidth=.8;
  bCtx.beginPath();bCtx.moveTo(x-s*.5,y-s*.3);bCtx.lineTo(x+s*.2,y+s*.1);bCtx.lineTo(x+s*.6,y+s*.5);bCtx.stroke();
  bCtx.beginPath();bCtx.moveTo(x+s*.1,y-s*.6);bCtx.lineTo(x-s*.3,y+s*.4);bCtx.stroke();
  // 中心X标记
  bCtx.strokeStyle='rgba(180,180,200,0.5)';bCtx.lineWidth=2;
  bCtx.beginPath();bCtx.moveTo(x-s*.25,y-s*.25);bCtx.lineTo(x+s*.25,y+s*.25);bCtx.stroke();
  bCtx.beginPath();bCtx.moveTo(x+s*.25,y-s*.25);bCtx.lineTo(x-s*.25,y+s*.25);bCtx.stroke();
  // 消失倒计时环
  if(age>0){
    bCtx.globalAlpha=.4-ageRatio*.15;
    const angle=(1-ageRatio)*Math.PI*2;
    bCtx.beginPath();bCtx.arc(x,y,s*1.15,-Math.PI/2,-Math.PI/2+angle);
    bCtx.strokeStyle='rgba(120,120,140,0.6)';bCtx.lineWidth=2;bCtx.stroke();
  }
  // 消失倒计时数字：剩余5回合或更少时显示
  if(age>=5){
    const turnsLeft=10-age;
    bCtx.globalAlpha=.85;
    bCtx.fillStyle='#ff6b6b';
    bCtx.font=`bold ${cellSize*.32}px sans-serif`;
    bCtx.textAlign='center';
    bCtx.textBaseline='middle';
    bCtx.fillText(turnsLeft.toString(),x,y);
  }
  bCtx.restore();}
function drawRift(x,y,age,t){const r=cellSize*.38;const phase=t*.003+(age||0)*.5;const pulse=.6+.3*Math.sin(phase*2);bCtx.save();bCtx.globalAlpha=pulse*(1-(age||0)/4*.4);for(let i=0;i<3;i++){const a=phase+i*Math.PI*2/3;const ir=r*(.3+i*.2);bCtx.beginPath();bCtx.arc(x+Math.cos(a)*3,y+Math.sin(a)*3,ir,0,Math.PI*2);bCtx.strokeStyle=`hsla(${220+i*30},70%,65%,${.3-i*.08})`;bCtx.lineWidth=1.2-i*.3;bCtx.stroke();}const cg=bCtx.createRadialGradient(x,y,0,x,y,r*.5);cg.addColorStop(0,'rgba(80,180,255,0.25)');cg.addColorStop(1,'rgba(80,180,255,0)');bCtx.fillStyle=cg;bCtx.beginPath();bCtx.arc(x,y,r*.5,0,Math.PI*2);bCtx.fill();bCtx.strokeStyle=`rgba(80,180,255,${.12*pulse})`;bCtx.lineWidth=.8;bCtx.setLineDash([3,5]);bCtx.beginPath();bCtx.arc(x,y,r+3,0,Math.PI*2);bCtx.stroke();bCtx.setLineDash([]);bCtx.restore();}

// ═══════════════════════════════════════
//  Loop & Init
// ═══════════════════════════════════════
function loop(t){drawBg(t);if(snap&&snap.winCells&&snap.winCells.length>0)winGlow+=.07;drawBoard(t);requestAnimationFrame(loop)}
function init(){initBg();calcSize();connectWS();requestAnimationFrame(loop)}
window.addEventListener('resize',()=>{initBg();calcSize()});
document.addEventListener('touchend',e=>{if(e.target.tagName!=='INPUT'&&e.target.tagName!=='SELECT'&&e.target.tagName!=='BUTTON')e.preventDefault()},{passive:false});
init();
