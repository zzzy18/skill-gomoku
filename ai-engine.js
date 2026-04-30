/**
 * AI 决策引擎 — 星虚对弈人机对战
 * 导出 getAIMove(room, difficulty) 作为主入口
 */

const N = 15;
const EMPTY = 0, P1 = 1, P2 = 2, P3 = 3, RUIN = 4, RIFT = 5;

// ── 棋型评分 ──
const SCORE = {
  FIVE: 1000000,
  LIVE4: 100000,
  RUSH4: 10000,
  LIVE3: 10000,
  SLEEP3: 1000,
  LIVE2: 1000,
  SLEEP2: 100,
  LIVE1: 100,
  SLEEP1: 10,
};

// 4个方向：横、竖、正斜、反斜
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];

// ── 工具函数 ──
function inBound(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }

function getEmptyNeighbors(board, r, c, dist = 1) {
  const result = [];
  for (let dr = -dist; dr <= dist; dr++) {
    for (let dc = -dist; dc <= dist; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (inBound(nr, nc) && board[nr][nc] === EMPTY) result.push([nr, nc]);
    }
  }
  return result;
}

function getAllEmpty(board) {
  const result = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (board[r][c] === EMPTY) result.push([r, c]);
  return result;
}

function getOccupied(board, roles) {
  const result = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (roles.includes(board[r][c])) result.push([r, c]);
  return result;
}

// ── 棋型分析 ──
// 分析某方向上的连子情况
function analyzeDirection(board, r, c, dr, dc, player) {
  let count = 1;
  let block = 0; // 被封堵端数 (0=活, 1=半封, 2=死)

  // 正方向
  let nr = r + dr, nc = c + dc;
  while (inBound(nr, nc) && board[nr][nc] === player) {
    count++;
    nr += dr;
    nc += dc;
  }
  if (!inBound(nr, nc) || (board[nr][nc] !== EMPTY && board[nr][nc] !== player)) {
    block++;
  }

  // 反方向
  nr = r - dr;
  nc = c - dc;
  while (inBound(nr, nc) && board[nr][nc] === player) {
    count++;
    nr -= dr;
    nc -= dc;
  }
  if (!inBound(nr, nc) || (board[nr][nc] !== EMPTY && board[nr][nc] !== player)) {
    block++;
  }

  return { count, block };
}

// 单格评分（考虑4个方向的棋型）
function scorePosition(board, r, c, player) {
  let total = 0;
  for (const [dr, dc] of DIRS) {
    const { count, block } = analyzeDirection(board, r, c, dr, dc, player);
    total += patternScore(count, block);
  }
  return total;
}

function patternScore(count, block) {
  if (count >= 5) return SCORE.FIVE;
  if (block >= 2) return 0; // 两端全死
  switch (count) {
    case 4: return block === 0 ? SCORE.LIVE4 : SCORE.RUSH4;
    case 3: return block === 0 ? SCORE.LIVE3 : SCORE.SLEEP3;
    case 2: return block === 0 ? SCORE.LIVE2 : SCORE.SLEEP2;
    case 1: return block === 0 ? SCORE.LIVE1 : SCORE.SLEEP1;
    default: return 0;
  }
}

// ── 评估函数 ──
// 评估某个位置放下棋子后的威胁
function evaluateMove(board, r, c, player) {
  // 临时放置
  board[r][c] = player;
  let score = 0;
  for (const [dr, dc] of DIRS) {
    const { count, block } = analyzeDirection(board, r, c, dr, dc, player);
    score += patternScore(count, block);
  }
  board[r][c] = EMPTY;
  return score;
}

// 全局棋盘评估（AI视角，正分有利AI）
function evaluateBoard(board, aiRole, humanRole) {
  let score = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] === aiRole) {
        score += scorePosition(board, r, c, aiRole);
      } else if (board[r][c] === humanRole) {
        score -= scorePosition(board, r, c, humanRole);
      }
    }
  }
  // 中心距离加成
  const center = (N - 1) / 2;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] === aiRole) {
        const dist = Math.abs(r - center) + Math.abs(c - center);
        score += (7 - dist) * 3;
      }
    }
  }
  return score;
}

