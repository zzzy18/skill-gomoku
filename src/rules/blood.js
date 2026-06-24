/**
 * 血战模式专属规则：五连后清场 + 累计血战分胜负判定
 */
const CONFIG = require('../../config/rules');
const { N, EMPTY, RIFT } = require('../constants');
const { isImpervious } = require('./board');

const BLOOD_FIVE_COUNT    = CONFIG.rules.blood.fiveCount;
const BLOOD_SCORE_TO_WIN  = CONFIG.rules.blood.scoreToWin;

/** 五连后清空周围 1 圈 + 五连本身，累加血战分（含连击奖励） */
function bloodClear(room, winCells, player) {
  const cleared = [];
  const clearedSet = new Set();
  // 周围 1 圈
  for (const [wr, wc] of winCells) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = wr + dr, nc = wc + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (winCells.some(([r, c]) => r === nr && c === nc)) continue;
        const key = nr * N + nc;
        if (clearedSet.has(key)) continue;
        if (room.board[nr][nc] === EMPTY) continue;
        if (room.board[nr][nc] === RIFT) continue;
        if (isImpervious(room, nr, nc)) continue;
        clearedSet.add(key);
        cleared.push([nr, nc, room.board[nr][nc]]);
        room.board[nr][nc] = EMPTY;
        room.stoneAge[nr][nc] = 0;
        delete room.swapMap[`${nr},${nc}`];
        delete room.ambushHidden[`${nr},${nc}`];
      }
    }
  }
  // 五连本身
  for (const [wr, wc] of winCells) {
    room.board[wr][wc] = EMPTY;
    room.stoneAge[wr][wc] = 0;
    delete room.swapMap[`${wr},${wc}`];
    delete room.ambushHidden[`${wr},${wc}`];
  }
  const baseScore  = 1;
  const bonusScore = cleared.length * 0.5;
  const totalScore = baseScore + bonusScore;
  room.bloodScores[player] = (room.bloodScores[player] || 0) + totalScore;
  return { cleared, score: totalScore, totalBloodScore: room.bloodScores[player] };
}

/** 血战胜利判定：五连次数或血战分任一达标 */
function checkBloodWin(room, player) {
  const fiveCount  = room.scores[player] || 0;
  const bloodScore = room.bloodScores[player] || 0;
  return fiveCount >= BLOOD_FIVE_COUNT || bloodScore >= BLOOD_SCORE_TO_WIN;
}

module.exports = { bloodClear, checkBloodWin };
