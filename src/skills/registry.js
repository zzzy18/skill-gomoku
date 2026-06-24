/**
 * 技能注册表 + 分派器
 *
 * 每个技能模块需要导出：
 * {
 *   id: string,                    // 技能唯一 ID（与 ALL_SKILLS 一致）
 *   apply(ctx) -> { error? } | { ok, action, skill, pending?, ... }
 * }
 *
 * ctx 字段：
 *   room              当前房间
 *   msg               原始消息（含 r/c/myR/...）
 *   player            发动者 role
 *   deps              注入的依赖：{ broadcastAll, snap, postMove, advanceTurn,
 *                                 findLines, isImpervious, checkBloodWin, EMPTY, N,
 *                                 PENDING_TIMER_MS, resolveSandstorm, resolveSwap, resolveSwapPos }
 */
const skills = new Map();

function register(skill) {
  if (!skill || !skill.id || typeof skill.apply !== 'function') {
    throw new Error('invalid skill module: ' + skill && skill.id);
  }
  skills.set(skill.id, skill);
}

function get(id) {
  return skills.get(id);
}

function list() {
  return Array.from(skills.values());
}

function dispatch(id, ctx) {
  const sk = skills.get(id);
  if (!sk) return { error: '未知技能' };
  return sk.apply(ctx);
}

// 自动加载所有内置技能
register(require('./impl/sandstorm'));
register(require('./impl/swapPos'));
register(require('./impl/mountain'));
register(require('./impl/swap'));
register(require('./impl/move'));
register(require('./impl/ambush'));
// ── 扩展技能 ──
register(require('./impl/barrier'));
register(require('./impl/phoenix'));
register(require('./impl/meteor'));
// intercept / impervious 是被动技能，不通过 dispatch 触发；
// 但注册一个空壳便于"装备/未装备"统一查询
register({ id: 'intercept',  apply: () => ({ error: '擒拿为被动技能，无需主动触发' }) });
register({ id: 'impervious', apply: () => ({ error: '无懈可击为被动技能，无需主动触发' }) });

module.exports = { register, get, list, dispatch };
