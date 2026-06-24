/**
 * 扩展技能（barrier / phoenix / meteor）单元测试
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  P1, P2, EMPTY,
  createRoom, initSkillState,
  postMove, isImpervious,
} = require('../server');
const registry = require('../src/skills/registry');
const board = require('../src/rules/board');
const snapshot = require('../src/rules/snapshot');

function deps() {
  return {
    N: 15, EMPTY: 0,
    PENDING_TIMER_MS: 1500,
    findLines: board.findLines,
    isImpervious: board.isImpervious,
    postMove: board.postMove,
    advanceTurn: board.advanceTurn,
    snap: snapshot.snap,
    checkBloodWin: () => false,
    resolveSandstorm: () => {},
    resolveSwap: () => {},
    resolveSwapPos: () => {},
    broadcastAll: () => {},
  };
}

function makeRoom(opts = {}) {
  const room = createRoom('T', opts.mode || 2, { 1: 'A', 2: 'B', 3: 'C' }, opts.gameMode || 'classic');
  for (const r of room.roles) room.equipped[r] = opts.equipped?.[r] || [];
  initSkillState(room);
  // 关掉法则以避免随机干扰
  room.globalSettings = { devour: false, decay: false, nova: false, rift: false };
  return room;
}

// ── barrier ──
test('barrier: 给己方棋子加 3 回合护盾，期间 isImpervious=true', () => {
  const room = makeRoom({ equipped: { [P1]: ['barrier'] } });
  initSkillState(room);
  room.board[7][7] = P1;
  const r = registry.dispatch('barrier', { room, msg: { r: 7, c: 7 }, player: P1, deps: deps() });
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(isImpervious(room, 7, 7), true);
  // 3 回合后应失效
  postMove(room); postMove(room); postMove(room);
  assert.equal(isImpervious(room, 7, 7), false);
});

test('barrier: 不能加到对手棋子上', () => {
  const room = makeRoom({ equipped: { [P1]: ['barrier'] } });
  initSkillState(room);
  room.board[7][7] = P2;
  const r = registry.dispatch('barrier', { room, msg: { r: 7, c: 7 }, player: P1, deps: deps() });
  assert.ok(r.error);
});

test('barrier: 冷却期内无法重复使用', () => {
  const room = makeRoom({ equipped: { [P1]: ['barrier'] } });
  initSkillState(room);
  room.board[7][7] = P1; room.board[7][8] = P1;
  const r1 = registry.dispatch('barrier', { room, msg: { r: 7, c: 7 }, player: P1, deps: deps() });
  assert.ok(!r1.error);
  const r2 = registry.dispatch('barrier', { room, msg: { r: 7, c: 8 }, player: P1, deps: deps() });
  assert.ok(r2.error);
  assert.match(r2.error, /冷却/);
});

// ── phoenix ──
test('phoenix: 把己方废墟复活为棋子', () => {
  const room = makeRoom({ equipped: { [P1]: ['phoenix'] } });
  initSkillState(room);
  const RUIN = 4;
  room.board[7][7] = RUIN;
  const r = registry.dispatch('phoenix', { room, msg: { r: 7, c: 7 }, player: P1, deps: deps() });
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(room.board[7][7], P1);
});

test('phoenix: 非废墟位置不可用', () => {
  const room = makeRoom({ equipped: { [P1]: ['phoenix'] } });
  initSkillState(room);
  room.board[7][7] = P2; // 敌子
  const r = registry.dispatch('phoenix', { room, msg: { r: 7, c: 7 }, player: P1, deps: deps() });
  assert.ok(r.error);
});

// ── meteor ──
test('meteor: 3x3 区域内的敌子被变为裂隙；己子不动', () => {
  const room = makeRoom({ equipped: { [P1]: ['meteor'] } });
  initSkillState(room);
  // 中心 (7,7) 周围：5 个敌子 + 2 个己子 + 1 个空
  room.board[6][6] = P2; room.board[6][7] = P2; room.board[6][8] = P2;
  room.board[7][6] = P1;
  room.board[7][7] = P2; // 中心也是敌子
  room.board[7][8] = P1;
  room.board[8][6] = P2; room.board[8][7] = EMPTY; room.board[8][8] = P2;
  const r = registry.dispatch('meteor', { room, msg: { r: 7, c: 7 }, player: P1, deps: deps() });
  assert.ok(!r.error, JSON.stringify(r));
  // P1 自己棋子保留
  assert.equal(room.board[7][6], P1);
  assert.equal(room.board[7][8], P1);
  // 敌子全部变 RIFT(5)
  const RIFT = 5;
  for (const [r2, c2] of [[6,6],[6,7],[6,8],[7,7],[8,6],[8,8]]) {
    assert.equal(room.board[r2][c2], RIFT, `(${r2},${c2}) 应变为裂隙`);
  }
});

test('meteor: 受 barrier 保护的敌方棋子免疫', () => {
  const room = makeRoom({ equipped: { [P1]: ['meteor'], [P2]: ['barrier'] } });
  initSkillState(room);
  room.board[7][7] = P2;
  // 给 P2 的 (7,7) 加临时护盾
  room.tempImpervious = { '7,7': { owner: P2, turnsLeft: 3 } };
  const r = registry.dispatch('meteor', { room, msg: { r: 7, c: 7 }, player: P1, deps: deps() });
  // 只有这一个目标且受保护 → 应报"无可摧毁"
  assert.ok(r.error);
});
