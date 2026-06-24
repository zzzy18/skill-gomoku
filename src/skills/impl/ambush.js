/**
 * 暗度陈仓（ambush）
 * 连下 2 子：第 1 子为假（对手可见但不计胜利），第 2 子为真（对手不可见）。
 * 全局只能用一次（CONFIG.skills.ambush.globalLimit）
 *
 * 后续的"落子"流程由 server.js 的 handlePlace / handleAmbushFake 接管。
 */
module.exports = {
  id: 'ambush',
  apply({ room, player, deps }) {
    const { snap } = deps;
    if (room.ambushUsed.has(player)) {
      return { error: '暗度陈仓全局只能使用一次，你已经用过了' };
    }
    room.ambushUsed.add(player);
    room.ambushState = { player, phase: 'fake', fakePos: null, realPos: null };
    console.log(`[暗度陈仓] 玩家${player} 启动技能，phase=fake`);
    return { ok: true, action: 'skill', skill: 'ambush', phase: 'fake', player, snapshot: snap(room) };
  },
};
