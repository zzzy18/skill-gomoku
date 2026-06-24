/**
 * 游戏规则配置
 * 把散落在 server.js / ai-engine.js 中的"魔法数字"集中起来，
 * 便于在不改业务代码的情况下做平衡调整。
 */

module.exports = {
  // 棋盘
  board: {
    N: 15,
  },

  // 全局法则
  rules: {
    decayTurns:    12,  // 棋子存在多少回合后变废墟
    ruinDuration:  10,  // 废墟存在多少回合后消失
    rift: {
      interval: 5,      // 每多少回合生成一次裂隙
      duration: 4,      // 裂隙存在多少回合
    },
    mountainMinTurn: 50,// 力拔山兮可用的最低回合数

    // 超新星法则：引爆后在棋盘空位随机生成多少颗"余烬"己方棋子
    novaSpawnCount: 2,

    blood: {
      fiveCount: 5,     // 血战模式：累计五连次数胜利门槛
      scoreToWin: 20,   // 血战模式：累计血战分胜利门槛
      mountainScore: 3, // 血战模式下力拔山兮直接加分
    },

    // 全局法则：引力 — 落子后，被己方 3 面正交包围的裂隙坍缩为废墟
    gravity: {
      surroundThreshold: 3, // 至少几面包围才坍缩
    },
  },

  // 技能冷却 / 限制
  skills: {
    sandstorm: { cooldown: 5 },     // 飞沙走石：每 5 回合可用一次
    swapPos:   { cooldown: 4 },     // 移形换影：冷却 4 回合
    move:      { cooldown: 5 },     // 斗转星移：冷却 5 回合
    swap:      { duration: 3 },     // 偷梁换柱：维持 3 回合
    ambush:    { globalLimit: 1 },  // 暗度陈仓：全局只能用一次
    // ── 扩展技能 ──
    barrier:   { cooldown: 6, duration: 3 },  // 金钟罩：冷却 6 回合，护盾持续 3 回合
    phoenix:   { cooldown: 8 },               // 凤凰涅槃：冷却 8 回合
    meteor:    { cooldown: 10, radius: 1 },   // 陨石坠落：冷却 10 回合，半径 1（3x3）

    // 待结算技能的"擒拿响应窗口"（毫秒）
    pendingTimerMs: 1500,
  },

  // AI 决策阈值（可调战术权重，不改变规则）
  ai: {
    atkWeightClassic: 1.1,
    atkWeightBlood:   1.4,
    ambushMinTurn:    15,   // 至少在多少回合后才考虑用暗度陈仓
    ambushProbability: 0.4, // 满足条件后实际使用概率
  },

  // 网络 / 会话
  net: {
    maxPayloadBytes: 8 * 1024,   // 单条 WS 消息最大字节数
    rateLimit: { capacity: 40, refillPerSec: 20 },
    heartbeatMs:    30 * 1000,   // 心跳检测周期
    roomIdleSweepMs:  5 * 60 * 1000, // 空闲房间清扫周期
    roomIdleMaxMs:   60 * 60 * 1000, // 空闲房间存活上限
    reconnectGraceMs: 60 * 1000, // 断线后允许重连的宽限期
  },

  // 输入限制
  limits: {
    nameMaxLen: 8,
    chatMaxLen: 200,
  },
};
