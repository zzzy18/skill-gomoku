/**
 * 斗转星移（move）
 * 移动任意一颗棋子到空位；冷却 CONFIG.skills.move.cooldown 回合
 */
const CONFIG = require('../../../config/rules');
const COOLDOWN = CONFIG.skills.move.cooldown;

module.exports = {
  id: 'move',
  apply({ room, msg, player, deps }) {
    const { fr, fc, tr, tc } = msg;
    const { N, EMPTY, isImpervious, snap, postMove, advanceTurn } = deps;
    if (fr<0||fr>=N||fc<0||fc>=N||tr<0||tr>=N||tc<0||tc>=N) return { error: '无效位置' };
    if (!room.roles.includes(room.board[fr][fc])) return { error: '起始位置无棋子' };
    if (room.board[tr][tc] !== EMPTY) return { error: '目标位置必须为空' };
    if (isImpervious(room, fr, fc)) return { error: '该棋子受无懈可击保护' };

    const ss = room.skillState[player] || {};
    if (ss.move > 0) return { error: `斗转星移冷却中，还需${ss.move}回合` };

    room.board[tr][tc] = room.board[fr][fc];
    room.stoneAge[tr][tc] = room.stoneAge[fr][fc];
    room.board[fr][fc] = EMPTY;
    room.stoneAge[fr][fc] = 0;
    const swapKey = `${fr},${fc}`;
    if (room.swapMap[swapKey]) {
      room.swapMap[`${tr},${tc}`] = room.swapMap[swapKey];
      delete room.swapMap[swapKey];
    }
    ss.move = COOLDOWN;
    room.skillState[player] = ss;
    room.totalMoves++;
    postMove(room);
    advanceTurn(room);
    return { ok: true, action: 'skill', skill: 'move', player, fr, fc, tr, tc, snapshot: snap(room) };
  },
};
