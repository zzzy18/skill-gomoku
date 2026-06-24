/**
 * AI Pool：单 worker（足够支撑游戏负载），把 AI 决策放到 worker_threads 中执行，
 * 主线程立刻返回 Promise，不再阻塞 WS / HTTP 心跳。
 */
const path = require('path');
const { Worker } = require('worker_threads');

let worker = null;
let nextTaskId = 1;
const pending = new Map(); // taskId -> { resolve, reject, timer }
const DEFAULT_TIMEOUT_MS = 5000;

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'ai-worker.js'));
  worker.on('message', (m) => {
    const p = pending.get(m.taskId);
    if (!p) return;
    pending.delete(m.taskId);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || 'ai worker error'));
  });
  worker.on('error', (err) => {
    // 致命错误：拒绝所有 pending，重建 worker
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
    worker = null;
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('ai worker exited: ' + code)); }
      pending.clear();
    }
    worker = null;
  });
  return worker;
}

/**
 * 把 room 对象裁剪成 worker 可结构化克隆的 plain object
 * （Set / 函数 / WebSocket 连接等不能传过去）
 */
function serializeRoom(room) {
  return {
    // 基础
    roles: room.roles,
    mode: room.mode,
    count: room.count,
    gameMode: room.gameMode,
    // 棋盘
    board: room.board.map(row => row.slice()),
    stoneAge: room.stoneAge,
    riftAge: room.riftAge,
    ruinAge: room.ruinAge,
    currentPlayer: room.currentPlayer,
    totalMoves: room.totalMoves,
    // 全局/技能状态
    globalSettings: { ...room.globalSettings },
    equipped: { ...room.equipped },
    skillState: room.skillState ? JSON.parse(JSON.stringify(room.skillState)) : {},
    sandstormLastUsed: { ...room.sandstormLastUsed },
    ambushUsed: Array.from(room.ambushUsed || []), // 注意：AI 引擎用 .has() 检查
    bloodScores: { ...(room.bloodScores || {}) },
    scores: { ...(room.scores || {}) },
    targetScore: room.targetScore,
  };
}

// AI 引擎用 ambushUsed.has(...)；序列化后是数组，给它包一层
function inflateRoom(roomLike) {
  return {
    ...roomLike,
    ambushUsed: {
      has: (r) => roomLike.ambushUsed.includes(r),
    },
  };
}

function getAIMove(room, difficulty) {
  ensureWorker();
  return new Promise((resolve, reject) => {
    const taskId = nextTaskId++;
    const timer = setTimeout(() => {
      pending.delete(taskId);
      reject(new Error('ai worker timeout'));
    }, DEFAULT_TIMEOUT_MS);
    pending.set(taskId, { resolve, reject, timer });
    // worker 内部会用 inflate 重新包一下 ambushUsed
    worker.postMessage({
      taskId,
      type: 'getAIMove',
      roomLike: { ...serializeRoom(room), _needInflate: true },
      difficulty,
    });
  });
}

function aiAmbush(room, aiRole, humanRole) {
  ensureWorker();
  return new Promise((resolve, reject) => {
    const taskId = nextTaskId++;
    const timer = setTimeout(() => {
      pending.delete(taskId);
      reject(new Error('ai worker timeout'));
    }, DEFAULT_TIMEOUT_MS);
    pending.set(taskId, { resolve, reject, timer });
    worker.postMessage({
      taskId,
      type: 'aiAmbush',
      roomLike: { ...serializeRoom(room), _needInflate: true },
      aiRole, humanRole,
    });
  });
}

function shutdown() {
  if (!worker) return;
  worker.terminate().catch(() => {});
  worker = null;
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('ai pool shutdown')); }
  pending.clear();
}

module.exports = { getAIMove, aiAmbush, shutdown, serializeRoom, inflateRoom };
