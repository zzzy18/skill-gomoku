/**
 * 金钟罩（barrier）
 * 选一枚己方棋子，N 回合内免疫所有技能（局部护盾）。冷却 M 回合。
 * 立即结算，推进回合。
 */
const CONFIG = require('../../../config/rules');
const COOLDOWN = CONFIG.skills.barrier.cooldown;
const DURATION = CONFIG.skills.barrier.duration;

module.exports = {
  id: 'barrier',
  apply({ room, msg, player, deps }) {
    const { r, c } = msg;
    const { N, snap, postMove, advanceTurn } = deps;
    if (r < 0 || r >= N || c < 0 || c >= N) return { error: '无效位置' };
    if (room.board[r][c] !== player) return { error: '只能在己方棋子上施加护盾' };
    const ss = room.skillState[player] || {};
    if (ss.barrier > 0) return { error: `金钟罩冷却中，还需${ss.barrier}回合` };
    room.tempImpervious = room.tempImpervious || {};
    room.tempImpervious[`${r},${c}`] = { owner: player, turnsLeft: DURATION };
    ss.barrier = COOLDOWN;
    room.skillState[player] = ss;
    room.totalMoves++;
    postMove(room);
    advanceTurn(room);
    return { ok: true, action: 'skill', skill: 'barrier', player, r, c, duration: DURATION, snapshot: snap(room) };
  },
};
