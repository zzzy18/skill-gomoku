/**
 * AI Worker：在独立线程运行 AI 决策，避免阻塞 Node 主事件循环（WS / HTTP 心跳）。
 *
 * 协议（主线程 ↔ worker）：
 *   主 → worker: { taskId, type: 'getAIMove'|'aiAmbush', roomLike, difficulty?, aiRole?, humanRole? }
 *   worker → 主: { taskId, ok, result?, error? }
 *
 * roomLike 必须是 AI 引擎可直接读的字段子集（见 ai-pool.js#serializeRoom）。
 */
const { parentPort } = require('worker_threads');
const { getAIMove, aiAmbush } = require('./ai-engine');
const { inflateRoom } = require('./ai-pool');

if (!parentPort) {
  throw new Error('ai-worker.js 必须作为 worker 加载');
}

parentPort.on('message', (msg) => {
  const { taskId, type } = msg;
  try {
    let result;
    const roomLike = msg.roomLike && msg.roomLike._needInflate ? inflateRoom(msg.roomLike) : msg.roomLike;
    if (type === 'getAIMove') {
      result = getAIMove(roomLike, msg.difficulty);
    } else if (type === 'aiAmbush') {
      result = aiAmbush(roomLike, msg.aiRole, msg.humanRole);
    } else {
      throw new Error('unknown ai task type: ' + type);
    }
    parentPort.postMessage({ taskId, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ taskId, ok: false, error: String(err && err.message || err) });
  }
});
