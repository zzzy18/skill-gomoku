/**
 * 飞沙走石（sandstorm）
 * 移除棋盘上一枚棋子并留下废墟，冷却 N 回合（CONFIG.skills.sandstorm.cooldown）
 */
const CONFIG = require('../../../config/rules');
const COOLDOWN = CONFIG.skills.sandstorm.cooldown;
const PENDING_MS = CONFIG.skills.pendingTimerMs;

module.exports = {
  id: 'sandstorm',
  apply({ room, msg, player, deps }) {
    const { r, c } = msg;
    const { N, isImpervious, broadcastAll, resolveSandstorm } = deps;
    if (r < 0 || r >= N || c < 0 || c >= N) return { error: '无效位置' };
    if (!room.roles.includes(room.board[r][c])) return { error: '该位置无棋子' };
    if (isImpervious(room, r, c)) return { error: '该棋子受无懈可击保护' };

    const lastUsed = room.sandstormLastUsed[player] || 0;
    const movesSince = room.totalMoves - lastUsed;
    if (lastUsed > 0 && movesSince < COOLDOWN) {
      return { error: `飞沙走石冷却中，还需 ${COOLDOWN - movesSince} 回合` };
    }
    room.sandstormLastUsed[player] = room.totalMoves;
    room.pendingSkill = { type: 'sandstorm', player, r, c };
    broadcastAll(room, { type: 'skillPending', skill: 'sandstorm', player, r, c });
    room.pendingTimer = setTimeout(() => {
      if (room.pendingSkill && room.pendingSkill.type === 'sandstorm') resolveSandstorm(room);
    }, PENDING_MS);
    return { ok: true, action: 'skill', skill: 'sandstorm', pending: true, player };
  },
};
