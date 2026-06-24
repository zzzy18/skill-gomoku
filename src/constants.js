/**
 * 全局常量。棋盘大小从 config 取以便平衡调整。
 */
const CONFIG = require('../config/rules');

const N = CONFIG.board.N;
const EMPTY = 0;
const P1 = 1;
const P2 = 2;
const P3 = 3;
const RUIN = 4;
const RIFT = 5;

module.exports = { N, EMPTY, P1, P2, P3, RUIN, RIFT };
