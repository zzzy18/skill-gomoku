/**
 * 陨石坠落（meteor）
 * 选中心格，把以该格为中心、半径 RADIUS（默认 1 → 3×3）的区域内
 * 所有"敌方棋子"变为裂隙（RIFT），己方棋子与已是废墟/裂隙的不动；
 * 受 isImpervious 保护的棋子不被影响。
 * 立即结算，推进回合。
 */
const CONFIG = require('../../../config/rules');
const COOLDOWN = CONFIG.skills.meteor.cooldown;
const RADIUS = CONFIG.skills.meteor.radius;

module.exports = {
  id: 'meteor',
  apply({ room, msg, player, deps }) {
    const { r, c } = msg;
    const { N, isImpervious, snap, postMove, advanceTurn } = deps;
    const RIFT = 5, EMPTY = 0;
    if (r < 0 || r >= N || c < 0 || c >= N) return { error: '无效位置' };
    const ss = room.skillState[player] || {};
    if (ss.meteor > 0) return { error: `陨石坠落冷却中，还需${ss.meteor}回合` };

    const destroyed = [];
    for (let dr = -RADIUS; dr <= RADIUS; dr++) {
      for (let dc = -RADIUS; dc <= RADIUS; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const cell = room.board[nr][nc];
        if (!room.roles.includes(cell)) continue;   // 只打棋子
        if (cell === player) continue;              // 不伤己
        if (isImpervious(room, nr, nc)) continue;   // 受保护
        destroyed.push([nr, nc, cell]);
        room.board[nr][nc] = RIFT;
        room.riftAge[nr][nc] = 0;
        room.stoneAge[nr][nc] = 0;
        delete room.swapMap[`${nr},${nc}`];
        delete room.ambushHidden[`${nr},${nc}`];
      }
    }
    if (destroyed.length === 0) {
      return { error: '该 3×3 区域内没有可摧毁的敌方棋子' };
    }
    ss.meteor = COOLDOWN;
    room.skillState[player] = ss;
    room.totalMoves++;
    postMove(room);
    advanceTurn(room);
    return { ok: true, action: 'skill', skill: 'meteor', player, r, c, destroyed, snapshot: snap(room) };
  },
};
