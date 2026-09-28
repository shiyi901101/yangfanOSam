/* =====================================================================
 * 扬帆OS 双角色端到端门禁（e2e_dual_role.js）
 * =====================================================================
 * 目的：每次交付前，管理端（testadmin）与浆站负责人端（王养运/五河）两条
 *       链路必须全部 PASS 才许交付。本脚本用【真实 index.html 前端】+【真实
 *       本地 yf-api 后端】跑通 16 个场景（A1-A6 / S1-S10；S9=已过截止月锁定正路；
 *       S10=论坛管理独立模块（admin 四分区渲染 + station 直访拦截）+ 私信「发起新会话」闭环）。
 *
 * 运行方法（任意 cwd 均可，路径全部 __dirname 基；推荐直接跑 tools/gates/run_gates_iso.sh）：
 *   1) 无需手动起后端——脚本自起/自清/自造数据/自杀进程；
 *   2) 命令：
 *        node yangfan-os-ghpages/tools/gates/e2e_dual_role.js            （门禁模式：任一 FAIL 退出码非 0）
 *        node yangfan-os-ghpages/tools/gates/e2e_dual_role.js --baseline （基线模式：只汇总，不改变退出码）
 *
 * 环境要求：
 *   - jsdom 装在受管 workspace（严禁全局安装）：
 *       cd C:\Users\Administrator\.workbuddy\binaries\node\workspace && npm install jsdom
 *   - Windows 下杀后端：taskkill /PID <pid> /T /F（脚本已自动处理，另用
 *     netstat 兜底清理目标端口残留进程）。
 *
 * 车道（v3）：后端目录与端口由环境变量注入，只此一份脚本、不再派生副本——
 *   YF_API_DIR   后端目录，默认 <repo>/yangfan-cloud/yf-api（canonical 车道）
 *   YF_TEST_PORT 后端端口，默认 9001（隔离车道用 9101 + virgin shadow store）
 * 例：YF_API_DIR=<shadow> YF_TEST_PORT=9101 node e2e_dual_role.js
 *
 * 注意：本脚本不改前端/后端任何代码逻辑；只写测试数据
 *   （yf_data.json / yf_data_v1/ 每次运行前删除重建，stations 由脚本播种）。
 *   清库后**硬校验 store 内容为空**，非空即非零退出——被污染的 store 会产生假绿，不做警告放行。
 *   上报月份动态判定（2026-09-27 收口）：真实时钟无开放月时，仅向自起后端注入
 *   YF_TEST_NOW 测试时钟环境变量（生产不设该变量，恒为真实时钟）。
 * ===================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

/* ---------- 路径（__dirname 基，唯一出口 paths.js；不依赖 cwd） ---------- */
const P = require('./paths');
const HTML = P.INDEX_HTML;
/* 后端目录与端口可由环境变量注入（YF_API_DIR / YF_TEST_PORT），默认即 canonical 车道
   （工作区仓库的 yangfan-cloud/yf-api，由 paths.js 向上查找）。
   只保留这一份 e2e——不再派生手工维护的孤立副本：两份迟早静默漂移，最后没人知道哪份是真的。 */
const YF_API_DIR = process.env.YF_API_DIR ? path.resolve(process.env.YF_API_DIR) : P.YF_API_DIR_DEFAULT;
const NODE_PATH_VAL = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules';
const { JSDOM } = require(path.join(NODE_PATH_VAL, 'jsdom'));

/* ---------- 常量 ---------- */
const PORT = String(process.env.YF_TEST_PORT || '9001');
const BASE = 'http://127.0.0.1:' + PORT;
const CLOUD_PREFIX = 'https://yangfan1012-d5gtfsfwn507451df.service.tcloudbase.com';
const APP_TOKEN = 'yf-cloud-2026-shiyi';
const ADMIN = { username: 'testadmin', password: 'test123456' };
const STATION_ACC = { username: '王养运', password: 'sc1012', role: 'station', station: '五河' };
const BASELINE = process.argv.indexOf('--baseline') >= 0;

/* 五河 2026-06 / 2026-07 合法上报样例（同 tools/v1-regression-test.js 口径） */
const SEED_JUNE = { reg: [90, 60, 40], dev: [80, 900, 0, 120, 50], camp: [40, 22, 18], par: [30, 0.75], ext: [0, null] };
const SEED_JULY = { reg: [260, 207, 82], dev: [291, 2093, 0, 218, 115], camp: [82, 45, 37], par: [65, 0.8], ext: [0, null] };

/* ---------- 动态开放月（2026-09-27 收口，根治「随真实日期推移必然 403」） ----------
   老写法硬编码提交 2026-08：8 月宽限期（截止 9-10 + 7 天 = 9-17）一过，S6 必然 403 month_locked。
   现改为与后端 deadlineFor/LATE_GRACE_DAYS 同源规则动态判定：
   - 真实时钟下当年夏季季末月（08）仍开放 → 用真实时钟，e2e 测的就是当前真实开放链路；
   - 真实时钟下无开放月（如 9 月下旬～来年 5 月）→ 启动后端时注入 YF_TEST_NOW 测试时钟
     （仅测试路径；生产不设该变量恒为真实时钟），统一按「当年 08-15」判定。
   S6 场景语义是「季末月（含运营天数行）开放提交成功」，故提交月恒取夏季季末 08；
   S9 锁定月取其前一季内月 07——08 开放时 07 必然已过截止+宽限，两种时钟下语义都成立。 */
const E2E_Y = new Date().getFullYear();
function e2ePad2(n) { return (n < 10 ? '0' : '') + n; }
function e2eDeadlineFor(month) { /* 镜像后端 deadlineFor：次月 5 日 18:00，8 月放宽至 9-10 18:00，周末顺延（HOLIDAYS 现为空表） */
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  let due = (e2ePad2(m) === '08') ? new Date(y, m, 10, 18, 0, 0) : new Date(y, m, 5, 18, 0, 0);
  let guard = 0;
  while (guard++ < 30) {
    const dow = due.getDay();
    if (dow !== 0 && dow !== 6) break;
    due = new Date(due.getTime() + 86400000);
  }
  return due;
}
function e2eMonthOpen(month, nowMs) { /* 截止+7 天宽限未过，且不是未来月（与后端 monthWindowError 同源） */
  const d = new Date(nowMs);
  if (month > (d.getFullYear() + '-' + e2ePad2(d.getMonth() + 1))) return false;
  return e2eDeadlineFor(month).getTime() + 7 * 86400000 >= nowMs;
}
let TEST_NOW = null;
if (!e2eMonthOpen(E2E_Y + '-08', Date.now())) TEST_NOW = E2E_Y + '-08-15';
const E2E_EFF_NOW = TEST_NOW ? Date.parse(TEST_NOW) : Date.now();
const OPEN_MONTH = E2E_Y + '-08';    /* S6 提交月（季末月，含运营天数） */
const LOCKED_MONTH = E2E_Y + '-07';  /* S9 锁定月（已过截止+7 天宽限） */

/* ---------- 结果收集 ---------- */
const RESULTS = [];
function report(id, name, status, detail) {
  RESULTS.push({ id, name, status, detail: detail || '' });
  const mark = status === 'PASS' ? '✓ PASS' : status === 'SKIP' ? '- SKIP' : '✗ FAIL';
  console.log(`  [${mark}] ${id} ${name}${detail ? ' ｜ ' + String(detail).slice(0, 300) : ''}`);
}

