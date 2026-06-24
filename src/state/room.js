/**
 * 房间状态：构造 / 重置 / 技能状态初始化
 */
const CONFIG = require('../../config/rules');
const { N, EMPTY, P1, P2, P3 } = require('../constants');

function createRoom(id, mode, names, gameMode) {
  const count = mode === 3 ? 3 : 2;
  const players = new Array(count).fill(null);
  const roles = count === 3 ? [P1, P2, P3] : [P1, P2];
  const isBlood = gameMode === 'blood';
  return {
    id, mode, count, players, roles, names,
    gameMode: gameMode || 'classic',
    targetScore: isBlood ? CONFIG.rules.blood.fiveCount : 0,
    bloodScores: {},
    board:    Array.from({ length: N }, () => Array(N).fill(EMPTY)),
    stoneAge: Array.from({ length: N }, () => Array(N).fill(0)),
    riftAge:  Array.from({ length: N }, () => Array(N).fill(0)),
    ruinAge:  Array.from({ length: N }, () => Array(N).fill(0)),
    swapMap: {},            // "r,c" -> { owner, turnsLeft }
    ambushHidden: {},       // "r,c" -> 真棋子归属 / "fake_r_c" -> 假棋子归属
    tempImpervious: {},     // "r,c" -> { owner, turnsLeft }  局部护盾（金钟罩）
    currentPlayer: P1,
    totalMoves: 0,
    history: [],
    gameOver: false,
    winCells: [],
    novaLine: null,
    scores: {},
    ready: new Array(count).fill(false),
    gameStarted: false,
    globalSettings: { devour: true, decay: true, nova: true, rift: true, gravity: false },
    equipped: {},           // role -> [skillId, skillId]
    skillState: {},         // role -> { [skillId]: cooldown }
    skipNext: new Set(),
    pendingSkill: null,
    pendingTimer: null,
    ambushState: null,      // { player, phase: 'fake' | 'real' }
    ambushUsed: new Set(),  // 全局只能用一次
    sandstormLastUsed: {},  // role -> lastUsedMove
    undoRequest: null,
    // 断线重连支持
    playerTokens: new Array(count).fill(null),
    pendingDisconnect: new Array(count).fill(null),
    lastActivity: Date.now(),
  };
}

function initSkillState(room) {
  for (const role of room.roles) {
    room.skillState[role] = {};
    const equipped = room.equipped[role] || [];
    for (const sid of equipped) {
      // move / swapPos 有冷却计数；其他技能保留字段方便统一处理
      room.skillState[role][sid] = 0;
    }
  }
}

function resetRoom(room) {
  room.board    = Array.from({ length: N }, () => Array(N).fill(EMPTY));
  room.stoneAge = Array.from({ length: N }, () => Array(N).fill(0));
  room.riftAge  = Array.from({ length: N }, () => Array(N).fill(0));
  room.ruinAge  = Array.from({ length: N }, () => Array(N).fill(0));
  room.swapMap = {};
  room.ambushHidden = {};
  room.tempImpervious = {};
  room.currentPlayer = P1;
  room.totalMoves = 0;
  room.history = [];
  room.gameOver = false;
  room.winCells = [];
  room.novaLine = null;
  room.ready = new Array(room.count).fill(false);
  room.skipNext = new Set();
  room.pendingSkill = null;
  room.ambushState = null;
  room.ambushUsed = new Set();
  room.sandstormLastUsed = {};
  room.bloodScores = {};
  room.undoRequest = null;
  if (room.pendingTimer) { clearTimeout(room.pendingTimer); room.pendingTimer = null; }
  initSkillState(room);
}

module.exports = { createRoom, initSkillState, resetRoom };
