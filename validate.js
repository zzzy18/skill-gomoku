/**
 * 输入校验工具
 *   - 校验 WebSocket 消息中的字段是否合法
 *   - 限制字符串长度，防止超大字段
 *   - 简易令牌桶限流（每连接独立）
 */

const N = 15;

function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }
function isCell(v) { return isInt(v) && v >= 0 && v < N; }
function isStr(v, maxLen = 64) { return typeof v === 'string' && v.length <= maxLen; }
function isBool(v) { return typeof v === 'boolean'; }

const VALID_TYPES = new Set([
  'create','join','setName','toggleSetting','equipSkills','startGame',
  'place','useSkill','intercept','supernova','dismissNova',
  'restart','chat','undoRequest','undoResponse',
  'reconnect',
]);

const VALID_SKILLS = new Set([
  'sandstorm','swapPos','intercept','mountain','swap','move','impervious','ambush'
]);

const VALID_SETTING_KEYS = new Set(['devour','decay','nova','rift']);
const VALID_DIFFICULTY = new Set(['simple','medium','hard']);
const VALID_GAME_MODES = new Set(['classic','blood']);

/**
 * 校验消息合法性
 * @returns {{ok:true}|{ok:false, message:string}}
 */
function validateMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, message: '消息格式错误' };
  }
  if (!isStr(msg.type, 32) || !VALID_TYPES.has(msg.type)) {
    return { ok: false, message: '未知消息类型' };
  }

  switch (msg.type) {
    case 'create': {
      if (msg.mode !== undefined && ![2, 3].includes(msg.mode)) return { ok: false, message: 'mode 必须是 2 或 3' };
      if (msg.gameMode !== undefined && !VALID_GAME_MODES.has(msg.gameMode)) return { ok: false, message: 'gameMode 非法' };
      if (msg.aiMode !== undefined && !isBool(msg.aiMode)) return { ok: false, message: 'aiMode 必须是布尔' };
      if (msg.aiDifficulty !== undefined && !VALID_DIFFICULTY.has(msg.aiDifficulty)) return { ok: false, message: 'aiDifficulty 非法' };
      if (msg.names !== undefined && (typeof msg.names !== 'object' || Array.isArray(msg.names))) return { ok: false, message: 'names 非法' };
      return { ok: true };
    }
    case 'join': {
      if (!isStr(msg.roomId, 16)) return { ok: false, message: 'roomId 非法' };
      if (msg.name !== undefined && !isStr(msg.name, 32)) return { ok: false, message: 'name 非法' };
      return { ok: true };
    }
    case 'setName': {
      if (!isStr(msg.name, 32)) return { ok: false, message: 'name 非法' };
      return { ok: true };
    }
    case 'toggleSetting': {
      if (!isStr(msg.key, 16) || !VALID_SETTING_KEYS.has(msg.key)) return { ok: false, message: 'key 非法' };
      return { ok: true };
    }
    case 'equipSkills': {
      if (!Array.isArray(msg.skills) || msg.skills.length > 2) return { ok: false, message: 'skills 非法' };
      for (const s of msg.skills) {
        if (!isStr(s, 32) || !VALID_SKILLS.has(s)) return { ok: false, message: '技能非法' };
      }
      return { ok: true };
    }
    case 'place': {
      if (!isCell(msg.r) || !isCell(msg.c)) return { ok: false, message: '位置非法' };
      return { ok: true };
    }
    case 'useSkill': {
      if (!isStr(msg.skill, 32) || !VALID_SKILLS.has(msg.skill)) return { ok: false, message: '技能非法' };
      // 各技能字段
      switch (msg.skill) {
        case 'sandstorm':
        case 'swap':
          if (!isCell(msg.r) || !isCell(msg.c)) return { ok: false, message: '位置非法' };
          break;
        case 'swapPos':
          if (!isCell(msg.myR) || !isCell(msg.myC) || !isCell(msg.opR) || !isCell(msg.opC)) return { ok: false, message: '位置非法' };
          break;
        case 'move':
          if (!isCell(msg.fr) || !isCell(msg.fc) || !isCell(msg.tr) || !isCell(msg.tc)) return { ok: false, message: '位置非法' };
          break;
        case 'mountain':
        case 'ambush':
          break;
        default:
          return { ok: false, message: '该技能不可主动触发' };
      }
      return { ok: true };
    }
    case 'chat': {
      if (!isStr(msg.text, 200)) return { ok: false, message: 'chat 内容非法' };
      return { ok: true };
    }
    case 'undoResponse': {
      if (!isBool(msg.accepted)) return { ok: false, message: 'accepted 必须是布尔' };
      return { ok: true };
    }
    case 'reconnect': {
      if (!isStr(msg.roomId, 16)) return { ok: false, message: 'roomId 非法' };
      if (!isStr(msg.sessionToken, 128)) return { ok: false, message: 'sessionToken 非法' };
      return { ok: true };
    }
    // 不带参数的消息
    case 'startGame':
    case 'intercept':
    case 'supernova':
    case 'dismissNova':
    case 'restart':
    case 'undoRequest':
      return { ok: true };
  }
  return { ok: false, message: '未知消息类型' };
}

/**
 * 令牌桶限流：每 connection 一个实例
 *   - capacity: 桶容量
 *   - refillPerSec: 每秒补 N 个令牌
 */
function createRateLimiter(capacity = 30, refillPerSec = 15) {
  let tokens = capacity;
  let last = Date.now();
  return function allow() {
    const now = Date.now();
    const elapsed = (now - last) / 1000;
    tokens = Math.min(capacity, tokens + elapsed * refillPerSec);
    last = now;
    if (tokens >= 1) {
      tokens -= 1;
      return true;
    }
    return false;
  };
}

module.exports = { validateMessage, createRateLimiter, VALID_TYPES };