/* ---------- 小工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > (timeout || 6000)) throw new Error('waitFor 超时: ' + (label || ''));
    await sleep(80);
  }
}
function stripDi(s) { return String(s || '').replace(/\s+/g, ''); }

/* ---------- 后端生命周期 ---------- */
let backendChild = null;
function killPortResidue() {
  try {
    const out = execSync('netstat -ano | findstr :' + PORT + ' | findstr LISTENING', { shell: 'cmd.exe' }).toString();
    const pids = new Set(out.split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p)));
    pids.forEach(pid => { try { execSync(`taskkill /PID ${pid} /T /F`, { shell: 'cmd.exe' }); } catch (e) {} });
    if (pids.size) console.log('  [env] 清理 ' + PORT + ' 端口残留进程: ' + [...pids].join(','));
  } catch (e) { /* 无监听即可 */ }
}
async function startBackend() {
  /* 1) 先清残留实例，再清历史数据 —— 顺序不可反（fe-growth-r2 门禁可复跑修复，2026-09-28）
     踩坑记录：旧顺序是「先 rmSync 后 killPortResidue」。上一轮后端进程仍持有 yf_data.json / yf_data_v1
     的句柄时，rmSync 抛 EBUSY/EPERM 被 `catch (e) {}` 吞掉 → 清库静默失败 → 新实例读到上一轮的账号
     → POST /bootstrap 返回「系统已初始化，无法重复初始化」→ 整轮门禁在前置就假失败（且每次都要人工
     干预才能再跑）。实测：错误顺序下 exists=true（清库没发生），正确顺序下 exists=false。
     所以：先 killPortResidue()，再删；删除带重试；清不干净就显式告警，不让脏环境伪装成代码回归。 */
  killPortResidue();
  const _rmF = path.join(YF_API_DIR, 'yf_data.json');
  const _rmD = path.join(YF_API_DIR, 'yf_data_v1');
  for (let _i = 0; _i < 3; _i++) {
    try { fs.rmSync(_rmF, { force: true }); } catch (e) {}
    try { fs.rmSync(_rmD, { recursive: true, force: true }); } catch (e) {}
    if (!fs.existsSync(_rmF) && !fs.existsSync(_rmD)) break;
    await sleep(250);
  }
  /* 清库后必须**硬校验 store 内容为空**——只看"目录是否存在"不够：
     本项目的 store 已被证实会被并发 lane 污染（yf_data.json 里查到过只在 joint_fb3.js 出现的种子文案
     「五河王养运」）。一个被污染的 store 正是产生**假绿**的途径，所以这里不做"警告放行"。
     注意：「bootstrap 播种成功」只能证明 accounts 为空，证明不了 dash/forum 等集合干净，
     因此它不作为隔离成立的证据。 */
  const _storeDirty = (function () {
    const f = path.join(YF_API_DIR, 'yf_data.json');
    if (fs.existsSync(f)) {
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        const nonEmpty = Object.keys(j || {}).filter(k => {
          const v = j[k];
          if (Array.isArray(v)) return v.length > 0;
          if (v && typeof v === 'object') return Object.keys(v).length > 0;
          return false;                       /* 标量（rev / updatedAt）不算脏 */
        });
        if (nonEmpty.length) return 'yf_data.json 仍有非空集合: ' + nonEmpty.join(',');
      } catch (e) { return 'yf_data.json 存在但不可解析（脏数据）: ' + e.message; }
    }
    const d = path.join(YF_API_DIR, 'yf_data_v1');
    if (fs.existsSync(d)) {
      /* 站点表是下一步主动播种的，不算脏；其余任何业务集合文件都算脏 */
      const bad = fs.readdirSync(d).filter(n => /\.json$/i.test(n) && !/^yf-data__stations\.json$/i.test(n));
      if (bad.length) return 'yf_data_v1 残留业务集合文件: ' + bad.join(',');
    }
    return '';
  })();
  if (_storeDirty) {
    console.log('  [env] 致命：隔离校验未通过 —— ' + _storeDirty);
    console.log('  [env] 本轮结果不可信，直接非零退出（不做"警告放行"：被污染的 store 正是产生假绿的途径）');
    process.exit(3);
  }
  console.log('  [env] 隔离校验通过：store 内容为空（yf_data.json 无 / 集合皆空；yf_data_v1 无业务文件）');
  /* 2) 播种站点表（后端无内置种子，本地测试需 yf-data/stations.json） */
  const seedDir = path.join(YF_API_DIR, 'yf_data_v1');
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'yf-data__stations.json'), JSON.stringify({
    rev: 1, updatedAt: Date.now(),
    stations: [
      { name: '五河', slug: 'wuhe' },
      { name: '凤台', slug: 'fengtai' }
    ]
  }, null, 2));
  /* 3) 起服务（TEST_NOW 非空 = 真实时钟下无开放月，注入 YF_TEST_NOW 测试时钟；后端仅测试路径读它，生产恒为真实时钟） */
  backendChild = spawn(process.execPath, ['index.js'], {
    cwd: YF_API_DIR,
    env: Object.assign({}, process.env, { YF_LOCAL: '1', ZHIPU_KEY: 'local-test-dummy', PORT: PORT, NODE_PATH: NODE_PATH_VAL }, TEST_NOW ? { YF_TEST_NOW: TEST_NOW } : {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  backendChild.stdout.on('data', d => { bootLog += d; });
  backendChild.stderr.on('data', d => { bootLog += d; });
  backendChild.on('exit', c => { if (c && c !== 0) console.log('  [env] 后端提前退出 code=' + c + '\n' + bootLog.slice(-800)); });
  /* 4) 等就绪 */
  await waitFor(async () => {
    const r = await fetch(BASE + '/status', { headers: { 'X-App-Token': APP_TOKEN } });
    const j = await r.json();
    return j && j.ok === true;
  }, 15000, '后端启动');
  console.log('  [env] 后端已就绪 ' + BASE + '（开放月=' + OPEN_MONTH + ' · 锁定月=' + LOCKED_MONTH + ' · 时钟=' + (TEST_NOW ? '注入 YF_TEST_NOW=' + TEST_NOW : '真实') + '）');
}
async function stopBackend() {
  if (backendChild && backendChild.pid) {
    try { execSync(`taskkill /PID ${backendChild.pid} /T /F`, { shell: 'cmd.exe' }); } catch (e) { try { backendChild.kill(); } catch (_) {} }
    backendChild = null;
  }
  killPortResidue();
}

/* ---------- 造数据（纯 API） ---------- */
async function api(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json', 'X-App-Token': APP_TOKEN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}
async function seedData() {
  let r = await api('POST', '/bootstrap', { username: ADMIN.username, password: ADMIN.password });
  if (!r.j || !r.j.ok) throw new Error('bootstrap 失败: ' + JSON.stringify(r.j));
  const tk = r.j.token;
  r = await api('POST', '/accounts', STATION_ACC, tk);
  if (!r.j || !r.j.ok) throw new Error('创建站点账号失败: ' + JSON.stringify(r.j));
  r = await api('POST', '/v1/dash/records', { station: '五河', month: '2026-06', src: 'form', metrics: SEED_JUNE }, tk);
  if (r.status !== 200) throw new Error('播种 2026-06 失败: ' + JSON.stringify(r.j));
  r = await api('POST', '/v1/dash/records', { station: '五河', month: '2026-07', src: 'form', metrics: SEED_JULY }, tk);
  if (r.status !== 200) throw new Error('播种 2026-07 失败: ' + JSON.stringify(r.j));
  return tk;
}

/* ---------- jsdom 场景环境 ---------- */
async function makeBrowser(opts) {
  opts = opts || {};
  const dom = await JSDOM.fromFile(HTML, {
    runScripts: 'dangerously',
    resources: undefined,            // 不加载外部资源（页面无外部脚本，全 inline）
    url: 'http://localhost/',        // 让 localStorage 生效
    pretendToBeVisual: true,
    beforeParse(window) {
      /* 残留状态注入（A6 用）：注意真实 key 是 yf_mystation（历史上曾误写 yf_station，两个都预置） */
      if (opts.presetStorage) Object.keys(opts.presetStorage).forEach(k => {
        try { window.localStorage.setItem(k, opts.presetStorage[k]); } catch (e) {}
      });
      /* fetch 劫持：云端前缀改写到本地真实后端（端口取自 YF_TEST_PORT，默认 9001），其余照发；headers（含 X-App-Token）原样透传 */
      const nodeFetch = global.fetch;
      window.fetch = function (input, init) {
        try {
          let url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.indexOf(CLOUD_PREFIX) === 0) {
            url = BASE + url.slice(CLOUD_PREFIX.length);
            input = url;
          }
        } catch (e) {}
        return nodeFetch.call(global, input, init);
      };
      /* jsdom 缺失 API stub */
      if (!window.matchMedia) window.matchMedia = function (q) {
        return { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      };
      if (!window.scrollTo) window.scrollTo = function () {};
    }
  });
  const win = dom.window;
  /* toast 侦听：页面 toast 是函数声明，运行时查 window.toast，包一层即可截获 */
  await waitFor(() => typeof win.toast === 'function', 5000, 'toast 定义');
  const origToast = win.toast;
  win.__toasts = [];
  win.toast = function (m) { try { win.__toasts.push(String(m)); } catch (e) {} return origToast.call(win, m); };
  win.__errs = [];
  win.addEventListener('error', e => { try { win.__errs.push(String(e.message)); } catch (x) {} });
  /* 等登录引导完成（lgBoot → /status），避免 yfNeedBootstrap 判错 */
  await sleep(500);
  return { dom, win, doc: win.document };
}

/* 页面内登录（走真实 lgLogin → 真实后端 /login 或 /bootstrap） */
async function pageLogin(env, username, password) {
  const { win, doc } = env;
  const u = doc.getElementById('lgUser'), p = doc.getElementById('lgPwd');
  if (!u || !p) throw new Error('登录表单不存在（#lgUser/#lgPwd）');
  u.value = username; p.value = password;
  win.lgLogin();
  await waitFor(() => {
    try { return win.localStorage.getItem('yf_token'); } catch (e) { return null; }
  }, 8000, '登录 token 写入');
  await sleep(400); /* 等 yfEnter/yfFilterNav 完成 */
}

/* =====================================================================
 * 场景实现
 * ===================================================================== */

/* ---------- 管理端 ---------- */
async function scA1() { /* 登录后中台总览正常渲染 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    env.win.applyTab('hq');
    await sleep(200);
    const body = env.doc.getElementById('hqBody');
    const txt = body ? body.textContent : '';
    if (txt.indexOf('中台总览仅管理员可见') >= 0) return report('A1', '管理端中台总览渲染', 'FAIL', '#hqBody 出现锁定文案');
    const hasKpi = /能力健康站|入营总规模|风险站|经验复用率/.test(txt) && /\d/.test(txt);
    if (!hasKpi) return report('A1', '管理端中台总览渲染', 'FAIL', '#hqBody 无 KPI 渲染内容，实际前 120 字: ' + stripDi(txt).slice(0, 120));
    report('A1', '管理端中台总览渲染', 'PASS');
  } catch (e) { report('A1', '管理端中台总览渲染', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scA2() { /* 经验对标正常渲染 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    env.win.applyTab('exp');
    await sleep(200);
    const body = env.doc.getElementById('expBody');
    const txt = body ? body.textContent : '';
    if (txt.indexOf('经验对标仅管理员可见') >= 0) return report('A2', '管理端经验对标渲染', 'FAIL', '#expBody 出现锁定文案');
    if (txt.indexOf('对标两站') < 0 || !env.doc.getElementById('expA') || !env.doc.getElementById('expB')) return report('A2', '管理端经验对标渲染', 'FAIL', '#expBody 无「对标两站」选择器');
    report('A2', '管理端经验对标渲染', 'PASS');
  } catch (e) { report('A2', '管理端经验对标渲染', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scA3() { /* 我的成长：管理员可切站 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    env.win.applyTab('rhythm');
    await sleep(200);
    const sel = env.doc.getElementById('gwStation');
    if (!sel) return report('A3', '管理端成长台可切站', 'FAIL', '#gwStation 不存在');
    if (sel.disabled) return report('A3', '管理端成长台可切站', 'FAIL', '#gwStation 被禁用（管理员应可切换）');
    const opts = [...sel.options].map(o => o.value);
    if (opts.length < 2) return report('A3', '管理端成长台可切站', 'FAIL', '选项数 ' + opts.length + '，应多站可选');
    const before = (env.doc.getElementById('gwWho') || {}).textContent || '';
    const gwBefore = (env.doc.getElementById('gwBody') || {}).innerHTML || '';
    const other = opts.find(v => v !== sel.value);
    sel.value = other;
    if (typeof sel.onchange === 'function') sel.onchange(); else sel.dispatchEvent(new env.win.Event('change'));
    await sleep(250);
    const after = (env.doc.getElementById('gwWho') || {}).textContent || '';
    const gwAfter = (env.doc.getElementById('gwBody') || {}).innerHTML || '';
    if (sel.value !== other) return report('A3', '管理端成长台可切站', 'FAIL', '切换后 sel.value=' + sel.value + '，期望 ' + other);
    if (before === after && gwBefore === gwAfter) return report('A3', '管理端成长台可切站', 'FAIL', '切换站点后内容未重渲染');
    report('A3', '管理端成长台可切站', 'PASS', '切换 ' + opts[0] + ' → ' + other);
  } catch (e) { report('A3', '管理端成长台可切站', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scA4() { /* 管理端看不到上报表单入口 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    await sleep(200);
    const reb = env.doc.getElementById('rpEntryBar');
    const rebHidden = !reb || reb.style.display === 'none';
    if (!rebHidden) return report('A4', '管理端无上报表单入口', 'FAIL', 'rpEntryBar 隐藏=' + rebHidden);
    /* 承诺兑现块仅 station（方案 v1.1 §3.4，本轮新增权威断言）：admin 下 #srPromise 容器不得存在——不是隐藏，是不产生 */
    try { env.win.GW_TAB = 'diag'; env.win.gwPaint(); await sleep(150); } catch (e) { }
    const prAdmin = env.doc.getElementById('srPromise');
    if (prAdmin) return report('A4', '管理端无上报表单入口', 'FAIL', 'admin 下不应存在 #srPromise 容器（实际存在）');
    const stAd = (() => { try { return env.win.gwSt(); } catch (e) { return null; } })();
    if (stAd && (() => { try { return env.win.gwDiag(stAd); } catch (e) { return ''; } })().indexOf('id="srPromise"') >= 0)
      return report('A4', '管理端无上报表单入口', 'FAIL', 'admin 下 gwDiag 仍输出 #srPromise 占位（应被 yfIsStation() 门控）');
    report('A4', '管理端无上报表单入口', 'PASS');
  } catch (e) { report('A4', '管理端无上报表单入口', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scA5() { /* 中台总览成效总览卡 KPI 元素 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    env.win.applyTab('hq');
    await sleep(200);
    const ids = ['hqStations', 'hqNps', 'hqRisk'];
    const missing = ids.filter(id => !env.doc.getElementById(id));
    if (missing.length) return report('A5', '中台总览成效总览卡 KPI', 'FAIL', '缺少元素: ' + missing.join(','));
    const vals = ids.map(id => stripDi(env.doc.getElementById(id).textContent));
    if (vals.every(v => v === '—' || v === '')) return report('A5', '中台总览成效总览卡 KPI', 'FAIL', '值全为「—」: ' + JSON.stringify(vals));
    report('A5', '中台总览成效总览卡 KPI', 'PASS', 'hqStations=' + vals[0] + ' hqNps=' + vals[1] + ' hqRisk=' + vals[2]);
  } catch (e) { report('A5', '中台总览成效总览卡 KPI', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scA6() { /* 残留 station 状态 → admin 登录后锁应消失 */
  const env = await makeBrowser({ presetStorage: {
    yf_role: 'station', yf_mystation: '五河', yf_station: '五河'
  } });
  try {
    /* 预置一个真实 station token，让 boot 校验通过、页面进入负责人锁定态 */
    const lg = await api('POST', '/login', { username: STATION_ACC.username, password: STATION_ACC.password });
    if (!lg.j || !lg.j.ok) throw new Error('预置 station 登录失败');
    env.win.localStorage.setItem('yf_token', lg.j.token);
    /* 重新触发 boot 校验/进入：直接调 yfVerifyToken+yfEnter 等价于刷新页面后的恢复路径 */
    await sleep(300);
    const me = await env.win.yfVerifyToken(lg.j.token);
    if (me && me.ok) env.win.yfEnter({ role: me.role, station: me.station, username: me.username }, lg.j.token);
    await sleep(300);
    /* 不刷新页面，直接 admin 登录 */
    await pageLogin(env, ADMIN.username, ADMIN.password);
    env.win.applyTab('hq');
    await sleep(250);
    const txt = (env.doc.getElementById('hqBody') || {}).textContent || '';
    if (txt.indexOf('中台总览仅管理员可见') >= 0) return report('A6', '残留状态恢复(admin登录修复)', 'FAIL', '登录后未重渲染，锁定文案残留');
    report('A6', '残留状态恢复(admin登录修复)', 'PASS');
  } catch (e) { report('A6', '残留状态恢复(admin登录修复)', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}

/* ---------- 负责人端 ---------- */
async function scS1() { /* 侧栏 admin-only 按钮隐藏 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const hqBtn = env.doc.querySelector('.sb-item[data-tab="hq"], nav button[data-tab="hq"]');
    const expBtn = env.doc.querySelector('.sb-item[data-tab="exp"], nav button[data-tab="exp"]');
    const faBtn = env.doc.querySelector('.sb-item[data-tab="forumadmin"], nav button[data-tab="forumadmin"]');
    const bad = [];
    if (!hqBtn || hqBtn.style.display !== 'none') bad.push('hq按钮 display=' + (hqBtn ? hqBtn.style.display : '缺失'));
    if (!expBtn || expBtn.style.display !== 'none') bad.push('exp按钮 display=' + (expBtn ? expBtn.style.display : '缺失'));
    if (!faBtn || faBtn.style.display !== 'none') bad.push('forumadmin按钮 display=' + (faBtn ? faBtn.style.display : '缺失'));
    if (bad.length) return report('S1', '负责人端侧栏隐藏管理模块', 'FAIL', bad.join('；'));
    report('S1', '负责人端侧栏隐藏管理模块', 'PASS');
  } catch (e) { report('S1', '负责人端侧栏隐藏管理模块', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scS2() { /* 直接 applyTab('hq') 被拦截 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    env.win.__toasts.length = 0;
    env.win.applyTab('hq');
    await sleep(250);
    const activeHq = env.doc.querySelector('section#hq.active');
    const toasts = env.win.__toasts.join('|');
    if (activeHq) return report('S2', '负责人端直访中台被拦截', 'FAIL', 'hq section 仍处于激活态');
    const blocked = toasts.indexOf('仅管理') >= 0 || (env.win.localStorage.getItem('yangfan_lasttab') !== 'hq');
    if (!blocked) return report('S2', '负责人端直访中台被拦截', 'FAIL', '既无拦截 toast 也未回退（lasttab=' + env.win.localStorage.getItem('yangfan_lasttab') + '）');
    report('S2', '负责人端直访中台被拦截', 'PASS', 'toast: ' + toasts.slice(0, 60));
  } catch (e) { report('S2', '负责人端直访中台被拦截', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scS3() { /* 成长台锁本人站 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    env.win.applyTab('rhythm');
    await sleep(250);
    const sel = env.doc.getElementById('gwStation');
    if (!sel) return report('S3', '负责人端成长台锁本人站', 'FAIL', '#gwStation 不存在');
    if (sel.value !== STATION_ACC.station) return report('S3', '负责人端成长台锁本人站', 'FAIL', '选中值=' + sel.value + '，期望 五河');
    if (!sel.disabled) return report('S3', '负责人端成长台锁本人站', 'FAIL', '#gwStation 未禁用，负责人可切站');
    report('S3', '负责人端成长台锁本人站', 'PASS');
  } catch (e) { report('S3', '负责人端成长台锁本人站', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scS4() { /* 上报入口可见 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const reb = env.doc.getElementById('rpEntryBar');
    const rebShown = reb && reb.style.display !== 'none';
    if (!rebShown) return report('S4', '负责人端上报入口可见（看板顶部上报条，侧栏项已移除）', 'FAIL', 'rpEntryBar 不可见');
    report('S4', '负责人端上报入口可见（看板顶部上报条，侧栏项已移除）', 'PASS', 'rpEntryBar=true');
  } catch (e) { report('S4', '负责人端上报入口可见', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scS5() { /* 表单 15 个字段位（13 模板 + 在营学生数选填 + 运营天数仅季末月）；students 填才传 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const rp = env.win.__RP_TEST__;
    if (!rp) return report('S5', '上报表单15字段位', 'FAIL', 'window.__RP_TEST__ 不存在（上报模块未加载）');
    env.win.openReportForm();
    await sleep(150);
    const mask = env.doc.getElementById('rpMask');
    if (!mask || mask.style.display === 'none') return report('S5', '上报表单15字段位', 'FAIL', 'rpMask 未打开');
    /* ① 字段位总数 = 15（13 模板 + camp.3 当前在营学生数选填 + camp.4 本季实际运营天数 od） */
    const total = rp.RP_FIELDS.reduce((n, g) => n + g.items.length, 0);
    if (total !== 15) return report('S5', '上报表单15字段位', 'FAIL', '字段位=' + total + '，期望 15（13模板+在营学生数选填+运营天数）');
    const hasStudents = rp.RP_FIELDS.some(g => g.items.some(it => it.i === 3 && /在营学生数/.test(it.label)));
    const hasOd = rp.RP_FIELDS.some(g => g.items.some(it => it.i === 4 && it.od && /运营天数/.test(it.label)));
    if (!hasStudents || !hasOd) return report('S5', '上报表单15字段位', 'FAIL', '缺字段: students=' + hasStudents + ' od=' + hasOd);
    /* ② students：填 55 → payload 出现且=55；清空 → 整个键不出现（空→不传是契约） */
    rp.RP_STATE.vals['camp.3'] = '55';
    let pay = rp.rpPayload();
    if (!pay.metrics || pay.metrics.students !== 55) return report('S5', '上报表单15字段位', 'FAIL', 'students=55 时 payload.metrics.students=' + JSON.stringify(pay.metrics && pay.metrics.students));
    rp.RP_STATE.vals['camp.3'] = '';
    pay = rp.rpPayload();
    if (pay.metrics && 'students' in pay.metrics) return report('S5', '上报表单15字段位', 'FAIL', 'students 空时 payload 仍携带 students 键（应为「空→不传」）');
    /* ③ 运营天数行：季末月（OPEN_MONTH，动态判定）DOM 出现，非季末月（LOCKED_MONTH）整行消失且 payload 不携带 */
    rp.RP_STATE.month = OPEN_MONTH; env.win.rpSetMonth(OPEN_MONTH); env.win.rpGo(3);
    await sleep(120);
    const odIn = env.doc.getElementById('rp_camp_4');
    if (!odIn) return report('S5', '上报表单15字段位', 'FAIL', '季末月 ' + OPEN_MONTH + ' 下 #rp_camp_4（运营天数）未出现');
    rp.RP_STATE.month = LOCKED_MONTH; env.win.rpSetMonth(LOCKED_MONTH); env.win.rpGo(3);
    await sleep(120);
    if (env.doc.getElementById('rp_camp_4') || (env.doc.getElementById('rpBody') || {}).textContent?.indexOf('运营天数') >= 0) {
      return report('S5', '上报表单15字段位', 'FAIL', '非季末月 ' + LOCKED_MONTH + ' 下运营天数行未消失');
    }
    if ('operationDays' in rp.rpPayload()) return report('S5', '上报表单15字段位', 'FAIL', '非季末月 payload 携带 operationDays（契约：绝不携带）');
    report('S5', '上报表单15字段位', 'PASS', '15 字段位；students 填传/空不传；od 行随季末月显隐');
  } catch (e) { report('S5', '上报表单15字段位', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scS6() { /* 季末月（开放窗口）填运营天数提交 → ok + 上报成功 toast + 刷新 spy + 服务端落盘 students/operationDays */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const rp = env.win.__RP_TEST__;
    if (!rp) return report('S6', '负责人端上报提交成功', 'FAIL', '上报模块未加载');
    /* spy：诊断缓存失效 + 看板刷新是否被触发 */
    const origInv = env.win.dgInvalidate;
    env.win.__dgInvCalls = 0;
    env.win.dgInvalidate = function () { env.win.__dgInvCalls++; return origInv.apply(this, arguments); };
    env.win.__pcdCalls = 0;
    if (env.win.YF_CLOUD && typeof env.win.YF_CLOUD.pullCloudDash === 'function') {
      const origPcd = env.win.YF_CLOUD.pullCloudDash;
      env.win.YF_CLOUD.pullCloudDash = function () { env.win.__pcdCalls++; return origPcd.apply(this, arguments); };
    }
    env.win.openReportForm();
    await sleep(150);
    /* 季末月 OPEN_MONTH（动态开放窗口，真实时钟无开放月时后端已注入测试时钟）：13 模板字段 + students=55 + operationDays=92 */
    env.win.rpSetMonth(OPEN_MONTH);
    const month = rp.RP_STATE.month;
    if (month !== OPEN_MONTH) return report('S6', '负责人端上报提交成功', 'FAIL', '月份设置失败: ' + month + '（期望 ' + OPEN_MONTH + '）');
    const vals = { 'reg.0': 300, 'reg.1': 220, 'reg.2': 90, 'dev.0': 350, 'dev.1': 2200, 'dev.2': 0, 'dev.3': 240, 'dev.4': 120, 'camp.0': 90, 'camp.1': 48, 'camp.2': 42, 'camp.3': 55, 'camp.4': 92, 'par.0': 70, 'par.1': 0.8 };
    Object.keys(vals).forEach(k => { rp.RP_STATE.vals[k] = String(vals[k]); });
    const pay = rp.rpPayload();
    if (pay.operationDays !== 92 || !pay.metrics || pay.metrics.students !== 55) {
      return report('S6', '负责人端上报提交成功', 'FAIL', 'payload 缺新必填: operationDays=' + pay.operationDays + ' students=' + (pay.metrics && pay.metrics.students));
    }
    env.win.__toasts.length = 0;
    env.win.rpSubmit();
    try { await waitFor(() => env.win.__toasts.some(t => t.indexOf('上报成功') >= 0) || (env.doc.getElementById('rpMsg') || {}).innerHTML, 6000, '上报结果'); } catch (e) {}
    const toasts = env.win.__toasts.join('|');
    const msgEl = env.doc.getElementById('rpMsg');
    const errMsg = msgEl ? stripDi(msgEl.textContent) : '';
    if (toasts.indexOf('上报成功') < 0) {
      const tk = env.win.localStorage.getItem('yf_token');
      const chk = await api('GET', '/v1/dash/records?station=' + encodeURIComponent('五河') + '&month=' + encodeURIComponent(month), null, tk);
      const rec = chk.j && chk.j.months && chk.j.months[month];
      return report('S6', '负责人端上报提交成功', 'FAIL',
        '无「上报成功」toast；表单错误提示: ' + (errMsg || '(空)') + '；服务端 ' + month + ' 记录: ' + (rec ? 'students=' + rec.students + ' od=' + rec.operationDays : JSON.stringify(chk.j).slice(0, 200)));
    }
    if (env.win.__dgInvCalls < 1) return report('S6', '负责人端上报提交成功', 'FAIL', '成功但 dgInvalidate 未被调用（诊断/看板未刷新）');
    /* 服务端落盘核对：students=55、operationDays=92 */
    const tk = env.win.localStorage.getItem('yf_token');
    const chk = await api('GET', '/v1/dash/records?station=' + encodeURIComponent('五河') + '&month=' + encodeURIComponent(month), null, tk);
    const rec = chk.j && chk.j.months && chk.j.months[month];
    if (!rec) return report('S6', '负责人端上报提交成功', 'FAIL', 'toast 成功但服务端无 ' + month + ' 记录');
    if (rec.students !== 55 || rec.operationDays !== 92) {
      return report('S6', '负责人端上报提交成功', 'FAIL', '落盘不符: students=' + rec.students + '（期望55） operationDays=' + rec.operationDays + '（期望92）');
    }
    report('S6', '负责人端上报提交成功', 'PASS', 'month=' + month + ' students=55 od=92 落盘 ✓ dgInvalidate=' + env.win.__dgInvCalls + '次 pullCloudDash=' + (env.win.__pcdCalls >= 0 ? env.win.__pcdCalls + '次' : 'N/A'));
  } catch (e) { report('S6', '负责人端上报提交成功', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
/* 裸错误码一票否决表（snake_case token 绝不允许出现在用户文案里） */
const RAW_CODE_RE = /validation_failed|not_season_month|month_locked|future_month|bad_format|bad_request|not_found|rev_conflict|forbidden|unlock_required|not_implemented|month_window|[a-z]{4,}_[a-z]{3,}/;
function friendlyMsgOk(msg) {
  const s = stripDi(msg);
  if (!s) return { ok: false, why: '提示为空' };
  if (s.indexOf('不在上报开放窗口') < 0 && s.indexOf('截止') < 0 && s.indexOf('联系管理员') < 0) return { ok: false, why: '不含「不在上报开放窗口/截止/联系管理员」任一文案' };
  if (RAW_CODE_RE.test(s)) return { ok: false, why: '含裸错误码 token: ' + (s.match(RAW_CODE_RE) || []).join(',') };
  return { ok: true };
}
async function scS7() { /* 非季月（不在开放窗口）提交 → 友好文案、无裸错误码 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const rp = env.win.__RP_TEST__;
    if (!rp) return report('S7', '锁月提交友好文案', 'FAIL', '上报模块未加载');
    env.win.openReportForm();
    await sleep(150);
    rp.RP_STATE.month = '2026-05'; /* 非季月 → 服务端 E6 拒绝 */
    const vals = { 'reg.0': 10, 'reg.1': 8, 'reg.2': 5, 'dev.0': 4, 'dev.1': 50, 'dev.2': 0, 'dev.3': 10, 'dev.4': 3, 'camp.0': 5, 'camp.1': 3, 'camp.2': 2, 'par.0': 2, 'par.1': 0.5 };
    Object.keys(vals).forEach(k => { rp.RP_STATE.vals[k] = String(vals[k]); });
    env.win.rpSubmit();
    try { await waitFor(() => (env.doc.getElementById('rpMsg') || {}).innerHTML, 6000, '锁月提示'); } catch (e) {}
    const msgEl = env.doc.getElementById('rpMsg');
    const msg = msgEl ? msgEl.textContent : '';
    const chk = friendlyMsgOk(msg);
    if (!chk.ok) return report('S7', '锁月提交友好文案', 'FAIL', chk.why + '，实际: ' + stripDi(msg).slice(0, 120));
    report('S7', '锁月提交友好文案', 'PASS', '文案: ' + stripDi(msg).slice(0, 80));
  } catch (e) { report('S7', '锁月提交友好文案', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scS9() { /* 月锁正路：已过截止+宽限的季内月（LOCKED_MONTH，动态判定）→ 命中「已过上报截止，联系管理员」 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const rp = env.win.__RP_TEST__;
    if (!rp) return report('S9', '已过截止月锁定提示', 'FAIL', '上报模块未加载');
    env.win.openReportForm();
    await sleep(150);
    rp.RP_STATE.month = LOCKED_MONTH; /* 季内月但已过截止+7天宽限 → 服务端 403 month_locked（动态锁定月，见文件头说明） */
    /* 数值须 ≥ 已播上月累计（先过 C1 校验，才能走到月锁判定） */
    const vals = { 'reg.0': 300, 'reg.1': 220, 'reg.2': 90, 'dev.0': 350, 'dev.1': 2200, 'dev.2': 0, 'dev.3': 240, 'dev.4': 120, 'camp.0': 90, 'camp.1': 48, 'camp.2': 42, 'par.0': 70, 'par.1': 0.8 };
    Object.keys(vals).forEach(k => { rp.RP_STATE.vals[k] = String(vals[k]); });
    env.win.rpSubmit();
    try { await waitFor(() => (env.doc.getElementById('rpMsg') || {}).innerHTML, 6000, '月锁提示'); } catch (e) {}
    const msgEl = env.doc.getElementById('rpMsg');
    const msg = msgEl ? msgEl.textContent : '';
    if (msg.indexOf('已过上报截止') < 0 || msg.indexOf('联系管理员') < 0) {
      return report('S9', '已过截止月锁定提示', 'FAIL', '未命中「已过上报截止，联系管理员」，实际: ' + stripDi(msg).slice(0, 120));
    }
    if (RAW_CODE_RE.test(stripDi(msg))) return report('S9', '已过截止月锁定提示', 'FAIL', '命中文案但含裸错误码: ' + stripDi(msg).slice(0, 120));
    /* 服务端确实没写入 */
    const tk = env.win.localStorage.getItem('yf_token');
    const chk = await api('GET', '/v1/dash/records?month=' + encodeURIComponent(LOCKED_MONTH), null, tk);
    const rec = chk.j && chk.j.months && chk.j.months[LOCKED_MONTH];
    if (rec && rec.by === STATION_ACC.username) return report('S9', '已过截止月锁定提示', 'FAIL', '锁定月竟被写入（by=负责人）');
    report('S9', '已过截止月锁定提示', 'PASS', '403 month_locked → 友好文案，服务端未写入');
  } catch (e) { report('S9', '已过截止月锁定提示', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}
async function scS8() { /* 档案自报（端点未上线则 SKIP） */
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const tk = env.win.localStorage.getItem('yf_token');
    let r = await api('POST', '/v1/profiles/mine', { owner: '王养运', post: '站长', exp: '3年' }, tk);
    if (r.status === 404 || (r.j && r.j.error === 'not_found')) {
      return report('S8', '档案自报(/v1/profiles/mine)', 'SKIP', '后端端点未上线（404），等上线后转正式门禁');
    }
    if (!r.j || !r.j.ok) return report('S8', '档案自报(/v1/profiles/mine)', 'FAIL', 'POST 返回: ' + JSON.stringify(r.j).slice(0, 200));
    const atk = (await api('POST', '/login', { username: ADMIN.username, password: ADMIN.password })).j.token;
    r = await api('GET', '/v1/profiles/pending', null, atk);
    if (r.status === 404) return report('S8', '档案自报(/v1/profiles/mine)', 'SKIP', 'mine 已通但 /v1/profiles/pending 未上线，admin 审核链路待补');
    const hasWH = JSON.stringify(r.j).indexOf('五河') >= 0;
    if (!hasWH) return report('S8', '档案自报(/v1/profiles/mine)', 'FAIL', 'pending 中未见五河: ' + JSON.stringify(r.j).slice(0, 200));
    report('S8', '档案自报(/v1/profiles/mine)', 'PASS');
  } catch (e) { report('S8', '档案自报(/v1/profiles/mine)', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
}

async function scS10() { /* 论坛管理独立模块（admin 四分区 + station 拦截）+ 私信「发起新会话」闭环 */
  /* ① admin 登录 → applyTab('forumadmin') → 四分区容器 + 角色区真实渲染 */
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    env.win.applyTab('forumadmin');
    await sleep(300);
    if (!env.doc.querySelector('section#forumadmin.active')) return report('S10a', '论坛管理四分区渲染', 'FAIL', 'forumadmin section 未激活');
    const ids = ['frRoles', 'frRules', 'frMedals', 'pfPendingList'];
    const missing = ids.filter(id => !env.doc.getElementById(id));
    if (missing.length) return report('S10a', '论坛管理四分区渲染', 'FAIL', '容器缺失: ' + missing.join(','));
    const faBtn = env.doc.querySelector('.sb-item[data-tab="forumadmin"]');
    if (!faBtn || faBtn.style.display === 'none') return report('S10a', '论坛管理四分区渲染', 'FAIL', 'admin 侧栏论坛管理项不可见');
    await waitFor(() => {
      const t = (env.doc.getElementById('frRoles') || {}).textContent || '';
      return t.indexOf('超级版主') >= 0 || t.indexOf('暂无账号') >= 0;
    }, 8000, '论坛角色区渲染');
    await waitFor(() => {
      const t = (env.doc.getElementById('frMedals') || {}).textContent || '';
      return t.indexOf('勋章列表') >= 0;
    }, 8000, '勋章管理区渲染');
    report('S10a', '论坛管理四分区渲染', 'PASS', 'admin 侧栏入口+frRoles/frRules/frMedals/pfPendingList 全在且角色/勋章区已出数据');
  } catch (e) { report('S10a', '论坛管理四分区渲染', 'FAIL', e.message); }
  finally { env.dom.window.close(); }
  /* ② station 直访被拦截（同 S2 模式） */
  let env2 = null;
  try {
    env2 = await makeBrowser();
    await pageLogin(env2, STATION_ACC.username, STATION_ACC.password);
    env2.win.__toasts.length = 0;
    env2.win.applyTab('forumadmin');
    await sleep(250);
    if (env2.doc.querySelector('section#forumadmin.active')) return report('S10b', '负责人端直访论坛管理被拦截', 'FAIL', 'forumadmin 仍处于激活态');
    const toasts = env2.win.__toasts.join('|');
    const blocked = toasts.indexOf('仅管理') >= 0 || env2.win.localStorage.getItem('yangfan_lasttab') !== 'forumadmin';
    if (!blocked) return report('S10b', '负责人端直访论坛管理被拦截', 'FAIL', '既无拦截 toast 也未回退（lasttab=' + env2.win.localStorage.getItem('yangfan_lasttab') + '）');
    report('S10b', '负责人端直访论坛管理被拦截', 'PASS', 'toast: ' + toasts.slice(0, 60));
  } catch (e) { report('S10b', '负责人端直访论坛管理被拦截', 'FAIL', e.message); }
  finally { if (env2) env2.dom.window.close(); }
  /* ③ 私信死胡同修复：发起新会话 → 发送 → 会话列表出现 */
  let env3 = null;
  try {
    env3 = await makeBrowser();
    await pageLogin(env3, STATION_ACC.username, STATION_ACC.password);
    env3.win.fbDmOpen();
    await waitFor(() => {
      const s = env3.doc.getElementById('dmPeerSel');
      return s && (s.options || []).length && Array.prototype.some.call(s.options, o => o.value === ADMIN.username);
    }, 8000, '私信弹窗+联系人下拉已填充');
    env3.doc.getElementById('dmPeerSel').value = ADMIN.username;
    env3.win.fbDmStart();
    await waitFor(() => env3.doc.getElementById('dmInput'), 6000, '对话窗打开');
    env3.doc.getElementById('dmInput').value = '你好，这是一条 S10 门禁测试私信';
    env3.win.fbDmSend();
    await waitFor(() => {
      const t = (env3.doc.getElementById('dmBody') || {}).textContent || '';
      return t.indexOf('S10 门禁测试私信') >= 0;
    }, 8000, '消息上屏');
    env3.win.fbDmOpen(); /* 回会话列表 */
    await waitFor(() => {
      const t = (env3.doc.getElementById('dmBody') || {}).textContent || '';
      return t.indexOf(ADMIN.username) >= 0;
    }, 8000, '会话列表出现该会话');
    report('S10c', '私信发起新会话闭环', 'PASS', STATION_ACC.username + '→' + ADMIN.username + ' 一条消息，会话列表可见');
  } catch (e) { report('S10c', '私信发起新会话闭环', 'FAIL', e.message); }
  finally { if (env3) env3.dom.window.close(); }
}

/* =====================================================================
 * S11 负责人端「管理专属控件」零泄漏
 * ---------------------------------------------------------------------
 * 用户原话（2026-09-08）：「该在管理端出现的就不要在员工端出现」。
 * S1 只验了侧栏三个板块入口，但管理专属的**按钮/卡片**是另一套开关
 * （yfFilterNav 里逐个 style.display），此前完全没有门禁钉死，
 * 改动 yfFilterNav 时极易静默回归。本例把 7 个控件全部钉住。
 * ===================================================================== */
const ADMIN_ONLY_CTRLS = [
  ['acctBtn', '账号管理按钮'],
  ['dashUpBtn', '看板「更新数据」批量上传入口'],
  ['viewToggle', '对外视图开关'],
  ['dashWeakTab', '看板「需要盯的站」页签'],
  ['wbAdmin', '工作台「管理端·成效总览」入口卡'],
  ['hqReportCard', '集团汇报材料卡片'],
  ['hqPptBtn', '集团汇报 PPT 生成按钮']
];
function ctrlVisible(doc, win, id) {
  const el = doc.getElementById(id);
  if (!el) return { exists: false, visible: false };
  /* 只认显式开关：yfFilterNav 用 style.display 控制，''/block 视为可见 */
  const inline = el.style.display;
  return { exists: true, visible: inline !== 'none' };
}
async function scS11() {
  let env = null;
  try {
    env = await makeBrowser();
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    /* 逐个 tab 走一遍，确保懒渲染的控件已经生成（否则「不存在」会掩盖泄漏） */
    ['dash', 'workbench'].forEach(t => { try { env.win.applyTab(t); } catch (e) {} });
    await sleep(400);
    const leaked = [];
    const absent = [];
    ADMIN_ONLY_CTRLS.forEach(([id, name]) => {
      const st = ctrlVisible(env.doc, env.win, id);
      if (!st.exists) absent.push(id + '(' + name + ')');
      else if (st.visible) leaked.push(id + '(' + name + ') display=「' + (env.doc.getElementById(id).style.display || '空') + '」');
    });
    if (leaked.length) return report('S11', '负责人端管理专属控件零泄漏', 'FAIL', '泄漏 ' + leaked.length + ' 个: ' + leaked.join('; '));
    report('S11', '负责人端管理专属控件零泄漏', 'PASS',
      ADMIN_ONLY_CTRLS.length + ' 个控件均不可见' + (absent.length ? '（其中未生成: ' + absent.join(',') + '）' : '（全部已生成且显式隐藏）'));
  } catch (e) { report('S11', '负责人端管理专属控件零泄漏', 'FAIL', e.message); }
  finally { if (env) env.dom.window.close(); }
}

/* =====================================================================
 * A7 管理端同批控件必须可见（S11 的对照组）
 * ---------------------------------------------------------------------
 * 防「一刀切隐藏」：把 station 藏干净的同时把管理端也砍了，S11 照样绿。
 * 没有这个对照组，S11 就是个假门禁。
 * ===================================================================== */
async function scA7() {
  let env = null;
  try {
    env = await makeBrowser();
    await pageLogin(env, ADMIN.username, ADMIN.password);
    ['dash', 'workbench'].forEach(t => { try { env.win.applyTab(t); } catch (e) {} });
    await sleep(400);
    const missing = [];
    ADMIN_ONLY_CTRLS.forEach(([id, name]) => {
      const st = ctrlVisible(env.doc, env.win, id);
      if (!st.exists) missing.push(id + '(' + name + ')不存在');
      else if (!st.visible) missing.push(id + '(' + name + ')被隐藏');
    });
    if (missing.length) return report('A7', '管理端管理专属控件齐全', 'FAIL', missing.join('; '));
    report('A7', '管理端管理专属控件齐全', 'PASS', ADMIN_ONLY_CTRLS.length + ' 个控件在管理端全部可见');
  } catch (e) { report('A7', '管理端管理专属控件齐全', 'FAIL', e.message); }
  finally { if (env) env.dom.window.close(); }
}

/* =====================================================================
 * S12 后端角色闸门：station 令牌直调管理端接口必须被拦
 * ---------------------------------------------------------------------
 * 这是「前端隐藏 ≠ 安全」那类洞的唯一有效验证方式：绕过整个前端，
 * 拿 station 的合法 JWT 直接打管理端接口。前端把按钮藏了但后端没拦，
 * 等于任何浆站账号都能提权改全站数据。
 * 判定：HTTP 403 或 body.ok===false && error 含 forbidden 都算拦住。
 * ===================================================================== */
const ADMIN_ENDPOINTS = [
  ['POST', '/v1/admin/dash/replace', { stations: [] }, '整份看板覆写'],
  ['POST', '/v1/admin/profiles/levels', { levels: {} }, '负责人等级批改'],
  ['GET', '/v1/admin/export/desensitized', null, '脱敏全量导出'],
  ['POST', '/v1/forum/roles', { super: [], boards: {} }, '论坛版主角色覆写'],
  ['POST', '/v1/forum/rules', { rules: {} }, '论坛积分规则覆写'],
  ['POST', '/v1/profiles/approve', { username: 'x', action: 'approve' }, '负责人档案审核'],
  ['GET', '/accounts', null, '账号列表'],
  ['POST', '/accounts', { username: 'hacker', password: 'hack123456', role: 'admin', station: '' }, '开管理员账号'],
  ['DELETE', '/accounts', { username: 'testadmin' }, '删账号'],
  ['DELETE', '/data', { col: 'forum_posts', clear: true }, '清空集合'],
  /* 注意：/data POST 的「整份覆写」判定条件是 body.data 为对象（见 yf-api/index.js handleDataPost）。
     早期探针误传 {key,value} → 落到单文档写入分支（station 合法路径），会假报一个洞出来。 */
  ['POST', '/data', { col: 'forum_posts', data: [{ _created: 1, hacked: true }] }, '整份数据覆写'],
  ['POST', '/data', { col: 'accounts', doc: { username: 'hacker', role: 'admin' } }, '向 accounts 追加伪造管理员文档']
];
function isBlocked(res) {
  if (res.status === 403) return true;
  const j = res.j || {};
  if (j.ok === false && /forbidden|仅\s*admin|仅管理/.test(String(j.error || '') + String(j.msg || ''))) return true;
  return false;
}
async function scS12() {
  try {
    const lg = await api('POST', '/login', { username: STATION_ACC.username, password: STATION_ACC.password });
    if (!lg.j || !lg.j.ok || !lg.j.token) return report('S12', '后端拦截 station 越权调用', 'FAIL', 'station 登录取不到令牌: ' + JSON.stringify(lg.j));
    if (lg.j.role !== 'station') return report('S12', '后端拦截 station 越权调用', 'FAIL', '/login 返回 role=' + lg.j.role + '，期望 station');
    const stTok = lg.j.token;
    const holes = [];
    for (const [m, p, b, name] of ADMIN_ENDPOINTS) {
      const res = await api(m, p, b, stTok);
      if (!isBlocked(res)) holes.push(m + ' ' + p + '（' + name + '）→ HTTP ' + res.status + ' ' + JSON.stringify(res.j || {}).slice(0, 110));
    }
    if (holes.length) return report('S12', '后端拦截 station 越权调用', 'FAIL', '未拦住 ' + holes.length + '/' + ADMIN_ENDPOINTS.length + ' 个: ' + holes.join(' ｜ '));
    report('S12', '后端拦截 station 越权调用', 'PASS', ADMIN_ENDPOINTS.length + ' 个管理端接口全部拒绝 station 令牌');
  } catch (e) { report('S12', '后端拦截 station 越权调用', 'FAIL', e.message); }
}

/* =====================================================================
 * S13 数据归属隔离：station 写入不得冒充他站
 * ---------------------------------------------------------------------
 * 「浆站只能上传本机构数据，但可查看全部浆站数据」是平台硬性权限设计。
 * 后端 handleDataPost 用 `if (user.role==='station') doc.station=user.station`
 * 强制归位——这行一旦被误删，五河账号就能以凤台名义发内容，且前端毫无察觉。
 * 本例正向验证：伪造 station=凤台 提交，落库后必须变回五河。
 * ===================================================================== */
async function scS13() {
  try {
    const lg = await api('POST', '/login', { username: STATION_ACC.username, password: STATION_ACC.password });
    if (!lg.j || !lg.j.ok) return report('S13', 'station 写入强制归本站', 'FAIL', 'station 登录失败');
    const stTok = lg.j.token;
    const mark = 'S13-越站写入测试-' + Date.now();
    const res = await api('POST', '/data', { col: 'forum_posts', doc: { station: '凤台', title: mark, body: mark } }, stTok);
    if (!res.j || !res.j.ok) return report('S13', 'station 写入强制归本站', 'FAIL', '合法单文档写入被拒: HTTP ' + res.status + ' ' + JSON.stringify(res.j));
    const got = (res.j.doc || {}).station;
    if (got !== STATION_ACC.station) {
      return report('S13', 'station 写入强制归本站', 'FAIL', '伪造 station=凤台 未被纠正，落库 station=' + got + '（期望 ' + STATION_ACC.station + '）——越站写入洞');
    }
    /* 复查落库结果，排除只改了响应体没改存储 */
    const back = await api('GET', '/data?col=forum_posts', null, stTok);
    const rows = (back.j && (back.j.rows || back.j.data)) || [];
    const hit = rows.filter(d => d && d.title === mark);
    if (!hit.length) return report('S13', 'station 写入强制归本站', 'FAIL', '写入后回读不到该文档（title=' + mark + '）');
    if (hit[0].station !== STATION_ACC.station) {
      return report('S13', 'station 写入强制归本站', 'FAIL', '响应体已纠正但存储里仍是 station=' + hit[0].station);
    }
    report('S13', 'station 写入强制归本站', 'PASS', '伪造 station=凤台 → 响应与存储均归位为 ' + STATION_ACC.station);
  } catch (e) { report('S13', 'station 写入强制归本站', 'FAIL', e.message); }
}

/* =====================================================================
 * S14 身份未确认时按最低权限渲染（登出残留一屏）
 * ---------------------------------------------------------------------
 * yfRole() 在 yf_role 缺失时的默认值决定了「登录前首屏 / 登出后残留」这一瞬
 * 按哪个角色画。原实现默认 admin，导致 station 用户点登出后、以及任何人打开
 * 页面等门禁弹出的那一刻，管理端侧栏与按钮会先画出来一屏。
 * 本例：登录 station → 登出清会话 → yfRole() 必须是 station，且重跑
 * yfFilterNav 后 7 个管理控件仍不可见。
 * ===================================================================== */
async function scS14() {
  let env = null;
  try {
    env = await makeBrowser();
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    /* 只清会话，不 reload（模拟登出后残留在屏上的那一瞬） */
    env.win.localStorage.removeItem('yf_role');
    const roleNow = env.win.yfRole();
    if (roleNow === 'admin') {
      return report('S14', '身份未确认按最低权限渲染', 'FAIL', 'yf_role 缺失时 yfRole() 返回 admin —— 失效开放默认值');
    }
    if (roleNow !== 'station') {
      return report('S14', '身份未确认按最低权限渲染', 'FAIL', 'yf_role 缺失时 yfRole()=' + roleNow + '，期望 station');
    }
    env.win.yfFilterNav();
    await sleep(150);
    const leaked = [];
    ADMIN_ONLY_CTRLS.forEach(([id, name]) => {
      const st = ctrlVisible(env.doc, env.win, id);
      if (st.exists && st.visible) leaked.push(id + '(' + name + ')');
    });
    /* 侧栏三个管理板块同样不得露出 */
    ['hq', 'exp', 'forumadmin'].forEach(t => {
      const b = env.doc.querySelector('.sb-item[data-tab="' + t + '"]');
      if (b && b.style.display !== 'none') leaked.push('侧栏' + t);
    });
    if (leaked.length) return report('S14', '身份未确认按最低权限渲染', 'FAIL', '清会话后仍露出: ' + leaked.join(', '));
    report('S14', '身份未确认按最低权限渲染', 'PASS', 'yfRole() 默认 station；管理控件 ' + ADMIN_ONLY_CTRLS.length + ' 个 + 侧栏 3 板块均隐藏');
  } catch (e) { report('S14', '身份未确认按最低权限渲染', 'FAIL', e.message); }
  finally { if (env) env.dom.window.close(); }
}

/* =====================================================================
 * A8 后端闸门不是无脑拒绝（S12 的对照组）
 * ---------------------------------------------------------------------
 * 若后端把所有人都 403，S12 也会全绿。用 admin 令牌验证同一批读接口通。
 * ===================================================================== */
async function scA8() {
  try {
    const lg = await api('POST', '/login', { username: ADMIN.username, password: ADMIN.password });
    if (!lg.j || !lg.j.ok || !lg.j.token) return report('A8', '管理端令牌可正常调用管理接口', 'FAIL', 'admin 登录失败: ' + JSON.stringify(lg.j));
    const adTok = lg.j.token;
    const bad = [];
    const probes = [['GET', '/accounts', null, '账号列表'], ['GET', '/v1/admin/export/desensitized', null, '脱敏导出']];
    for (const [m, p, b, name] of probes) {
      const res = await api(m, p, b, adTok);
      if (isBlocked(res)) bad.push(m + ' ' + p + '（' + name + '）被误拦 HTTP ' + res.status);
    }
    if (bad.length) return report('A8', '管理端令牌可正常调用管理接口', 'FAIL', bad.join('; '));
    report('A8', '管理端令牌可正常调用管理接口', 'PASS', 'admin 令牌读接口通，证明 S12 的拦截是按角色而非无脑拒绝');
  } catch (e) { report('A8', '管理端令牌可正常调用管理接口', 'FAIL', e.message); }
}

/* =====================================================================
 * S15 年度自报×数据关联全链路（station 侧）
 * ---------------------------------------------------------------------
 * 双轨表单新契约提交（指标轨 reg[2]/比例 70→0.7/证据轨）→ admin 批准 →
 * 表单回填 → 服务端真实 actual 驱动：suggest 预填 / 矛盾确认 / display 直渲染 / 暂无实测 →
 * result 必填拦截 → completions 键控对象英文码提交 → 承诺兑现块三色状态点（诊断卡下方）。
 * ===================================================================== */
async function scS15() {
  let env = null;
  try {
    env = await makeBrowser();
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const adminTok = (await api('POST', '/login', { username: ADMIN.username, password: ADMIN.password })).j.token;
    const stTok = (await api('POST', '/login', { username: STATION_ACC.username, password: STATION_ACC.password })).j.token;
    /* 1) 打开成长档案·年度自报（gwBody → file 页签 → srMaybeLoad 自动 srLoad） */
    env.win.applyTab('rhythm');
    await sleep(250);
    env.win.GW_TAB = 'file';
    env.win.gwPaint();
    await waitFor(() => env.doc.getElementById('srCards') && env.doc.getElementById('srCards').textContent.indexOf('年度目标') >= 0, 8000, 'srCards 渲染');
    /* 2) 造目标：annual 三类（brand 指标轨 reg[2]=300 / dev 指标轨比例 cap.family 70 / effect 证据轨）+ winter 指标轨 dev[0]=50（1-2 月无上报 → 当期暂无实测） */
    env.win.srDraftGoals();
    env.win.SR_DRAFT.goals.annual = [
      { id: 'g_e2e_a1', text: '全年入营 300 人', cat: 'brand', track: 'metric', metric: 'reg[2]', target: '300', note: '季收官口径', evidence: '' },
      { id: 'g_e2e_a2', text: '家长参与度做到 70%', cat: 'dev', track: 'metric', metric: 'cap.family', target: '70', note: '', evidence: '' },
      { id: 'g_e2e_a3', text: '办一场社区科普开放日', cat: 'effect', track: 'evidence', metric: '', target: '', note: '', evidence: '办了一场，来了 40 组家庭' }
    ];
    env.win.SR_DRAFT.goals.winter = [
      { id: 'g_e2e_w1', text: '寒假季学生新卡 50 张', cat: 'dev', track: 'metric', metric: 'dev[0]', target: '50', note: '', evidence: '' }
    ];
    env.win.srRender();
    env.win.srSubmit('goals');
    await waitFor(() => env.win.__toasts.some(t => t.indexOf('已提交审核') >= 0), 8000, 'goals 提交 toast');
    /* 3) 待审 payload 契约校验（后端 srSanitizeSection 放行即形状合法，这里再逐字段核对） */
    const pj = await api('GET', '/v1/selfreport/pending', null, adminTok);
    const grow = (pj.j.pending || []).find(x => x.slug === 'wuhe' && x.section === 'goals');
    if (!grow) return report('S15', '年度自报新契约全链路', 'FAIL', 'goals pending 未生成');
    const pa = grow.payload.annual || [];
    const a1 = pa.find(x => x.id === 'g_e2e_a1'), a2 = pa.find(x => x.id === 'g_e2e_a2'), a3 = pa.find(x => x.id === 'g_e2e_a3');
    if (!a1 || !a1.measure || a1.measure.metric !== 'reg[2]' || a1.measure.target !== 300 || a1.measure.dir !== 'gte' || a1.measure.caliber !== 'seasonFinal')
      return report('S15', '年度自报新契约全链路', 'FAIL', '指标轨 measure 不符: ' + JSON.stringify(a1));
    if (!a2 || !a2.measure || a2.measure.metric !== 'cap.family' || a2.measure.target !== 0.7 || a2.measure.caliber !== 'ratio')
      return report('S15', '年度自报新契约全链路', 'FAIL', '比例类 70 未存成 0.7: ' + JSON.stringify(a2));
    if (!a3 || a3.evidence !== '办了一场，来了 40 组家庭' || a3.measure)
      return report('S15', '年度自报新契约全链路', 'FAIL', '证据轨形态不符: ' + JSON.stringify(a3));
    /* 4) admin 批准 goals → 站长重拉：双轨表单回填 */
    await api('POST', '/v1/selfreport/approve', { station: '五河', section: 'goals', decision: 'approve' }, adminTok);
    env.win.srLoad();
    await waitFor(() => {
      const s = env.doc.querySelector('#srCards select[aria-label="对照指标"]');
      return s && s.value === 'reg[2]';
    }, 8000, '表单回填 reg[2]');
    const tgts = [...env.doc.querySelectorAll('#srCards input.sr-target')];
    if (tgts.length < 2 || tgts[0].value !== '300' || tgts[1].value !== '70')
      return report('S15', '年度自报新契约全链路', 'FAIL', '目标值回填不符: ' + tgts.map(t => t.value).join(','));
    /* 5) 服务端真实 actual 驱动（五河 7 月实测 reg[2]=82<300 → missed；cap.family 80%≥70% → achieved；winter 窗口 1-2 月无上报 → met=null）：
           display 直渲染 / 暂无实测 / suggest 预填全走真实链路，前端零自算 */
    const selA = () => [...env.doc.querySelectorAll('#srCards select[aria-label="完成状态"]')][0];
    await waitFor(() => {
      const t = env.doc.getElementById('srCards').textContent;
      /* a1 display 为服务端直渲染（季收官取最新有数月，数值由上游 S6 上报决定，用正则放宽）；a2=80% / 70%；w1 窗口 1-2 月无数据 → 暂无实测 */
      return /系统实测：\d+(\.\d+)? \/ 300 人/.test(t) && t.indexOf('系统实测：80% / 70%') >= 0 && t.indexOf('该目标当期暂无实测数据') >= 0;
    }, 8000, '实测行/暂无实测渲染');
    if (selA().value !== 'missed') return report('S15', '年度自报新契约全链路', 'FAIL', 'a1 suggest 预填失败: ' + selA().value);
    const selB = () => [...env.doc.querySelectorAll('#srCards select[aria-label="完成状态"]')][1];
    if (selB().value !== 'achieved') return report('S15', '年度自报新契约全链路', 'FAIL', 'a2 suggest 预填失败: ' + selB().value);
    /* 6) 改选与实测不一致：confirm=false 拦截回退，confirm=true 放行 */
    env.win.confirm = function () { return false; };
    selA().value = 'achieved';
    if (typeof selA().onchange === 'function') selA().onchange(); else selA().dispatchEvent(new env.win.Event('change'));
    await sleep(200);
    if (selA().value !== 'missed') return report('S15', '年度自报新契约全链路', 'FAIL', '矛盾改选未拦截（confirm=false 应回退 missed）');
    env.win.confirm = function () { return true; };
    selA().value = 'achieved';
    if (typeof selA().onchange === 'function') selA().onchange(); else selA().dispatchEvent(new env.win.Event('change'));
    await sleep(200);
    if (selA().value !== 'achieved') return report('S15', '年度自报新契约全链路', 'FAIL', 'confirm=true 后改选未生效');
    /* 7) result 必填拦截 */
    const tSnap1 = env.win.__toasts.length;
    env.win.SR_DRAFT.completions['g_e2e_a3'] = { status: 'achieved', result: '' };
    env.win.srSubmit('completions');
    await sleep(300);
    if (!env.win.__toasts.slice(tSnap1).some(t => t.indexOf('未填完成结果') >= 0))
      return report('S15', '年度自报新契约全链路', 'FAIL', 'result 必填未拦截，toasts=' + JSON.stringify(env.win.__toasts.slice(tSnap1)));
    /* 8) 补齐三条已选状态目标的结果 → completions 键控对象英文码 pending（以后端落库为事实源，toast 仅作旁证） */
    env.win.SR_DRAFT.completions['g_e2e_a1'] = { status: 'achieved', result: '实际入营 320 人' };
    env.win.SR_DRAFT.completions['g_e2e_a2'] = { status: 'achieved', result: '7 月参与度 80%，达标' };
    env.win.SR_DRAFT.completions['g_e2e_a3'] = { status: 'achieved', result: '开放日如期举办' };
    const tSnap2 = env.win.__toasts.length;
    env.win.srSubmit('completions');
    let cPending = null;
    try {
      await waitFor(async () => {
        const p2 = await api('GET', '/v1/selfreport/pending', null, adminTok);
        cPending = (p2.j.pending || []).find(x => x.slug === 'wuhe' && x.section === 'completions') || null;
        return !!cPending;
      }, 8000, 'completions pending 落库');
    } catch (e) { cPending = null; }
    if (!cPending)
      return report('S15', '年度自报新契约全链路', 'FAIL', 'completions 未落库 ｜ toasts=' + JSON.stringify(env.win.__toasts.slice(tSnap2 - 2)));
    if (!cPending.payload['g_e2e_a1'] || cPending.payload['g_e2e_a1'].status !== 'achieved' || cPending.payload['g_e2e_a1'].result !== '实际入营 320 人')
      return report('S15', '年度自报新契约全链路', 'FAIL', 'completions pending 键控对象不符: ' + JSON.stringify(cPending.payload));
    if (!cPending.payload['g_e2e_a2'] || cPending.payload['g_e2e_a2'].status !== 'achieved')
      return report('S15', '年度自报新契约全链路', 'FAIL', 'a2 预填状态未随 payload 提交: ' + JSON.stringify(cPending.payload));
    const toastOk = env.win.__toasts.slice(tSnap2).some(t => t.indexOf('已提交审核') >= 0);
    /* 9) 承诺兑现块（诊断卡下方，station only，灰点=暂无实测） */
    env.win.GW_TAB = 'diag';
    env.win.gwPaint();
    await waitFor(() => {
      const pr = env.doc.getElementById('srPromise');
      return pr && pr.getAttribute('data-loaded') === '1' && pr.textContent.indexOf('我的承诺兑现') >= 0 && pr.textContent.indexOf('我已立') >= 0;
    }, 8000, '承诺兑现块渲染');
    const pr = env.doc.getElementById('srPromise');
    /* 真实 actual 三态：a1 季收官入营（6+7+8 月，含上游 S6 的 8 月上报）<300 → 红灯；a2 80%≥70% → 绿灯；w1 窗口 1-2 月无数据 → 灰灯 */
    if (!pr.querySelector('.sr-dot-ok') || !pr.querySelector('.sr-dot-bad') || !pr.querySelector('.sr-dot-none'))
      return report('S15', '年度自报新契约全链路', 'FAIL', '承诺兑现三色状态点不全（绿/红/灰应同时存在）');
    /* 承诺块契约（方案 v1.1 §3.1，用户裁定行内恢复实测值）：摘要行（四状态计数）+ 每条「实测值列 + 1 个行级下一步」
       实测值 = 服务端 actual.display 直渲染（例：'82 / 300 人'、'72% / 70%'），前端零计算；无实测显示「—」不显示 0 */
    if (pr.textContent.indexOf('我已立') < 0 || !/达成 \d+ · 未达 \d+ · 待实测 \d+/.test(pr.textContent.replace(/\s+/g, ' ')))
      return report('S15', '年度自报新契约全链路', 'FAIL', '承诺摘要行缺四状态计数: ' + stripDi(pr.textContent).slice(0, 160));
    if (pr.querySelectorAll('.sr-promise-i .sr-promise-go').length < 3)
      return report('S15', '年度自报新契约全链路', 'FAIL', '承诺行级「下一步」不全: ' + stripDi(pr.textContent).slice(0, 160));
    /* 实测值列必须真的渲染出来（不是「函数存在」「没抛错」这种橡皮图章断言）。
       期望值不写死数字：季收官（seasonFinal）口径的合计由上游 S6 上报决定，写死就是脆断言。
       改为取服务端 GET /v1/selfreport 的 goals[].actual.display 作为事实源，逐条逐字比对。 */
    const prRows = pr.querySelectorAll('.sr-promise-i');
    const prVals = Array.prototype.slice.call(pr.querySelectorAll('.sr-promise-i .sr-promise-v')).map(function (el) { return stripDi(el.textContent); });
    if (prVals.length !== prRows.length || prVals.length < 3)
      return report('S15', '年度自报新契约全链路', 'FAIL', '承诺行实测值列缺失（行数=' + prRows.length + '，实测值列=' + prVals.length + '）');
    const srGet = await api('GET', '/v1/selfreport', null, stTok);
    const expDisp = [];
    ['annual', 'winter', 'summer'].forEach(function (sk) {
      (((srGet.j || {}).goals || {})[sk] || []).forEach(function (it) {
        if (it && it.track === 'metric' && it.measure && typeof it.measure === 'object')
          expDisp.push(stripDi(it.actual && it.actual.display != null ? it.actual.display : '—'));
      });
    });
    if (!expDisp.length)
      return report('S15', '年度自报新契约全链路', 'FAIL', '服务端未返回任何指标轨承诺行（无法校验实测值列）');
    if (!expDisp.some(function (v) { return v !== '—'; }))
      return report('S15', '年度自报新契约全链路', 'FAIL', '服务端未返回任何真·实测 display（全为「—」，断言失去意义）: ' + JSON.stringify(expDisp));
    if (expDisp.length !== prVals.length || expDisp.some(function (v, i) { return v !== prVals[i]; }))
      return report('S15', '年度自报新契约全链路', 'FAIL', '实测值列与服务端 display 不一致 ｜ UI=' + JSON.stringify(prVals) + ' ｜ 服务端=' + JSON.stringify(expDisp));
    if (expDisp.some(function (v) { return v === '0' || v === ''; }))
      return report('S15', '年度自报新契约全链路', 'FAIL', '实测缺失被服务端渲染成 0 / 空串（禁止）: ' + JSON.stringify(expDisp));
    const noDataIdx = expDisp.indexOf('—');
    if (noDataIdx < 0)
      return report('S15', '年度自报新契约全链路', 'FAIL', 'w1（寒假窗口无上报）应无实测、「—」缺失，断言前提不成立: ' + JSON.stringify(expDisp));
    /* 10) 制造 goals 修订待审（锁定后修订，confirm 已覆写为 true）——供 S16 验证 goals 行 contrast 三列对照 */
    env.win.GW_TAB = 'file';
    env.win.gwPaint();
    await waitFor(() => env.doc.getElementById('srCards') && env.doc.getElementById('srCards').textContent.indexOf('年度目标') >= 0, 8000, '回到年度自报');
    env.win.confirm = function () { return true; };
    env.win.srSubmit('goals');
    let gPending = null;
    try {
      await waitFor(async () => {
        const p3 = await api('GET', '/v1/selfreport/pending', null, adminTok);
        gPending = (p3.j.pending || []).find(x => x.slug === 'wuhe' && x.section === 'goals') || null;
        return !!gPending;
      }, 8000, 'goals 修订 pending 落库');
    } catch (e) { gPending = null; }
    if (!gPending) return report('S15', '年度自报新契约全链路', 'FAIL', 'goals 修订 pending 未落库 ｜ toasts=' + JSON.stringify(env.win.__toasts.slice(-3)));
    report('S15', '年度自报新契约全链路', 'PASS', '双轨提交/reg[2] 契约/0.7 换算/表单回填/真实 actual display 直渲染/暂无实测/预填/矛盾确认/必填拦截/键控提交落库/承诺兑现三色点/承诺行实测值列与服务端 display 逐条逐字一致（无实测显示「—」不显示 0）/goals 修订待审全过（toast=' + toastOk + '）');
  } catch (e) { report('S15', '年度自报新契约全链路', 'FAIL', e.message + ' ｜ toasts=' + JSON.stringify((env && env.win.__toasts || []).slice(-6)) + ' ｜ errs=' + JSON.stringify((env && env.win.__errs || []).slice(-3))); }
  finally { if (env) env.dom.window.close(); }
}

/* =====================================================================
 * S16 年度自报×数据关联（admin 侧，消费 S15 遗留待审）
 * ---------------------------------------------------------------------
 * 待审全文渲染（状态中文+目标原文+承诺口径）→ 三列对照双形态（数组/键控对象）
 * 渲染与矛盾红标 → 批准 completions → 总览完成计数与承诺口径 → 未知 goalId 400。
 * ===================================================================== */
async function scS16() {
  let env = null;
  try {
    const adminTok = (await api('POST', '/login', { username: ADMIN.username, password: ADMIN.password })).j.token;
    const stTok = (await api('POST', '/login', { username: STATION_ACC.username, password: STATION_ACC.password })).j.token;
    env = await makeBrowser();
    await pageLogin(env, ADMIN.username, ADMIN.password);
    /* 1) 审核双页签：goals 修订行（附真实 contrast 三列对照）+ completions 行全文（状态中文+目标原文+结果） */
    env.win.faAuditTab('sr');
    await waitFor(() => {
      const el = env.doc.getElementById('srPendingList');
      return el && el.textContent.indexOf('年度目标') >= 0 && el.textContent.indexOf('目标完成') >= 0;
    }, 8000, '待审列表加载');
    const pendTxt = env.doc.getElementById('srPendingList').textContent;
    if (pendTxt.indexOf('达成·') < 0 || pendTxt.indexOf('全年入营 300 人') < 0 || pendTxt.indexOf('实际入营 320 人') < 0 || pendTxt.indexOf('承诺：入营人数') < 0)
      return report('S16', '自报关联管理端审核与总览', 'FAIL', '待审全文缺状态中文/目标原文/结果/承诺口径: ' + stripDi(pendTxt).slice(0, 200));
    /* 2) 三列对照——后端真实 contrast（数组形态）已在待审行内渲染：a1 自评 achieved vs 实测 missed → 矛盾红标；再直调验证键控对象兼容形态 */
    const ct0 = env.doc.getElementById('srPendingList').querySelector('.sr-ct');
    if (!ct0) return report('S16', '自报关联管理端审核与总览', 'FAIL', '待审行未渲染三列对照（.sr-ct 缺失，contrast 未消费）');
    const ct0Txt = ct0.textContent;
    if (ct0Txt.indexOf('目标值') < 0 || ct0Txt.indexOf('系统实测') < 0 || ct0Txt.indexOf('本人自评+理由') < 0 || !/\d+(\.\d+)? \/ 300 人/.test(ct0Txt) || ct0Txt.indexOf('自评与实测不一致') < 0)
      return report('S16', '自报关联管理端审核与总览', 'FAIL', '三列对照内容不符: ' + stripDi(ct0Txt).slice(0, 200));
    const ct2 = env.win.srContrastRows({ g_x: { goalText: '全年入营 300 人', selfStatus: 'missed', actual: { met: true, display: '320 / 300 人' } } }, {});
    if (ct2.indexOf('自评与实测不一致') < 0 || ct2.indexOf('320 / 300 人') < 0)
      return report('S16', '自报关联管理端审核与总览', 'FAIL', '三列对照键控对象兼容形态渲染不符');
    /* 3) 批准 completions + goals 修订 → 总览计数 3/4 + 展开含状态中文/承诺口径/实测/缺数据月 */
    await api('POST', '/v1/selfreport/approve', { station: '五河', section: 'completions', decision: 'approve' }, adminTok);
    await api('POST', '/v1/selfreport/approve', { station: '五河', section: 'goals', decision: 'approve' }, adminTok);
    env.win.GW_TAB = 'file';
    env.win.gwPaint();
    await waitFor(() => {
      const el = env.doc.getElementById('srCards');
      /* 用带全角括号的标题匹配，避开 loading 文案「加载年度自报总览中…」的子串误命中 */
      return el && el.textContent.indexOf('年度自报总览（') >= 0;
    }, 8000, '总览加载');
    const ovTxt = env.doc.getElementById('srCards').textContent;
    if (ovTxt.indexOf('完成 3/4') < 0) return report('S16', '自报关联管理端审核与总览', 'FAIL', '总览完成计数不符（期望 3/4）: ' + stripDi(ovTxt).slice(0, 200));
    env.win.srOvToggle(0);
    await sleep(150);
    const det = env.doc.getElementById('srOvDet_0');
    if (!det || det.textContent.indexOf('完成·达成') < 0 || det.textContent.indexOf('承诺：入营人数 ≥300') < 0 || !/实测：\d+(\.\d+)? \/ 300 人/.test(det.textContent) || det.textContent.indexOf('缺数据月：1月、2月') < 0)
      return report('S16', '自报关联管理端审核与总览', 'FAIL', '总览展开缺状态中文/承诺口径/实测/缺数据月: ' + (det ? stripDi(det.textContent).slice(0, 220) : 'srOvDet_0 不存在'));
    /* 4) 未知 goalId 拒绝（挂靠校验，前端 payload 键必须来自目标 id） */
    const bad = await api('POST', '/v1/selfreport', { section: 'completions', payload: { 'not-a-goal': { status: 'achieved', result: 'x' } } }, stTok);
    if (bad.status !== 400) return report('S16', '自报关联管理端审核与总览', 'FAIL', '未知 goalId 未被 400 拒绝: HTTP ' + bad.status);
    /* 5) 第四态：goals 已批准（锁定）且修订机会已用尽（步骤 3 已批准修订 → 目标带 revisedAt）→ 再提交 goals 必须 400，
          且人工文案随 body 回传（yfApi 不因 4xx reject → 前端 srSubmit 能 toast 出该 msg，不被吞）。 */
    const lockedAgain = await api('POST', '/v1/selfreport', { section: 'goals', payload: { annual: [
      { id: 'gl1', text: '品牌目标', cat: 'brand', track: 'evidence', evidence: 'e1' },
      { id: 'gl2', text: '发展目标', cat: 'dev', track: 'evidence', evidence: 'e2' },
      { id: 'gl3', text: '效能目标', cat: 'effect', track: 'evidence', evidence: 'e3' }
    ], winter: [], summer: [] } }, stTok);
    if (lockedAgain.status !== 400) return report('S16', '自报关联管理端审核与总览', 'FAIL', '第四态（修订机会已用尽）未被 400 拒绝: HTTP ' + lockedAgain.status + ' ' + JSON.stringify(lockedAgain.j || {}).slice(0, 160));
    const l4msg = String((lockedAgain.j && (lockedAgain.j.msg || lockedAgain.j.error)) || '');
    if (l4msg.indexOf('修订机会仅一次') < 0) return report('S16', '自报关联管理端审核与总览', 'FAIL', '第四态 400 未回传人工文案（疑似被吞）: ' + JSON.stringify(lockedAgain.j));
    report('S16', '自报关联管理端审核与总览', 'PASS', '待审全文/真实 contrast 三列对照+矛盾红标/总览 3/4+承诺口径+实测+缺数据月/未知 goalId 400/第四态 400 人工文案透传（' + l4msg.slice(0, 34) + '…）全过');
  } catch (e) { report('S16', '自报关联管理端审核与总览', 'FAIL', e.message + ' ｜ toasts=' + JSON.stringify((env && env.win.__toasts || []).slice(-4))); }
  finally { if (env) env.dom.window.close(); }
}

/* ---------- 主流程 ---------- */
(async () => {
  console.log('== 扬帆OS 双角色端到端门禁' + (BASELINE ? '（baseline 基线模式）' : '') + ' ==');
  const t0 = Date.now();
  await startBackend();
  try {
    await seedData();
    console.log('  [env] 数据已播种（admin 账号 + 王养运/五河账号 + 五河 2026-06/07 月报）\n');
    console.log('---- 管理端（testadmin）----');
    await scA1(); await scA2(); await scA3(); await scA4(); await scA5(); await scA6(); await scA7(); await scA8();
    console.log('---- 负责人端（王养运 · 五河）----');
    await scS1(); await scS2(); await scS3(); await scS4(); await scS5(); await scS6(); await scS7(); await scS8(); await scS9(); await scS10();
    console.log('---- 角色隔离专项（管理端专属不得下渗员工端）----');
    await scS11(); await scS12(); await scS13(); await scS14();
    console.log('---- 年度自报×数据关联专项（S15 依赖 S16 前置数据）----');
    await scS15(); await scS16();
  } finally {
    await stopBackend();
  }
  /* 汇总矩阵 */
  console.log('\n== 场景×结果矩阵 ==');
  console.log('场景  结果   说明');
  RESULTS.forEach(r => {
    console.log(`${r.id.padEnd(5)} ${r.status.padEnd(5)}  ${r.name}${r.detail ? ' ｜ ' + r.detail.slice(0, 160) : ''}`);
  });
  const nPass = RESULTS.filter(r => r.status === 'PASS').length;
  const nFail = RESULTS.filter(r => r.status === 'FAIL').length;
  const nSkip = RESULTS.filter(r => r.status === 'SKIP').length;
  console.log(`\n== 汇总: ${nPass} PASS / ${nFail} FAIL / ${nSkip} SKIP（耗时 ${Math.round((Date.now() - t0) / 1000)}s） ==`);
  if (BASELINE) {
    console.log('--baseline 模式：FAIL 不影响退出码（仅记录基线）');
    process.exit(0);
  }
  process.exit(nFail ? 1 : 0);
})().catch(e => {
  console.error('门禁脚本异常:', e);
  stopBackend().then(() => process.exit(2));
});