// ── 候选位置筛选 ──
// 只考虑已有棋子附近2格内的空位（大幅减少搜索空间）
function getCandidates(board, dist = 2) {
  const hasStone = new Set();
  const candidates = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] !== EMPTY && board[r][c] !== RUIN && board[r][c] !== RIFT) {
        for (let dr = -dist; dr <= dist; dr++) {
          for (let dc = -dist; dc <= dist; dc++) {
            const nr = r + dr, nc = c + dc;
            if (inBound(nr, nc) && board[nr][nc] === EMPTY) {
              const key = nr * N + nc;
              if (!hasStone.has(key)) {
                hasStone.add(key);
                candidates.push([nr, nc]);
              }
            }
          }
        }
      }
    }
  }
  // 棋盘空时选中心
  if (candidates.length === 0) {
    candidates.push([7, 7]);
  }
  return candidates;
}

// ── 简单模式 ──
function getSimpleMove(room, aiRole, humanRole) {
  const board = room.board;
  const candidates = getCandidates(board);
  if (candidates.length === 0) return { action: 'place', r: 7, c: 7 };

  // 1. 检查AI能否直接赢
  for (const [r, c] of candidates) {
    board[r][c] = aiRole;
    const five = findFive(board, r, c, aiRole);
    board[r][c] = EMPTY;
    if (five) return { action: 'place', r, c };
  }

  // 2. 检查人类是否即将赢→防守
  for (const [r, c] of candidates) {
    board[r][c] = humanRole;
    const five = findFive(board, r, c, humanRole);
    board[r][c] = EMPTY;
    if (five) return { action: 'place', r, c };
  }

  // 3. 70%概率选邻近己方棋子的空位，30%完全随机
  if (Math.random() < 0.7) {
    const nearOwn = candidates.filter(([r, c]) => {
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr, nc = c + dc;
          if (inBound(nr, nc) && board[nr][nc] === aiRole) return true;
        }
      }
      return false;
    });
    if (nearOwn.length > 0) {
      const [r, c] = nearOwn[Math.floor(Math.random() * nearOwn.length)];
      return { action: 'place', r, c };
    }
  }

  const [r, c] = candidates[Math.floor(Math.random() * candidates.length)];
  return { action: 'place', r, c };
}

// ── 中等模式 ──
function getMediumMove(room, aiRole, humanRole) {
  const board = room.board;
  const candidates = getCandidates(board);
  if (candidates.length === 0) return { action: 'place', r: 7, c: 7 };

  // Blood mode: more aggressive — weight attack higher
  const isBlood = room.gameMode === 'blood';
  const atkWeight = isBlood ? 1.4 : 1.1;

  let bestScore = -Infinity;
  let bestMove = candidates[0];

  for (const [r, c] of candidates) {
    // 进攻评分
    const attackScore = evaluateMove(board, r, c, aiRole);
    // 防守评分
    const defenseScore = evaluateMove(board, r, c, humanRole);
    // 中心距离加成
    const center = (N - 1) / 2;
    const distScore = (7 - Math.abs(r - center) - Math.abs(c - center)) * 5;

    const total = attackScore * atkWeight + defenseScore + distScore;
    if (total > bestScore) {
      bestScore = total;
      bestMove = [r, c];
    }
  }

  return { action: 'place', r: bestMove[0], c: bestMove[1] };
}

