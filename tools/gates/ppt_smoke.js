/* =====================================================================
 * GATE5 ppt_smoke —— 管理端汇报 PPT「运行期真跑」门禁
 * =====================================================================
 * 为什么需要这一道（team-lead 2026-09-28 裁决纳入）：
 *   GATE3 的 PG1~PG8 只能证明「genHQPPT 在、按钮在、角色开关在、页数与特征串对」——
 *   全是**结构**证据。它们证明不了「点下去真能出一个能拿去讲的 .pptx」：
 *   PptxGenJS 的 API 误用（选项名写错、表格列宽/行数越界、chart 类型不支持）
 *   只在真构建时才抛错，静态断言一条都拦不住。本项目门禁口径是「能证明功能真的能用」，
 *   不是「能证明代码存在」，故补这一道**功能绿**。
 *
 * 拦截点（零源码改动，index.html 一个字节都不碰）：
 *   页面自己解码注入内联 pptxSrc 后，在 jsdom window 里 patch
 *   `PptxGenJS.prototype.writeFile`，内部改用 `this.write({outputType:'base64'})`
 *   把字节交回门禁（jsdom 域内没有 Node Buffer，JSZip 的 nodebuffer 输出不可用）。
 *   **构建路径（addSlide/addShape/addText/addTable/addChart/write）与生产完全一致**，
 *   只替换「最后一步落盘/下载」。因此本门禁验的就是真实产物。
 *
 * 隔离车道（与 GATE4 端口隔离，避免两条车道抢同一个端口）：
 *   · 端口：`YF_PPT_PORT`，默认 **9103**（GATE4 用 YF_TEST_PORT / 9101；独立验证 worker 用 9102）
 *   · 影子后端：调 mk_shadow.js 生成 virgin shadow store（每轮全新，md5 逐字节校验）
 *   · 跑完 taskkill + netstat 兜底清端口残留；否则下一轮读到上轮账号 → 假绿
 *
 * 失败口径（不许静默跳过）：
 *   环境类前置失败（jsdom 缺失 / 影子目录造不出 / 后端起不来 / 隔离校验不过）
 *   → 打印 FATAL 原因并 **exit 3**；断言红 → exit 1；脚本异常 → exit 2。
 *   「跳过」在本套件里一律按红处理——跳过一次就再也不会有红灯提醒你它已经坏了。
 *
 * 读页面词法全局的注意点（实测）：
 *   `DASH_DB` 是脚本顶层的 `let/const` 词法绑定，**不在 window 上**（`win.DASH_DB===undefined`），
 *   只能经 `win.eval(...)` 在全局词法作用域里读写。`STATIONS` / `M6` / `M7` 同理按需 eval。
 *   `win.JSZip` 在 `__yfLoadLib('pptx')` 之后才出现（PptxGenJS 随包带 JSZip）。
 *
 * 用法：
 *   node tools/gates/ppt_smoke.js                 （门禁模式）
 *   YF_PPT_PORT=9203 node tools/gates/ppt_smoke.js
 *   YF_PPT_DUMP=1 node tools/gates/ppt_smoke.js   （附：红时把 chart XML 片段打出来）
 * ===================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

/* ---------- 路径（唯一权威出口 paths.js；不依赖 cwd） ---------- */
const P = require('./paths');
const HTML = P.INDEX_HTML;
const GATES_DIR = P.GATES_DIR;

/* jsdom 装在受管 workspace（与 e2e_dual_role.js 同一处；严禁全局安装） */
const NODE_PATH_VAL = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules';
let JSDOM = null;
try { JSDOM = require(path.join(NODE_PATH_VAL, 'jsdom')).JSDOM; }
catch (e) {
  console.log('FATAL: jsdom 未安装或路径不可用（' + NODE_PATH_VAL + '）：' + e.message);
  console.log('GATE5 中止（不静默跳过——跳过会被当成绿）。安装：cd <workspace> && npm install jsdom');
  process.exit(3);
}

const PORT = String(process.env.YF_PPT_PORT || '9103');
const BASE = 'http://127.0.0.1:' + PORT;
const CLOUD_PREFIX = 'https://yangfan1012-d5gtfsfwn507451df.service.tcloudbase.com';
const APP_TOKEN = 'yf-cloud-2026-shiyi';
const ADMIN = { username: 'testadmin', password: 'test123456' };
const STATION_ACC = { username: '王养运', password: 'sc1012', role: 'station', station: '五河' };
const DUMP = !!process.env.YF_PPT_DUMP;
const SAVE = process.env.YF_PPT_SAVE ? path.resolve(process.env.YF_PPT_SAVE) : null;
const HQ_HTML_OUT = process.env.YF_HQ_HTML ? path.resolve(process.env.YF_HQ_HTML) : null;

