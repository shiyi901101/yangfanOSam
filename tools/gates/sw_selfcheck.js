/* GATE-SW：Service Worker 离线可用性 + 版本纪律自检（2026-10-03 新增）
 * ---------------------------------------------------------------------
 * 为什么单独建这个门禁：
 *   现有 p0_scan.js 只扫 index.html，**sw.js 一直是 P0 盲区**。而 SW 恰恰是
 *   「二次打开秒开 + 断网可用」的唯一承载，且它的失效方式是**静默的**
 *   ——用户在弱网下会「一直看旧版」却毫无报错。故单列门禁，只做**机械可判定**的断言。
 *
 * 断言分三组：
 *   A. 文件与语法：sw.js / manifest.json 存在、可读、JSON 可解析
 *   B. 离线可用性（静态可判部分）：
 *      · SW 注册点在 index.html 内联块里（不在外链，本项目全自包含）
 *      · CORE 清单里**每个路径在仓库中真实存在**（防「清单写了但文件没推」）
 *      · manifest 的 icons[].src 每个都在仓库中存在（防装不上桌面的图标 404）
 *      · manifest.start_url / scope 非空
 *   C. 版本纪律（v2→v3 踩到的点）：
 *      · CACHE 常量必须存在、必须是字符串字面量、必须含 `v<数字>` 版本号
 *      · 每次改 sw.js 行为，CACHE 必须同步递增（这条由人工 review 把关，
 *        门禁只保证「格式合规 + 不退化回无版本号」，并打印当前值供比对）
 *
 * 退出码：0 = 全绿；非 0 = 有断言红。
 * 用法：node tools/gates/sw_selfcheck.js
 * --------------------------------------------------------------------- */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');

const FRONT = P.FRONT_ROOT;
const SW = path.join(FRONT, 'sw.js');
const MF = path.join(FRONT, 'manifest.json');
const INDEX = P.INDEX_HTML;

const T = [];
function chk(name, ok, detail) { T.push({ name: name, ok: !!ok, detail: detail || '' }); }

/* ---------- A. 文件与语法 ---------- */
chk('sw.js 存在', fs.existsSync(SW), SW);
chk('manifest.json 存在', fs.existsSync(MF), MF);

if (!fs.existsSync(SW)) {
  console.log('FATAL: sw.js 不存在，无法继续');
  process.exit(9);
}
const swSrc = fs.readFileSync(SW, 'utf8');

let mf = null, mfErr = '';
try { mf = JSON.parse(fs.readFileSync(MF, 'utf8')); }
catch (e) { mfErr = String(e && e.message || e); }
chk('manifest.json 可 JSON 解析', !!mf, mfErr);

/* ---------- B. 离线可用性 ---------- */
const html = fs.readFileSync(INDEX, 'utf8');

