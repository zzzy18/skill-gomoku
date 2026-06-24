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
];

module.exports = { ALL_SKILLS };