/* 基线（MANIFEST 写死；改动需同步 MANIFEST 并说明理由） */
const BASE_SLIDES = 14;         /* 本轮页数（2026-10-09 改版：9 → 14，首页改数据总览） */
const BASE_MIN_BYTES = 20000;   /* 非空壳下限（实测约 679KB） */
const BASE_TABLES = 2;          /* 原生表格页数（健康度总表 + 风险预警） */
const BASE_CHART_KINDS = ['barChart', 'lineChart'];  /* 漏斗柱状图 + 趋势折线图 */
const BASE_TOTAL_COLS = 10;     /* 健康度总表列数 */
const BASE_BAR_POINTS = 3;      /* 漏斗柱状图数值点数（报名/面试/入营） */

/* 口径三句（逐字；与 index.html 的 HQ_CALIB 同源，改口径必须同步改这里并说明） */
const CALIB_SENTENCES = [
  '四项能力全部由各站真实漏斗反推',
  '不以到场率、入营率评价好坏',
  '健康度 = 四项能力中达到全体中位数 90% 的项数'
];
/* 口径唯一性判据：这句话在**全部幻灯片文本**里只许出现 1 次（只许在集团总览页） */
const CALIB_UNIQUE_NEEDLE = '不以到场率、入营率评价好坏';

/* ---------- 结果收集 ---------- */
const RESULTS = [];
function report(id, name, status, detail) {
  RESULTS.push({ id, name, status, detail: detail || '' });
  const mark = status === 'PASS' ? '✓ PASS' : status === 'SKIP' ? '- SKIP' : '✗ FAIL';
  console.log(`  [${mark}] ${id} ${name}${detail ? ' ｜ ' + String(detail).slice(0, 320) : ''}`);
}
function assert(id, name, cond, detail) { report(id, name, cond ? 'PASS' : 'FAIL', detail); }

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
/* 从一段 XML 里取出全部 <c:v>…</c:v> 文本（去标签） */
function cvList(block) {
  const out = [];
  const re = /<c:v>([^<]*)<\/c:v>/g; let m;
  while ((m = re.exec(block)) !== null) out.push(m[1]);
  return out;
}
/* 折线/柱状图的一个 ser 里的数值点（兼容 numLit / numCache 两种嵌数据写法） */
function serVals(xml) {
  const sers = xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) || [];
  for (const ser of sers) {
    const b = ser.match(/<c:(?:numLit|numCache)>[\s\S]*?<\/c:(?:numLit|numCache)>/);
    if (b) { const v = cvList(b[0]); if (v.length) return v; }
  }
  return [];
}
/* 折线图类目（<c:cat> 里的字符串点） */
function catVals(xml) {
  const m = xml.match(/<c:cat>[\s\S]*?<\/c:cat>/);
  return m ? cvList(m[0]) : [];
}

/* ---------- 影子后端 ---------- */
let YF_API_DIR = process.env.YF_API_DIR ? path.resolve(process.env.YF_API_DIR) : null;
let backendChild = null;
function fatal(msg) {
  console.log('FATAL: ' + msg);
  console.log('GATE5 中止（不静默跳过——跳过会被当成绿）');
  try { stopBackendSync(); } catch (e) {}
  process.exit(3);
}
function killPortResidue() {
  try {
    const out = execSync('netstat -ano | findstr :' + PORT + ' | findstr LISTENING', { shell: 'cmd.exe' }).toString();
    const pids = new Set(out.split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p)));
    pids.forEach(pid => { try { execSync(`taskkill /PID ${pid} /T /F`, { shell: 'cmd.exe' }); } catch (e) {} });
    if (pids.size) console.log('  [env] 清理 ' + PORT + ' 端口残留进程: ' + [...pids].join(','));
  } catch (e) { /* 无监听即可 */ }
}
function stopBackendSync() {
  if (backendChild && backendChild.pid) {
    try { execSync(`taskkill /PID ${backendChild.pid} /T /F`, { shell: 'cmd.exe' }); } catch (e) { try { backendChild.kill(); } catch (_) {} }
    backendChild = null;
  }
  killPortResidue();
}
async function stopBackend() { stopBackendSync(); }

