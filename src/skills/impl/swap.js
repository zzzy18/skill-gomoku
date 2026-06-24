/**
 * 偷梁换柱（swap）
 * 将一枚敌方棋子变为己方 N 回合（CONFIG.skills.swap.duration），期间不计胜利
 */
const CONFIG = require('../../../config/rules');
const DURATION = CONFIG.skills.swap.duration;
const PENDING_MS = CONFIG.skills.pendingTimerMs;

module.exports = {
  id: 'swap',
  apply({ room, msg, player, deps }) {
    const { r, c } = msg;
    const { N, isImpervious, broadcastAll, resolveSwap } = deps;
    if (r < 0 || r >= N || c < 0 || c >= N) return { error: '无效位置' };
    const target = room.board[r][c];
    if (!room.roles.includes(target) || target === player) return { error: '只能对敌方棋子使用' };
    if (isImpervious(room, r, c)) return { error: '该棋子受无懈可击保护' };

    room.swapMap[`${r},${c}`] = { owner: target, turnsLeft: DURATION };
    room.board[r][c] = player;
    room.stoneAge[r][c] = 0;
    room.pendingSkill = { type: 'swap', player, r, c, from: target };
    broadcastAll(room, { type: 'skillPending', skill: 'swap', player, r, c });
    room.pendingTimer = setTimeout(() => {
      if (room.pendingSkill && room.pendingSkill.type === 'swap') resolveSwap(room);
    }, PENDING_MS);
    return { ok: true, action: 'skill', skill: 'swap', pending: true, player, r, c, from: target, to: player };
  },
};
