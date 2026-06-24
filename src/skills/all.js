/**
 * 八大个人技能定义表
 */
const ALL_SKILLS = [
  { id: 'sandstorm',  name: '飞沙走石', type: 'active',  desc: '移除棋盘上一枚棋子并留下废墟，每5回合可用一次' },
  { id: 'swapPos',    name: '移形换影', type: 'active',  desc: '选择己方一枚棋子与对手一枚棋子交换位置，冷却4回合' },
  { id: 'intercept',  name: '擒拿',     type: 'passive', desc: '当飞沙走石、偷梁换柱、移形换影发动时可打断其效果' },
  { id: 'mountain',   name: '力拔山兮', type: 'active',  desc: '回合≥50时直接获胜' },
  { id: 'swap',       name: '偷梁换柱', type: 'active',  desc: '将一枚棋子变为己方3回合，期间不计胜利' },
  { id: 'move',       name: '斗转星移', type: 'active',  desc: '移动任意一颗棋子到空位，冷却5回合' },
  { id: 'impervious', name: '无懈可击', type: 'passive', desc: '己方棋子无法被技能选中' },
  { id: 'ambush',     name: '暗度陈仓', type: 'active',  desc: '连下2子：第1子为假(对手可见但不计胜利)，第2子为真(对手不可见)，全局只能用一次' },
  // ── 扩展技能 ──
  { id: 'barrier',    name: '金钟罩',   type: 'active',  desc: '选一枚己方棋子，3 回合内免疫所有技能；冷却 6 回合' },
  { id: 'phoenix',    name: '凤凰涅槃', type: 'active',  desc: '将一枚己方废墟（衰变残留）复原为棋子；冷却 8 回合' },
  { id: 'meteor',     name: '陨石坠落', type: 'active',  desc: '选中心格 → 把以它为中心的 3×3 区域内全部敌方棋子变为裂隙；冷却 10 回合' },
];

module.exports = { ALL_SKILLS };