/* 影子目录：调 mk_shadow.js 生成（每轮全新 virgin store，md5 逐字节校验真实后端） */
function buildShadow() {
  if (YF_API_DIR) { console.log('  [env] 复用外部注入的 YF_API_DIR=' + YF_API_DIR); return Promise.resolve(); }
  const r = spawn(process.execPath, [path.join(GATES_DIR, 'mk_shadow.js')], { cwd: GATES_DIR, encoding: 'utf8' });
  let out = '';
  r.stdout.on('data', d => { out += d; });
  r.stderr.on('data', d => { out += d; });
  return new Promise(resolve => {
    r.on('exit', code => {
      console.log(out.trim().split('\n').map(l => '  [env] ' + l).join('\n'));
      const m = /^SHADOW=(.+)$/m.exec(out);
      if (code !== 0 || !m) { console.log('FATAL: 影子目录生成失败（exit=' + code + '）'); console.log('GATE5 中止（不静默跳过——跳过会被当成绿）'); process.exit(3); }
      YF_API_DIR = m[1].trim();
      if (!fs.existsSync(path.join(YF_API_DIR, 'index.js'))) {
        console.log('FATAL: 影子目录里没有 index.js: ' + YF_API_DIR);
        process.exit(3);
      }
      resolve();
    });
  });
}
async function startBackend() {
  killPortResidue();
  const _rmF = path.join(YF_API_DIR, 'yf_data.json');
  const _rmD = path.join(YF_API_DIR, 'yf_data_v1');
  for (let i = 0; i < 3; i++) {
    try { fs.rmSync(_rmF, { force: true }); } catch (e) {}
    try { fs.rmSync(_rmD, { recursive: true, force: true }); } catch (e) {}
    if (!fs.existsSync(_rmF) && !fs.existsSync(_rmD)) break;
    await sleep(250);
  }
  /* 隔离校验：store 必须为空（被污染的 store 是产生假绿的直接途径，不做"警告放行"） */
  const dirty = (function () {
    if (fs.existsSync(_rmF)) {
      try {
        const j = JSON.parse(fs.readFileSync(_rmF, 'utf8'));
        const nonEmpty = Object.keys(j || {}).filter(k => {
          const v = j[k];
          if (Array.isArray(v)) return v.length > 0;
          if (v && typeof v === 'object') return Object.keys(v).length > 0;
          return false;
        });
        if (nonEmpty.length) return 'yf_data.json 仍有非空集合: ' + nonEmpty.join(',');
      } catch (e) { return 'yf_data.json 不可解析: ' + e.message; }
    }
    if (fs.existsSync(_rmD)) {
      const bad = fs.readdirSync(_rmD).filter(n => /\.json$/i.test(n) && !/^yf-data__stations\.json$/i.test(n));
      if (bad.length) return 'yf_data_v1 残留业务集合文件: ' + bad.join(',');
    }
    return '';
  })();
  if (dirty) fatal('隔离校验未通过 —— ' + dirty);
  console.log('  [env] 隔离校验通过：store 内容为空');
  /* 播种站点表（后端无内置种子） */
  const seedDir = path.join(YF_API_DIR, 'yf_data_v1');
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'yf-data__stations.json'), JSON.stringify({
    rev: 1, updatedAt: Date.now(),
    stations: [{ name: '五河', slug: 'wuhe' }, { name: '凤台', slug: 'fengtai' }]
  }, null, 2));
  backendChild = spawn(process.execPath, ['index.js'], {
    cwd: YF_API_DIR,
    env: Object.assign({}, process.env, { YF_LOCAL: '1', ZHIPU_KEY: 'local-test-dummy', PORT: PORT, NODE_PATH: NODE_PATH_VAL }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  backendChild.stdout.on('data', d => { bootLog += d; });
  backendChild.stderr.on('data', d => { bootLog += d; });
  backendChild.on('exit', c => { if (c && c !== 0) console.log('  [env] 后端提前退出 code=' + c + '\n' + bootLog.slice(-600)); });
  try {
    await waitFor(async () => {
      const r = await fetch(BASE + '/status', { headers: { 'X-App-Token': APP_TOKEN } });
      const j = await r.json();
      return j && j.ok === true;
    }, 15000, '后端启动');
  } catch (e) {
    fatal('后端起不来（' + BASE + '）：' + e.message + '\n' + bootLog.slice(-600));
  }
  console.log('  [env] 后端已就绪 ' + BASE);
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
  return tk;
}

/* ---------- jsdom 环境 ---------- */
async function makeBrowser() {
  const dom = await JSDOM.fromFile(HTML, {
    runScripts: 'dangerously',
    resources: undefined,
    url: 'http://localhost/',
    pretendToBeVisual: true,
    beforeParse(window) {
      const nodeFetch = global.fetch;
      window.fetch = function (input, init) {
        try {
          let url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.indexOf(CLOUD_PREFIX) === 0) { input = BASE + url.slice(CLOUD_PREFIX.length); }
        } catch (e) {}
        return nodeFetch.call(global, input, init);
      };
      if (!window.matchMedia) window.matchMedia = function (q) {
        return { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      };
      if (!window.scrollTo) window.scrollTo = function () {};
      /* jsdom 未实现 scrollIntoView（机器人模块初始化会调它），补空实现降噪；
         与产物无任何关系，不影响任何断言。 */
      if (window.HTMLElement && !window.HTMLElement.prototype.scrollIntoView) {
        window.HTMLElement.prototype.scrollIntoView = function () {};
      }
    }
  });
  const win = dom.window;
  await waitFor(() => typeof win.toast === 'function', 5000, 'toast 定义');
  const origToast = win.toast;
  win.__toasts = [];
  win.toast = function (m) { try { win.__toasts.push(String(m)); } catch (e) {} return origToast.call(win, m); };
  win.__errs = [];
  win.addEventListener('error', e => { try { win.__errs.push(String(e.message)); } catch (x) {} });
  await sleep(600);
  return { dom, win, doc: win.document };
}
async function pageLogin(env, username, password) {
  const { win, doc } = env;
  const u = doc.getElementById('lgUser'), p = doc.getElementById('lgPwd');
  if (!u || !p) throw new Error('登录表单不存在（#lgUser/#lgPwd）');
  u.value = username; p.value = password;
  win.lgLogin();
  await waitFor(() => { try { return win.localStorage.getItem('yf_token'); } catch (e) { return null; } }, 8000, '登录 token 写入');
  await sleep(400);
}

/* ---------- 核心：真跑一次 genHQPPT，抓回字节 ---------- */
async function generateAndCapture(env) {
  const win = env.win;
  if (typeof win.__yfLoadLib !== 'function') throw new Error('页面缺少 __yfLoadLib（懒加载器）');
  await win.__yfLoadLib('pptx');                     /* 走页面自己的懒加载路径，不另造加载方式 */
  if (typeof win.PptxGenJS !== 'function') throw new Error('PptxGenJS 未注入（懒加载失败）');
  if (typeof win.JSZip !== 'function') throw new Error('JSZip 未注入（PptxGenJS 随包缺失）');
  const cap = { b64: null, fileName: null };
  win.PptxGenJS.prototype.writeFile = function (opt) {
    cap.fileName = opt && opt.fileName;
    return this.write({ outputType: 'base64' }).then(b => {
      cap.b64 = b;
      /* 渲染核验用：YF_PPT_SAVE=<路径> 时把真实 pptx 落盘（默认关闭，不影响门禁行为） */
      if (SAVE) { try { fs.writeFileSync(SAVE, Buffer.from(b, 'base64')); } catch (e) {} }
      return cap.fileName;
    });
  };
  const toastsBefore = win.__toasts.length;
  const errsBefore = win.__errs.length;
  win.genHQPPT();
  /* 等字节或等"任意新 toast"：成功路径先 resolve writeFile 再 toast「已生成」；
     越权路径立即 toast「仅管理端」；失败路径 toast「生成/保存失败」。任一发生即结束等待。 */
  await waitFor(() => cap.b64 || win.__toasts.length > toastsBefore, 30000, 'pptx 生成');
  await sleep(120);                                   /* 给 writeFile 的 promise 落地 */
  return { cap, newToasts: win.__toasts.slice(toastsBefore), newErrs: win.__errs.slice(errsBefore) };
}

/* ---------- 场景 ---------- */
async function scAdmin() {
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    const isAdmin = env.win.yfIsAdmin();
    assert('G5-A0', '管理端登录后 yfIsAdmin() 为真（前置）', isAdmin === true, 'yfIsAdmin()=' + isAdmin + ' role=' + env.win.yfRole());

    const nSt = env.win.eval('GW.stationList().length');
    const t0 = Date.now();
    const { cap, newToasts, newErrs } = await generateAndCapture(env);
    const ms = Date.now() - t0;
    assert('G5-A1', '★真出字节：genHQPPT() 执行后捕获到非空 pptx',
      !!cap.b64 && Buffer.from(cap.b64, 'base64').length > BASE_MIN_BYTES,
      '文件=' + cap.fileName + ' · ' + (cap.b64 ? Buffer.from(cap.b64, 'base64').length : 0) + ' 字节 · 耗时 ' + ms + 'ms · toast=' + JSON.stringify(newToasts));
    if (!cap.b64) { report('G5-A2', '解包校验（无字节，后续跳过）', 'FAIL', '未取到字节，无法解包'); return; }
    assert('G5-A1b', '运行期零 JS 错误', newErrs.length === 0, 'window.error=' + JSON.stringify(newErrs.slice(0, 3)));
    /* 渲染核验用：YF_HQ_HTML=<路径> 时把汇报 HTML 落盘（默认关闭，不影响门禁行为） */
    if (HQ_HTML_OUT) {
      try {
        const probe = env.win.eval('JSON.stringify({cur:DASH_CUR,season:GW.isSeasonView(),label:GW.periodLabel(),months:GW.months(),span:GW.spanLabel()})');
        fs.writeFileSync(HQ_HTML_OUT, '<!-- HQ_PROBE ' + probe + ' -->\n' + env.win.eval('hqReportHTML()'));
      } catch (e) {}
    }

    const zip = await env.win.JSZip.loadAsync(cap.b64, { base64: true });
    const names = Object.keys(zip.files);
    const slides = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]));
    assert('G5-A2', '★幻灯片张数 = ' + BASE_SLIDES, slides.length === BASE_SLIDES,
      '实际 ' + slides.length + ' 张（少一页即红）');

    const slideXml = [];
    for (const s of slides) slideXml.push(await zip.file(s).async('string'));
    const tblCount = slideXml.filter(x => x.indexOf('<a:tbl>') >= 0).length;
    assert('G5-A3', '★原生表格 ≥' + BASE_TABLES + ' 处（a:tbl）', tblCount >= BASE_TABLES, '含表格的幻灯片 ' + tblCount + ' 张');
    /* 总表页（第 4 页）必须是真表格，且 10 列、行数 = 表头 + 各站 */
    const tblXml = slideXml[3] || '';
    const gridCols = (tblXml.match(/<a:gridCol /g) || []).length;
    assert('G5-A3b', '健康度总表为 ' + BASE_TOTAL_COLS + ' 列原生表格', gridCols === BASE_TOTAL_COLS,
      '实际 gridCol=' + gridCols + '（列数变了说明表结构被改）');
    const trCount = (tblXml.match(/<a:tr[\s>]/g) || []).length;
    assert('G5-A3c', '健康度总表行数 = 表头 + 各站（' + (nSt + 1) + '）', trCount === nSt + 1,
      '实际 <a:tr>=' + trCount + ' · 站数=' + nSt);

    const chartFiles = names.filter(n => /^ppt\/charts\/.*\.xml$/.test(n));
    const chartXmls = [];
    for (const c of chartFiles) chartXmls.push(await zip.file(c).async('string'));
    const kinds = new Set();
    chartXmls.forEach(x => {
      if (/<c:barChart>/.test(x)) kinds.add('barChart');
      if (/<c:lineChart>/.test(x)) kinds.add('lineChart');
    });
    assert('G5-A4', '★原生图表存在（柱状图 + 折线图）',
      BASE_CHART_KINDS.every(k => kinds.has(k)),
      'chart part=' + chartFiles.length + ' · 类型=' + [...kinds].join(',') + ' · 期望含 ' + BASE_CHART_KINDS.join(','));
    /* 柱状图必须带真实漏斗数值（不是空图）。2026-10-09 改版后 PPT 里有多个柱状图
       （月度入营 / 各站入营 / 短板分布），必须**按类目定位漏斗那一张**，不能取第一张。 */
    const barXml = chartXmls.filter(x => /<c:barChart>/.test(x) && catVals(x).join(',') === '报名,面试,入营')[0] || '';
    const barVals = serVals(barXml);
    assert('G5-A4b', '★漏斗柱状图（报名/面试/入营）为 ' + BASE_BAR_POINTS + ' 个真实数值',
      barVals.length === BASE_BAR_POINTS && barVals.every(v => /^\d+(\.\d+)?$/.test(v)) && barVals.some(v => +v > 0),
      '类目=' + JSON.stringify(catVals(barXml)) + ' 值=' + JSON.stringify(barVals) + (DUMP ? ' · barXml片段=' + barXml.slice(0, 400) : ''));

    /* 口径逐字 + 唯一性 */
    const allText = slideXml.map(x => (x.match(/<a:t>[\s\S]*?<\/a:t>/g) || []).map(t => t.replace(/<\/?a:t>/g, '')).join('')).join('\n');
    const missing = CALIB_SENTENCES.filter(s => allText.indexOf(s) < 0);
    assert('G5-A5', '★口径三句逐字落在 PPT 里', missing.length === 0, missing.length ? '缺: ' + missing.join(' / ') : '三句齐全');
    const dup = (allText.split(CALIB_UNIQUE_NEEDLE).length - 1);
    assert('G5-A5b', '★口径全文只出现 1 次（复制第二份即红）', dup === 1, '出现 ' + dup + ' 次');
  } finally { env.dom.window.close(); }
}