// ── 困难模式 (minimax) ──
function getHardMove(room, aiRole, humanRole) {
  const board = room.board;
  const candidates = getCandidates(board);
  if (candidates.length === 0) return { action: 'place', r: 7, c: 7 };

  // 先检查必杀和必防
  for (const [r, c] of candidates) {
    board[r][c] = aiRole;
    const five = findFive(board, r, c, aiRole);
    board[r][c] = EMPTY;
    if (five) return { action: 'place', r, c };
  }
  for (const [r, c] of candidates) {
    board[r][c] = humanRole;
    const five = findFive(board, r, c, humanRole);
    board[r][c] = EMPTY;
    if (five) return { action: 'place', r, c };
  }

  // 对候选位置打分排序，只搜索前15
  const isBlood = room.gameMode === 'blood';
  const atkWeight = isBlood ? 1.4 : 1.1;
  const scored = candidates.map(([r, c]) => {
    const atk = evaluateMove(board, r, c, aiRole);
    const def = evaluateMove(board, r, c, humanRole);
    return { r, c, score: atk * atkWeight + def };
  });
  scored.sort((a, b) => b.score - a.score);
  const topCandidates = scored.slice(0, 15);

  let bestScore = -Infinity;
  let bestMove = topCandidates[0];

  for (const { r, c } of topCandidates) {
    board[r][c] = aiRole;
    const score = minimax(board, 1, false, aiRole, humanRole, -Infinity, Infinity);
    board[r][c] = EMPTY;
    if (score > bestScore) {
      bestScore = score;
      bestMove = { r, c };
    }
  }

  return { action: 'place', r: bestMove.r, c: bestMove.c };
}

function minimax(board, depth, isMax, aiRole, humanRole, alpha, beta) {
  // 终止条件
  if (depth <= 0) return evaluateBoard(board, aiRole, humanRole);

  const candidates = getCandidates(board, 1);
  if (candidates.length === 0) return evaluateBoard(board, aiRole, humanRole);

  // 快速检查终局
  const player = isMax ? aiRole : humanRole;
  for (const [r, c] of candidates) {
    board[r][c] = player;
    if (findFive(board, r, c, player)) {
      board[r][c] = EMPTY;
      return isMax ? SCORE.FIVE : -SCORE.FIVE;
    }
    board[r][c] = EMPTY;
  }

  // 对候选排序（启发式剪枝）
  const scored = candidates.map(([r, c]) => {
    const atk = evaluateMove(board, r, c, isMax ? aiRole : humanRole);
    const def = evaluateMove(board, r, c, isMax ? humanRole : aiRole);
    return { r, c, s: atk + def };
  });
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, 10);

  if (isMax) {
    let maxEval = -Infinity;
    for (const { r, c } of top) {
      board[r][c] = aiRole;
      const ev = minimax(board, depth - 1, false, aiRole, humanRole, alpha, beta);
      board[r][c] = EMPTY;
      maxEval = Math.max(maxEval, ev);
      alpha = Math.max(alpha, ev);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const { r, c } of top) {
      board[r][c] = humanRole;
      const ev = minimax(board, depth - 1, true, aiRole, humanRole, alpha, beta);
      board[r][c] = EMPTY;
      minEval = Math.min(minEval, ev);
      beta = Math.min(beta, ev);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

// ── 五连检测 ──
function findFive(board, r, c, player) {
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (let i = 1; i <= 4; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (!inBound(nr, nc) || board[nr][nc] !== player) break;
      count++;
    }
    for (let i = 1; i <= 4; i++) {
      const nr = r - dr * i, nc = c - dc * i;
      if (!inBound(nr, nc) || board[nr][nc] !== player) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

// 四连检测（用于超新星和战术评估）
function findFourCells(board, r, c, player) {
  for (const [dr, dc] of DIRS) {
    const cells = [[r, c]];
    for (let i = 1; i <= 4; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (!inBound(nr, nc) || board[nr][nc] !== player) break;
      cells.push([nr, nc]);
    }
    for (let i = 1; i <= 4; i++) {
      const nr = r - dr * i, nc = c - dc * i;
      if (!inBound(nr, nc) || board[nr][nc] !== player) break;
      cells.unshift([nr, nc]);
    }
    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return null;
}

// ── 技能决策 ──

// 飞沙走石：选价值最高的敌方棋子移除
function aiSandstorm(room, aiRole, humanRole) {
  const board = room.board;
  let bestScore = -1;
  let bestPos = null;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] !== humanRole) continue;
      if (isImpervious(room, r, c)) continue;
      const score = scorePosition(board, r, c, humanRole);
      if (score > bestScore) {
        bestScore = score;
        bestPos = [r, c];
      }
    }
  }

  return bestPos;
}

// 移形换影：选择交换价值最高的组合（己方低价值棋子 ↔ 对手高价值棋子）
function aiSwapPos(room, aiRole, humanRole) {
  const board = room.board;
  let bestScore = -1;
  let bestSwap = null;

  for (let myR = 0; myR < N; myR++) {
    for (let myC = 0; myC < N; myC++) {
      if (board[myR][myC] !== aiRole) continue;
      if (isImpervious(room, myR, myC)) continue;
      const myValue = scorePosition(board, myR, myC, aiRole);

      for (let opR = 0; opR < N; opR++) {
        for (let opC = 0; opC < N; opC++) {
          if (board[opR][opC] !== humanRole) continue;
          if (isImpervious(room, opR, opC)) continue;
          const opValue = scorePosition(board, opR, opC, humanRole);

          // Simulate swap: how much better is the opponent's position for us?
          // And how much does removing our low-value piece hurt us?
          const swapBenefit = opValue - myValue * 0.3;
          if (swapBenefit > bestScore) {
            bestScore = swapBenefit;
            bestSwap = { myR, myC, opR, opC, opValue };
          }
        }
      }
    }
  }

  return bestSwap;
}

// 偷梁换柱：选择关键位置的敌方棋子转化
function aiSwap(room, aiRole, humanRole) {
  const board = room.board;
  let bestScore = -1;
  let bestPos = null;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] !== humanRole) continue;
      if (isImpervious(room, r, c)) continue;
      // 评估该棋子对人类的价值
      const humanValue = scorePosition(board, r, c, humanRole);
      // 评估转换后对AI的价值
      board[r][c] = aiRole;
      const aiValue = evaluateMove(board, r, c, aiRole);
      board[r][c] = humanRole;
      const total = humanValue + aiValue * 0.5;
      if (total > bestScore) {
        bestScore = total;
        bestPos = [r, c];
      }
    }
  }

  return bestPos;
}

