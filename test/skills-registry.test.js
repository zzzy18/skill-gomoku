/**
 * 技能注册表（插件化架构）测试
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../src/skills/registry');

test('registry: 所有内置技能均已注册', () => {
  const expected = [
    'sandstorm','swapPos','intercept','mountain','swap','move','impervious','ambush',
    'barrier','phoenix','meteor',
  ];
  for (const id of expected) {
    assert.ok(registry.get(id), `技能 ${id} 应被注册`);
  }
  assert.ok(registry.list().length >= expected.length);
});

test('registry: 未知技能 dispatch 返回 error', () => {
  const r = registry.dispatch('unknown-id', {});
  assert.ok(r.error);
});

test('registry: 被动技能（intercept/impervious）主动 dispatch 返回 error', () => {
  assert.ok(registry.dispatch('intercept', {}).error);
  assert.ok(registry.dispatch('impervious', {}).error);
});

test('registry: 可注册并分派自定义技能', () => {
  const my = {
    id: 'test-skill',
    apply({ msg }) { return { ok: true, action: 'skill', skill: 'test-skill', echo: msg && msg.n }; },
  };
  registry.register(my);
  const r = registry.dispatch('test-skill', { msg: { n: 42 } });
  assert.equal(r.ok, true);
  assert.equal(r.echo, 42);
});
