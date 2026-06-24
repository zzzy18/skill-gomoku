/**
 * ai-pool worker 测试：验证 worker 能正常返回 AI 决策
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../ai-pool');

function makeEmptyRoom() {
  const N = 15;
  return {
    roles: [1, 2],
    mode: 2,
    count: 2,
    gameMode: 'classic',
    board: Array.from({ length: N }, () => Array(N).fill(0)),
    stoneAge: Array.from({ length: N }, () => Array(N).fill(0)),
    riftAge: Array.from({ length: N }, () => Array(N).fill(0)),
    ruinAge: Array.from({ length: N }, () => Array(N).fill(0)),
    currentPlayer: 2,
    totalMoves: 0,
    globalSettings: { devour: true, decay: true, nova: true, rift: true },
    equipped: { 1: [], 2: [] },
    skillState: { 1: {}, 2: {} },
    sandstormLastUsed: {},
    ambushUsed: new Set(),
    scores: { 1: 0, 2: 0 },
    bloodScores: { 1: 0, 2: 0 },
    targetScore: 0,
  };
}

test('ai-pool.getAIMove 在空盘上能返回合法落子（simple）', async () => {
  const N = 15;
  const room = makeEmptyRoom();
  const decision = await pool.getAIMove(room, 'simple');
  assert.ok(decision);
  assert.equal(decision.action, 'place');
  assert.ok(Number.isInteger(decision.r) && decision.r >= 0 && decision.r < N);
  assert.ok(Number.isInteger(decision.c) && decision.c >= 0 && decision.c < N);
});

test('ai-pool.getAIMove medium 难度也能返回 place', async () => {
  const room = makeEmptyRoom();
  // 制造一个简单局面：人类下了 1 子
  room.board[7][7] = 1;
  room.totalMoves = 1;
  const decision = await pool.getAIMove(room, 'medium');
  assert.equal(decision.action, 'place');
});

test('ai-pool 并发调用都能正确返回（worker 串行处理多个 task）', async () => {
  const room = makeEmptyRoom();
  const results = await Promise.all([
    pool.getAIMove(room, 'simple'),
    pool.getAIMove(room, 'simple'),
    pool.getAIMove(room, 'simple'),
  ]);
  for (const d of results) assert.equal(d.action, 'place');
});

test.after(() => pool.shutdown());
