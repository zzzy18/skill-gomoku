/**
 * 移形换影（swapPos）
 * 选择己方一枚棋子与对手一枚棋子交换位置；冷却 CONFIG.skills.swapPos.cooldown 回合
 */
const CONFIG = require('../../../config/rules');
const COOLDOWN = CONFIG.skills.swapPos.cooldown;
const PENDING_MS = CONFIG.skills.pendingTimerMs;

module.exports = {
  id: 'swapPos',
  apply({ room, msg, player, deps }) {
    const { myR, myC, opR, opC } = msg;
    const { N, isImpervious, broadcastAll, resolveSwapPos } = deps;
    if (myR<0||myR>=N||myC<0||myC>=N||opR<0||opR>=N||opC<0||opC>=N) return { error: '无效位置' };
    if (room.board[myR][myC] !== player) return { error: '起始位置必须是己方棋子' };
    if (!room.roles.includes(room.board[opR][opC]) || room.board[opR][opC] === player) return { error: '目标位置必须是对手棋子' };
    if (isImpervious(room, opR, opC)) return { error: '该棋子受无懈可击保护' };

    const ss = room.skillState[player] || {};
    if (ss.swapPos > 0) return { error: `移形换影冷却中，还需${ss.swapPos}回合` };

    // 交换 board / stoneAge / swapMap / ambushHidden
    const opStone = room.board[opR][opC];
    room.board[myR][myC] = opStone;
    room.board[opR][opC] = player;
    const tmpAge = room.stoneAge[myR][myC];
    room.stoneAge[myR][myC] = room.stoneAge[opR][opC];
    room.stoneAge[opR][opC] = tmpAge;

    const myKey = `${myR},${myC}`;
    const opKey = `${opR},${opC}`;
    delete room.swapMap[myKey];
    delete room.swapMap[opKey];

    const myAmbush = room.ambushHidden[myKey];
    const opAmbush = room.ambushHidden[opKey];
    delete room.ambushHidden[myKey];
    delete room.ambushHidden[opKey];
    if (myAmbush) room.ambushHidden[opKey] = myAmbush;
    if (opAmbush) room.ambushHidden[myKey] = opAmbush;

    ss.swapPos = COOLDOWN;
    room.skillState[player] = ss;
    room.pendingSkill = { type: 'swapPos', player, myR, myC, opR, opC };
    broadcastAll(room, { type: 'skillPending', skill: 'swapPos', player, myR, myC, opR, opC });
    room.pendingTimer = setTimeout(() => {
      if (room.pendingSkill && room.pendingSkill.type === 'swapPos') resolveSwapPos(room);
    }, PENDING_MS);
    return { ok: true, action: 'skill', skill: 'swapPos', pending: true, player, myR, myC, opR, opC };
  },
};
