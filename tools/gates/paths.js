/* =====================================================================
 * 门禁套件路径解析（唯一权威出口）
 * ---------------------------------------------------------------------
 * 纳管红线（#92）：
 *   1) 全部路径 **__dirname 基**：任何脚本在任何 cwd 下被调用都能自定位；
 *      不得再依赖「先 cd 到 .tmp-verify」或 cwd 相对路径（js_0X.js / ../yangfan-os-ghpages/…）。
 *   2) 提取产物写 **os.tmpdir()**（跨平台），不落仓库。
 *   3) 影子后端目录（运行期产物）写 os.tmpdir()，不落仓库；且必须每轮从真实源重生成。
 *
 * 目录布局：
 *   <front> = <workspace>/yangfan-os-ghpages        ← 本仓库（index.html 所在）
 *   <workspace>                                     ← 含 yangfan-cloud/ 的工作区仓库
 *   __dirname = <front>/tools/gates
 * ===================================================================== */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const GATES_DIR = __dirname;                                  // <front>/tools/gates
const FRONT_ROOT = path.resolve(GATES_DIR, '..', '..');       // <front>
const INDEX_HTML = path.join(FRONT_ROOT, 'index.html');
const DASH_DATA_JS = path.join(FRONT_ROOT, 'dash_data.js');

/* 工作区仓库（含 yangfan-cloud/ 的那一层）：从前端仓库向上逐级找 yf-api/index.js。
   这就是「套件虽放前端仓库、却依赖另一个仓库」的解析口——MANIFEST 已写明该跨仓库前置。 */
function findYfApiDir() {
  let d = FRONT_ROOT;
  for (let i = 0; i < 6; i++) {
    const cand = path.join(d, 'yangfan-cloud', 'yf-api', 'index.js');
    if (fs.existsSync(cand)) return path.join(d, 'yangfan-cloud', 'yf-api');
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  /* 兜底：找不到也给出一条可读路径（错误信息里能看出该放哪），不静默造空 */
  return path.join(path.dirname(FRONT_ROOT), 'yangfan-cloud', 'yf-api');
}
const YF_API_DIR_DEFAULT = findYfApiDir();
const YF_API_INDEX = path.join(YF_API_DIR_DEFAULT, 'index.js');

/* 提取产物目录：os.tmpdir() + 前端仓库绝对路径哈希（同一前端仓库恒得同一目录，
   extract.js 与 test_rules.js 各自算出一致，无需任何外部状态传递）。 */
const KEY = crypto.createHash('md5').update(FRONT_ROOT).digest('hex').slice(0, 8);
const BUILD_DIR = path.join(os.tmpdir(), 'yf-gates-' + KEY);
const RUNS_DIR = path.join(os.tmpdir(), 'yf-gates-shadow-' + KEY);

/* 提取出的 JS 块绝对路径：jsBlock('02') → <tmp>/js_02.js */
function jsBlock(n) { return path.join(BUILD_DIR, 'js_' + n + '.js'); }

module.exports = {
  GATES_DIR, FRONT_ROOT, INDEX_HTML, DASH_DATA_JS,
  YF_API_DIR_DEFAULT, YF_API_INDEX, BUILD_DIR, RUNS_DIR, jsBlock
};
