/**
 * 房间状态快照
 * snap：通用快照
 * personalSnap：根据玩家视角，隐藏暗度陈仓真棋子
 */
const CONFIG = require('../../config/rules');
const { N, EMPTY } = require('../constants');

const BLOOD_FIVE_COUNT   = CONFIG.rules.blood.fiveCount;
const BLOOD_SCORE_TO_WIN = CONFIG.rules.blood.scoreToWin;

function snap(room) {
  const board = room.board.map(row => [...row]);
  const ambush = room.ambushState;

  // 从 ambushHidden 中找出假棋子位置（key 形如 fake_r_c）
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
    ruinAge: room.ruinAge,
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
      c: room.pendingSkill.c,
      myR: room.pendingSkill.myR,
      myC: room.pendingSkill.myC,
      opR: room.pendingSkill.opR,
      opC: room.pendingSkill.opC,
    } : null,
    equipped: room.equipped,
    skillState: room.skillState,
    sandstormLastUsed: room.sandstormLastUsed,
    gameMode: room.gameMode,
    bloodWinCondition: { fiveCount: BLOOD_FIVE_COUNT, bloodScore: BLOOD_SCORE_TO_WIN },
    targetScore: room.targetScore,
    bloodScores: room.bloodScores,
    ambushPhase: ambush ? ambush.phase : null,
    ambushPlayer: ambush ? ambush.player : null,
    ambushFakePos: ambush ? ambush.fakePos : null,
    ambushRealPos: ambush ? ambush.realPos : null,
    ambushHidden: room.ambushHidden,
    ambushFakePositions: fakePositions,
    swapMap: room.swapMap,
  };
}

/** 玩家个性化快照：把对手的暗度陈仓真棋子隐藏成 EMPTY */
function personalSnap(room, role) {
  const s = snap(room);
  for (const key of Object.keys(room.ambushHidden)) {
    if (key.startsWith('fake_')) continue;
    const hiddenOwner = room.ambushHidden[key];
    if (hiddenOwner !== role) {
      const [hr, hc] = key.split(',').map(Number);
      if (hr >= 0 && hr < N && hc >= 0 && hc < N) {
        s.board[hr][hc] = EMPTY;
      }
    }
  }
  // 进行中的真棋子也隐藏
  if (room.ambushState && room.ambushState.phase === 'real' && room.ambushState.player !== role) {
    if (room.ambushState.realPos) {
      const [rr, rc] = room.ambushState.realPos;
      s.board[rr][rc] = EMPTY;
    }
  }
  return s;
}

module.exports = { snap, personalSnap };