/* 缺月不当 0：构造「6/7 月有真实上报、8 月有键但无人上报」的 DASH_DB，趋势页必须把 8 月
   排除在画线之外并在口径行写明缺月——用 0 顶替（让空月也 push）会让折线类目数从 2 变 3，本断言即红。
   注意：DASH_DB 是词法全局，只能用 win.eval 读写；且 months() 只在 DASH_DB 全空时才回落到 M6/M7，
   故必须把 6/7 月一并注入（否则注入 8 月后 months() 只剩 ['8']，构造不出"有 6/7 又有缺 8"的场景）。 */
async function scGapMonth() {
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    await env.win.__yfLoadLib('pptx');   /* 预加载，避免注入后到生成之间再发生异步回落 */
    const injected = env.win.eval('(function(){ try{'
      + ' DASH_DB["6"]=(typeof M6!=="undefined"&&M6)?JSON.parse(JSON.stringify(M6)):{};'
      + ' DASH_DB["7"]=(typeof M7!=="undefined"&&M7)?JSON.parse(JSON.stringify(M7)):{};'
      + ' DASH_DB["8"]={"五河":{}};'
      + ' return Object.keys(DASH_DB["8"]).length; }catch(e){ return -1; } })()');
    if (injected !== 1) {
      report('G5-B0', '注入缺月 8 月（前置）', 'FAIL', 'DASH_DB 不可写或注入失败（返回 ' + injected + '）——该前置失败也必须红，不许静默跳过');
      return;
    }
    const ms = env.win.eval('JSON.stringify(GW.months())');
    assert('G5-B0', '注入后 GW.months() 含 6/7/8 月（构造出「有缺月」场景）',
      ms.indexOf('"6"') >= 0 && ms.indexOf('"7"') >= 0 && ms.indexOf('"8"') >= 0, 'GW.months()=' + ms);

    const { cap } = await generateAndCapture(env);
    if (!cap.b64) { report('G5-B1', '缺月场景仍能出字节', 'FAIL', '未取到字节'); return; }
    const zip = await env.win.JSZip.loadAsync(cap.b64, { base64: true });
    const names = Object.keys(zip.files);
    const slides = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]));
    const chartFiles = names.filter(n => /^ppt\/charts\/.*\.xml$/.test(n));
    let cats = [];
    for (const c of chartFiles) {
      const x = await zip.file(c).async('string');
      if (/<c:lineChart>/.test(x)) { cats = catVals(x); break; }
    }
    assert('G5-B1', '★缺月不参与画线（折线类目恰 2 个：6 月 / 7 月）', cats.length === 2,
      '类目=' + JSON.stringify(cats) + '（出现第 3 个类目 = 拿 0 顶替）');
    const s8 = await zip.file(slides[7]).async('string');
    const s8Text = (s8.match(/<a:t>[\s\S]*?<\/a:t>/g) || []).map(t => t.replace(/<\/?a:t>/g, '')).join('');
    assert('G5-B2', '★缺月页显式写明「缺月 8 月 …不以 0 顶替」',
      s8Text.indexOf('缺月 8 月') >= 0 && s8Text.indexOf('不以 0 顶替') >= 0,
      '第 8 页文本片段=' + JSON.stringify(s8Text.slice(0, 160)));
    /* 口径文案字段名断言（2026-10-03 修正）：趋势页取数在 index.html L8592 用 c.reg[2]（入营人数），
       文案原误写 camp[2]（女生数）。此处锁死正确字样，并断言错误字样不得出现 —— 改回 camp[2] 即红。 */
    assert('G5-B3', '★趋势页口径文案字段名 = reg[2]（入营人数），不得写 camp[2]',
      s8Text.indexOf('reg[2] 逐站求和') >= 0 && s8Text.indexOf('camp[2]') < 0,
      '含 reg[2] 逐站求和=' + (s8Text.indexOf('reg[2] 逐站求和') >= 0) + ' · 误含 camp[2]=' + (s8Text.indexOf('camp[2]') >= 0));
  } finally { env.dom.window.close(); }
}

