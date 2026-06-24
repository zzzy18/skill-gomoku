/**
 * validate 模块单元测试
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMessage, createRateLimiter } = require('../validate');

test('validateMessage: 拒绝非对象', () => {
  assert.equal(validateMessage(null).ok, false);
  assert.equal(validateMessage('hi').ok, false);
  assert.equal(validateMessage([]).ok, false);
});

test('validateMessage: 拒绝未知 type', () => {
  assert.equal(validateMessage({ type: 'unknown' }).ok, false);
});

test('validateMessage: place 必须提供合法 r/c', () => {
  assert.equal(validateMessage({ type: 'place', r: 7, c: 7 }).ok, true);
  assert.equal(validateMessage({ type: 'place', r: -1, c: 0 }).ok, false);
  assert.equal(validateMessage({ type: 'place', r: 15, c: 0 }).ok, false);
  assert.equal(validateMessage({ type: 'place', r: '7', c: 7 }).ok, false);
  assert.equal(validateMessage({ type: 'place' }).ok, false);
});

test('validateMessage: useSkill 不同技能需要不同字段', () => {
  assert.equal(validateMessage({ type: 'useSkill', skill: 'sandstorm', r: 0, c: 0 }).ok, true);
  assert.equal(validateMessage({ type: 'useSkill', skill: 'sandstorm' }).ok, false);
  assert.equal(validateMessage({ type: 'useSkill', skill: 'move', fr: 0, fc: 0, tr: 1, tc: 1 }).ok, true);
  assert.equal(validateMessage({ type: 'useSkill', skill: 'move', fr: 0 }).ok, false);
  assert.equal(validateMessage({ type: 'useSkill', skill: 'swapPos', myR: 0, myC: 0, opR: 1, opC: 1 }).ok, true);
  assert.equal(validateMessage({ type: 'useSkill', skill: 'mountain' }).ok, true);
  assert.equal(validateMessage({ type: 'useSkill', skill: 'ambush' }).ok, true);
  assert.equal(validateMessage({ type: 'useSkill', skill: 'unknownSkill' }).ok, false);
});

test('validateMessage: create 校验 mode / gameMode / aiDifficulty', () => {
  assert.equal(validateMessage({ type: 'create' }).ok, true);
  assert.equal(validateMessage({ type: 'create', mode: 2, gameMode: 'classic' }).ok, true);
  assert.equal(validateMessage({ type: 'create', mode: 4 }).ok, false);
  assert.equal(validateMessage({ type: 'create', gameMode: 'wrong' }).ok, false);
  assert.equal(validateMessage({ type: 'create', aiMode: true, aiDifficulty: 'hard' }).ok, true);
  assert.equal(validateMessage({ type: 'create', aiDifficulty: 'extreme' }).ok, false);
});

test('validateMessage: chat 超长被拒', () => {
  const big = 'x'.repeat(201);
  assert.equal(validateMessage({ type: 'chat', text: big }).ok, false);
  assert.equal(validateMessage({ type: 'chat', text: 'hello' }).ok, true);
});

test('createRateLimiter: 容量耗尽后被拒，随时间补充', async () => {
  const allow = createRateLimiter(3, 10); // cap=3，每秒 10
  assert.equal(allow(), true);
  assert.equal(allow(), true);
  assert.equal(allow(), true);
  assert.equal(allow(), false, '第 4 次应被拒');
  await new Promise(r => setTimeout(r, 250)); // 0.25s -> 补 ~2.5 个
  assert.equal(allow(), true, '稍后应允许');
});
