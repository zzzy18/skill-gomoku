/**
 * 棋盘维护：胜利检测、吞噬、衰变、裂隙、废墟、swap 计时、turn 推进、无懈可击判定
 * 所有函数都是纯函数（仅依赖 room / board，无外部副作用，不依赖网络）
 */
const CONFIG = require('../../config/rules');
const { N, EMPTY, RUIN, RIFT } = require('../constants');

const DECAY_TURNS    = CONFIG.rules.decayTurns;
const RIFT_INTERVAL  = CONFIG.rules.rift.interval;
const RIFT_DURATION  = CONFIG.rules.rift.duration;
const RUIN_DURATION  = CONFIG.rules.ruinDuration;

/**
 * 在 (r,c) 处沿四个方向查找指定长度的连子组合（用于 4 连/5 连判定）
 * @param excludePos 可选 [r,c]：被视为 EMPTY 的位置（暗度陈仓假棋子使用）
 */
function findLines(board, r, c, player, length, excludePos = null) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  const results = [];
  for (const [dr,dc] of dirs) {
    let cells = [[r,c]];
    const isExcluded = (nr, nc) => excludePos && excludePos[0] === nr && excludePos[1] === nc;

    for (let i=1; i<length; i++) {
      const nr = r+dr*i, nc = c+dc*i;
      if (nr<0||nr>=N||nc<0||nc>=N) break;
      if (isExcluded(nr,nc)) break;
      if (board[nr][nc] !== player) break;
      cells.push([nr,nc]);
    }
    for (let i=1; i<length; i++) {
      const nr = r-dr*i, nc = c-dc*i;
      if (nr<0||nr>=N||nc<0||nc>=N) break;
      if (isExcluded(nr,nc)) break;
      if (board[nr][nc] !== player) break;
      cells.unshift([nr,nc]);
    }
    if (cells.length >= length) results.push(cells.slice(0, length));
  }
  return results;
}

/** 吞噬法则：被 ≥3 面包围的敌子被转化（最多 3 轮链式） */
function applyDevour(room, r, c, player) {
  const enemies = room.roles.filter(p => p !== player);
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
  const allDevoured = [];
  for (let chain = 0; chain < 3; chain++) {
    const toDevour = [];
    const sources = chain === 0 ? [[r,c]] : allDevoured.slice(-5);
    const checked = new Set();
    for (const [sr,sc] of sources) {
      for (const [dr,dc] of dirs) {
        const nr = sr+dr, nc = sc+dc;
        if (nr<0||nr>=N||nc<0||nc>=N) continue;
        const cell = room.board[nr][nc];
        if (!enemies.includes(cell)) continue;
        const key = nr*N+nc;
        if (checked.has(key)) continue;
        checked.add(key);
        let surr = 0;
        for (const [dr2,dc2] of dirs) {
          const ar = nr+dr2, ac = nc+dc2;
          if (ar<0||ar>=N||ac<0||ac>=N) continue;
          if (room.board[ar][ac] === player) surr++;
        }
        if (surr >= 3) toDevour.push([nr,nc,cell]);
      }
    }
    if (toDevour.length === 0) break;
    for (const [dr,dc] of toDevour) {
      room.board[dr][dc] = player;
      room.stoneAge[dr][dc] = 0;
      allDevoured.push([dr,dc]);
    }
  }
  return allDevoured;
}

/** 衰变：棋子超过 decayTurns 回合变废墟 */
function applyDecay(room) {
  let d = 0;
  for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
    if (room.roles.includes(room.board[r][c])) {
      room.stoneAge[r][c]++;
      if (room.stoneAge[r][c] >= DECAY_TURNS) {
        room.board[r][c] = RUIN;
        room.stoneAge[r][c] = 0;
        room.ruinAge[r][c] = 0;
        d++;
      }
    }
  }
  return d;
}

/** 裂隙生成：随机 1~2 个 */
function spawnRifts(room) {
  const count = Math.random() > 0.5 ? 2 : 1;
  const empty = [];
  for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
    if (room.board[r][c] === EMPTY) empty.push([r,c]);
  }
  for (let i=empty.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [empty[i], empty[j]] = [empty[j], empty[i]];
  }
  let s = 0;
  for (let i=0; i<Math.min(count, empty.length); i++) {
    const [r,c] = empty[i];
    room.board[r][c] = RIFT;
    room.riftAge[r][c] = 0;
    s++;
  }
  return s;
}

/** 裂隙老化 */
function ageRifts(room) {
  for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
    if (room.board[r][c] === RIFT) {
      room.riftAge[r][c]++;
      if (room.riftAge[r][c] >= RIFT_DURATION) {
        room.board[r][c] = EMPTY;
        room.riftAge[r][c] = 0;
      }
    }
  }
}

/** 废墟老化 */
function ageRuins(room) {
  for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
    if (room.board[r][c] === RUIN) {
      room.ruinAge[r][c]++;
      if (room.ruinAge[r][c] >= RUIN_DURATION) {
        room.board[r][c] = EMPTY;
        room.ruinAge[r][c] = 0;
      }
    }
  }
}

/** 偷梁换柱的回合计时：到期回退 */
function processSwaps(room) {
  const toRevert = [];
  for (const key of Object.keys(room.swapMap)) {
    const s = room.swapMap[key];
    s.turnsLeft--;
    if (s.turnsLeft <= 0) {
      const [r,c] = key.split(',').map(Number);
      room.board[r][c] = s.owner;
      room.stoneAge[r][c] = 0;
      toRevert.push(key);
    }
  }
  for (const k of toRevert) delete room.swapMap[k];
  return toRevert.length;
}

/** 每手棋完成后的统一收尾：法则结算 + 冷却递减 + 终局检测 */
function postMove(room) {
  if (room.globalSettings.decay) applyDecay(room);
  if (room.globalSettings.rift && room.totalMoves > 0 && room.totalMoves % RIFT_INTERVAL === 0) {
    spawnRifts(room);
  }
  ageRifts(room);
  ageRuins(room);
  processSwaps(room);
  // 主动技能冷却递减
  for (const role of room.roles) {
    const ss = room.skillState[role];
    if (ss) {
      for (const sid of Object.keys(ss)) {
        if (sid === 'move' && ss[sid] > 0) ss[sid]--;
        if (sid === 'swapPos' && ss[sid] > 0) ss[sid]--;
      }
    }
  }
  // 棋盘填满 → 终局
  let empties = 0;
  for (let i=0; i<N; i++) for (let j=0; j<N; j++) {
    if (room.board[i][j] === EMPTY) empties++;
  }
  if (empties === 0) room.gameOver = true;
}

/** 推进到下一个未被 skipNext 跳过的玩家 */
function advanceTurn(room) {
  let idx = room.roles.indexOf(room.currentPlayer);
  for (let i = 0; i < room.count; i++) {
    idx = (idx + 1) % room.count;
    const next = room.roles[idx];
    if (room.skipNext.has(next)) { room.skipNext.delete(next); continue; }
    room.currentPlayer = next;
    return;
  }
  room.currentPlayer = room.roles[0];
}

/** 无懈可击保护判定 */
function isImpervious(room, r, c) {
  const owner = room.board[r][c];
  if (!room.roles.includes(owner)) return false;
  const equipped = room.equipped[owner] || [];
  return equipped.includes('impervious');
}

module.exports = {
  findLines, applyDevour,
  applyDecay, spawnRifts, ageRifts, ageRuins, processSwaps,
  postMove, advanceTurn, isImpervious,
};