/* 口径统一回归（2026-10-09 首建 / 2026-10-10 口径修订）：中台/汇报的漏斗必须**跟随看板的时间选择**——
   看板「整季」= 《整季汇总表》数据集（all 键，单独核算，**不是** 6-8 月逐月相加，更不是"最新月"）；
   看板选某月 = 该月；势头恒按「前一月→最新月」，不随周期选择漂移。
   用三个月 × 全站可控数据（reg[2] 分别 10/20/30）把「单月」变成可判定的数；
   并显式注入 all 数据集 = 100/站（**故意 ≠ 逐月求和 60**），以钉死「整季读 all、不回退求和」。 */
async function scPeriod() {
  const env = await makeBrowser();
  try {
    await pageLogin(env, ADMIN.username, ADMIN.password);
    await env.win.__yfLoadLib('pptx');
    const inj = env.win.eval('(function(){ try{'
      + ' var v={"6":10,"7":20,"8":30};'
      + ' Object.keys(v).forEach(function(m){ var o={};'
      + '   STATIONS.forEach(function(s){ o[s]={reg:[v[m],v[m],v[m]],dev:[1,2,0,3,4],camp:[v[m],1,1],par:[2,0.5]}; });'
      + '   DASH_DB[m]=o; });'
      + ' var ao={}; STATIONS.forEach(function(s){ ao[s]={reg:[100,100,100],dev:[1,2,0,3,4],camp:[100,1,1],par:[2,0.5]}; });'
      + ' DASH_DB["all"]=ao;'   /* 整季汇总表数据集：=100/站 ≠ 6+7+8 之和 60 */
      + ' DASH_CUR="all";'
      + ' return Object.keys(DASH_DB).sort().join(",")+"|"+STATIONS.length; }catch(e){ return "ERR:"+e.message; } })()');
    if (inj.indexOf('ERR') === 0) { report('G5-D0', '注入三个月可控数据 + 整季汇总表（前置）', 'FAIL', inj); return; }
    const nSt = env.win.eval('GW.stationList().length');
    const seasonSum = nSt * 100;            /* 整季 = 《整季汇总表》all 数据集（2026-10-10 口径） */
    const monthSum = nSt * (10 + 20 + 30);  /* 6+7+8 逐月求和——新口径下「整季」不应等于它 */
    const m8Sum = nSt * 30;

    const s1 = JSON.parse(env.win.eval('JSON.stringify({label:GW.periodLabel(),isSeason:GW.isSeasonView(),sum:(function(){var t=0;GW.stationList().forEach(function(s){t+=GW.raw(s).r2;});return t;})()})'));
    assert('G5-D1', '★看板「整季」→ 中台口径 = 《整季汇总表》值（' + seasonSum + '），不是最新月、也不是逐月求和',
      s1.isSeason === true && s1.sum === seasonSum && s1.label === '6-8 月',
      'isSeason=' + s1.isSeason + ' · label=' + s1.label + ' · Σ入营=' + s1.sum + '（=' + monthSum + ' 即错走逐月求和 · =' + m8Sum + ' 即回退成"只有 8 月"）');

    /* D1b：无汇总表时「整季」回退逐月求和（兼容旧数据/历史季/尚未上传整季）——原子读写，免受异步云拉干扰 */
    const s1b = JSON.parse(env.win.eval('(function(){ var bak=DASH_DB["all"]; delete DASH_DB["all"]; DASH_CUR="all"; var t=0; GW.stationList().forEach(function(s){t+=GW.raw(s).r2;}); DASH_DB["all"]=bak; return JSON.stringify({sum:t}); })()'));
    assert('G5-D1b', '★无汇总表时「整季」回退逐月求和（' + monthSum + '）——兼容旧数据/历史季',
      s1b.sum === monthSum, 'Σ入营=' + s1b.sum + '（期望 ' + monthSum + '，=0 即数据层被误清空）');

    const s2 = JSON.parse(env.win.eval('(function(){ DASH_CUR="8"; return JSON.stringify({label:GW.periodLabel(),isSeason:GW.isSeasonView(),sum:(function(){var t=0;GW.stationList().forEach(function(s){t+=GW.raw(s).r2;});return t;})()}); })()'));
    assert('G5-D2', '看板选「8 月」→ 中台口径 = 该月（' + m8Sum + '）',
      s2.isSeason === false && s2.sum === m8Sum && s2.label === '8 月',
      'isSeason=' + s2.isSeason + ' · label=' + s2.label + ' · Σ入营=' + s2.sum);

    const s3 = JSON.parse(env.win.eval('(function(){ DASH_CUR="all"; var mo=GW.momentum(GW.stationList()[0]); return JSON.stringify({cur:mo.cur,prev:mo.prev,pLabel:mo.pLabel,mLabel:mo.mLabel}); })()'));
    assert('G5-D3', '★势头恒按「前一月→最新月」环比，不随周期选择漂移',
      s3.cur === 30 && s3.prev === 20 && s3.mLabel === '8 月' && s3.pLabel === '7 月',
      '势头=' + s3.pLabel + '→' + s3.mLabel + ' · ' + s3.prev + '→' + s3.cur + '（整季视图下必须仍是单月环比）');

    const { cap } = await generateAndCapture(env);   /* DASH_CUR 保持 "all" */
    if (!cap.b64) { report('G5-D4', '整季口径仍能出字节', 'FAIL', '未取到字节'); return; }
    const zip = await env.win.JSZip.loadAsync(cap.b64, { base64: true });
    const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]));
    let allText = '';
    for (const n of names) allText += (await zip.file(n).async('string')).replace(/<\/?a:t>/g, '');
    assert('G5-D4', '★整季口径下 PPT 带「6-8 月」标签与《整季汇总表》值（' + seasonSum + '）',
      allText.indexOf('6-8 月') >= 0 && allText.indexOf(String(seasonSum)) >= 0,
      '含「6-8 月」=' + (allText.indexOf('6-8 月') >= 0) + ' · 含「' + seasonSum + '」=' + (allText.indexOf(String(seasonSum)) >= 0));
    const lbls = allText.match(/\d+(?:-\d+)? 月累计/g) || [];
    assert('G5-D5', '★整季口径下周期标签恰为「6-8 月累计」——不是「8 月累计」（旧 bug 签名）',
      lbls.length >= 1 && lbls.every(x => x === '6-8 月累计'),
      '实测标签=' + JSON.stringify(lbls));

    /* D6/D7：时间视图「默认整季 + 记住选择」——云刷新/上报回填不得把选择冲回最新月 */
    const s6 = JSON.parse(env.win.eval('(function(){'
      + ' localStorage.setItem("yf_dash_cur_choice","8"); DASH_CUR="all";'
      + ' if(typeof dashApplyCloud==="function") dashApplyCloud(DASH_DB,"cloud",null);'
      + ' return JSON.stringify({cur:DASH_CUR,label:GW.periodLabel(),season:GW.isSeasonView()}); })()'));
    assert('G5-D6', '★云刷新/上报回填后，用户选择的「8 月」不被冲回（旧 bug：必被重置为最新月）',
      s6.cur === '8' && s6.season === false && s6.label === '8 月',
      'cur=' + s6.cur + ' · label=' + s6.label + '（若 cur="all" 即选择被静默冲掉）');

    /* 只测判定函数（纯同步）——不调 initDash()：它会拉起异步云拉取，窗口关闭后会抛未处理异常。 */
    const s7 = JSON.parse(env.win.eval('(function(){'
      + ' localStorage.removeItem("yf_dash_cur_choice"); DASH_CUR="all"; DASH_CUR=resolveDashCur(); var d1=DASH_CUR;'
      + ' localStorage.setItem("yf_dash_cur_choice","7"); DASH_CUR="all"; DASH_CUR=resolveDashCur(); var d2=DASH_CUR;'
      + ' localStorage.setItem("yf_dash_cur_choice","9"); DASH_CUR="all"; DASH_CUR=resolveDashCur(); var d3=DASH_CUR;'
      + ' localStorage.removeItem("yf_dash_cur_choice"); DASH_CUR="all";'
      + ' return JSON.stringify({d1:d1,d2:d2,d3:d3}); })()'));
    assert('G5-D7', '★默认整季 + 记住选择 + 失效月份回退整季（resolveDashCur 判定）',
      s7.d1 === 'all' && s7.d2 === '7' && s7.d3 === 'all',
      '无选择=' + s7.d1 + '（期望 all）· 选 7 月=' + s7.d2 + '（期望 7）· 选本赛季不存在的 9 月=' + s7.d3 + '（期望 all）');

    /* D8：bench() 缓存键必须含「周期」维度——整季与最新单月不得共用一把键（否则口径随访问顺序漂移） */
    const s8 = JSON.parse(env.win.eval('(function(){'
      + ' DASH_CUR="all"; var b1=GW.bench();'
      + ' DASH_CUR="8"; var b2=GW.bench();'
      + ' return JSON.stringify({same:(b1===b2)}); })()'));
    assert('G5-D8', '★标杆基准 bench() 缓存区分整季/单月（两视图不得命中同一个缓存对象）',
      s8.same === false,
      'b1===b2 → ' + s8.same + '（true = 整季与最新单月共用缓存，健康度/预警会随「先看哪个视图」而变）');
  } finally { env.dom.window.close(); }
}

