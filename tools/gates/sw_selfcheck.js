/* GATE-SW：Service Worker 离线可用性 + 版本纪律自检（2026-10-03 新增）
 * ---------------------------------------------------------------------
 * 为什么单独建这个门禁：
 *   现有 p0_scan.js 只扫 index.html，**sw.js 一直是 P0 盲区**。而 SW 恰恰是
 *   「二次打开秒开 + 断网可用」的唯一承载，且它的失效方式是**静默的**
 *   ——用户在弱网下会「一直看旧版」却毫无报错。故单列门禁，只做**机械可判定**的断言。
 *
 * 断言分四组：
 *   A. 文件与语法：sw.js / manifest.json 存在、可读、JSON 可解析
 *   B. 离线可用性（静态可判部分 + 🔴 策略防回归）：
 *      · SW 注册点在 index.html 内联块里（不在外链，本项目全自包含）
 *      · CORE 清单里**每个路径在仓库中真实存在**（防「清单写了但文件没推」）
 *      · manifest 的 icons[].src 每个都在仓库中存在（防装不上桌面的图标 404）
 *      · manifest.start_url / scope 非空
 *      · **B6–B9 导航分支必须「缓存优先」**——这是断网可用的唯一根本保证。
 *        历史教训：曾用网络优先，导致导航响应从未入缓存，断网可用全靠 HTTP 磁盘缓存
 *        （GitHub 只给 max-age=600）⇒ 超过 10 分钟断网即打不开。退回网络优先 = 静默退化。
 *      · B10 SW 注册必须带 https 协议判断（兼作测试纪律：本地 http 测不到 SW）
 *   C. 版本纪律（v2→v3 踩到的点）：
 *      · CACHE 常量必须存在、必须是字符串字面量、必须含 `v<数字>` 版本号
 *      · 每次改 sw.js 行为，CACHE 必须同步递增（这条由人工 review 把关，
 *        门禁只保证「格式合规 + 不退化回无版本号」，并打印当前值供比对）
 *   D. 部署风险提示（不红，仅 INFO/ADVISORY）
 *
 * ⚠️ 本门禁只做**静态**断言。运行时的「缓存真的落盘了吗」由
 *    output/_scratch/_sw_accept_v4.js 线上 CDP 验收覆盖（不进门禁是因为需联网）。
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

  /* B3: index.html **不应**在 CORE 里。
     理由：install 阶段预缓存 index.html 会在首次访问时**双下载** 4.4 MB
     （预缓存一次 + 导航一次），对 20 站跨国弱网是净负收益。
     断网可用性由 fetch 处理器的「缓存优先 + 后台回写」保证（见 B6/B7）。 */
  const inCore = corePaths.filter(function (p) { return /index\.html$/.test(p); });
  chk("CORE 不含 index.html（install 预缓存会双下载 4.4MB）",
    inCore.length === 0,
    'CORE 含 index.html: ' + inCore.join(', '));
}

/* B6: 🔴 导航分支必须是「缓存优先」——**这是断网可用的唯一根本保证**。
   历史教训（2026-10-03 实测）：曾用「网络优先」实现，结果导航请求**从未被写进缓存**
   （缓存里只有 CORE 的 4 个图标），断网能用全靠 Chromium HTTP 磁盘缓存，
   而 GitHub Pages 只给 `Cache-Control: max-age=600` ⇒ **超过 10 分钟断网即打不开**。
   ⇒ 任何人把导航分支改回纯网络优先，都是在悄悄退回到「10 分钟离线窗口」。
   判据：导航分支内必须先做 `cache.match`，且命中时**直接 return 缓存**
        （不是「拿缓存放旁边、等网络回来再决定」）。 */
const navBranch = /if\s*\(\s*isDoc\s*\)\s*\{[\s\S]*?e\.respondWith\([\s\S]*?\n\s{2,4}\}/.exec(swSrc);
const navSrc = navBranch ? navBranch[0] : swSrc;
{
  const hasMatch = /cache\.match\s*\(/.test(navSrc);
  const returnsCached = /if\s*\(\s*cached\s*\)\s*\{[\s\S]{0,120}?return\s+cached/.test(navSrc);
  chk('B6 导航分支先读缓存（cache.match 在 fetch 之前）',
    hasMatch,
    'isDoc 分支内未找到 cache.match —— 缓存优先策略丢失，断网窗口会退化到 10 分钟');
  chk('B7 导航分支命中缓存时直接返回缓存（缓存优先，非网络优先）',
    returnsCached,
    '未找到 `if (cached) { … return cached }` —— 疑似退回网络优先，断网可用性不成立');
  /* B8: 无缓存时必须显式 await 回写，保证首次访问一定落盘 */
  chk('B8 首次访问（无缓存）会等待网络结果并回写',
    /const\s+fresh\s*=\s*await\s+bg/.test(navSrc) || /return\s+fresh/.test(navSrc),
    '未找到「首次访问显式等待网络」的分支 —— 首次访问可能不入缓存');
  /* B9: 首次访问 + 断网必须有可读兜底页，不能是空白 */
  chk('B9 首次访问 + 断网有可读的 503 兜底页',
    /status\s*:\s*503/.test(navSrc) && !/e\.respondWith\(\s*Response\.error/.test(navSrc),
    '未找到 503 兜底页 —— 首次断网会白屏');
}

/* B10: SW 注册**必须只在 https 下进行**（本地 http 调试不注册，避免测试期缓存干扰）。
   这条同时是一条**测试纪律**：本地 http 复现 SW 行为**永远测不到**（会得到 no-reg），
   必须线上 https 或本地起 https。此断言防止有人误删这个协议判断。 */
chk('B10 index.html 中 SW 注册有 https 协议判断',
  /location\.protocol\s*!==\s*['"]https:['"]/.test(html),
  '未找到 `location.protocol!==\'https:\'` 判断 —— 本地 http 会意外注册 SW');

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
/* C3: NET_TIMEOUT —— **条件断言**。
   v3.1 起导航分支改为「缓存优先」，该常量已无调用方（netFirst 改为收 ms 参数）。
   故此处**只在其存在时校验格式**，不存在不红——避免门禁逼迫保留死代码。
   ⚠️ 若将来有人删掉 netFirst 却保留 NET_TIMEOUT，或反过来，都属正常重构范围。 */
const timeoutM = /const\s+NET_TIMEOUT\s*=\s*(\d+)/.exec(swSrc);
if (timeoutM) {
  chk('NET_TIMEOUT 存在时为正整数', Number(timeoutM[1]) > 0, 'NET_TIMEOUT = ' + timeoutM[1]);
  console.log('INFO 当前 NET_TIMEOUT = ' + timeoutM[1] + 'ms');
} else {
  console.log('INFO NET_TIMEOUT 不存在（v3.1 缓存优先后已无调用方，属预期）');
}
/* netFirst 若存在，必须是纯函数（不注册监听器、不调用 respondWith）——防有人把它接进事件流 */
if (/function\s+netFirst\s*\(/.test(swSrc)) {
  chk('netFirst 是纯函数（不注册监听器 / 不调用 respondWith）',
    !/addEventListener/.test(/function\s+netFirst\s*\([\s\S]*?\n\}/.exec(swSrc)[0])
    && !/respondWith/.test(/function\s+netFirst\s*\([\s\S]*?\n\}/.exec(swSrc)[0]),
    'netFirst 内部出现 addEventListener / respondWith —— 已不再是纯函数');
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