// 斗转星移：移动棋子到战术位置
function aiMove(room, aiRole, humanRole) {
  const board = room.board;
  let bestScore = -1;
  let bestMove = null;

  // 考虑移动己方棋子
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] !== aiRole) continue;
      if (isImpervious(room, r, c)) continue;
      // 当前位置的价值
      const currentScore = scorePosition(board, r, c, aiRole);
      // 尝试移动到附近空位
      board[r][c] = EMPTY;
      const targets = getEmptyNeighbors(board, r, c, 3);
      for (const [tr, tc] of targets) {
        board[tr][tc] = aiRole;
        const newScore = evaluateMove(board, tr, tc, aiRole);
        board[tr][tc] = EMPTY;
        const improvement = newScore - currentScore;
        if (improvement > bestScore) {
          bestScore = improvement;
          bestMove = { fr: r, fc: c, tr, tc, improvement };
        }
      }
      board[r][c] = aiRole;
    }
  }

  // 也考虑移动敌方关键棋子
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] !== humanRole) continue;
      if (isImpervious(room, r, c)) continue;
      const enemyValue = scorePosition(board, r, c, humanRole);
      if (enemyValue < SCORE.LIVE3) continue; // 只移动高价值敌方棋子
      board[r][c] = EMPTY;
      const targets = getEmptyNeighbors(board, r, c, 3);
      for (const [tr, tc] of targets) {
        board[tr][tc] = humanRole;
        const newEnemyValue = scorePosition(board, tr, tc, humanRole);
        board[tr][tc] = EMPTY;
        // 破坏价值 = 原价值 - 新价值
        const destruction = enemyValue - newEnemyValue;
        if (destruction > bestScore) {
          bestScore = destruction;
          bestMove = { fr: r, fc: c, tr, tc, improvement: destruction };
        }
      }
      board[r][c] = humanRole;
    }
  }

  return bestMove;
}

