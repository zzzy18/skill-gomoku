/**
 * 凤凰涅槃（phoenix）
 * 将一枚棋盘上的废墟（RUIN）变回自己的棋子。冷却 M 回合。
 * 立即结算，推进回合。
 */
const CONFIG = require('../../../config/rules');
const COOLDOWN = CONFIG.skills.phoenix.cooldown;

module.exports = {
  id: 'phoenix',
  apply({ room, msg, player, deps }) {
    const { r, c } = msg;
    const { N, snap, postMove, advanceTurn } = deps;
    const RUIN = 4;
    if (r < 0 || r >= N || c < 0 || c >= N) return { error: '无效位置' };
    if (room.board[r][c] !== RUIN) return { error: '只能复活废墟' };
    const ss = room.skillState[player] || {};
    if (ss.phoenix > 0) return { error: `凤凰涅槃冷却中，还需${ss.phoenix}回合` };

    room.board[r][c] = player;
    room.stoneAge[r][c] = 0;
    room.ruinAge[r][c] = 0;
    ss.phoenix = COOLDOWN;
    room.skillState[player] = ss;
    room.totalMoves++;
    postMove(room);
    advanceTurn(room);
    return { ok: true, action: 'skill', skill: 'phoenix', player, r, c, snapshot: snap(room) };
  },
};
