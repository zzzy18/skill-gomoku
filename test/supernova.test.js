/**
 * 超新星（supernova）测试
 *   - 引爆后毁掉以四连为中心半径 2 内的所有非裂隙棋子
 *   - 引爆后在棋盘空位随机生成 2 颗己方棋子（"余烬"）
 *   - 血战模式禁用引爆
 *   - impervious / barrier 保护的棋子不被毁
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  P1, P2, P3, EMPTY,
  createRoom, initSkillState,
  handlePlace, handleSupernova,
  isImpervious,
} = require('../server');
const CONFIG = require('../config/rules');

function makeRoom(opts = {}) {
  const room = createRoom('NV', opts.mode || 2, { 1: 'A', 2: 'B', 3: 'C' }, opts.gameMode || 'classic');
  for (const r of room.roles) room.equipped[r] = opts.equipped?.[r] || [];
  initSkillState(room);
  room.gameStarted = true;
  // 关掉法则避免衰变 / 裂隙干扰
  room.globalSettings = { devour: false, decay: false, nova: true, rift: false, gravity: false };
  return room;
}

test('supernova: 引爆后生成 N 颗己方棋子（N=config.rules.novaSpawnCount）', () => {
  const room = makeRoom();
  // 构造 P1 四连 (7,0)-(7,3)，但不能形成五连
  for (let c = 0; c < 4; c++) {
    room.board[7][c] = P1;
  }
  // novaLine 由 handlePlace 触发更自然，但我们直接设置便于隔离
  room.novaLine = { cells: [[7,0],[7,1],[7,2],[7,3]], player: P1 };

  // 引爆前 P1 棋子数 = 4
  let beforeP1 = 0;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) if (room.board[r][c] === P1) beforeP1++;

  const res = handleSupernova(room, P1);
  assert.ok(!res.error, JSON.stringify(res));
  assert.ok(Array.isArray(res.spawned));
  assert.equal(res.spawned.length, CONFIG.rules.novaSpawnCount, '应生成 config 中配置的余烬数量');

  // 引爆后 P1 棋子数应为：原 4 子被毁 + 新 spawn N 子 = N
  let afterP1 = 0;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) if (room.board[r][c] === P1) afterP1++;
  assert.equal(afterP1, CONFIG.rules.novaSpawnCount);

  // 余烬都落在空位上，且各不相同
  const seen = new Set();
  for (const [sr, sc] of res.spawned) {
    const key = sr * 15 + sc;
    assert.ok(!seen.has(key), '余烬不应重叠');
    seen.add(key);
    assert.equal(room.board[sr][sc], P1, '余烬位置应为己方棋子');
  }
});

test('supernova: 半径 2 内的敌方非裂隙棋子被湮灭，裂隙不动', () => {
  const room = makeRoom();
  const RIFT = 5;
  // 四连
  for (let c = 0; c < 4; c++) room.board[7][c] = P1;
  // 敌方棋子放在半径 2 内
  room.board[5][1] = P2;  // 距 (7,1) 2 行 - 应被毁
  room.board[9][2] = P2;  // 距 (7,2) 2 行 - 应被毁
  // 半径 3 之外
  room.board[10][10] = P2;
  // 裂隙在半径 2 内（不应被毁）
  room.board[6][2] = RIFT;
  room.novaLine = { cells: [[7,0],[7,1],[7,2],[7,3]], player: P1 };

  const res = handleSupernova(room, P1);
  assert.ok(!res.error);
  assert.equal(room.board[5][1], EMPTY);
  assert.equal(room.board[9][2], EMPTY);
  assert.equal(room.board[10][10], P2, '半径外不动');
  assert.equal(room.board[6][2], RIFT, '裂隙不被毁');
});

test('supernova: impervious 保护的棋子不被毁', () => {
  const room = makeRoom({ equipped: { [P2]: ['impervious'] } });
  initSkillState(room);
  for (let c = 0; c < 4; c++) room.board[7][c] = P1;
  room.board[7][5] = P2;  // 距 (7,3) 2 列，应该被毁，但有 impervious
  room.novaLine = { cells: [[7,0],[7,1],[7,2],[7,3]], player: P1 };
  const res = handleSupernova(room, P1);
  assert.ok(!res.error);
  assert.equal(room.board[7][5], P2, '无懈可击保护下应保留');
});

test('supernova: 血战模式禁用', () => {
  const room = makeRoom({ gameMode: 'blood' });
  for (let c = 0; c < 4; c++) room.board[7][c] = P1;
  room.novaLine = { cells: [[7,0],[7,1],[7,2],[7,3]], player: P1 };
  const res = handleSupernova(room, P1);
  assert.ok(res.error);
  assert.match(res.error, /血战/);
});

test('supernova: 空位不足时，余烬数量退化为剩余空位数', () => {
  const room = makeRoom();
  // 棋盘几乎填满：把所有非五连区的格子都填 P2，留 1 个空位
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) room.board[r][c] = P2;
  // 给 P1 留四连
  for (let c = 0; c < 4; c++) room.board[7][c] = P1;
  // 留 1 个空位（半径 2 之外，引爆不影响）
  room.board[0][14] = EMPTY;
  room.novaLine = { cells: [[7,0],[7,1],[7,2],[7,3]], player: P1 };

  const res = handleSupernova(room, P1);
  assert.ok(!res.error);
  // 引爆会把附近的 P2 也清空，但 (0,14) 仍空，因此余烬至少能落 1 颗
  assert.ok(res.spawned.length >= 1);
});
