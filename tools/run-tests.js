/**
 * 跨 Node 版本的测试启动器
 * Node 18 / 20 / 22 都可用。
 *
 * 实现：列出 test/ 下所有 *.test.js，然后用 spawn 调用
 *   node --test <files...>
 *
 * 这样可以避免依赖 shell 的 glob 展开（PowerShell / Windows cmd 不展开 glob，
 * 而 Node 自身的 --test glob 支持要 Node 22+）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_DIR = path.join(__dirname, '..', 'test');
let files;
try {
  files = fs.readdirSync(TEST_DIR)
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join(TEST_DIR, f));
} catch (e) {
  console.error('Cannot read test dir:', TEST_DIR, e.message);
  process.exit(1);
}

if (files.length === 0) {
  console.error('No test files found in', TEST_DIR);
  process.exit(1);
}

console.log('[run-tests] discovered', files.length, 'test files');
const args = ['--test', ...files];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