// 暗度陈仓：选择假棋子和真棋子位置
function aiAmbush(room, aiRole, humanRole) {
  const board = room.board;
  const candidates = getCandidates(board);
  if (candidates.length < 2) return null;

  // 假棋子：选一个看起来有威胁但不是真正进攻的位置
  // 真棋子：选一个真正能形成威胁的隐蔽位置
  let bestFake = null, bestReal = null, bestScore = -1;

  // 对候选排序，取前10个
  const scored = candidates.map(([r, c]) => ({
    r, c,
    atk: evaluateMove(board, r, c, aiRole),
    def: evaluateMove(board, r, c, humanRole)
  }));
  scored.sort((a, b) => (b.atk + b.def) - (a.atk + a.def));
  const top = scored.slice(0, 12);

  for (const fake of top) {
    for (const real of top) {
      if (fake.r === real.r && fake.c === real.c) continue;
      // 真棋子在进攻核心，假棋子在旁边干扰
      const score = real.atk * 1.5 + fake.def * 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestFake = [fake.r, fake.c];
        bestReal = [real.r, real.c];
      }
    }
  }

  return bestFake && bestReal ? { fakePos: bestFake, realPos: bestReal } : null;
}

// 检查位置是否受无懈可击保护
function isImpervious(room, r, c) {
  const owner = room.board[r][c];
  if (!room.roles || !room.roles.includes(owner)) return false;
  const equipped = room.equipped[owner] || [];
  return equipped.includes('impervious');
}

