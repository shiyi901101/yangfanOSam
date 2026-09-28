/* GATE1 提取：把 index.html 内联 <script> 块抽成 js_01..js_0N.js。
   路径全部 __dirname 基（见 paths.js）；产物写 os.tmpdir()/yf-gates-<hash>/，不落仓库、不依赖 cwd。
   输出末行固定为 `YF_TMP=<绝对路径（正斜杠）>`，供 run_gates_iso.sh 取用做 GATE2 语法检查。 */
'use strict';
const fs = require('fs');
const P = require('./paths');

const html = fs.readFileSync(P.INDEX_HTML, 'utf8');
const re = /<script(?![^>]*type=)(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
fs.mkdirSync(P.BUILD_DIR, { recursive: true });
let m, i = 0;
while ((m = re.exec(html))) {
  i++;
  fs.writeFileSync(P.jsBlock(String(i).padStart(2, '0')), m[1]);
}
console.log('extracted ' + i + ' JS blocks');
console.log('YF_TMP=' + P.BUILD_DIR.replace(/\\/g, '/'));
