/**
 * 规则引擎单元测试 (node:test)
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  N, EMPTY, P1, P2, P3,
  createRoom, initSkillState,
  findLines, applyDevour, bloodClear, checkBloodWin,
  handlePlace, undoLastMove,
  isImpervious,
} = require('../server');

function makeRoom(opts = {}) {
  const room = createRoom('TEST1', opts.mode || 2, { 1: 'A', 2: 'B', 3: 'C' }, opts.gameMode || 'classic');
  // 默认所有人不装备技能，避免影响纯落子测试
  for (const r of room.roles) room.equipped[r] = opts.equipped?.[r] || [];
  initSkillState(room);
  return room;
}

// ── findLines ──
test('findLines: 水平五连可被检测', () => {
  const room = makeRoom();
  for (let i = 0; i < 4; i++) room.board[7][i] = P1;
  room.board[7][4] = P1;
  const lines = findLines(room.board, 7, 2, P1, 5);
  assert.ok(lines.length >= 1, '应找到至少一条五连');
  assert.equal(lines[0].length, 5);
});

test('findLines: 不连续的四子不应判为四连', () => {
  const room = makeRoom();
  room.board[7][0] = P1; room.board[7][1] = P1;
  room.board[7][3] = P1; room.board[7][4] = P1; // 中间断了
  const lines = findLines(room.board, 7, 1, P1, 4);
  assert.equal(lines.length, 0);
});

test('findLines: excludePos 会把指定格子视为空（用于暗度陈仓假棋子）', () => {
  const room = makeRoom();
  // 0..4 都是 P1，但 2 号是假棋子
  for (let i = 0; i < 5; i++) room.board[7][i] = P1;
  const linesAll = findLines(room.board, 7, 0, P1, 5);
  const linesEx = findLines(room.board, 7, 0, P1, 5, [7, 2]);
  assert.ok(linesAll.length >= 1, '排除前应能找到五连');
  assert.equal(linesEx.length, 0, '排除假棋子后不应判定五连');
});

// ── handlePlace + 胜利 ──
test('handlePlace: 形成五连后 gameOver=true，scores+1', () => {
  const room = makeRoom();
  room.gameStarted = true;
  // 关闭法则，避免裂隙/衰变影响落子位置
  room.globalSettings = { devour: false, decay: false, nova: false, rift: false };
  // 让 P1 连下 5 子
  const seq = [
    [7, 0, P1], [0, 0, P2],
    [7, 1, P1], [0, 1, P2],
    [7, 2, P1], [0, 2, P2],
    [7, 3, P1], [0, 3, P2],
    [7, 4, P1], // 第 9 手，P1 五连
  ];
  for (const [r, c, p] of seq) {
    const res = handlePlace(room, r, c, p);
    assert.ok(!res.error, `落子不应失败: ${JSON.stringify(res)}`);
  }
  assert.equal(room.gameOver, true);
  assert.equal(room.scores[P1], 1);
  assert.equal(room.winCells.length, 5);
});

test('handlePlace: 不是当前回合的玩家无法落子', () => {
  const room = makeRoom();
  room.gameStarted = true;
  const r = handlePlace(room, 7, 7, P2); // 默认 currentPlayer=P1
  assert.ok(r.error, '应返回 error');
});

test('handlePlace: 已有棋子的位置不可落子', () => {
  const room = makeRoom();
  room.gameStarted = true;
  handlePlace(room, 7, 7, P1);
  const r = handlePlace(room, 7, 7, P2);
  assert.ok(r.error);
});

// ── applyDevour（吞噬法则）──
test('applyDevour: 敌方棋子被 3 面包围会被吞噬', () => {
  const room = makeRoom();
  // 中心 (7,7) 是 P2，被 P1 包围 3 面：左/上/下；右侧空
  room.board[7][7] = P2;
  room.board[6][7] = P1;
  room.board[8][7] = P1;
  room.board[7][6] = P1;
  // 右侧落 P1 作为触发点（此时 P2 周围 P1=4 面，>=3）
  room.board[7][8] = P1;
  const devoured = applyDevour(room, 7, 8, P1);
  // P2 应被转化为 P1
  assert.equal(room.board[7][7], P1);
  assert.ok(devoured.some(([r, c]) => r === 7 && c === 7));
});

test('applyDevour: 仅 2 面包围不应触发', () => {
  const room = makeRoom();
  // P2 在 (7,7)，仅一个 P1 邻居 (6,7)；触发点 (7,8)=P1 算另一面，共 2 面，未达 3
  room.board[7][7] = P2;
  room.board[6][7] = P1;
  room.board[7][8] = P1; // 触发点
  applyDevour(room, 7, 8, P1);
  assert.equal(room.board[7][7], P2, '未达 3 面包围不应被吞噬');
});

// ── 血战模式 ──
test('血战 bloodClear: 五连后周围 1 圈被清空，五连本身也清空，分数累加', () => {
  const room = makeRoom({ gameMode: 'blood' });
  // 构造一条 (7,0)-(7,4) 的五连
  const winCells = [];
  for (let c = 0; c < 5; c++) {
    room.board[7][c] = P1;
    winCells.push([7, c]);
  }
  // 周围放一些棋子等待被清
  room.board[6][2] = P2;
  room.board[8][2] = P2;
  room.board[7][5] = P2;
  const res = bloodClear(room, winCells, P1);
  // 周围被清
  assert.equal(room.board[6][2], EMPTY);
  assert.equal(room.board[8][2], EMPTY);
  assert.equal(room.board[7][5], EMPTY);
  // 五连本身被清
  for (const [r, c] of winCells) assert.equal(room.board[r][c], EMPTY);
  // 分数累加
  assert.ok(res.score > 0);
  assert.equal(room.bloodScores[P1], res.score);
});

test('血战 bloodClear: 受无懈可击保护的棋子不被清', () => {
  const room = makeRoom({ gameMode: 'blood', equipped: { [P2]: ['impervious'] } });
  initSkillState(room);
  // P1 在 (7,0)-(7,4) 五连
  const winCells = [];
  for (let c = 0; c < 5; c++) { room.board[7][c] = P1; winCells.push([7, c]); }
  // P2 棋子带无懈可击，应保留
  room.board[6][2] = P2;
  bloodClear(room, winCells, P1);
  assert.equal(room.board[6][2], P2, '无懈可击的棋子应保留');
});

test('checkBloodWin: 达到 5 次五连或 20 分时返回 true', () => {
  const room = makeRoom({ gameMode: 'blood' });
  room.scores[P1] = 5; room.bloodScores[P1] = 0;
  assert.equal(checkBloodWin(room, P1), true);
  room.scores[P1] = 0; room.bloodScores[P1] = 20;
  assert.equal(checkBloodWin(room, P1), true);
  room.scores[P1] = 4; room.bloodScores[P1] = 19;
  assert.equal(checkBloodWin(room, P1), false);
});

// ── 悔棋 ──
test('undoLastMove: 撤销最后一手，棋子清除，回合回到悔棋玩家', () => {
  const room = makeRoom();
  room.gameStarted = true;
  // 关闭"衰变"等可能干扰的法则，确保单测纯净
  room.globalSettings = { devour: false, decay: false, nova: false, rift: false };

  handlePlace(room, 7, 7, P1); // P1 -> currentPlayer=P2
  assert.equal(room.board[7][7], P1);
  assert.equal(room.currentPlayer, P2);

  const res = undoLastMove(room);
  assert.ok(!res.error, `不应失败: ${JSON.stringify(res)}`);
  assert.equal(room.board[7][7], EMPTY, '棋子应被清除');
  assert.equal(room.currentPlayer, P1, '回合应回到悔棋玩家');
  assert.equal(room.totalMoves, 0);
});

test('undoLastMove: 没有历史时返回 error', () => {
  const room = makeRoom();
  const res = undoLastMove(room);
  assert.ok(res.error);
});

test('undoLastMove: 游戏已结束时不可悔棋', () => {
  const room = makeRoom();
  room.gameOver = true;
  room.history.push({ r: 0, c: 0, player: P1, type: 'place' });
  const res = undoLastMove(room);
  assert.ok(res.error);
});

// ── 无懈可击 ──
test('isImpervious: 装备 impervious 的玩家棋子受保护', () => {
  const room = makeRoom({ equipped: { [P1]: ['impervious'] } });
  initSkillState(room);
  room.board[5][5] = P1;
  room.board[5][6] = P2;
  assert.equal(isImpervious(room, 5, 5), true);
  assert.equal(isImpervious(room, 5, 6), false);
});