// ── 综合技能决策 ──
function shouldUseSkill(room, aiRole, difficulty) {
  const humanRole = room.roles.find(r => r !== aiRole);
  if (!humanRole) return null;

  const equipped = room.equipped[aiRole] || [];
  const ss = room.skillState[aiRole] || {};
  const board = room.board;

  // 先计算当前最佳落子的价值，作为技能使用的基准
  const candidates = getCandidates(board);
  let bestPlaceScore = 0;
  for (const [r, c] of candidates) {
    const atk = evaluateMove(board, r, c, aiRole);
    const def = evaluateMove(board, r, c, humanRole);
    bestPlaceScore = Math.max(bestPlaceScore, atk * 1.1 + def);
  }

  // 力拔山兮：回合≥50直接获胜（经典模式）或+3分（血战模式）
  if (equipped.includes('mountain') && room.totalMoves >= 50) {
    if (room.gameMode !== 'blood') return { action: 'skill', skill: 'mountain' };
    // Blood mode: use mountain if it would win or if close to target
    const currentBloodScore = room.bloodScores[aiRole] || 0;
    if (currentBloodScore + 3 >= (room.targetScore || 5)) return { action: 'skill', skill: 'mountain' };
    // Otherwise still use it if no better move
    if (bestPlaceScore < SCORE.LIVE3) return { action: 'skill', skill: 'mountain' };
  }

  // 如果能直接赢或防住，优先落子
  if (bestPlaceScore >= SCORE.LIVE4) return null;

  // 中等/困难：主动使用技能
  if (difficulty === 'medium' || difficulty === 'hard') {
    // 飞沙走石：移除高威胁敌方棋子（降低阈值，更积极使用）
    if (equipped.includes('sandstorm')) {
      const lastUsed = room.sandstormLastUsed[aiRole] || 0;
      if (room.totalMoves - lastUsed >= 5) {
        const target = aiSandstorm(room, aiRole, humanRole);
        if (target) {
          const threatValue = scorePosition(board, target[0], target[1], humanRole);
          // 降低阈值：移除LIVE3及以上威胁，或比落子价值高的威胁
          if (threatValue >= SCORE.LIVE3 || (threatValue >= bestPlaceScore * 0.6 && threatValue >= SCORE.SLEEP3)) {
            return { action: 'skill', skill: 'sandstorm', r: target[0], c: target[1] };
          }
        }
      }
    }

    // 偷梁换柱：转化关键敌方棋子（降低阈值至LIVE3）
    if (equipped.includes('swap')) {
      const target = aiSwap(room, aiRole, humanRole);
      if (target) {
        const humanValue = scorePosition(board, target[0], target[1], humanRole);
        // 降低阈值：转化活三或冲四的棋子
        if (humanValue >= SCORE.LIVE3) {
          return { action: 'skill', skill: 'swap', r: target[0], c: target[1] };
        }
      }
    }

    // 移形换影：交换己方低价值与对手高价值棋子
    if (equipped.includes('swapPos')) {
      const ssSwap = ss.swapPos || 0;
      if (ssSwap <= 0) {
        const swapResult = aiSwapPos(room, aiRole, humanRole);
        if (swapResult && swapResult.opValue >= SCORE.LIVE3) {
          return { action: 'skill', skill: 'swapPos', myR: swapResult.myR, myC: swapResult.myC, opR: swapResult.opR, opC: swapResult.opC };
        }
      }
    }

    // 斗转星移：有重大改进时使用（降低阈值）
    if (equipped.includes('move') && (ss.move || 0) <= 0) {
      const moveResult = aiMove(room, aiRole, humanRole);
      if (moveResult && moveResult.improvement >= SCORE.LIVE3) {
        return { action: 'skill', skill: 'move', fr: moveResult.fr, fc: moveResult.fc, tr: moveResult.tr, tc: moveResult.tc };
      }
    }

    // 暗度陈仓：中后期有一定概率使用（增加使用概率）
    if (equipped.includes('ambush') && !room.ambushUsed.has(aiRole)) {
      // 20回合后有40%概率使用，创造双杀机会
      if (room.totalMoves > 15 && Math.random() < 0.4) {
        const ambushPlan = aiAmbush(room, aiRole, humanRole);
        if (ambushPlan) {
          return { action: 'skill', skill: 'ambush', fakePos: ambushPlan.fakePos, realPos: ambushPlan.realPos };
        }
      }
    }
  }

  // 简单模式：降低了技能使用阈值
  if (difficulty === 'simple') {
    if (equipped.includes('sandstorm')) {
      const lastUsed = room.sandstormLastUsed[aiRole] || 0;
      if (room.totalMoves - lastUsed >= 5) {
        const target = aiSandstorm(room, aiRole, humanRole);
        if (target && scorePosition(board, target[0], target[1], humanRole) >= SCORE.LIVE3) {
          return { action: 'skill', skill: 'sandstorm', r: target[0], c: target[1] };
        }
      }
    }
    // 简单模式也会用力拔山兮
    if (equipped.includes('mountain') && room.totalMoves >= 50) {
      return { action: 'skill', skill: 'mountain' };
    }
  }

  return null; // 不使用技能，直接落子
}

// ── 主入口 ──
function getAIMove(room, difficulty) {
  const aiRole = room.roles.find(r => r !== room.roles[0]); // AI是P2
  const humanRole = room.roles[0]; // 人类是P1

  if (!aiRole || !humanRole) return { action: 'place', r: 7, c: 7 };

  // 先考虑使用技能
  const skillDecision = shouldUseSkill(room, aiRole, difficulty);
  if (skillDecision) return skillDecision;

  // 根据难度选择落子策略
  switch (difficulty) {
    case 'simple':
      return getSimpleMove(room, aiRole, humanRole);
    case 'medium':
      return getMediumMove(room, aiRole, humanRole);
    case 'hard':
      return getHardMove(room, aiRole, humanRole);
    default:
      return getMediumMove(room, aiRole, humanRole);
  }
}

module.exports = { getAIMove, aiAmbush };