/* B1: SW 注册必须在 index.html 内联块里（本项目全自包含，禁外链） */
chk("index.html 内联注册 sw.js（register('./sw.js'))",
  /serviceWorker[^;]*\.register\(\s*['"]\.\/sw\.js['"]/.test(html),
  '未找到内联注册调用');
chk("index.html 引用 manifest.json",
  /rel=["']manifest["'][^>]*href=["']\.\/manifest\.json["']/.test(html)
  || /href=["']\.\/manifest\.json["'][^>]*rel=["']manifest["']/.test(html),
  '未找到 manifest 链接');

/* B2: CORE 清单每个路径必须真实存在（防「清单写了但文件没推」） */
const coreM = /const\s+CORE\s*=\s*\[([\s\S]*?)\];/.exec(swSrc);
chk('sw.js 存在 CORE 预缓存清单', !!coreM, '未匹配到 const CORE = [...]');
let corePaths = [];
if (coreM) {
  corePaths = (coreM[1].match(/['"]([^'"]+)['"]/g) || [])
    .map(function (s) { return s.slice(1, -1); });
  chk('CORE 清单非空', corePaths.length > 0, 'CORE 数组为空');

  const missing = corePaths.filter(function (p) {
    const rel = p.replace(/^\.\//, '');
    return !fs.existsSync(path.join(FRONT, rel));
  });
  chk('CORE 清单里每个文件在仓库中真实存在', missing.length === 0,
    '缺失: ' + missing.join(', '));

  /* B3: index.html **不应**在 CORE 里（网络优先下预缓存 = 双下载 4.4 MB；
     断网可用性由「成功 fetch 后自动回写」保证）。若有人加回来，这条会提醒。 */
  const inCore = corePaths.filter(function (p) { return /index\.html$/.test(p); });
  chk("CORE 不含 index.html（网络优先下预缓存会双下载）",
    inCore.length === 0,
    'CORE 含 index.html: ' + inCore.join(', '));
}

/* B4: manifest 图标必须真实存在（否则装不了桌面 / 图标 404） */
if (mf && Array.isArray(mf.icons)) {
  const badIcons = mf.icons.filter(function (ic) {
    if (!ic || typeof ic.src !== 'string') return true;
    const rel = ic.src.replace(/^\.\//, '');
    return !fs.existsSync(path.join(FRONT, rel));
  });
  chk('manifest.icons 每个 src 都在仓库中真实存在', badIcons.length === 0,
    '问题图标: ' + JSON.stringify(badIcons.map(function (i) { return i && i.src; })));
  chk('manifest.icons 数量 ≥ 2（含 192/512）', mf.icons.length >= 2,
    'icons 数 = ' + mf.icons.length);
} else {
  chk('manifest.icons 是数组', false, 'icons 缺失或非数组');
}
chk('manifest.start_url 非空', !!(mf && mf.start_url), '');
chk('manifest.scope 非空', !!(mf && mf.scope), '');

/* B5: 「窗口内不自我更新」防护——跳过等待/接管必须有，否则新版要等所有标签页关闭 */
chk("sw.js install 阶段调用 skipWaiting()", /self\.skipWaiting\s*\(/.test(swSrc), '');
chk("sw.js activate 阶段调用 clients.claim()", /self\.clients\.claim\s*\(/.test(swSrc), '');

/* ---------- C. 版本纪律 ---------- */
const cacheM = /const\s+CACHE\s*=\s*(['"])([^'"]+)\1/.exec(swSrc);
chk('CACHE 常量存在且为字符串字面量', !!cacheM,
  cacheM ? '' : '未匹配到 const CACHE = \'...\'');
if (cacheM) {
  const cacheVal = cacheM[2];
  chk('CACHE 值含 v<数字> 版本号（如 yf-os-v3）', /v\d+/.test(cacheVal),
    'CACHE = ' + cacheVal);
  console.log('INFO 当前 CACHE = ' + cacheVal
    + '（改 sw.js 行为时必须递增此版本号，否则老用户拿不到新策略）');
}
const timeoutM = /const\s+NET_TIMEOUT\s*=\s*(\d+)/.exec(swSrc);
chk('NET_TIMEOUT 存在且为正整数', !!timeoutM && Number(timeoutM[1]) > 0,
  timeoutM ? ('NET_TIMEOUT = ' + timeoutM[1] + 'ms') : '未匹配到 const NET_TIMEOUT = <数字>');
if (timeoutM) {
  console.log('INFO 当前 NET_TIMEOUT = ' + timeoutM[1] + 'ms'
    + '（低于 10000 会在跨国弱网下中止下载改读旧缓存，导致新版装不上）');
}

/* ---------- 可选增强（存在即校验，不存在不红——属提示） ---------- */
if (mf) {
  if (!mf.display) console.log('ADVISORY manifest.display 缺失（建议 standalone）');
  if (!mf.theme_color) console.log('ADVISORY manifest.theme_color 缺失');
}

/* ---------- 汇总 ---------- */
const failed = T.filter(function (t) { return !t.ok; });
T.forEach(function (t) {
  /* detail 只在 FAIL 时打印——PASS 时打印会让人误读成「失败原因」。 */
  console.log((t.ok ? 'PASS ' : 'FAIL ') + t.name + ((!t.ok && t.detail) ? ('  ← ' + t.detail) : ''));
});
console.log('\nsw_selfcheck: ' + (failed.length ? ('FAIL ' + failed.length) : 'PASS')
  + ' ' + (T.length - failed.length) + '/' + T.length);
if (failed.length) {
  failed.forEach(function (t) { console.log('  FAIL 详情: ' + t.name + ' ← ' + t.detail); });
}
process.exitCode = failed.length ? 1 : 0;
