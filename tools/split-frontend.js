/**
 * 把 public/index.html 中的 <style> 与 <script> 抽到外部文件：
 *   public/styles.css
 *   public/app.js
 * 并把 index.html 替换为 <link>/<script src> 引用。
 *
 * 用法：node tools/split-frontend.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const cssPath  = path.join(ROOT, 'public', 'styles.css');
const jsPath   = path.join(ROOT, 'public', 'app.js');

const src = fs.readFileSync(htmlPath, 'utf8');

// 提取首个 <style>...</style>
const styleMatch = src.match(/<style[^>]*>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error('未找到 <style> 块');
const cssContent = styleMatch[1].trim() + '\n';

// 提取首个 <script>...</script>（无 src）
const scriptMatch = src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('未找到内联 <script> 块');
const jsContent = scriptMatch[1].trim() + '\n';

fs.writeFileSync(cssPath, cssContent, 'utf8');
fs.writeFileSync(jsPath, jsContent, 'utf8');
console.log('wrote', cssPath, cssContent.length, 'bytes');
console.log('wrote', jsPath,  jsContent.length,  'bytes');

// 替换 html 中的 style/script 内联块为外链
let out = src
  .replace(styleMatch[0],  '<link rel="stylesheet" href="styles.css">')
  .replace(scriptMatch[0], '<script src="app.js" defer></script>');

fs.writeFileSync(htmlPath, out, 'utf8');
console.log('rewrote', htmlPath, 'size', out.length);
