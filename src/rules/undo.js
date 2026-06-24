/**
 * 悔棋协商：仅刚落子的玩家可发起请求，对方接受后撤销最后一手
 */
const { EMPTY } = require('../constants');
const { snap } = require('./snapshot');

/** 撤销最后一手棋（包含暗度陈仓的真/假棋子配对清理） */
function undoLastMove(room) {
  if (room.history.length === 0) return { error: '没有可悔棋的历史' };
  if (room.gameOver)        return { error: '游戏已结束，无法悔棋' };
  if (room.ambushState)     return { error: '暗度陈仓进行中，无法悔棋' };
  if (room.pendingSkill)    return { error: '技能结算中，无法悔棋' };

  const lastMove = room.history.pop();
  if (!lastMove) return { error: '历史记录为空' };

  const { r, c, player, type } = lastMove;
  if (type === 'place') {
    // 暗度陈仓真棋子：连带清除假棋子
    const ambushKey = `${r},${c}`;
    if (room.ambushHidden[ambushKey] === player) {
      delete room.ambushHidden[ambushKey];
      for (const key of Object.keys(room.ambushHidden)) {
        if (key.startsWith('fake_') && room.ambushHidden[key] === player) {
          const parts = key.split('_');
          const fr = parseInt(parts[1]), fc = parseInt(parts[2]);
          room.board[fr][fc] = EMPTY;
          room.stoneAge[fr][fc] = 0;
          delete room.ambushHidden[key];
        }
      }
    }
    room.board[r][c] = EMPTY;
    room.stoneAge[r][c] = 0;
    room.totalMoves--;
    room.currentPlayer = player;
    room.winCells = [];
    room.novaLine = null;
    console.log(`[悔棋] 玩家${player} 撤销 (${r},${c})，回合回到 ${room.currentPlayer}`);
    return { ok: true, undone: { r, c, player }, snapshot: snap(room) };
  }
  return { error: '无法撤销该类型操作' };
}

/** 处理悔棋请求 */
function handleUndoRequest(room, player) {
  if (room.gameOver)        return { error: '游戏已结束' };
  if (room.ambushState)     return { error: '暗度陈仓进行中' };
  if (room.pendingSkill)    return { error: '技能结算中' };
  if (room.history.length === 0) return { error: '没有可悔棋的历史' };
  if (room.undoRequest)     return { error: '已有悔棋请求待处理' };
  // 只有刚落子的玩家（当前回合的前一个玩家）才能请求悔棋
  const roles = room.roles;
  const idx = roles.indexOf(room.currentPlayer);
  const prevPlayer = roles[(idx - 1 + room.count) % room.count];
  if (player !== prevPlayer) return { error: '只有刚落子的玩家才能请求悔棋' };

  room.undoRequest = { from: player };
  console.log(`[悔棋请求] 玩家${player} 请求悔棋`);
  return { ok: true, undoRequest: true, from: player };
}

/** 处理悔棋响应 */
function handleUndoResponse(room, player, accepted) {
  if (!room.undoRequest)                return { error: '没有悔棋请求' };
  if (room.undoRequest.from === player) return { error: '不能响应自己的悔棋请求' };
  room.undoRequest = null;
  if (accepted) {
    const result = undoLastMove(room);
    if (result.error) return result;
    console.log(`[悔棋] 玩家${player} 同意悔棋`);
    return { ok: true, undoAccepted: true, ...result };
  } else {
    console.log(`[悔棋] 玩家${player} 拒绝悔棋`);
    return { ok: true, undoRejected: true };
  }
}

module.exports = { undoLastMove, handleUndoRequest, handleUndoResponse };
