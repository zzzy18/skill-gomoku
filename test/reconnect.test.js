/**
 * 断线重连集成测试
 * 启动一个真实的 server，开两个 ws 客户端做 2 人对局，
 * 模拟其中一方断开后用 sessionToken 在宽限期内重连，验证座位仍在。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');

// 直接 require server 不会监听端口（require.main !== module 时）
// 但 server.js 内已经创建了 http.Server / wss，可以手动 listen
const srv = require('../server');

// 因为 server 的 wss 绑定在 server 实例上，我们需要让它真正 listen
// 我们没有显式导出 http server，但 server.js 中已 createServer 并通过 wss=new ws.Server({server})
// 这里改用 nodejs require 同一份代码的副作用是已建好 wss，但未 listen
// 取巧办法：在子进程里启动 server
const { spawn } = require('child_process');
const path = require('path');

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    const onData = (buf) => {
      const s = buf.toString();
      if (s.includes('星虚对弈服务器') || s.includes(`localhost:${port}`)) {
        if (!started) { started = true; resolve(child); }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    setTimeout(() => { if (!started) { child.kill(); reject(new Error('server start timeout')); } }, 15000);
  });
}

function waitMsg(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', handler); reject(new Error('wait timeout')); }, timeoutMs);
    function handler(buf) {
      let m;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      if (predicate(m)) { clearTimeout(t); ws.off('message', handler); resolve(m); }
    }
    ws.on('message', handler);
  });
}

function openWs(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('断线重连：宽限期内带 sessionToken 重连可恢复座位', async (t) => {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = await startServer(port);
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });

  // 玩家 A：创建房间
  const a = await openWs(port);
  a.send(JSON.stringify({ type: 'create', mode: 2, gameMode: 'classic' }));
  const aJoined = await waitMsg(a, m => m.type === 'joined');
  assert.ok(aJoined.sessionToken, 'A 应收到 sessionToken');
  const roomId = aJoined.roomId;

  // 玩家 B：加入
  const b = await openWs(port);
  b.send(JSON.stringify({ type: 'join', roomId, name: 'B' }));
  const bJoined = await waitMsg(b, m => m.type === 'joined');
  assert.ok(bJoined.sessionToken, 'B 应收到 sessionToken');

  // 双方装备技能 + 开始
  a.send(JSON.stringify({ type: 'equipSkills', skills: ['sandstorm', 'intercept'] }));
  b.send(JSON.stringify({ type: 'equipSkills', skills: ['sandstorm', 'intercept'] }));
  await new Promise(r => setTimeout(r, 100));
  a.send(JSON.stringify({ type: 'startGame' }));
  await waitMsg(a, m => m.type === 'gameStart');
  await waitMsg(b, m => m.type === 'gameStart');

  // A 落一手
  a.send(JSON.stringify({ type: 'place', r: 7, c: 7 }));
  await waitMsg(b, m => m.type === 'update');

  // B 断开
  b.close();
  await new Promise(r => setTimeout(r, 100));

  // A 应收到 playerDisconnected（不是 playerLeft）
  // 但因 B 可能已经先收到自己的事件已断开，这里我们直接验证服务端态——重连试试
  const b2 = await openWs(port);
  b2.send(JSON.stringify({ type: 'reconnect', roomId, sessionToken: bJoined.sessionToken }));
  const re = await waitMsg(b2, m => m.type === 'joined' && m.reconnected === true);
  assert.equal(re.roomId, roomId);
  assert.equal(re.playerIndex, 1);
  assert.equal(re.role, bJoined.role);

  // 重连后应能正常落子
  b2.send(JSON.stringify({ type: 'place', r: 7, c: 8 }));
  const upd = await waitMsg(a, m => m.type === 'update');
  assert.ok(upd.snapshot, '断线重连后应继续可下棋');

  a.close(); b2.close();
});

test('断线重连：错误 token 被拒绝', async (t) => {
  const port = 40000 + Math.floor(Math.random() * 1000);
  const child = await startServer(port);
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });

  const a = await openWs(port);
  a.send(JSON.stringify({ type: 'create', mode: 2 }));
  const aJoined = await waitMsg(a, m => m.type === 'joined');
  a.close();

  const bad = await openWs(port);
  bad.send(JSON.stringify({ type: 'reconnect', roomId: aJoined.roomId, sessionToken: 'wrong-token' }));
  const err = await waitMsg(bad, m => m.type === 'error');
  assert.match(err.message, /会话|无效|过期/);
  bad.close();
});
