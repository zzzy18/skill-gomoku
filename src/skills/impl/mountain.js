/**
 * 力拔山兮（mountain）
 * 回合 ≥ 阈值时直接获胜；血战模式下改为 +N 血战分
 */
const CONFIG = require('../../../config/rules');
const MIN_TURN = CONFIG.rules.mountainMinTurn;
const BLOOD_BONUS = CONFIG.rules.blood.mountainScore;

module.exports = {
  id: 'mountain',
  apply({ room, player, deps }) {
    const { snap, postMove, advanceTurn, checkBloodWin } = deps;
    if (room.totalMoves <= MIN_TURN) return { error: `回合数不足${MIN_TURN}` };
    if (room.gameMode === 'blood') {
      room.bloodScores[player] = (room.bloodScores[player] || 0) + BLOOD_BONUS;
      room.scores[player] = (room.scores[player] || 0) + 1;
      const reachedTarget = checkBloodWin(room, player);
      if (reachedTarget) room.gameOver = true;
      room.totalMoves++;
      postMove(room);
      if (!room.gameOver) advanceTurn(room);
      return { ok: true, action: 'skill', skill: 'mountain', player, bloodMode: true,
               bloodScore: room.bloodScores[player], gameOver: room.gameOver, snapshot: snap(room) };
    }
    room.gameOver = true;
    room.winCells = [];
    room.scores[player] = (room.scores[player] || 0) + 1;
    return { ok: true, action: 'skill', skill: 'mountain', winner: player, snapshot: snap(room) };
  },
};
