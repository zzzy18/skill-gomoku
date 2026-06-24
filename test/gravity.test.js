/**
 * 全局法则 · 引力（gravity）测试
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { P1, P2, EMPTY, createRoom, initSkillState } = require('../server');
const { applyGravity } = require('../src/rules/board');

function makeRoom(){
  const room = createRoom('G', 2, {1:'A',2:'B',3:'C'}, 'classic');
  for(const r of room.roles) room.equipped[r] = [];
  initSkillState(room);
  // 关掉其他法则避免干扰；只开 gravity
  room.globalSettings = { devour: false, decay: false, nova: false, rift: false, gravity: true };
  return room;
}

test('gravity: 关闭 gravity 时不触发', () => {
  const room = makeRoom();
  room.globalSettings.gravity = false;
  const RIFT = 5;
  room.board[7][7] = RIFT;
  // P1 三面包围
  room.board[6][7] = P1; room.board[7][6] = P1; room.board[8][7] = P1;
  // 在 (7,8) 落子触发
  room.board[7][8] = P1;
  const collapsed = applyGravity(room, 7, 8, P1);
  assert.equal(collapsed.length, 0);
  assert.equal(room.board[7][7], RIFT);
});

test('gravity: 被己方三面包围的裂隙坍缩为废墟', () => {
  const room = makeRoom();
  const RIFT = 5, RUIN = 4;
  // 裂隙在 (7,7)
  room.board[7][7] = RIFT;
  // P1 三面包围
  room.board[6][7] = P1; room.board[7][6] = P1; room.board[8][7] = P1;
  // 在 (7,8) 落子触发引力
  room.board[7][8] = P1;
  const collapsed = applyGravity(room, 7, 8, P1);
  // (7,8) 自己也算一面，合计 4 面，应坍缩
  assert.equal(room.board[7][7], RUIN);
  assert.deepEqual(collapsed, [[7, 7]]);
});

test('gravity: 仅 2 面包围不坍缩', () => {
  const room = makeRoom();
  const RIFT = 5;
  room.board[7][7] = RIFT;
  room.board[6][7] = P1;     // 一面
  room.board[7][8] = P1;     // 触发点 — 第二面
  const collapsed = applyGravity(room, 7, 8, P1);
  assert.equal(room.board[7][7], RIFT);
  assert.equal(collapsed.length, 0);
});

test('gravity: 与 phoenix 联动 — 坍缩后的废墟可被 phoenix 复活', () => {
  const registry = require('../src/skills/registry');
  const board = require('../src/rules/board');
  const snapshot = require('../src/rules/snapshot');
  const room = makeRoom();
  room.equipped[P1] = ['phoenix'];
  initSkillState(room);

  const RIFT = 5;
  room.board[7][7] = RIFT;
  room.board[6][7] = P1; room.board[7][6] = P1; room.board[8][7] = P1; room.board[7][8] = P1;
  // 触发引力
  applyGravity(room, 7, 8, P1);
  // 此时 (7,7) 应是 RUIN
  assert.equal(room.board[7][7], 4);

  // 用 phoenix 复活
  const deps = {
    N: 15, EMPTY: 0, PENDING_TIMER_MS: 1500,
    findLines: board.findLines, isImpervious: board.isImpervious,
    postMove: board.postMove, advanceTurn: board.advanceTurn,
    snap: snapshot.snap, checkBloodWin: () => false,
    resolveSandstorm: () => {}, resolveSwap: () => {}, resolveSwapPos: () => {},
    broadcastAll: () => {},
  };
  const r = registry.dispatch('phoenix', { room, msg: { r: 7, c: 7 }, player: P1, deps });
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(room.board[7][7], P1);
});