/* 权限：负责人端直调 genHQPPT() 必须拿不到字节（去掉 admin 守卫即红） */
async function scStationDenied() {
  const env = await makeBrowser();
  try {
    await pageLogin(env, STATION_ACC.username, STATION_ACC.password);
    const role = env.win.yfRole();
    const btn = env.doc.getElementById('hqPptBtn');
    assert('G5-C0', '负责人端按钮显式隐藏（前置）',
      !!btn && btn.style.display === 'none', 'display=' + (btn ? ('「' + btn.style.display + '」') : '按钮不存在'));
    const { cap, newToasts } = await generateAndCapture(env).catch(e => ({ cap: { b64: null }, newToasts: [String(e.message)] }));
    const refused = newToasts.some(t => t.indexOf('仅管理端') >= 0);
    assert('G5-C1', '★负责人端直调 genHQPPT() 拿不到字节（越权被拦）', !cap.b64,
      '捕获字节=' + (cap.b64 ? Buffer.from(cap.b64, 'base64').length : 0) + ' · role=' + role + ' · toast=' + JSON.stringify(newToasts));
    assert('G5-C2', '越权调用有明确拒绝文案', refused, 'toast=' + JSON.stringify(newToasts));
  } finally { env.dom.window.close(); }
}

/* ---------- 主流程 ---------- */
(async () => {
  console.log('== GATE5 ppt_smoke：管理端汇报 PPT 运行期真跑（端口 ' + PORT + '） ==');
  const t0 = Date.now();
  await buildShadow();
  await startBackend();
  try {
    await seedData();
    console.log('  [env] 数据已播种（admin + 王养运/五河）\n');
    console.log('---- A. 管理端真跑一次，抓回 pptx 字节 ----');
    await scAdmin();
    console.log('---- B. 缺月不得以 0 顶替 ----');
    await scGapMonth();
    console.log('---- C. 口径统一：整季=各月累计、单月=该月、势头恒按最新月 ----');
    await scPeriod();
    console.log('---- D. 负责人端直调必须拿不到字节 ----');
    await scStationDenied();
  } catch (e) {
    report('G5-EXC', '脚本异常', 'FAIL', (e && e.message) || String(e));
    console.log((e && e.stack) || '');
  } finally {
    await stopBackend();
  }
  const nPass = RESULTS.filter(r => r.status === 'PASS').length;
  const nFail = RESULTS.filter(r => r.status === 'FAIL').length;
  const nSkip = RESULTS.filter(r => r.status === 'SKIP').length;
  console.log('\n== GATE5 汇总: ' + nPass + ' PASS / ' + nFail + ' FAIL / ' + nSkip + ' SKIP（耗时 ' + Math.round((Date.now() - t0) / 1000) + 's） ==');
  console.log(nFail ? 'GATE5 RESULT: FAIL' : 'GATE5 RESULT: PASS');
  process.exit(nFail ? 1 : 0);
})().catch(e => {
  console.log('GATE5 脚本异常:', e);
  stopBackend().then(() => process.exit(2));
});
