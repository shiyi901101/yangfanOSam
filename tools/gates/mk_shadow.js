/* 构建「隔离门禁车道」v3：每次生成一个全新影子后端目录（virgin store），并**逐字节校验**从真实
   `yangfan-cloud/yf-api` 拷来的 index.js —— 影子目录只是运行期产物，绝不手工维护、绝不派生第二份代码。

   为什么必须 virgin-per-run：
     · v1 复用同一个影子目录，复跑时依赖 startBackend() 内的 rmSync 删库；Windows 上只要上一轮后端
       仍持有句柄，删除就 EBUSY/EPERM（被 catch 吞掉），复跑会在 POST /bootstrap 处报「系统已初始化」。
     · 换成每轮新目录后 store 天然不存在，删除成为 ENOENT 空操作，任何锁都无从谈起。

   为什么必须 md5 校验（v3 新增）：
     本项目已经出过一次「手工维护的副本静默漂移」事故——`扬帆OS_学习系统v5.html` 是 index.html 的
     手工副本，已漂移 25 字节（连 CSS 都不同），现在是个诱饵。校验失败即硬失败，不让影子变成第二个诱饵。

   为什么不再派生 `_r2b_e2e_isolated.js`（v3 删除）：
     那份副本曾是 e2e_dual_role.js 的改写版，两份断言体迟早静默漂移、最后没人知道哪份是真的。
     现在 e2e_dual_role.js 自己读环境变量 `YF_API_DIR` / `YF_TEST_PORT`，**只此一份**。

   本脚本不做任何越界修改：只读真实 index.js（拷贝 + 校验）、只在 os.tmpdir() 下写自有目录。
   输出：最后一行固定为 `SHADOW=<绝对路径>`，供 run_gates_iso.sh 提取。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');   /* 路径唯一权威出口：REAL/RUNS 全部 __dirname/tmp 基，无硬编码绝对路径 */

const REAL = P.YF_API_DIR_DEFAULT;   /* 工作区仓库的真实后端（md5 校验的比对基准） */
const RUNS = P.RUNS_DIR;             /* 影子运行目录 → os.tmpdir()，绝不落仓库 */
const KEEP = 3;

const log = [];
function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

const SHADOW = path.join(RUNS, 'run_' + Date.now());
fs.mkdirSync(SHADOW, { recursive: true });

/* 1) 拷贝后端代码（每次运行前重新生成，绝不手工维护） */
const REAL_JS = path.join(REAL, 'index.js');
const REAL_PKG = path.join(REAL, 'package.json');
const SHD_JS = path.join(SHADOW, 'index.js');
fs.copyFileSync(REAL_JS, SHD_JS);
fs.copyFileSync(REAL_PKG, path.join(SHADOW, 'package.json'));

/* 2) 逐字节校验：影子 index.js 必须与真实 index.js 完全一致 */
const mReal = md5(REAL_JS), mShd = md5(SHD_JS);
if (mReal !== mShd) {
  console.log('FATAL: 影子 index.js 与真实 index.js 不一致（md5 ' + mShd + ' != ' + mReal + '）');
  process.exit(3);
}
log.push('virgin shadow: ' + SHADOW);
log.push('  index.js bytes=' + fs.statSync(SHD_JS).size + ' md5=' + mShd + '（与真实逐字节一致 ✓）');
log.push('  store: yf_data.json=' + fs.existsSync(path.join(SHADOW, 'yf_data.json')) + ' yf_data_v1=' + fs.existsSync(path.join(SHADOW, 'yf_data_v1')) + '（virgin，无需删除）');

/* 3) node_modules 用 junction 借用真实目录（不复制 300MB） */
try { fs.symlinkSync(path.join(REAL, 'node_modules'), path.join(SHADOW, 'node_modules'), 'junction'); }
catch (e) {
  if (e.code === 'EEXIST') { /* 已存在即可 */ }
  else { console.log('FATAL: node_modules junction 创建失败（影子跑不起来，别让它伪装成断言失败）: ' + e.message); process.exit(3); }
}

/* 4) 只保留最近 KEEP 个 run 目录，避免堆积 */
try {
  const dirs = fs.readdirSync(RUNS).filter(function (d) { return d.indexOf('run_') === 0; }).sort();
  dirs.slice(0, Math.max(0, dirs.length - KEEP)).forEach(function (d) {
    try { fs.rmSync(path.join(RUNS, d), { recursive: true, force: true }); } catch (e) {}
  });
} catch (e) {}

console.log(log.join('\n'));
console.log('SHADOW=' + SHADOW);
