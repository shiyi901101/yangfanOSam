/* 诊断卡规则引擎 mock 断言（评估新标准：3 键双轨 outreach/conv/family + S 系列预警）
   + 浆站自主月上报表单（RP）mock 断言
   + 学习条理化（LR）mock 断言
   + 用户验收修复批次（修1-修6）断言
   全部从 index.html 实际提取代码执行，不复制逻辑。 */
const fs = require('fs');
const P = require('./paths');   /* 路径唯一权威出口（__dirname 基 / tmp 产物），见 paths.js 纳管红线 */

/* ================================ 第一部分：诊断卡规则引擎（js_03 → DG-RULES） ================================ */
const src = fs.readFileSync(P.jsBlock('03'), 'utf8');
const a = src.indexOf('/*DG-RULES-BEGIN*/');
const b = src.indexOf('/*DG-RULES-END*/');
if (a < 0 || b < 0) { console.log('FAIL 引擎标记未找到'); process.exit(1); }
const engine = src.slice(a, b + '/*DG-RULES-END*/'.length);
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
eval(engine);

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ('  → ' + detail) : '')); }
}

/* ===== mock：舒城 2026-08，评估新标准数据形态（rankTrack.perCap 仅 3 键 + absTrack 3 线 + alerts S 系列） ===== */
const shuchouHealth = {
  rankTrack: {
    overallRank: 6, rankPct: 0.7,
    perCap: {
      outreach: { capName: '学生科普', rank: 18, value: 2.1, median: 3.5 },
      conv:     { capName: '科普转化率', rank: 14, value: 0.35, median: 0.42 },
      family:   { capName: '家长参与度', rank: 20, value: 0.45, median: 0.63 }
    }
  },
  absTrack: {
    lines: [
      { capKey: 'outreach', capName: '学生科普', target: null, value: 2.1, reached: null },
      { capKey: 'conv',     capName: '科普转化率', target: 0.40, value: 0.35, reached: false },
      { capKey: 'family',   capName: '家长参与度', target: 0.70, value: 0.45, reached: false }
    ],
    reachedCount: 0, standardCount: 2
  }
};
function mkModel(month, overrides) {
  const m = {
    month: month,
    me: { station: '舒城', reg: [150, 110, 62], dev: [58, 420, 0, 61, 32], camp: [180, 100, 80], par: [28, 47.5], ext: [0, null], health: JSON.parse(JSON.stringify(shuchouHealth)) },
    stations: [
      { station: '舒城', slug: 'shucheng', reg: [150, 110, 62], health: shuchouHealth },
      { station: '五河', slug: 'wuhe', reg: [260, 207, 82], health: { rankTrack: { perCap: {
        outreach: { capName: '学生科普', rank: 1, value: 5.2, median: 3.5 },
        conv:     { capName: '科普转化率', rank: 1, value: 0.55, median: 0.42 },
        family:   { capName: '家长参与度', rank: 1, value: 0.88, median: 0.63 } } } } },
      { station: '怀远', slug: 'huaiyuan', reg: [30, 26, 24], health: { rankTrack: { perCap: { conv: { capName: '科普转化率', rank: 5, value: 0.48, median: 0.42 } } } } }
    ],
    alerts: [],
    rx: {}, ev: [], prescriptions: null, profile: { owner: '陈实', level: 'L1' }
  };
  if (overrides) overrides(m);
  return m;
}
function mkAlerts() {
  return [
    { station: '舒城', slug: 'shucheng', sev: 3, code: 'S3_no_screening', title: '入营≈面试：没筛选', desc: '本月面试 110 人、入营 62 人之外的另一条：入营人数几乎等于面试人数，说明没筛选。', semiQuote: null },
    { station: '舒城', slug: 'shucheng', sev: 2, code: 'S2_invite_gap', title: '邀约不力', desc: '面试人数不足报名人数的一半，邀约动作没跟上。', semiQuote: null },
    { station: '舒城', slug: 'shucheng', sev: 2, code: 'S1_pool_low', title: '蓄水不足', desc: '报名人数低于全集团中位的一半。', semiQuote: null },
    { station: '舒城', slug: 'shucheng', sev: 3, code: 'S4_dev_only', title: 'S4不该出现', desc: 'S4 不生成任何预警，前端必须过滤。', semiQuote: null }
  ];
}

/* ===== 断言 A1：全场景命中与优先级排序（R4 > S3 > S2 > S1 > R4B > R1 > R2） ===== */
let out = dgRules(mkModel('2026-08', function (m) { m.alerts = mkAlerts(); }));
const rs = out.map(x => x.r).join(',');
assert(rs === 'R4,R7,R8,R8,R4B,R1,R1,R2', 'A1 排序全序：R4 > S3(R7) > S2(R8) > S1(R8) > R4B > R1×2 > R2（实际：' + rs + '）');
assert(out[0].r === 'R4' && out[0].cap === 'family' && out[0].order === 0, 'A1 R4 家站硬线排第一，cap=family');
assert(out[0].body.indexOf('45%') >= 0 && out[0].body.indexOf('70%') >= 0, 'A1 R4 正文含参与度 45% 与集团线 70%');
assert(out[0].anchor === 'ka-stake', 'A1 R4 学习锚点=干系人管理 ka-stake');
assert(out[1].r === 'R7' && out[1].sev === 3 && out[1].anchor === 'ka-scope' && out[1].cap === null, 'A1 S3_no_screening sev3 → R7 横幅，锚点=范围管理 ka-scope，不带旧 cap');
assert(out[2].r === 'R8' && out[2].sev === 2 && out[2].anchor === 'ka-comm', 'A1 S2_invite_gap sev2 → R8，锚点=沟通管理 ka-comm');
assert(out[3].r === 'R8' && out[3].sev === 2 && out[3].anchor === 'ka-res', 'A1 S1_pool_low sev2 → R8，锚点=资源管理 ka-res');
const iR4B = out.findIndex(x => x.r === 'R4B');
assert(iR4B === 4 && out[iR4B].cap === 'conv' && out[iR4B].anchor === 'ka-qual', 'A1 R4B 科普转化硬线 order=4，锚点=质量管理 ka-qual');
assert(out[iR4B].body.indexOf('35%') >= 0 && out[iR4B].body.indexOf('40%') >= 0, 'A1 R4B 正文含转化率 35% 与集团线 40%');
const r1s = out.filter(x => x.r === 'R1');
assert(r1s.length === 2 && r1s.every(x => x.title.indexOf('五河') >= 0), 'A1 R1×2（outreach rank18 / family rank20），标题带第一名站名（五河，来自运行时数据）');
assert(r1s.some(x => x.dedupeKey === 'R1:outreach') && r1s.some(x => x.dedupeKey === 'R1:family'), 'A1 R1 防重复键随新 capKey');
const r2conv = out.find(x => x.r === 'R2');
assert(!!r2conv && r2conv.cap === 'conv' && r2conv.body.indexOf('42%') >= 0, 'A1 R2 conv（rank14）正文含中位 42%');
assert(!out.some(x => x.r === 'R3'), 'A1 R3 不命中（无 rank<=3）');
assert(!out.some(x => x.r === 'R10'), 'A1 R10 不命中（参与度 45%>1%）');
assert(!out.some(x => x.r === 'R12' || x.r === 'R13'), 'A1 R12/R13 不命中（rx 为空，growth/mine 501 静默降级）');
assert(!out.some(x => x.title.indexOf('S4不该出现') >= 0), 'A1 S4 前端过滤兜底：S4_* 预警不产生任何卡');
assert(!out.some(x => x.r === 'R6'), 'A1 R6 为呈现规则，引擎不产 R6 卡');
assert(!out.some(x => x.cap === 'outreach' && (x.r === 'R4' || x.r === 'R4B' || x.r === 'R10')), 'A1 outreach 无集团标准：绝不判罚（无线不产绝对线卡）');
assert(out[1].body === mkAlerts()[0].desc, 'A1 S 横幅正文透传服务端 desc（不二次加工）');

/* ===== 断言 A2：值格式归一与 3 键声明 ===== */
assert(dgPct(0.45) === 45 && dgPct(45) === 45 && dgPct(0.4) === 40 && dgPct(1.2) === 120, 'A2 dgPct 归一：0.45/45/0.4/1.2 → 45/45/40/120');
assert(DG_CAPS.length === 3 && DG_CAPS.map(c => c.k).join(',') === 'outreach,conv,family', 'A2 双轨表只放 3 键 outreach/conv/family');
assert(DG_CAPS[0].pct === 0 && DG_CAPS[1].pct === 1 && DG_CAPS[2].pct === 1, 'A2 pct 标记：outreach=0（次/人），conv/family=1（%）');
assert(dgFV(DG_CAPS[0], 2.1) === '2.1 次/人', 'A2 dgFV 非百分比单位带「次/人」');
assert(dgFV(DG_CAPS[1], 0.35) === '35%' && dgFV(DG_CAPS[2], null) === '—', 'A2 dgFV 百分比带 % / 空值显示 —');
assert(DG_S_META.S3.anchor === 'ka-scope' && DG_S_META.S2.anchor === 'ka-comm' && DG_S_META.S1.anchor === 'ka-res', 'A2 S 系列锚点映射：没筛选→ka-scope、邀约→ka-comm、蓄水→ka-res');
assert(DG_S_META.S3.order === 1 && DG_S_META.S2.order === 2 && DG_S_META.S1.order === 3, 'A2 S 系列优先级：S3(1) > S2(2) > S1(3)');
assert(Object.keys(DG_FORUM_TAG).join(',') === 'outreach,conv,family' && DG_FORUM_TAG.family === '家长活动', 'A2 论坛标杆标签随新 capKey（学生科普/科普转化/家长活动）');
assert(engine.indexOf("'arrive'") < 0 && engine.indexOf("'enroll'") < 0 && engine.indexOf("'cardper'") < 0 && engine.indexOf("'volper'") < 0 && engine.indexOf('R5') < 0, 'A2 引擎源码无旧 cap/旧 R5 位次判罚残留');

/* ===== 断言 A3：R14 季首月（01/06）抑制位次类，绝对线与 S 横幅保留 ===== */
out = dgRules(mkModel('2026-01', function (m) { m.alerts = mkAlerts(); }));
assert(out.some(x => x.r === 'R4') && out.some(x => x.r === 'R4B'), 'A3 季首月 R4/R4B 绝对线仍出');
assert(out.some(x => x.r === 'R7' || x.r === 'R8'), 'A3 季首月 S 系列横幅仍出');
assert(!out.some(x => x.r === 'R1' || x.r === 'R2' || x.r === 'R3'), 'A3 R14 抑制 R1/R2/R3 位次类（实际：' + out.map(x => x.r).join(',') + '）');

/* ===== 断言 A4：R11 数据核实（>100% 阻断一切，含 S 横幅） ===== */
out = dgRules(mkModel('2026-08', function (m) {
  m.alerts = mkAlerts();
  m.me.health.rankTrack.perCap.conv.value = 1.2;
}));
assert(out.length === 1 && out[0].r === 'R11' && out[0].cap === 'conv' && out[0].body.indexOf('1 个学生=1 个名额') >= 0, 'A4 R11 阻断：conv 120% 只出核实提醒（含 1 学生=1 名额口径），S 横幅也被阻断');
out = dgRules(mkModel('2026-08', function (m) {
  m.me.health.rankTrack.perCap.family.value = 1.05;
}));
assert(out.length === 1 && out[0].r === 'R11' && out[0].cap === 'family', 'A4 R11 对 family 105% 同样阻断（阈值 100%，非旧 110%）');
out = dgRules(mkModel('2026-08', function (m) { m.me.health.rankTrack.perCap.conv.value = 1.0; }));
assert(!out.some(x => x.r === 'R11'), 'A4 边界：恰为 100% 不触发 R11');

/* ===== 断言 A5：R10 家长从未进站（<1% 常驻） ===== */
out = dgRules(mkModel('2026-08', function (m) {
  m.me.health.rankTrack.perCap.family.value = 0.005;
  m.me.health.absTrack.lines[2].value = 0.005; m.me.health.absTrack.lines[2].reached = false;
}));
const r10 = out.find(x => x.r === 'R10');
assert(!!r10 && r10.order === 3 && r10.body.indexOf('0.5%') >= 0, 'A5 R10 命中：0.5% 从未进站，order=3');
out = dgRules(mkModel('2026-08', function (m) { m.me.health.rankTrack.perCap.family.value = 0.01; }));
assert(!out.some(x => x.r === 'R10'), 'A5 边界：恰为 1% 不算「从未进站」');

/* ===== 断言 A6：防重复（键随新 capKey；R1/R2 7 天、R3 30 天、R13 一次性） ===== */
global.localStorage._d = {};
out = dgRules(mkModel('2026-08'));
dgMark('R1:outreach');
out = dgRules(mkModel('2026-08'));
assert(!out.some(x => x.r === 'R1' && x.cap === 'outreach') && out.some(x => x.r === 'R1' && x.cap === 'family'), 'A6 R1:outreach 已提示后 7 天内不再出，R1:family 不受影响');
dgMark('R2:conv');
out = dgRules(mkModel('2026-08'));
assert(!out.some(x => x.r === 'R2'), 'A6 R2:conv 同理防重复');
global.localStorage._d = {};
out = dgRules(mkModel('2026-08', function (m) { m.me.health.rankTrack.perCap.outreach.rank = 2; }));
assert(out.some(x => x.r === 'R3' && x.cap === 'outreach'), 'A6 R3 头部站（outreach rank=2）建议沉淀方法');
dgMark('R3:outreach');
out = dgRules(mkModel('2026-08', function (m) { m.me.health.rankTrack.perCap.outreach.rank = 2; }));
assert(!out.some(x => x.r === 'R3'), 'A6 R3 30 天防重复');

/* ===== 断言 A7：R12/R13 处方执行状态 ===== */
global.localStorage._d = {};
out = dgRules(mkModel('2026-08', function (m) {
  m.rx = { conv: { status: 'doing', start: Date.now() - 3 * 86400000 + 3600000, target: 0.4 } };
  m.prescriptions = { conv: { title: '把科普讲透：一场胜过十场', acts: ['选题会', '讲稿打磨', '现场答疑'] } };
}));
const r12 = out.find(x => x.r === 'R12');
assert(!!r12 && r12.title === '执行中 · 第 3 天' && r12.body.indexOf('把科普讲透：一场胜过十场') >= 0, 'A7 R12 执行中第 3 天，处方标题注入');
out = dgRules(mkModel('2026-08', function (m) {
  m.rx = { family: { status: 'done', start: Date.now() - 40 * 86400000, end: Date.now(), target: 0.7 } };
  m.ev = [{ t: Date.now() - 86400000, k: 'family', from: 0.45, to: 0.72, target: 0.7, method: '家长开放日', verified: 'evidenced' }];
}));
assert(out.some(x => x.r === 'R13' && x.cap === 'family'), 'A7 R13：done + evidenced 进成长档案');
dgMark('R13:family');
out = dgRules(mkModel('2026-08', function (m) {
  m.rx = { family: { status: 'done', start: Date.now() - 40 * 86400000, end: Date.now(), target: 0.7 } };
  m.ev = [{ t: Date.now() - 86400000, k: 'family', verified: 'evidenced' }];
}));
assert(!out.some(x => x.r === 'R13'), 'A7 R13 一次性：已提示不再出');
out = dgRules(mkModel('2026-08', function (m) {
  m.rx = { family: { status: 'done', start: Date.now(), end: Date.now(), target: 0.7 } };
  m.ev = [{ t: Date.now(), k: 'family', verified: null }];
}));
assert(!out.some(x => x.r === 'R13'), 'A7 R13 不命中（无留痕 verified=null 不计入）');

/* ===== 断言 A8：无预警、无达标线的最简场景不炸、不造假 ===== */
out = dgRules(mkModel('2026-08', function (m) {
  m.me.health.rankTrack.perCap = {};
  m.me.health.absTrack.lines = [];
}));
assert(Array.isArray(out) && out.length === 0, 'A8 空数据（新站首月）返回空数组不报错');
out = dgRules(mkModel('2026-08', function (m) { m.alerts = [null, undefined]; }));
assert(Array.isArray(out), 'A8 alerts 含空项不炸（引擎逐项判空）');

/* ================================ 第二部分：浆站自主月上报表单（RP 块） ================================ */
const rpFull = fs.readFileSync(P.jsBlock('06'), 'utf8');
const ra = rpFull.indexOf('/*RP-BEGIN*/');
const rb = rpFull.indexOf('/*RP-END*/');
if (ra < 0 || rb < 0) { console.log('FAIL RP块标记未找到'); process.exit(1); }
const rpCode = rpFull.slice(ra + '/*RP-BEGIN*/'.length, rb);
global.window = { addEventListener() {} };
global.document = { getElementById() { return null; } };
eval(rpCode);
const RP = global.window.__RP_TEST__;
assert(!!RP && Array.isArray(RP.RP_FIELDS), 'RP 块在沙箱内可加载并暴露测试钩子');

/* R1：14 字段与分组（用户 Excel 模板原 13 字段逐字一致 + 第 14 字段「当前在营学生数（选填）」） */
assert(RP.RP_FIELDS.length === 4 && RP.RP_FIELDS.map(g => g.name).join(',') === '招募,学生发展,入营结构,家站经营', 'R1 4 步分组：招募/学生发展/入营结构/家站经营');
const rpLabels = [];
RP.RP_FIELDS.forEach(g => g.items.forEach(it => rpLabels.push(it.label)));
assert(rpLabels.length === 15, 'R1 字段总数 15（实际：' + rpLabels.length + '）');
const RP_EXPECT = ['报名人数','面试人数','入营人数','全站学生新卡数','全站学生采量','在营学生无偿献浆数','在营学生科普数','科普转化新卡数','入营总人数','男','女','当前在营学生数（选填）','本季实际运营天数','家长参与人数','家长参与度'];
assert(JSON.stringify(rpLabels) === JSON.stringify(RP_EXPECT), 'R1 15 字段名逐字一致（Excel 13 + students 选填 + 季末运营天数）');
assert(RP.RP_FIELDS.map(g => g.g).join(',') === 'reg,dev,camp,par', 'R1 字段映射分组 reg/dev/camp/par');
assert(RP.RP_FIELDS[0].items.map(i => i.i).join(',') === '0,1,2' && RP.RP_FIELDS[1].items.map(i => i.i).join(',') === '0,1,2,3,4' && RP.RP_FIELDS[2].items.map(i => i.i).join(',') === '0,1,2,3,4' && RP.RP_FIELDS[3].items.map(i => i.i).join(',') === '0,1', 'R1 下标映射：reg[0-2]/dev[0-4]/camp[0-4]/par[0-1]');
const itStu = RP.RP_FIELDS[2].items[3];
assert(!!itStu.opt && itStu.hint.indexOf('下季度起作为人均科普的精准分母') >= 0, 'R1 students 字段 opt 标记 + 口径提示原文');

/* R2：即时校验边界 */
assert(RP.rpValidate('', true) === null && RP.rpValidate('', false) === null, 'R2 空值放行（提交按 0 处理）');
assert(RP.rpValidate('-3') === '请填写非负数字' && RP.rpValidate('abc') === '请填写非负数字', 'R2 负数/非数字拒绝');
assert(RP.rpValidate('3.5') === '请填写整数', 'R2 计数字段小数拒绝');
assert(RP.rpValidate('3.5', true) === null && RP.rpValidate('47.5', true) === null, 'R2 参与度允许一位小数');
assert(RP.rpNum('') === 0 && RP.rpNum(null) === 0 && RP.rpNum('47') === 47, 'R2 rpNum 空值→0（payload 口径）');
const gPar = RP.RP_FIELDS[3], itPar1 = gPar.items[1];
assert(RP.rpWarnText(gPar, itPar1, '105') === '请核对（1 学生=1 名额）', 'R2 参与度>100% → 「1 学生=1 名额」核对提醒');
assert(RP.rpWarnText(gPar, itPar1, '95') === null, 'R2 参与度≤100% 不提醒');
const gDev = RP.RP_FIELDS[1], itDev4 = gDev.items[4];
RP.RP_STATE.vals['dev.3'] = '61';
assert(RP.rpWarnText(gDev, itDev4, '65') === '科普转化新卡数大于科普数，请核对', 'R2 科普转化新卡(65)>科普数(61) → 交叉核对提醒');
assert(RP.rpWarnText(gDev, itDev4, '32') === null, 'R2 科普转化新卡(32)≤科普数(61) 通过');

/* R3：payload 结构（{month, metrics:{reg[3], dev[5], camp[3], par[2], students?}}，空值→0；students 选填空则不传） */
RP.RP_STATE.month = '2026-08';
RP.RP_STATE.vals = { 'reg.0': '150', 'reg.1': '110', 'reg.2': '62', 'dev.0': '58', 'dev.1': '420', 'dev.2': '0', 'dev.3': '61', 'dev.4': '32', 'camp.0': '', 'camp.1': '', 'camp.2': '', 'camp.3': '', 'par.0': '28', 'par.1': '47.5' };
const pl = RP.rpPayload();
assert(pl.month === '2026-08' && JSON.stringify(Object.keys(pl)) === JSON.stringify(['month', 'metrics']), 'R3 payload 顶层结构 {month, metrics}（服务端从 token 认站，不传 station）');
assert(JSON.stringify(Object.keys(pl.metrics)) === JSON.stringify(['reg', 'dev', 'camp', 'par']), 'R3 metrics 键序 [reg,dev,camp,par]（后端读 body.metrics.*）');
assert(!('students' in pl.metrics), 'R3 students 空 → 整个字段不传（不是 0）');
assert(JSON.stringify(pl.metrics.reg) === '[150,110,62]', 'R3 reg=[报名,面试,入营]');
assert(JSON.stringify(pl.metrics.dev) === '[58,420,0,61,32]', 'R3 dev=[新卡,采量,献浆,科普,转化新卡]');
assert(JSON.stringify(pl.metrics.camp) === '[0,0,0]', 'R3 camp 数组仍为 3 元（students 走独立字段不进 camp 数组）');
assert(JSON.stringify(pl.metrics.par) === '[28,47.5]', 'R3 par=[参与人数,参与度小数保留]');
RP.RP_STATE.vals['camp.3'] = '55';
const pl2 = RP.rpPayload();
assert(pl2.metrics.students === 55 && JSON.stringify(Object.keys(pl2.metrics)) === JSON.stringify(['reg', 'dev', 'camp', 'par', 'students']), 'R3 students 填 55 → metrics.students=55（追加在 par 后）');
RP.RP_STATE.vals['camp.3'] = '-1';
assert(!('students' in RP.rpPayload().metrics), 'R3 students 非法值（负数）不传');
RP.RP_STATE.vals['camp.3'] = '2.5';
assert(!('students' in RP.rpPayload().metrics), 'R3 students 非法值（小数）不传');
/* 选填不挡步骤完成标记（用非季末月：od 字段不存在于 07 月语义） */
RP.RP_STATE.month = '2026-07';
RP.RP_STATE.vals = { 'camp.0': '180', 'camp.1': '100', 'camp.2': '80', 'camp.3': '' };
assert(RP.rpStepDone(3) === true, 'R3 步骤3完成标记：camp.3（选填）为空不挡 done');
RP.RP_STATE.vals['camp.0'] = '';
assert(RP.rpStepDone(3) === false, 'R3 步骤3完成标记：必填 camp.0 为空 → 未完成');

/* R4：上报月份仅季内可选 */
const sm = RP.rpSeasonMonths();
assert(JSON.stringify(sm) === JSON.stringify([8, 7, 6, 3, 2, 1]), 'R4 季内月份=[8,7,6,3,2,1]（季外 4/5/9-12 不可选）');
const ml = RP.rpMonthList();
assert(ml.list.length === 6 && ml.list.every(o => sm.indexOf(o.m) >= 0), 'R4 月份下拉只含季内 6 个月');
assert(/^-{0,1}\d{4}-\d{2}$/.test(ml.def) && sm.indexOf(Number(ml.def.slice(5))) >= 0, 'R4 默认月为季内未锁月份格式 YYYY-MM');

/* R5：月锁 403 分支与成功闭环（提交链路为 DOM 逻辑，用源码文本断言） */
assert(rpCode.indexOf("yfApi('/v1/dash/records','POST',rpPayload())") >= 0, 'R5 提交走 yfApi POST /v1/dash/records，body=rpPayload()');
assert(rpCode.indexOf("if(j.forbidden||e==='month_locked'||/截止|锁定|403/.test(m+e))") >= 0, 'S7 月锁分支：403/forbidden/截止/锁定 统一映射（rpErrMsg 内，月锁优先）');
assert(rpCode.indexOf("'已过上报截止，联系管理员'") >= 0, 'R5 月锁文案「已过上报截止，联系管理员」');
assert(rpCode.indexOf('dgInvalidate()') >= 0 && rpCode.indexOf('dgBoot(true)') >= 0 && rpCode.indexOf('pullCloudDash') >= 0 && rpCode.indexOf('pc(true') >= 0, 'R5 成功闭环：dgInvalidate + dgBoot(true) + pullCloudDash 强刷（YF_CLOUD 优先、全局兜底，6dbaee3）');
assert(rpCode.indexOf("toast('上报成功，诊断已更新')") >= 0, 'R5 成功 toast「上报成功，诊断已更新」');
assert(rpCode.indexOf('月上报仅浆站账号使用') >= 0, 'R5 admin 打开表单被拒（仅 station）');
assert(rpCode.indexOf("dataset.auto=''") >= 0 || rpCode.indexOf('dataset.auto=""') >= 0, 'R5 手改参与度后清 auto 标记（不再自动试算覆盖）');
assert(rpCode.indexOf('1 个名额') >= 0 && rpCode.indexOf('一般不应超过在营学生科普数') >= 0, 'R5 口径提示原文在字段 hint 中');
assert(rpCode.indexOf("p.metrics.students=Number(sv)") >= 0 && rpCode.indexOf('绝不传 0 冒充') >= 0, 'R5 students 选填：合法非负整数才附加进 metrics（空/非法不传）');

/* S6：季末月（03/08）「本季实际运营天数」——与后端 V1.SEASON_END_MONTHS=['03','08'] 同源 */
const gCamp2 = RP.RP_FIELDS[2], itOd = gCamp2.items[4];
assert(!!itOd && itOd.od === true && itOd.label === '本季实际运营天数', 'S6 od 字段声明：label 逐字 + od 标记');
assert(itOd.hint.indexOf('仅季末月') >= 0 && itOd.hint.indexOf('1-200') >= 0, 'S6 od 口径提示含「仅季末月」与 1-200 范围');
RP.RP_STATE.month = '2026-08';
assert(RP.rpIsSeasonEnd() === true, 'S6 08 月=季末月');
RP.RP_STATE.month = '2026-03';
assert(RP.rpIsSeasonEnd() === true, 'S6 03 月=季末月');
RP.RP_STATE.month = '2026-07';
assert(RP.rpIsSeasonEnd() === false, 'S6 07 月非季末月');
/* od 即时校验 */
RP.RP_STATE.month = '2026-08';
assert(RP.rpWarnText(gCamp2, itOd, '') === '季末月必填「本季实际运营天数」', 'S6 季末月空 → 必填提示（E7 同文案）');
assert(RP.rpWarnText(gCamp2, itOd, '300') === '运营天数须在 1-200 之间', 'S6 超范围 300 → 范围提示');
assert(RP.rpWarnText(gCamp2, itOd, '0') === '运营天数须在 1-200 之间', 'S6 0 不在 1-200');
assert(RP.rpWarnText(gCamp2, itOd, '92.5') === '运营天数须为 1-200 的整数', 'S6 小数拒绝');
assert(RP.rpWarnText(gCamp2, itOd, '92') === null, 'S6 92 合法通过');
RP.RP_STATE.month = '2026-07';
assert(RP.rpWarnText(gCamp2, itOd, '300') === null, 'S6 非季末月字段隐藏：不校验不挡提交');
/* od 与步骤完成标记 */
RP.RP_STATE.month = '2026-08';
RP.RP_STATE.vals = { 'camp.0': '180', 'camp.1': '100', 'camp.2': '80', 'camp.3': '', 'camp.4': '' };
assert(RP.rpStepDone(3) === false, 'S6 季末月 camp.4 空 → 步骤3未完成（必填）');
RP.RP_STATE.vals['camp.4'] = '92';
assert(RP.rpStepDone(3) === true, 'S6 季末月 camp.4=92 → 步骤3完成');
RP.RP_STATE.month = '2026-07';
RP.RP_STATE.vals['camp.4'] = '';
assert(RP.rpStepDone(3) === true, 'S6 非季末月 camp.4 不挡完成标记');
/* od payload（body 顶层，仅季末月携带） */
RP.RP_STATE.month = '2026-08';
RP.RP_STATE.vals = { 'reg.0': '150', 'reg.1': '110', 'reg.2': '62', 'dev.0': '58', 'dev.1': '420', 'dev.2': '0', 'dev.3': '61', 'dev.4': '32', 'camp.0': '180', 'camp.1': '100', 'camp.2': '80', 'camp.3': '', 'camp.4': '92', 'par.0': '28', 'par.1': '47.5' };
const plS6 = RP.rpPayload();
assert(plS6.operationDays === 92, 'S6 季末月 payload body 顶层 operationDays=92');
assert(JSON.stringify(Object.keys(plS6)) === JSON.stringify(['month', 'metrics', 'operationDays']), 'S6 顶层键序 [month, metrics, operationDays]（operationDays 不进 metrics）');
RP.RP_STATE.vals['camp.4'] = '';
assert(!('operationDays' in RP.rpPayload()), 'S6 季末月未填 → 不传（预览步阻断 + 服务端 E7 兜底）');
RP.RP_STATE.vals['camp.4'] = '300';
assert(!('operationDays' in RP.rpPayload()), 'S6 非法值 300 → 不传');
RP.RP_STATE.month = '2026-07';
RP.RP_STATE.vals['camp.4'] = '92';
assert(!('operationDays' in RP.rpPayload()), 'S6 非季末月绝不携带 operationDays（E7：携带会被服务端 400 拒绝）');

/* S7：rpSubmit 错误文案归一（rpErrMsg 纯函数实测） */
assert(!!RP.RP_ERR_TEXT && RP.RP_ERR_TEXT.validation_failed === '上报数据未通过校验，请检查标红的字段' && RP.RP_ERR_TEXT.month_locked === '已过上报截止，联系管理员' && RP.RP_ERR_TEXT.rev_conflict === '数据已被他人更新，请刷新后重试', 'S7 RP_ERR_TEXT 码表（服务端 v1err 实际码，不臆造）');
assert(RP.rpErrMsg(null) === '上报失败，请稍后重试', 'S7 null 响应兜底');
assert(RP.rpErrMsg({ error: 'validation_failed', msg: '校验未通过', errors: [{ code: 'E7', field: 'operationDays', msg: '季末月必填「本季实际运营天数」' }] }) === '季末月必填「本季实际运营天数」', 'S7 errors 数组逐条透出人工 msg（E7 字段级）');
assert(RP.rpErrMsg({ error: 'validation_failed', msg: '校验未通过', errors: [{ code: 'E2', field: 'caliber' }] }) === '上报数据未通过校验，请检查标红的字段', 'S7 errors 无 msg 的码走码表');
assert(RP.rpErrMsg({ error: 'validation_failed', msg: '校验未通过' }) === '上报数据未通过校验，请检查标红的字段', 'S7 validation_failed 映射为中文，绝不裸吐机器码');
assert(RP.rpErrMsg({ forbidden: true, error: 'validation_failed', msg: '校验未通过' }) === '已过上报截止，联系管理员', 'S7 forbidden 优先 → 月锁文案');
assert(RP.rpErrMsg({ error: 'month_locked', msg: '该月已锁定' }) === '已过上报截止，联系管理员', 'S7 month_locked → 月锁文案');
assert(RP.rpErrMsg({ error: 'rev_conflict', msg: '数据已被他人更新' }) === '数据已被他人更新，请刷新后重试', 'S7 rev_conflict 映射');
assert(RP.rpErrMsg({ error: 'weird_new_code', msg: '服务端人话' }) === '服务端人话', 'S7 未知码：人工 msg 优先于裸码');
assert(RP.rpErrMsg({ error: 'weird_new_code' }) === '上报失败（weird_new_code），请稍后重试', 'S7 未知码无 msg：包一层可读文案');
assert(RP.rpErrMsg({ error: 'validation_failed', msg: '月份不在开放窗口（not_season_month）', errors: [{ code: 'E6', field: 'month', msg: '月份不在开放窗口：not_season_month' }] }) === '所选月份不在上报开放窗口内，请选择季内月份', 'E6 窗口级映射：内部标记 not_season_month 不透出，固定人话');
assert(RP.rpErrMsg({ error: 'validation_failed', msg: '校验未通过', errors: [{ code: 'E7', field: 'operationDays', msg: '季末月必填「本季实际运营天数」' }, { code: 'E6', field: 'month', msg: 'x' }] }) === '季末月必填「本季实际运营天数」', 'E6 判定仅看 errors[0]：E7 打头仍走字段级透传');
assert(rpCode.indexOf("e0.code==='E6'") >= 0, 'E6 源码断言：映射分支落在 errors 分支最前');
/* 源码断言：wiring + 过滤 + 旧裸码行已删 */
assert(rpCode.indexOf('var msg=rpErrMsg(j);') >= 0, 'S7 rpSubmit 已接 rpErrMsg');
assert(rpCode.indexOf("(j&&(j.error||j.msg))||'上报失败") < 0, 'S7 旧裸 error 拼接行已从 rpSubmit 删除');
assert(rpCode.indexOf('!it.od||rpIsSeasonEnd()') >= 0, 'S6 渲染/预览按季末月过滤 od 字段');
assert(rpCode.indexOf('function rpSetMonth(v){ RP_STATE.month=v; rpRender();') >= 0, 'S6 切月即重渲染（od 字段随月份出现/消失）');


/* ================================ 第二部分B：登录/会话恢复重渲染 + 角色（修1）与成效总览 KPI（修2） ================================ */
const srcMain = fs.readFileSync(P.jsBlock('02'), 'utf8');
/* S1 源码断言：applyTab 分发 + yfRefreshActiveTab + 白名单 + 清 key + 预置站 + KPI 接线 */
assert(/function applyTab\(tab\)\{[\s\S]*?tab==='hq'&&typeof renderHQ==='function'\)renderHQ\(\)/.test(srcMain), 'S1 applyTab 分发重渲染含 hq→renderHQ');
assert(/function applyTab\(tab\)\{[\s\S]*?tab==='exp'&&typeof renderBench==='function'\)renderBench\(\)/.test(srcMain), 'S1 applyTab 分发重渲染含 exp→renderBench');
assert(/function applyTab\(tab\)\{[\s\S]*?tab==='rhythm'&&typeof renderRhythm==='function'\)renderRhythm\(\)/.test(srcMain), 'S1 applyTab 分发重渲染含 rhythm→renderRhythm');
assert(/function yfRefreshActiveTab\(\)\{[\s\S]*?yangfan_lasttab[\s\S]*?t==='hq'&&typeof renderHQ[\s\S]*?t==='exp'&&typeof renderBench[\s\S]*?t==='rhythm'&&typeof renderRhythm/.test(srcMain), 'S1 yfRefreshActiveTab：读 yangfan_lasttab 并按 hq/exp/rhythm 映射重渲染');
assert(srcMain.indexOf("var r=(user.role==='station')?'station':'admin';") >= 0, 'S1 角色白名单：yfEnter 只认 station，其余一律 admin');
assert(/lgClearSession\(\); showGateLogin\(\);/.test(srcMain), 'S1 lgBoot verify-fail：先清 yf_token/yf_user/yf_role/yf_mystation 再进登录门');
assert(srcMain.match(/function lgClearSession/g).length === 1 && srcMain.indexOf('lgClearSession();') >= 0, 'S1 lgClearSession 公共函数唯一定义且被 lgLogout 复用');
assert(srcMain.indexOf("d.st=user.station; GW.save(d)") >= 0, 'S1 station 登录预置默认站（GW.load→st=user.station→GW.save）');
const htmlMain = fs.readFileSync(P.INDEX_HTML, 'utf8');
const apiSrc = (function(){ try { return fs.readFileSync(P.YF_API_INDEX, 'utf8'); } catch (e) { return ''; } })();
assert(htmlMain.indexOf('id="hqStations"') >= 0 && htmlMain.indexOf('id="hqNps"') >= 0 && htmlMain.indexOf('id="hqRisk"') >= 0, 'S2 三个 KPI 数值 div 已挂 id（静态 HTML）');
assert(srcMain.indexOf("knps.textContent=north.healthy+'/'+list.length") >= 0 && srcMain.indexOf("krisk.textContent=String(north.risk)") >= 0, 'S2 renderHQ 守卫后回填 KPI（healthy/总数、风险站数，与 northH 同口径）');

/* S3 功能断言：junk role 进 yfEnter → yfIsAdmin()=true；station 进 yfEnter → 预置本人站
   （IIFE 包裹：eval 出的 yfIsStation 等函数声明只进本闭包，不污染后续 修2 gwLockStation 断言的 stub 机制） */
(function () {
  const grab = re => { const m = srcMain.match(re); return m ? m[0] : null; };
  const keyDefs = grab(/var YF_TOKEN_KEY\s*=\s*'[^']*';[\s\S]*?var YF_USER_KEY\s*=\s*'[^']*';/) || '';
  /* 四个 key 常量分散声明，逐个抓取拼接 */
  const keyLines = ['YF_TOKEN_KEY','YF_USER_KEY','YF_ROLE_KEY','YF_STATION_KEY'].map(k => {
    const m = srcMain.match(new RegExp('var ' + k + "\\s*=\\s*'[^']*';"));
    return m ? m[0] : '';
  }).join('\n');
  const roleFns = ['function yfToken(){','function yfRole(){','function yfMyStation(){','function yfIsAdmin(){','function yfIsStation(){'].map(k => {
    const i = srcMain.indexOf(k);
    return i < 0 ? '' : srcMain.slice(i, srcMain.indexOf('\n', i) + 1);
  }).join('\n');
  const yfEnterSrc = grab(/function yfEnter\(user, tok\)\{[\s\S]*?\n\}/);
  const refreshSrc = grab(/function yfRefreshActiveTab\(\)\{[\s\S]*?\n\}/);
  const clearSrc = grab(/function lgClearSession\(\)\{[^\n]*\}/);
  assert(!!yfEnterSrc && !!refreshSrc && !!clearSrc && keyLines.indexOf('yf_role') >= 0, 'S3 yfEnter/yfRefreshActiveTab/lgClearSession/角色助手可提取');
  if (yfEnterSrc && refreshSrc && clearSrc && keyLines.indexOf('yf_role') >= 0) {
    const savedDoc = global.document;
    global.document = { getElementById() { return null; } };
    const yfFilterNav = function () {}, yfShowRole = function () {}, yfShowAcctBtn = function () {};
    let gwSaved = null;
    const GW = { load() { return {}; }, save(d) { gwSaved = d; } };
    eval(keyLines + '\n' + roleFns + '\n' + clearSrc + '\n' + refreshSrc + '\n' + yfEnterSrc);
    /* junk role */
    global.localStorage._d = {};
    yfEnter({ role: 'junk-role', station: '', username: 'x' }, 'tok1');
    assert(global.localStorage.getItem('yf_role') === 'admin' && yfIsAdmin() === true && yfIsStation() === false, 'S3 junk role 进 yfEnter → 落库为 admin，yfIsAdmin()=true（不存 undefined/junk）');
    assert(global.localStorage.getItem('yf_token') === 'tok1', 'S3 yfEnter 正常写入 token');
    /* station role + 预置默认站 */
    global.localStorage._d = {}; gwSaved = null;
    yfEnter({ role: 'station', station: '舒城', username: 'y' }, 'tok2');
    assert(yfIsStation() === true && yfIsAdmin() === false, 'S3 station role 进 yfEnter → yfIsStation()=true');
    assert(gwSaved && gwSaved.st === '舒城', 'S3 station 登录后 GW 预置默认站=本人站（我的成长直接落到本人站）');
    /* 清理函数 */
    global.localStorage.setItem('yf_token', 't'); global.localStorage.setItem('yf_user', 'u'); global.localStorage.setItem('yf_role', 'station'); global.localStorage.setItem('yf_mystation', '舒城');
    lgClearSession();
    assert(!global.localStorage.getItem('yf_token') && !global.localStorage.getItem('yf_user') && !global.localStorage.getItem('yf_role') && !global.localStorage.getItem('yf_mystation'), 'S3 lgClearSession 清净四个会话 key（登出/verify-fail 同一清单）');
    global.document = savedDoc;
  }
})();


/* ================================ 第三部分：学习条理化（js_04 → LR 块） ================================ */
const lrSrc = fs.readFileSync(P.jsBlock('04'), 'utf8');
const la = lrSrc.indexOf('/*LR-BEGIN*/');
const lb = lrSrc.indexOf('/*LR-END*/');
if (la < 0 || lb < 0) { console.log('FAIL LR块标记未找到'); process.exit(1); }
const lrCode = lrSrc.slice(la, lb + '/*LR-END*/'.length);
eval(lrCode);
const T = global.window.__LR_TEST__;
assert(!!T && Array.isArray(T.LR_CH), 'LR 块在沙箱内可加载并暴露测试钩子');

/* 断言 L1：路线选择记忆 */
T.lrS('yf:lr:route', 'B');
assert(T.lrJ('yf:lr:route', null) === 'B', '路线选择记忆：选 B 后可恢复');
T.lrS('yf:lr:route', 'A');
assert(T.lrJ('yf:lr:route', null) === 'A' && T.lrJ('yf:lr:route', null) !== 'B', '路线选择记忆：换路线覆盖旧值');

/* 断言 L2：回到你站三问存取 */
assert(T.LR_CH.length === 16, '正文章节分母为 16（过程组5+知识领域10+敏捷1）');
assert(new Set(T.LR_CH.map(c => c.q1)).size === 16, '三问模板逐章定制（q1 无重复通用句式）');
T.lrS('yf:lr3:ka-comm', { a1: '家长群每天发播报', a2: '', a3: '下月做一次家长开放日', ts: 1700000000000 });
assert(T.lrJ('yf:lr3:ka-comm', null).a3 === '下月做一次家长开放日', '三问存取：存下后可回读');
assert(T.lrDone('ka-comm') === true && T.lrDone('ka-risk') === false, '已落点状态：存过的章 lrDone=true');
T.lrS('yf:lr3:draft:ka-risk', { a3: '这只是草稿', ts: 1 });
const bl = T.lrBacklogItems();
assert(bl.some(i => i.text === '下月做一次家长开放日'), '改进背囊：已落点第 3 问自动汇总');
assert(!bl.some(i => i.text === '这只是草稿'), '改进背囊：草稿（稍后）不进背囊');

/* 断言 L3：读过/已落点双态 + 已学回流诊断卡 */
assert(T.lrLearnedCount() === 0, '已学计数初值：未读为 0（只统计 16 正文章节）');
T.lrMarkRead('ka-comm');
assert(T.lrLearnedCount() === 1, '已学计数：读过 1 章后为 1');
assert(!!global.localStorage.getItem('yf:lr:read'), '读过状态：章节被查看后写入 yf:lr:read');
assert(!!global.localStorage.getItem('yf:diag:learned:ka-comm'), '已学回流：诊断卡锚点章读过 → 写 yf:diag:learned:{anchor}');
assert(T.LR_LEARN_ANCHORS.length === 8 && T.LR_LEARN_ANCHORS.indexOf('pg-exec') >= 0, '回流锚点集合与诊断卡 DG_ANCHOR 一致（8 个）');

/* 断言 L4：断点续学 */
T.lrS('yf:lr:pos', { id: 'ka-risk', y: 1200, pct: 42, ts: 2 });
const pos = T.lrJ('yf:lr:pos', null);
assert(pos.id === 'ka-risk' && pos.pct === 42 && T.LR_NAME[pos.id] === '风险管理', '断点续学：位置与百分比可恢复且能显示章节名');

/* 断言 L5：L3 同行层取帖与降级（capKey 已重挂到新 3 键） */
assert(T.lrFindPost(['outreach', 'family'], []) === null, 'L5 降级：论坛无帖 → null（卡片不显示）');
assert(T.lrFindPost(['family'], [{ title: '无关帖', body: '今天天气不错', bid: 'cases' }]) === null, 'L5 降级：无 capKey 标签命中的帖 → null');
const hit = T.lrFindPost(['family'], [{ title: '无关帖', body: '今天天气不错', bid: 'cases' }, { title: '家长开放日复盘', body: '我们的家长活动这样组织：先让 5 个家长进站看一次', bid: 'cases' }]);
assert(!!hit && hit.title === '家长开放日复盘', 'L5 命中：family（家长活动）标签取到真实帖');
const hitO = T.lrFindPost(['outreach'], [{ title: '学生科普这样组织', body: '每名在营学生每月至少 1 场科普', bid: 'cases' }]);
assert(!!hitO && hitO.title === '学生科普这样组织', 'L5 命中：outreach（学生科普）标签取到真实帖');
assert(T.lrFindPost(['arrive'], [{ title: '学生科普这样组织', body: '每名在营学生每月至少 1 场科普', bid: 'cases' }]) === null, 'L5 旧 capKey（arrive）已不在 LR_CAPS：映射为空 → null');

/* 断言 L6：L3 capKey 标签 ↔ 论坛标签体系一致性（与诊断卡 DG_FORUM_TAG 同源） */
const DG_FORUM_TAG_EXPECT = { outreach: '学生科普', conv: '科普转化', family: '家长活动' };
assert(Object.keys(DG_FORUM_TAG_EXPECT).every(k => T.LR_CAPS[k] && T.LR_CAPS[k].tag === DG_FORUM_TAG_EXPECT[k]) && Object.keys(DG_FORUM_TAG_EXPECT).every(k => DG_FORUM_TAG[k] === DG_FORUM_TAG_EXPECT[k]), 'L6 标签与诊断卡 DG_FORUM_TAG 逐项一致（新 3 键）');
assert(T.LR_CH_TAGS['ka-comm'].indexOf('family') >= 0 && T.LR_CH_TAGS['ka-scope'].indexOf('conv') >= 0 && T.LR_CH_TAGS['ka-res'].indexOf('outreach') >= 0, 'L6 章节回流锚点已重挂到新 capKey（ka-comm→family、ka-scope→conv、ka-res→outreach）');

/* 断言 L7：自测首答统计口径 */
T.lrS('yf:lr:quiz', { q0: { first: true, ts: 1, redo: 0 }, q1: { first: false, ts: 2, redo: 2 }, q2: { first: true, ts: 3, redo: 5 } });
const qs = T.lrQuizStat();
assert(qs.first === 3 && qs.right === 2, '自测口径：首答 3 题对 2（redo 不计入首答、不覆盖）');

/* ===== 断言 B1（学习版块阅读体验 · 版式注入层）：设计规格 §4.2 + §4.6 =====
   两级核对：① 注入层字面量的值对不对；② 被覆盖的课文规则在课文中真的存在（防死 CSS 漂移）。
   课文在 index.html 里是 base64，解码后可核对（同修1 的手法）。 */
{
  const cssOf = lrCode;                                   /* LR 块源码（含 LR_CSS 字面量） */
  const htmlB1 = fs.readFileSync(P.INDEX_HTML, 'utf8');
  const has = s => cssOf.indexOf(s) >= 0;
  /* 注入的是「字符串元素」，JS 注释不进 CSS（st.textContent=LR_CSS）。
     故判 !important 前先剥注释——否则注释里写「不靠 !important」这句说明本身会被误判成「用了 !important」。 */
  const cssNoComment = cssOf.replace(/\/\*[\s\S]*?\*\//g, '');
  /* 覆盖成立的前提：注入 <style> 在课文 <style> 之后 + 不靠 !important 掩盖特异性算错 */
  assert(/d\.head\.appendChild\(st\)/.test(cssOf), 'B1：注入 style 追加到 iframe head 末尾（同特异性下后者胜，覆盖才成立）');
  assert(cssNoComment.indexOf('!important') < 0, 'B1：注入层零 !important（不靠 important 压课文，逼特异性算对）');
  /* B1-1 阅读测量 */
  assert(has('.main{max-width:860px}'), 'B1-1：主列上限 860px');
  assert(has('.deepbox{max-width:34em}') && cssOf.indexOf('.main > .hero > p') >= 0 && cssOf.indexOf('.main > section > .lead') >= 0,
    'B1-1：正文测量 34em（含 hero 段落与 .lead——课文导语是 <div class="lead"> 不是 p，只写 p 会漏掉它）');
  /* B1-2 字号与行高 */
  assert(has('.deepbox{font-size:17px;line-height:1.9;padding:20px 24px}'), 'B1-2：.deepbox 13.5px/1.85 → 17px/1.9');
  assert(has('section h2{font-size:22px;letter-spacing:0}') && has('.box p,.box li{font-size:15.5px;line-height:1.85}') &&
    has('.case .col p,.case .col li{font-size:15px;line-height:1.8}') && has('.lead{font-size:15px'),
    'B1-2：四级层级 22 / 17 / 15.5 / 15 全部落地');
  /* B1-3 章节节奏 */
  assert(has('section{padding:26px 28px;margin-bottom:28px}') && has('.grid2{gap:18px}') && has('.tagrow{gap:12px}'),
    'B1-3：章节节奏（section 内边距/下间距 + 栅格间距）');
  /* B1-4 特异性陷阱：课文警句是 .deepbox .warn（两类），只写 .warn 会被课文压住 */
  assert(has('.deepbox .warn{font-size:15px;line-height:1.8;padding:12px 16px}'),
    'B1-4：★警句覆盖写足 .deepbox .warn（课文是两类选择器，只写 .warn 会被压住）');
  /* B1-5 / B1-6 */
  assert(has('header{display:none}'), 'B1-5：内嵌页 header 收起（省约 96px 阅读高度）');
  assert(has('html,body{overscroll-behavior:contain}'), 'B1-6：滚动链在内嵌文档侧吞掉（外层 iframe 元素上写管不到内层滚动）');
  /* B1-7 窄屏回退 */
  assert(has('@media(max-width:700px){.deepbox{font-size:17px;padding:16px 16px}.main{max-width:100%}section{padding:18px 16px}.toc-btn{min-height:44px}}'),
    'B1-7：320-414px 窄屏回退');
  /* B1-8 侧栏断点 700 → 768：两个「平移时必须显式给」的 display 是本条最易漏的点 */
  const i768 = cssOf.indexOf('@media(min-width:701px) and (max-width:768px){');
  const tail768 = i768 >= 0 ? cssOf.slice(i768) : '';
  assert(i768 >= 0 && tail768.indexOf('.wrap{grid-template-columns:1fr}') >= 0,
    'B1-8：701-768 转单列（消除「两列但正文仅 430px」夹缝态）');
  assert(tail768.indexOf('.toc-btn{display:flex;') >= 0,
    'B1-8：★.toc-btn 必须显式 display:flex（课文 @media(min-width:701px) 里是 display:none，不写就看不见）');
  assert(tail768.indexOf('.side-mask{display:block;') >= 0,
    'B1-8：★.side-mask 必须显式 display:block（课文 ≤700 靠 div 默认 display，平移时必须显式给）');
  /* §4.6② 触摸高：课文 .toc-btn 只有 padding（≈36px 高），窄屏单手操作必须抬到 44px（WCAG 2.5.5）。
     两侧都要有（≤700 与 701-768），漏一侧就有一侧仍是 36px 死角。 */
  assert(/section\{padding:18px 16px\}\.toc-btn\{min-height:44px\}\}/.test(cssOf),
    'B1-7：★.toc-btn 触摸高 ≥44px（≤700 块 / §4.6② / WCAG 2.5.5）');
  assert(/\.toc-btn\{[^}]*min-height:44px/.test(tail768),
    'B1-8：★.toc-btn 触摸高 ≥44px（701-768 块，两侧都抬，不留 36px 死角）');
  /* 注入层只用 iframe 内既有 CSS 变量：硬编码色只允许 #fff */
  const iCss = cssOf.indexOf('var LR_CSS=[');
  const iCssEnd = cssOf.indexOf("].join('\\n')", iCss);
  const lrCssRaw = (iCss >= 0 && iCssEnd > iCss) ? cssOf.slice(iCss, iCssEnd) : '';
  const lrCss = lrCssRaw.replace(/\/\*[\s\S]*?\*\//g, '');   /* 同前：注释不进 CSS，先剥再扫色值 */
  assert(lrCss.length > 0, 'B1：LR_CSS 字面量可提取（后续硬编码色规则的前提）');
  const badHex = (lrCss.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(h => !/^#fff$/i.test(h));
  assert(badHex.length === 0, 'B1：★注入层只用 iframe 内 CSS 变量，硬编码色仅允许 #fff（实际命中的其它色值：' + (badHex.join(',') || '无') + '）');
  /* ② 被覆盖对象确实存在（防死 CSS：课文漂移了，注入层的覆盖就该跟着改） */
  const moB1 = htmlB1.match(/<script type="text\/plain" id="learnSrc">([\s\S]*?)<\/script>/);
  const decB1 = moB1 ? Buffer.from(moB1[1].replace(/\s+/g, ''), 'base64').toString('utf8') : '';
  assert(decB1.indexOf('font-size:13.5px;line-height:1.85') >= 0 && decB1.indexOf('section h2{font-size:19px') >= 0 &&
    decB1.indexOf('.deepbox .warn{') >= 0 && decB1.indexOf('.wrap{max-width:1240px') >= 0,
    'B1：被覆盖的课文规则确实存在（.deepbox 13.5px / h2 19px / .deepbox .warn / .wrap 1240px）');
  assert((decB1.match(/<header/g) || []).length === 1, 'B1-5：课文恰 1 个 <header>，故 header{display:none} 不误伤其它节点');
  assert(decB1.indexOf('@media(max-width:700px)') >= 0 && decB1.indexOf('@media(min-width:701px)') >= 0 && decB1.indexOf('@media(max-width:720px)') >= 0,
    'B1-8：课文断点仍是 700/701/720 —— 768 是注入层叠加，没有改课文');
  /* B1-9 iframe 首帧高度（§4.6）：旧值必须无残留，且 lrFit 仍是运行时唯一权威 */
  assert(htmlB1.indexOf('height:calc(100dvh - 104px)') >= 0 && htmlB1.indexOf('calc(100dvh - 150px)') < 0 &&
    htmlB1.split('height:calc(100dvh - 104px)').length - 1 === 1,
    'B1-9：iframe 首帧高度 150px → 104px，且只有一处定义（旧值零残留）');
  assert(cssOf.indexOf('if(h>320)f.style.height=Math.round(h)+') >= 0,
    'B1-9：lrFit 仍是运行时唯一权威（h>320 才覆盖内联首帧值；小窗回退到内联 104px）');
}

/* ===== 断言 B2（学习版块富形式 · 注入层）：设计规格 §4.3 九类 + §4.4 19 章映射表 =====
   三层核对：
     ① 源码层 —— 九类选择器都进了注入层 CSS；.flow 连接符复用 yfIco（不另起图标体系）；
        映射/表格内容维护在 LR_B2_* 数据对象里（总入口不散 if/else）；注入层源码零 emoji。
     ② 纯函数层 —— b2Terms/b2Steps/b2SubPairs/b2ReadMin/b2CaseTags/b2MetaChips 的行为。
     ③ 真实 DOM 层 —— 把解码后的课文喂进 jsdom，真跑 lrB2Apply：数九类块落地（期望值全部
        从课文自身推导，不硬编码 —— 课文漂移时断言跟着红，而不是静默放过）；课文 19 章 id 与
        顺序不变（课文零改动）；源块「收起而非删除」；幂等；注入层引入的 emoji = 0；
        自测「收尾建议卡」按错题给回看章。
   注：课文在 index.html 里是 base64，解码后可核对（同 B1 的手法）。 */
/* §4.4 映射表的 19 章 = 课文骨架顺序（冻结）。B-4 裁决后：agile 由 B-4 手工编排（§4.5），
   不再走 B2 通用流水 → B2 只处理其余 18 章。期望值由这条骨架**推导**，不硬编码 18。
   （定义在块外：B2 与 B-4 两段断言共用同一条骨架，避免两处各写一份而漂移。） */
const LESSON_CH_IDS = 'intro,pg-init,pg-plan,pg-exec,pg-mon,pg-close,ka-int,ka-scope,ka-sched,ka-cost,ka-qual,ka-res,ka-comm,ka-risk,ka-proc,ka-stake,agile,cases,quiz';
const LESSON_CH_LIST = LESSON_CH_IDS.split(',');
const B2_EXPECT_IDS = LESSON_CH_LIST.filter(x => x !== 'agile').join(',');
{
  const cssOf = lrCode;
  const htmlB2 = fs.readFileSync(P.INDEX_HTML, 'utf8');
  const has = s => cssOf.indexOf(s) >= 0;

  /* ---------- ① 源码层 ---------- */
  const RICH = [
    ['.sec-hero{', '① 章首结论卡'], ['.kcard{', '② 术语要点卡'], ['.tbl{', '③ 对照表'],
    ['.flow{', '④ 过程时间线'], ['.fold{', '⑤ 可折叠长文'], ['.glossary{', '⑥ 术语速查'],
    ['.case-kpi{', '⑦ 案例卡强化'], ['.quiz-bar{', '⑧ 自测强化'], ['.case-filter{', '⑨ 案例筛选条']
  ];
  const missRich = RICH.filter(x => !has(x[0]));
  assert(missRich.length === 0,
    'B2：★§4.3 九类富形式选择器全部进注入层 CSS（缺：' + (missRich.map(x => x[1]).join('/') || '无') + '）');

  /* 切出 B2 模块源码：后续「不另起图标体系 / 零 emoji / 数据驱动」断言都以此为作用域 */
  const iB2 = cssOf.indexOf('var LR_B2_IDS=');
  const iB2e = cssOf.indexOf('/* ---------- 主入口 ---------- */', iB2);
  const b2 = (iB2 >= 0 && iB2e > iB2) ? cssOf.slice(iB2, iB2e) : '';
  const cnt = t => { let n = 0, i = 0; while ((i = b2.indexOf(t, i)) !== -1) { n++; i += t.length; } return n; };
  assert(b2.length > 0, 'B2：B2 模块源码可切片（后续断言的前提）');

  /* team-lead 指令：.flow 连接符复用 yfIco，不另起一套图标体系。
     注意 YF_ICO 表在 js_01（L3563），不在 LR 块内 —— 语义键要在整份 index.html 上核。 */
  assert(b2.indexOf('<svg') < 0, 'B2：★B2 源码零内联 <svg>（连接符全走 yfIco 唯一出口，不另起图标体系）');
  assert(cnt("yfIco('chev'") === 2 && /chev:'<path d="m9 18 6-6-6-6"\/>'/.test(htmlB2),
    'B2：★连接符复用 yfIco(\'chev\',…) 且 chev 语义登记在 YF_ICO 唯一图标表内（2 处：时间线 18px + 回看 14px）');

  /* team-lead 指令：表格/映射内容维护在注入层数据对象里，不要散成几十个 if/else */
  assert(cnt('var LR_B2_') === 7,
    'B2：映射与表格内容维护在 7 个 LR_B2_* 数据对象里（实际 ' + cnt('var LR_B2_') + '）');
  const applyIfs = (b2.slice(b2.indexOf('function lrB2Apply(')).match(/\bif\s*\(/g) || []).length;
  assert(b2.indexOf('function lrB2Apply(') >= 0 && applyIfs <= 4,
    'B2：★总入口是数据驱动流水，不是几十个 if/else（lrB2Apply 内 if 数 = ' + applyIfs + '，上限 4）');

  /* P0-1：注入层源码不得出现 emoji 字面量（分组靠中文关键词匹配，不靠 emoji） */
  const emoRe = () => /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const emoCnt = s => (s.match(emoRe()) || []).length;
  assert(emoCnt(b2) === 0, 'B2：★B2 模块零 emoji 字面量（P0-1）');
  assert(emoCnt(lrCode) === 0, 'B2：★整个 LR 注入层零 emoji 字面量（P0-1）');

  /* ---------- ② 数据对象 & 纯函数（经 __LR_TEST__） ---------- */
  assert(T.LR_B2_IDS.length === LESSON_CH_LIST.length - 1,
    'B2：§4.4 映射表 19 章，B2 通用流水处理其中 18 章（agile 摘出交 B-4 手工编排，实际 ' + T.LR_B2_IDS.length + '）');
  assert(T.LR_B2_IDS.join(',') === B2_EXPECT_IDS && T.LR_B2_IDS.indexOf('agile') < 0,
    'B2：★18 章 id 与顺序冻结 = 19 章课文骨架去掉 agile（错位或漏摘即红）');
  assert(T.LR_B2_IDS.every(id => LESSON_CH_LIST.indexOf(id) >= 0),
    'B2：流水章清单必须全部落在课文 19 章骨架内（不凭空多出章）');
  assert(T.LR_B2_FLOW.length === 5 && T.LR_B2_FLOW.every(id => T.LR_B2_IDS.indexOf(id) >= 0),
    'B2：.flow 章清单 5 章且都在 19 章内（§4.4：intro/pg-plan/ka-int/ka-sched/ka-comm）');
  assert(T.LR_B2_PG5.join(',') === 'pg-init,pg-plan,pg-exec,pg-mon,pg-close',
    'B2：五大过程组清单正确（§4.4 第 1 行 intro 时间线的节点源）');
  assert(!!T.LR_B2_TBL_SEED.intro && T.LR_B2_TBL_SEED.intro.th.length === 2 && T.LR_B2_TBL_SEED.intro.rows.length === 6,
    'B2：§4.4 第 1 行——intro 的「5×10 矩阵怎么用」表在数据对象里（课文推不出来，故走数据对象）');
  const heroKeys = Object.keys(T.LR_B2_HERO);
  assert(heroKeys.length === 3 && heroKeys.every(k => T.LR_B2_IDS.indexOf(k) >= 0) &&
    heroKeys.every(k => T.LR_B2_HERO[k].concl && T.LR_B2_HERO[k].ans.length === 3),
    'B2：3 章补写结论卡（intro/cases/quiz，各 1 结论 + 3 问；其余 15 章取 .lead / LR_CH）');
  assert(T.LR_B2_QUIZ_GO.length === 4 && T.LR_B2_QUIZ_GO.every(g => T.LR_B2_IDS.indexOf(g.to) >= 0 && !!g.label),
    'B2：自测 4 题的「回到「第 N 章」」落点都在 19 章内（§4.3⑧）');
  assert(T.LR_B2_CASE_FILTER.length === 3 && T.LR_B2_CASE_FILTER[0].k === 'all',
    'B2：案例筛选条 3 档（全部 / 失败 / 成功与参照，§4.4 第 18 行）');

  const t1 = T.b2Terms(['项目章程（Project Charter）：一份任命书 + 说明书'])[0];
  assert(!!t1 && t1.n === '项目章程' && t1.e === 'Project Charter' && t1.d === '一份任命书 + 说明书',
    'B2：b2Terms 拆「术语（English）：人话」→ {n,e,d}');
  const t2 = T.b2Terms(['冲刺:固定时长的迭代'])[0];
  assert(!!t2 && t2.n === '冲刺' && t2.e === '' && t2.d === '固定时长的迭代',
    'B2：b2Terms 兼容半角冒号 / 无 English 的写法');
  const s1 = T.b2Steps(['第 1 步：开会——把三件事说清楚'])[0];
  assert(!!s1 && s1.i === 1 && s1.t === '开会' && s1.d === '把三件事说清楚',
    'B2：b2Steps 拆「第 N 步：动作——说明」');
  assert(T.b2SubPairs([1, 2, 3], [4, 5]).length === 2 && T.b2SubPairs([], [1, 2]).length === 0,
    'B2：b2SubPairs 按序配对取小长度（子块配对 / 跨栏对齐的基础）');
  assert(T.b2ReadMin('') === 1 && T.b2ReadMin('a'.repeat(300)) === 1 && T.b2ReadMin('a'.repeat(601)) === 2,
    'B2：b2ReadMin 300 字/分钟且下限 1（不给「0 分钟」这种假读感）');
  const ctags = T.b2CaseTags('范围/集成：xxx 内容。风险：yyy 内容。');
  assert(ctags.join('|') === '范围/集成|风险' && ctags.every(t => t.indexOf('xxx') < 0),
    'B2：b2CaseTags 只取「标签」不取正文（实际 ' + ctags.join('|') + '）');
  const chips = T.b2MetaChips('时间：1995 启用｜规模：17 英里轨道');
  assert(chips.length === 2 && chips[0].k === '时间' && chips[0].v === '1995 启用' && chips[1].k === '规模',
    'B2：b2MetaChips 按「｜」拆 {k,v}（案例数字条的数据源）');

  /* ---------- ③ 真实 DOM 层（jsdom）：课文 → document，真跑 lrB2Apply ---------- */
  const NODE_MODULES = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules';
  let JSDOM = null;
  try { JSDOM = require(NODE_MODULES + '/jsdom').JSDOM; } catch (e) { JSDOM = null; }
  assert(!!JSDOM, 'B2：jsdom 可用（「块真的落地了」只有真跑 DOM 才能证；套件 GATE4 已硬依赖 jsdom）');
  if (JSDOM) {
    const moB2 = htmlB2.match(/<script type="text\/plain" id="learnSrc">([\s\S]*?)<\/script>/);
    const lesson = moB2 ? Buffer.from(moB2[1].replace(/\s+/g, ''), 'base64').toString('utf8') : '';
    assert(lesson.length > 0, 'B2：课文 base64 可解码（课文是只读输入，改造全在注入层）');
    const icoTbl2 = (htmlB2.match(/var YF_ICO=\{[\s\S]*?\n\};/) || [''])[0];
    const icoFn2 = (htmlB2.match(/function yfIco\(name,size\)\{[\s\S]*?\n\}/) || [''])[0];
    /* url 必须给 http(s) origin：about:blank 是 opaque origin，jsdom 的 localStorage 会抛
       SecurityError，被 lrJ/lrS 的 try/catch 吞掉 → 自测相关分支会静默走「未作答」，测了等于没测。 */
    const dom2 = new JSDOM(lesson, { url: 'https://yf.test/', runScripts: 'outside-only', pretendToBeVisual: true });
    const win2 = dom2.window, doc2 = win2.document;
    win2.eval(icoTbl2 + '\n' + icoFn2 + '\nglobalThis.yfIco=yfIco;');
    let ok2 = true;
    try { win2.eval(lrCode); } catch (e) { ok2 = false; }
    const B = win2.__LR_TEST__;
    assert(ok2 && !!B && Array.isArray(B.LR_B2_IDS), 'B2：LR 块能在真实 document 上加载并暴露测试钩子');

    const q2 = s => doc2.querySelectorAll(s).length;
    const idsBefore = [].slice.call(doc2.querySelectorAll('.main > section, .main > .hero')).map(s => s.id);
    assert(idsBefore.join(',') === LESSON_CH_IDS,
      'B2：★课文 19 章 id 与顺序冻结（= §4.4 映射表骨架，防错位）');

    /* 期望值全部从课文自身推导（不硬编码），且**只统计 B2 流水实际处理的章**：agile 已摘出交 B-4，
       若沿用「全文 querySelectorAll」，agile 的 .grid2 / 术语表会被算进 B2 的分母 → 断言假红。 */
    const b2secs = B.LR_B2_IDS.map(id => doc2.getElementById(id)).filter(Boolean);
    assert(b2secs.length === B.LR_B2_IDS.length,
      'B2：18 章在课文里都找得到（流水清单与课文骨架对齐）');
    const grid2N = b2secs.filter(s => s.querySelector('.grid2')).length;
    const caseN = q2('#cases .case');
    const quizN = q2('#quiz .quiz');
    const paraN = items => {
      let m = 0;
      (items || []).forEach(el => {
        if (el.tagName === 'P') m++;
        else m += el.querySelectorAll('p').length;
      });
      return m;
    };
    const grpOf = db => {                       /* 课文 .deepbox 按 h4 关键词分组（只读） */
      const g = {}; let cur = null;
      [].slice.call(db.children).forEach(c => {
        if (/^H[45]$/.test(c.tagName)) {
          cur = null; const t = c.textContent;
          if (t.indexOf('人话版') >= 0) cur = 'f'; else if (t.indexOf('经典案例') >= 0) cur = 'c';
          if (cur) g[cur] = g[cur] || [];
        } else if (cur) g[cur].push(c);
      });
      return g;
    };
    const termN = b2secs.filter(sec => {
      const db = sec.querySelector('.deepbox'); if (!db) return false;
      let hit = false, on = false;
      [].slice.call(db.children).forEach(c => {
        if (/^H[45]$/.test(c.tagName)) on = c.textContent.indexOf('关键术语') >= 0;
        else if (on && c.querySelectorAll('li').length) hit = true;
      });
      return hit;
    }).length;
    /* 可折叠 = 人话版有 >1 段（兜底档，§4.4 第 2 行 pg-init 就是这种）或 经典案例有 >2 段（常规档） */
    const foldableN = b2secs.filter(sec => {
      const db = sec.querySelector('.deepbox'); if (!db) return false;
      const g = grpOf(db);
      return paraN(g.f) > 1 || paraN(g.c) > 2;
    }).length;
    const lessonEmo = emoCnt(new JSDOM(lesson, { url: 'https://yf.test/' }).window.document.body.textContent);

    let runOk2 = true;
    try { B.lrB2Apply(doc2); } catch (e) { runOk2 = false; }
    assert(runOk2, 'B2：lrB2Apply 在真实课文上无异常');

    assert(q2('.sec-hero') === B.LR_B2_IDS.length,
      'B2①：章首结论卡覆盖 B2 全部 18 章（实际 ' + q2('.sec-hero') + '）');
    assert(q2('.tbl') === grid2N + 1,
      'B2③：对照表 = B2 章里课文 .grid2 数 + intro 数据对象表（期望 ' + grid2N + '+1，实际 ' + q2('.tbl') + '）');
    assert(q2('.flow') === B.LR_B2_FLOW.length,
      'B2④：过程时间线覆盖 LR_B2_FLOW 全部 5 章（实际 ' + q2('.flow') + '）');
    assert(q2('.kcard') === termN, 'B2②：术语要点卡数 = B2 章里有「关键术语」列表的章数（期望 ' + termN + '，实际 ' + q2('.kcard') + '）');
    assert(q2('.glossary') === termN, 'B2⑥：术语速查数 = 术语卡数（按章扫描 .kcard 生成，期望 ' + termN + '，实际 ' + q2('.glossary') + '）');
    assert(q2('.fold') === foldableN, 'B2⑤：可折叠长文数 = B2 章里可折叠的章数（期望 ' + foldableN + '，实际 ' + q2('.fold') + '）');
    assert(q2('.case-kpi') === caseN && q2('.case-tag') === caseN && q2('.case-act') === caseN,
      'B2⑦：8 个案例各得 数字条/根因标签/行动条 三件套（期望 ' + caseN + ' 组，实际 ' + q2('.case-kpi') + '/' + q2('.case-tag') + '/' + q2('.case-act') + '）');
    assert(q2('.quiz-bar') === 1 && q2('.case-filter') === 1,
      'B2⑧/⑨：自测正确率条 1 个 + 案例筛选条 1 个（实际 ' + q2('.quiz-bar') + ' / ' + q2('.case-filter') + '）');
    assert(q2('.qz-go') === quizN, 'B2⑧：每道自测题都有「回到第 N 章」（期望 ' + quizN + '，实际 ' + q2('.qz-go') + '）');

    /* §4.4 第 1 行：intro 是 .hero，课文里没有可用的 .flow/.tbl 源 —— 这两块是规格点名要的 */
    const ifl = doc2.querySelector('#intro .flow');
    assert(!!ifl && ifl.querySelectorAll('.fl-n').length === 5,
      'B2：★§4.4 第 1 行——intro 有五大过程组总览时间线（5 节点，实际 ' + (ifl ? ifl.querySelectorAll('.fl-n').length : 0) + '）');
    assert(!!ifl && ifl.querySelectorAll('.fl-c svg').length === 4,
      'B2：intro 时间线 5 节点之间 4 个连接符全部是 yfIco 生成的 <svg>（复用唯一图标出口）');
    const itb = doc2.querySelector('#intro .tbl');
    assert(!!itb && itb.querySelectorAll('tbody tr').length === 6 && itb.textContent.indexOf('5×10') >= 0,
      'B2：★§4.4 第 1 行——intro 有「5×10 矩阵怎么用」对照表（6 行，来自数据对象）');

    /* 零空折叠 / 零错位：块「出现了」还不够，得是能读的 */
    const emptyFolds = [].slice.call(doc2.querySelectorAll('.fold')).filter(f => f.querySelectorAll('.fd-b > p').length === 0).length;
    assert(emptyFolds === 0, 'B2：★零空折叠（每个 .fold 的 summary 都对应真实段数，实际空折叠 ' + emptyFolds + '）');
    const misaligned = [].slice.call(doc2.querySelectorAll('.tbl')).filter(tb => {
      const h = tb.querySelectorAll('thead th').length;
      return [].slice.call(tb.querySelectorAll('tbody tr')).some(r => r.querySelectorAll('td').length !== h);
    }).length;
    assert(misaligned === 0, 'B2：对照表零错位（每行 td 数 = thead th 数，实际错位 ' + misaligned + '）');

    /* §4.4 第 19 行「收尾建议卡」：写入首答状态 → 建议按错题给回看章 */
    win2.localStorage.setItem('yf:lr:quiz', JSON.stringify({ q0: { first: false }, q1: { first: true }, q2: { first: false }, q3: { first: true } }));
    const qe0 = doc2.getElementById('lrQend'); if (qe0 && qe0.parentNode) qe0.parentNode.removeChild(qe0);
    B.lrB2Apply(doc2);
    const qe2 = doc2.querySelector('.quiz-end');
    const qeTxt = qe2 ? qe2.textContent : '';
    assert(!!qe2 && qeTxt.indexOf('首答 2 / 4') >= 0 && qeTxt.indexOf('进度管理') >= 0 && qeTxt.indexOf('范围管理') >= 0,
      'B2：★§4.4 第 19 行——收尾建议卡按错题给出回看章（读 yf:lr:quiz，首答 2/4 → 进度管理 + 范围管理）');

    /* 幂等 + 源块「收起而非删除」：DOM 保留 → 课文文本与既有断言不受影响 */
    const snap = () => ['.sec-hero', '.tbl', '.flow', '.kcard', '.fold', '.glossary', '.case-kpi', '.case-tag', '.case-act',
      '.quiz-bar', '.qz-go', '.case-filter', '.quiz-end'].map(s => q2(s)).join(',');
    const s1snap = snap();
    B.lrB2Apply(doc2);
    assert(snap() === s1snap, 'B2：★幂等——二次运行块数不翻倍（' + s1snap + '）');
    const idsAfter = [].slice.call(doc2.querySelectorAll('.main > section, .main > .hero')).map(s => s.id);
    assert(idsAfter.join(',') === idsBefore.join(','), 'B2：注入后课文 19 章 id 与顺序未变（块都是新增/移动，不改课文骨架）');
    const g2el = doc2.querySelector('#pg-init .grid2');
    assert(!!g2el && g2el.style.display === 'none',
      'B2：★源两栏 .grid2 收起而非删除（DOM 保留，课文文本 / 既有断言不受影响）');
    const hiddenUl = [].slice.call(doc2.querySelectorAll('#pg-init .deepbox ul')).filter(u => u.style.display === 'none').length;
    assert(hiddenUl >= 1, 'B2：源「关键术语」列表收起而非删除（.kcard 接管呈现，实际收起 ' + hiddenUl + ' 个）');

    /* P0-1 注入层口径：课文自带 emoji 保持原样（课文零改动），注入层引入的必须为 0 */
    const afterEmo = emoCnt(doc2.body.textContent);
    assert(afterEmo - lessonEmo === 0,
      'B2：★注入层引入的 emoji = 0（注入后 DOM 文本 emoji ' + afterEmo + ' − 课文原有 ' + lessonEmo + '；课文自带的 📖🔑📚🎯⚠ 属课文内容，零改动）');
  }
}

/* ===== 断言 B-4（敏捷章手工编排 · 注入层）：设计规格 §4.5 六块 =====
   三层核对：
     ① 源码层 —— §4.5 六块选择器都进了 LR_CSS；B-4 源码零内联 <svg>、零 emoji；连接符走 yfIco 唯一出口；
        操作板存储键命名空间化（yf_lr_agile_plan）且不碰 yf:lr:* 既有键；文案/字段维护在 LR_B4_* 数据对象里。
     ② 数据层 —— 六块的逐字文案与数量（价值观 3 列 × 4 行 / Sprint 4 节点 / 术语 7 张 / Spotify 4 列 × 4 行 /
        操作板字段与 maxlength）。
     ③ 真实 DOM 层（jsdom）—— 真跑 lrInjectAll（含 B2 + B-4）：agile 六块都在且文档序 = §4.5 序位、
        其余 18 章仍走 B2 且总数不变、课文 19 章骨架冻结、源块收起而非删除、幂等、注入层引入 emoji = 0；
        行为层：操作板「保存 → 重新载入 → 回填」闭环、maxlength 上限、纯本机、按季分槽（换季不串数据）。 */
{
  const htmlB4 = fs.readFileSync(P.INDEX_HTML, 'utf8');
  const i4 = lrCode.indexOf("var LR_B4_ID='agile';");
  const i4e = lrCode.indexOf('function lrFit(){', i4);
  const b4 = (i4 >= 0 && i4e > i4) ? lrCode.slice(i4, i4e) : '';
  assert(b4.length > 0, 'B-4：B-4 模块源码可切片（后续断言的前提）');

  /* ---------- ① 源码层 ---------- */
  /* 锚点用「基规则原文」而非裸选择器：`.actboard{` 在窄屏/打印回退里也出现，
     裸选择器会让「基规则被改坏」漏检（假绿）。锚到基规则首段才真正承重。 */
  const RICH4 = [
    ['.sec-hero{background:var(--soft)', '① 章首结论卡'], ['.tbl{width:100%;border-collapse:collapse', '② 价值观对照表 / ⑤ Spotify 表'],
    ['.flow{display:flex;flex-wrap:wrap', '③ Sprint 节奏时间线'], ['.kcard{display:grid;grid-template-columns:repeat(2', '④ 术语卡'],
    ['.case.b4-case{display:block', '⑤ Spotify 案例强化（规格点名复用 .case）'], ['.actboard{border:1px solid var(--line)', '⑥ 一页纸操作板']
  ];
  const miss4 = RICH4.filter(x => lrCode.indexOf(x[0]) < 0);
  assert(miss4.length === 0, 'B-4：★§4.5 六块选择器全部进注入层 CSS（缺：' + (miss4.map(x => x[1]).join('/') || '无') + '）');
  assert(lrCode.indexOf('.actboard .ab-in') >= 0 && lrCode.indexOf('@media print{') >= 0 && lrCode.indexOf('@media(max-width:640px){.actboard') >= 0,
    'B-4：操作板「可打印 / 可填写 / 窄屏可用」三态样式齐备（输入框 + 打印回退 + 320-414px 单列）');
  /* 注入层硬编码色只允许 #fff（沿用 B1 口径，B-4 新增行不得引入新色值） */
  const iCss4 = lrCode.indexOf('var LR_CSS=[');
  const iCss4e = lrCode.indexOf("].join('\\n')", iCss4);
  const lrCss4 = (iCss4 >= 0 && iCss4e > iCss4) ? lrCode.slice(iCss4, iCss4e).replace(/\/\*[\s\S]*?\*\//g, '') : '';
  const badHex4 = (lrCss4.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(h => !/^#fff$/i.test(h));
  assert(badHex4.length === 0, 'B-4：★B-4 样式只用课文既有 CSS 变量（硬编码色仅 #fff，实际 ' + (badHex4.join(',') || '无') + '）');

  const cnt4 = t => { let n = 0, i = 0; while ((i = b4.indexOf(t, i)) !== -1) { n++; i += t.length; } return n; };
  assert(b4.indexOf('<svg') < 0, 'B-4：★B-4 源码零内联 <svg>（图标走 yfIco 唯一出口，不另起图标体系）');
  assert(cnt4("yfIco('chev'") === 1, 'B-4：★Sprint 时间线连接符用 yfIco(\'chev\',18)（实际 ' + cnt4("yfIco('chev'") + ' 处）');
  assert((b4.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length === 0,
    'B-4：★B-4 模块零 emoji 字面量（P0-1）');
  assert(cnt4('var LR_B4_') === 8, 'B-4：文案/字段维护在 8 个 LR_B4_* 数据对象里（实际 ' + cnt4('var LR_B4_') + '）');
  const apIfs4 = (b4.slice(b4.indexOf('function lrB4Apply(')).match(/\bif\s*\(/g) || []).length;
  assert(b4.indexOf('function lrB4Apply(') >= 0 && apIfs4 <= 6,
    'B-4：★总入口是数据驱动流水，不散 if/else（lrB4Apply 内 if 数 = ' + apIfs4 + '，上限 6）');
  /* 存储三条硬约束（§4.5⑧） */
  assert(T.LR_B4_STORE === 'yf_lr_agile_plan' && b4.indexOf("'yf_lr_agile_plan'") >= 0,
    'B-4：★操作板存储键 = yf_lr_agile_plan（下划线命名空间 yf_lr_*）');
  assert(b4.indexOf('yf:lr:') < 0 && b4.indexOf('yf:lr3:') < 0 && b4.indexOf('yf_growth_v1') < 0,
    'B-4：★不占用 yf:lr:* / yf:lr3:* / yf_growth_v1 任何既有键（不迁移、不改动，两者并存）');
  const NET4 = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'yfApi', 'navigator.', 'new WebSocket', 'location.href'];
  const netHit4 = NET4.filter(t => b4.indexOf(t) >= 0);
  assert(netHit4.length === 0, 'B-4：★纯本机——B-4 源码无任何网络调用面（命中：' + (netHit4.join(',') || '无') + '）');

  /* ---------- ② 数据层（逐字文案与数量） ---------- */
  assert(T.LR_B4_HERO.concl === '扬帆用「预测型框架 + 敏捷执行」：年度目标与合规红线锁死，执行按月冲刺滚动。' &&
    T.LR_B4_HERO.ans.join('|') === '一个月怎么算一个 Sprint？|站会三问怎么问才不流于形式？|月末复盘到底改什么？' &&
    T.LR_B4_HERO.meta === '预计 6 分钟 · 关联能力：转化设计 / 深度经营',
    'B-4①：章首结论卡逐字（一句话结论 + 读完你能回答 3 问 + 预计 6 分钟 · 关联能力）');
  assert(T.LR_B4_VALUES.th.join('|') === '敏捷价值观|扬帆怎么做|你做错了会怎样' &&
    T.LR_B4_VALUES.rows.length === 4 && T.LR_B4_VALUES.rows.every(r => r.length === 3),
    'B-4②：价值观对照表 3 列 × 4 行（表头逐字）');
  assert(T.LR_B4_SPRINT.nodes.length === 4 && T.LR_B4_SPRINT.nodes.map(n => n.t).join('|') === '月初|每周|月末|季末' &&
    T.LR_B4_SPRINT.nodes[1].d === '站会三问（上周动了什么 / 卡在哪 / 下周动什么），15 分钟',
    'B-4③：Sprint 节奏 4 节点（月初 / 每周 / 月末 / 季末，逐字）');
  assert(T.LR_B4_TERMS.length === 7 &&
    T.LR_B4_TERMS.indexOf('冲刺（Sprint）：固定时长的迭代，一月一冲刺，必须有可交付成果。') >= 0 &&
    T.LR_B4_TERMS.indexOf('四大价值观：个体与互动 / 可工作的成果 / 客户协作 / 响应变化（都大于右边那项）。') >= 0,
    'B-4④：术语 7 张（首末两条逐字）');
  assert(T.LR_B4_SPOTIFY.th.join('|') === 'Spotify 组件|规模|扬帆对应|你的动作' &&
    T.LR_B4_SPOTIFY.rows.length === 4 && T.LR_B4_SPOTIFY.rows.every(r => r.length === 4) &&
    T.LR_B4_SPOTIFY.rows[0].join('|') === 'Squad 小队|6-12 人自治|一个浆站|本县打法自己定，不等人喂',
    'B-4⑤：Spotify 强化表 4 列 × 4 行（表头与首行逐字）');
  assert(T.LR_B4_BOARD.goalFields.length === 2 && T.LR_B4_BOARD.goalFields[0].max === 40 && T.LR_B4_BOARD.goalFields[1].max === 16 &&
    T.LR_B4_BOARD.stand.length === 3 && T.LR_B4_BOARD.retro.length === 4 &&
    T.LR_B4_BOARD.goalsLabel === '本月 3 件（每件都要能验收）' && T.LR_B4_BOARD.standLabel === '每周站会三问（15 分钟）' &&
    T.LR_B4_BOARD.retroLabel === '月末复盘四问（30 分钟）',
    'B-4⑥：操作板字段逐字（本月 3 件 × 目标 ≤40 字 / 验收数字 ≤16 字 + 站会三问 + 复盘四问）');

  /* ---------- ③ 真实 DOM 层（jsdom）：课文 → document，真跑注入 ---------- */
  const NODE_MODULES4 = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules';
  let JSDOM4 = null;
  try { JSDOM4 = require(NODE_MODULES4 + '/jsdom').JSDOM; } catch (e) { JSDOM4 = null; }
  assert(!!JSDOM4, 'B-4：jsdom 可用（六块「真的落地了」只有真跑 DOM 才能证）');
  if (JSDOM4) {
    const mo4 = htmlB4.match(/<script type="text\/plain" id="learnSrc">([\s\S]*?)<\/script>/);
    const lesson4 = mo4 ? Buffer.from(mo4[1].replace(/\s+/g, ''), 'base64').toString('utf8') : '';
    assert(lesson4.length > 0, 'B-4：课文 base64 可解码（课文只读，改造全在注入层）');
    const icoTbl4 = (htmlB4.match(/var YF_ICO=\{[\s\S]*?\n\};/) || [''])[0];
    const icoFn4 = (htmlB4.match(/function yfIco\(name,size\)\{[\s\S]*?\n\}/) || [''])[0];
    /* url 必须给 http(s) origin —— 同 B2 的坑：about:blank 是 opaque origin，
       jsdom 的 localStorage 会抛 SecurityError 被 lrJ/lrS 的 try/catch 吞掉，自测分支会假过。 */
    const dom4 = new JSDOM4(lesson4, { url: 'https://yf.test/', runScripts: 'outside-only', pretendToBeVisual: true });
    const win4 = dom4.window, doc4 = win4.document;
    win4.eval(icoTbl4 + '\n' + icoFn4 + '\nglobalThis.yfIco=yfIco;');
    let ok4 = true;
    try { win4.eval(lrCode); } catch (e) { ok4 = false; }
    const B4 = win4.__LR_TEST__;
    assert(ok4 && !!B4 && typeof B4.lrB4Apply === 'function' && typeof B4.lrInjectAll === 'function' && B4.LR_B4_STORE === 'yf_lr_agile_plan',
      'B-4：LR 块能在真实 document 上加载并暴露 B-4 测试钩子');

    /* 预置既有键（LR 模块的冒号命名空间 + 云端增长数据键）：B-4 全程不得改动/迁移它们。
       断言口径 = 逐字节快照比对 + 除 yf_lr_agile_plan 外零新键。 */
    const SEED4 = {
      'yf:lr:read': '{"pg-init":1}',
      'yf:lr:route': '{"r":"A"}',
      'yf:lr3:pg-init': '{"a1":"x","a2":"","a3":"y","ts":2}',
      'yf_growth_v1': '{"st":"","d":{}}'
    };
    Object.keys(SEED4).forEach(k => win4.localStorage.setItem(k, SEED4[k]));
    const seededSnap4 = Object.keys(SEED4).map(k => k + '=' + win4.localStorage.getItem(k)).join('|');

    const q4 = s => doc4.querySelectorAll(s).length;
    const ag4 = doc4.getElementById('agile');
    const kid = id => doc4.getElementById(id);
    const lessonIdsB4 = [].slice.call(doc4.querySelectorAll('.main > section, .main > .hero')).map(s => s.id);
    assert(lessonIdsB4.join(',') === LESSON_CH_IDS, 'B-4：★注入前课文 19 章骨架冻结（agile 在列，顺序未变）');

    /* 期望值从课文自身推导（与 B2 同口径，只统计 B2 流水处理的 18 章） */
    const b2secs4 = B4.LR_B2_IDS.map(id => doc4.getElementById(id)).filter(Boolean);
    const paraN4 = items => { let m = 0; (items || []).forEach(el => { if (el.tagName === 'P') m++; else m += el.querySelectorAll('p').length; }); return m; };
    const grpOf4 = db => {
      const g = {}; let cur = null;
      [].slice.call(db.children).forEach(c => {
        if (/^H[45]$/.test(c.tagName)) { cur = null; const t = c.textContent;
          if (t.indexOf('人话版') >= 0) cur = 'f'; else if (t.indexOf('经典案例') >= 0) cur = 'c';
          if (cur) g[cur] = g[cur] || []; }
        else if (cur) g[cur].push(c);
      });
      return g;
    };
    const grid2N4 = b2secs4.filter(s => s.querySelector('.grid2')).length;
    const termN4 = b2secs4.filter(sec => {
      const db = sec.querySelector('.deepbox'); if (!db) return false;
      let hit = false, on = false;
      [].slice.call(db.children).forEach(c => {
        if (/^H[45]$/.test(c.tagName)) on = c.textContent.indexOf('关键术语') >= 0;
        else if (on && c.querySelectorAll('li').length) hit = true;
      });
      return hit;
    }).length;
    const foldableN4 = b2secs4.filter(sec => {
      const db = sec.querySelector('.deepbox'); if (!db) return false;
      const g = grpOf4(db);
      return paraN4(g.f) > 1 || paraN4(g.c) > 2;
    }).length;
    const emoRe4 = () => /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const emoCnt4 = s => (s.match(emoRe4()) || []).length;
    const lessonEmo4 = emoCnt4(new JSDOM4(lesson4, { url: 'https://yf.test/' }).window.document.body.textContent);

    let runOk4 = true;
    try { B4.lrInjectAll(doc4); } catch (e) { runOk4 = false; }
    assert(runOk4, 'B-4：lrInjectAll（含 B2 + B-4）在真实课文上无异常');

    /* 其余 18 章仍走 B2：每章仍有章首卡；有 .grid2 的章仍有 B2 对照表 */
    assert(b2secs4.length === B4.LR_B2_IDS.length && b2secs4.every(s => s.querySelector('.sec-hero')),
      'B-4：其余 18 章每章都仍有 B2 章首结论卡（摘出 agile 没误伤别的章）');
    assert(b2secs4.filter(s => s.querySelector('.grid2')).every(s => s.querySelector('.tbl')),
      'B-4：其余有 .grid2 的章仍都有 B2 对照表（B2 流水未被摘改打断）');
    /* 总数不变：全局计数 = B2 单独跑出来的数 + B-4 的固定增量（结论卡 1 / 表 2 / 时间线 1 / 术语卡 1） */
    assert(q4('.sec-hero') === B4.LR_B2_IDS.length + 1,
      'B-4：章首结论卡总数 = B2 的 18 + agile 的 1（实际 ' + q4('.sec-hero') + '）');
    assert(q4('.tbl') === grid2N4 + 1 + 2,
      'B-4：对照表总数 = B2 的（' + grid2N4 + ' 张 grid2 + 1 张 intro 种子）+ agile 的 2 张（实际 ' + q4('.tbl') + '）');
    assert(q4('.flow') === B4.LR_B2_FLOW.length + 1,
      'B-4：时间线总数 = B2 的 5 + agile 的 1（实际 ' + q4('.flow') + '）');
    assert(q4('.kcard') === termN4 + 1, 'B-4：术语卡总数 = B2 的 ' + termN4 + ' + agile 的 1（实际 ' + q4('.kcard') + '）');
    assert(q4('.glossary') === termN4, 'B-4：B2 术语速查数不受影响（实际 ' + q4('.glossary') + '）');
    assert(q4('.fold') === foldableN4, 'B-4：B2 可折叠数不受影响（实际 ' + q4('.fold') + '）');

    /* agile 六块落位：数量与 §4.5 一致 */
    const inAg4 = s => ag4.querySelectorAll(s).length;
    assert(inAg4('.sec-hero') === 1, 'B-4①：agile 章首结论卡 1 个（实际 ' + inAg4('.sec-hero') + '）');
    assert(inAg4('.tbl') === 2, 'B-4②⑤：agile 两张表（价值观 + Spotify，实际 ' + inAg4('.tbl') + '）');
    const vTbl4 = ag4.querySelectorAll('.tbl')[0];
    assert(!!vTbl4 && vTbl4.querySelectorAll('thead th').length === 3 && vTbl4.querySelectorAll('tbody tr').length === 4 &&
      [].slice.call(vTbl4.querySelectorAll('tbody tr')).every(r => r.querySelectorAll('td').length === 3),
      'B-4②：价值观表 3 列 × 4 行（DOM 实测）');
    assert(inAg4('.flow') === 1 && inAg4('.flow .fl-n') === 4 && inAg4('.flow .fl-c svg') === 3,
      'B-4③：Sprint 时间线 1 条 / 4 节点 / 3 个 yfIco 连接符（实际 ' + inAg4('.flow') + '/' + inAg4('.flow .fl-n') + '/' + inAg4('.flow .fl-c svg') + '）');
    assert(inAg4('.kcard') === 1 && inAg4('.kcard .kc') === 7,
      'B-4④：术语卡 1 组 / 7 张（实际 ' + inAg4('.kcard') + '/' + inAg4('.kcard .kc') + '）');
    const sTbl4 = ag4.querySelectorAll('.tbl')[1];
    assert(!!sTbl4 && !!sTbl4.closest('.case') && sTbl4.querySelectorAll('thead th').length === 4 && sTbl4.querySelectorAll('tbody tr').length === 4 &&
      [].slice.call(sTbl4.querySelectorAll('tbody tr')).every(r => r.querySelectorAll('td').length === 4),
      'B-4⑤：Spotify 强化表 4 列 × 4 行且落在 .case 卡里（DOM 实测）');
    assert(inAg4('.actboard') === 1, 'B-4⑥：一页纸操作板 1 个（实际 ' + inAg4('.actboard') + '）');

    /* 序位（§4.5）：章首卡 → 价值观表 → Sprint → 术语卡 → Spotify → 操作板 → 3.A/3.B/C → .r3 */
    const seq4 = ['lrHero_agile', 'lrVal_agile', 'lrSprint_agile', 'lrTerm_agile', 'lrSpot_agile', 'lrAct_agile', 'lrAgile', 'lrR3_agile'].map(kid);
    const inOrder4 = seq4.every(e => !!e) &&
      seq4.every((e, i) => i === 0 || !!(seq4[i - 1].compareDocumentPosition(e) & 4));   /* 4 = DOCUMENT_POSITION_FOLLOWING */
    assert(inOrder4 && seq4.slice(0, 6).every(e => ag4.contains(e)),
      'B-4：★六块与 3.A/3.B/C、.r3 的文档序 = §4.5 序位（全部落在 #agile 内）');
    const h2_4 = ag4.querySelector('h2');
    assert(!!h2_4 && !!h2_4.compareDocumentPosition(kid('lrHero_agile')) && !!(h2_4.compareDocumentPosition(kid('lrHero_agile')) & 4),
      'B-4：★章首结论卡紧随 h2（「章首」语义）');
    /* §4.5⑦：3.A/3.B/3.C 原样保留、入口不重复 */
    const agTxt4 = kid('lrAgile') ? kid('lrAgile').textContent : '';
    assert(agTxt4.indexOf('去「我的成长」回填本月结果') >= 0 && agTxt4.indexOf('带模板去论坛发帖') >= 0 &&
      agTxt4.indexOf('改进背囊') >= 0,
      'B-4⑦：3.A/3.B/3.C 三块与其两个入口原样保留（操作板不替代、不重复入口）');

    /* 源块「收起而非删除」：DOM 保留 + display:none */
    assert(!!ag4.querySelector('.lead') && !!ag4.querySelector('.grid2') && !!ag4.querySelector('.deepbox') && !!ag4.querySelector('.warn'),
      'B-4：课文正文（.lead / .grid2 / .deepbox / .warn）DOM 保留，零删除');
    const hidUl4 = [].slice.call(ag4.querySelector('.deepbox').querySelectorAll('ul')).filter(u => u.style.display === 'none').length;
    assert(hidUl4 === 1, 'B-4：★课文「关键术语」UL 收起而非删除（术语卡接管，实际收起 ' + hidUl4 + ' 个）');
    const hidP4 = [].slice.call(ag4.querySelector('.deepbox').querySelectorAll('p')).filter(p => p.style.display === 'none').length;
    assert(hidP4 === 3, 'B-4：★课文 Spotify 正文 3 段收起而非删除（强化表接管，实际收起 ' + hidP4 + ' 段）');

    /* 幂等 + 骨架不变。注意：lrInjectAll 自身有 `if(lrMapWrap&&LR_INJECTED) return` 早退，
       单跑它证明不了「块级幂等」；必须**直调各总入口**（lrB2Apply / lrB4Apply）才真正二次注入。 */
    const snap4 = () => ['.sec-hero', '.tbl', '.flow', '.kcard', '.fold', '.glossary', '.actboard', '.case-kpi', '.quiz-bar', '.case-filter', '.qz-go'].map(q4).join(',');
    const sig4 = () => [snap4(), ag4.querySelectorAll('*').length, q4('.lr-r3'), q4('.case-kpi'), doc4.querySelectorAll('.actboard').length].join('|');
    const s1_4 = sig4();
    B4.lrInjectAll(doc4); B4.lrB2Apply(doc4); B4.lrB4Apply(doc4);
    assert(sig4() === s1_4,
      'B-4：★幂等——二次注入（lrInjectAll + 直调 lrB2Apply/lrB4Apply）块数/节点数不翻倍（' + snap4() + '）');
    const idsAfter4 = [].slice.call(doc4.querySelectorAll('.main > section, .main > .hero')).map(s => s.id);
    assert(idsAfter4.join(',') === LESSON_CH_IDS, 'B-4：注入后课文 19 章骨架与顺序未变（块都是新增/移动）');

    /* P0-1 口径：注入层引入的 emoji = 0（课文自带 emoji 保持原样） */
    const afterEmo4 = emoCnt4(doc4.body.textContent);
    assert(afterEmo4 - lessonEmo4 === 0,
      'B-4：★B-4（与 B2）注入层引入的 emoji = 0（注入后 ' + afterEmo4 + ' − 课文原有 ' + lessonEmo4 + '）');

    /* ---------- 行为层：操作板保存 → 重新载入 → 回填 → 清空 ---------- */
    const ab4 = kid('lrAct_agile');
    assert(!!ab4 && ab4.querySelectorAll('input[data-f]').length === 13,
      'B-4⑥：操作板 13 个输入框（3 件 × 2 字段 + 站会三问 + 复盘四问，实际 ' + (ab4 ? ab4.querySelectorAll('input[data-f]').length : 0) + '）');
    const ml4 = ab4 ? [].slice.call(ab4.querySelectorAll('input[maxlength]')).map(i => i.getAttribute('data-f') + '=' + i.getAttribute('maxlength')) : [];
    assert(ml4.length === 6 && ml4.filter(x => /^g.t=40$/.test(x)).length === 3 && ml4.filter(x => /^g.v=16$/.test(x)).length === 3,
      'B-4⑥：目标 ≤40 字 / 验收数字 ≤16 字（maxlength 逐字段，实际 ' + ml4.join(',') + '）');
    const ab4Labels = ab4 ? [].slice.call(ab4.querySelectorAll('.ab-l')).map(x => x.textContent).join('') : '';
    assert(['目标：', '验收数字：', '上周动了什么：', '卡在哪：', '下周动什么：', '本月 3 件实际结果如何：', '差距出在哪一环：', '下月保留哪一条：', '下月换掉哪一条：']
      .every(t => ab4Labels.indexOf(t) >= 0),
      'B-4⑥：操作板字段文案逐字（§4.5⑥）');
    const setF4 = (n, v) => { if (!ab4) return; const i = ab4.querySelector('input[data-f="' + n + '"]'); if (i) i.value = v; };
    setF4('g0t', '本月办 2 场开放日'); setF4('g0v', '到场 60 人'); setF4('g2t', '招 3 名小组长'); setF4('g2v', '3 人');
    setF4('s0', '完成 2 场'); setF4('r1', '报名环节漏跟进');
    const btnSave4 = ab4 && ab4.querySelector('.ab-save'); if (btnSave4) btnSave4.onclick();
    const raw4 = win4.localStorage.getItem('yf_lr_agile_plan');
    const slot4 = raw4 ? JSON.parse(raw4)[B4.b4SeasonKey()] : null;
    assert(!!slot4 && Array.isArray(slot4.goals) && slot4.goals.length === 3 &&
      slot4.goals[0].t === '本月办 2 场开放日' && slot4.goals[0].target === '到场 60 人' && slot4.goals[2].t === '招 3 名小组长' &&
      Array.isArray(slot4.standup) && slot4.standup.length === 3 && slot4.standup[0] === '完成 2 场' &&
      Array.isArray(slot4.retro) && slot4.retro.length === 4 && slot4.retro[1] === '报名环节漏跟进' &&
      typeof slot4.savedAt === 'number',
      'B-4：★保存写入 yf_lr_agile_plan[季槽]（goals 3 × {t,target} + standup 3 + retro 4 + savedAt）');
    /* 只写自己那一个键：既有键逐字节不动 + 不产生别的键 */
    const seededNow4 = Object.keys(SEED4).map(k => k + '=' + win4.localStorage.getItem(k)).join('|');
    const extraKeys4 = Object.keys(win4.localStorage).filter(k => k !== 'yf_lr_agile_plan' && !(k in SEED4));
    assert(seededNow4 === seededSnap4 && extraKeys4.length === 0,
      'B-4：★保存只写 yf_lr_agile_plan：既有键（yf:lr:* / yf:lr3:* / yf_growth_v1）逐字节未改、且零新键（多出：' + (extraKeys4.join(',') || '无') + '）');
    /* 重新载入：删掉操作板节点 → 再跑一次注入 → 回填 */
    const abOld4 = kid('lrAct_agile'); if (abOld4 && abOld4.parentNode) abOld4.parentNode.removeChild(abOld4);
    B4.lrB4Apply(doc4);
    const ab5 = kid('lrAct_agile');
    const valF4 = n => { const i = ab5 ? ab5.querySelector('input[data-f="' + n + '"]') : null; return i ? i.value : '<missing>'; };
    assert(valF4('g0t') === '本月办 2 场开放日' && valF4('g0v') === '到场 60 人' && valF4('g2t') === '招 3 名小组长' &&
      valF4('s0') === '完成 2 场' && valF4('r1') === '报名环节漏跟进' && valF4('s2') === '',
      'B-4：★关掉再打开即回填（键存在即回填输入框，空值不伪造默认值）');
    /* 按季分槽：换季不串数据 */
    const slotKey4 = B4.b4SeasonKey();
    const fakeKey4 = (slotKey4 === '2025S') ? '2024S' : '2025S';
    const rawObj4 = JSON.parse(win4.localStorage.getItem('yf_lr_agile_plan') || '{}');
    rawObj4[fakeKey4] = { goals: [{ t: '别季目标', target: '别' }], standup: ['a', 'b', 'c'], retro: ['1', '2', '3', '4'], savedAt: 1 };
    win4.localStorage.setItem('yf_lr_agile_plan', JSON.stringify(rawObj4));
    assert(!!B4.b4Slot() && B4.b4Slot().goals[0].t === '本月办 2 场开放日',
      'B-4：★读的是当前季槽（别季数据不串进来）');
    const btnClear4 = ab5 && ab5.querySelector('.ab-clear'); if (btnClear4) btnClear4.onclick();
    const afterClear4 = win4.localStorage.getItem('yf_lr_agile_plan');
    const leftKeys4 = afterClear4 ? Object.keys(JSON.parse(afterClear4)) : [];
    const leftFake4 = afterClear4 ? JSON.parse(afterClear4)[fakeKey4] : null;
    assert(leftKeys4.join(',') === fakeKey4 && !!leftFake4 && leftFake4.goals[0].t === '别季目标',
      'B-4：★清空只清当前季槽，其它季数据不动（剩余槽 ' + leftKeys4.join(',') + '）');
    const abNow4 = kid('lrAct_agile');
    const clearedVals4 = abNow4 ? [].slice.call(abNow4.querySelectorAll('input[data-f]')).map(i => i.value).join('') : '<missing>';
    assert(clearedVals4 === '', 'B-4：★清空后输入框同步清空（实际残留 "' + clearedVals4 + '"）');
    /* 全程走完，既有键仍逐字节未动 */
    assert(Object.keys(SEED4).map(k => k + '=' + win4.localStorage.getItem(k)).join('|') === seededSnap4,
      'B-4：★保存 / 回填 / 清空全程走完，既有键（yf:lr:* / yf:lr3:* / yf_growth_v1）仍逐字节未动（零迁移、两者并存）');
  }
}

/* ================================ 第四部分：用户验收修复批次（修1-修6） ================================ */
const fsFix = require('fs');
const htmlFixIdx = fsFix.readFileSync(P.INDEX_HTML, 'utf8').indexOf('id="dashWeakTab"');
/* 修1 回归断言：学习断点已还原为 700/720/701（解码实测，不含 1023/1024） */
{
  const htmlFix = fsFix.readFileSync(P.INDEX_HTML, 'utf8');
  const mo = htmlFix.match(/<script type="text\/plain" id="learnSrc">([\s\S]*?)<\/script>/);
  let okBlob = !!mo;
  if (okBlob) {
    const dec = Buffer.from(mo[1].replace(/\s+/g, ''), 'base64').toString('utf8');
    assert(dec.includes('@media(max-width:700px)') && dec.includes('@media(max-width:720px)') && dec.includes('@media(min-width:701px)'), '修1 回归：断点已还原 700/720/701');
    assert(!dec.includes('max-width:1023px') && !dec.includes('min-width:1024px'), '修1 回归：解码后不含 1023px/1024px');
  } else { assert(false, '修1 回归：learnSrc 可提取'); }
}

/* 修2 断言：gwLockStation 纯函数——station 角色强制本人站 */
{
  const srcFix = fsFix.readFileSync(P.jsBlock('02'), 'utf8');
  function grab(re) { const m = srcFix.match(re); return m ? m[0] : null; }
  const gwLock = grab(/function gwLockStation[\s\S]*?\n\}/);
  assert(!!gwLock, '修2：gwLockStation 已注入主脚本');
  if (gwLock) {
    global.yfIsStation = function () { return true; };
    global.yfMyStation = function () { return '舒城'; };
    eval(gwLock);
    assert(gwLockStation('怀远') === '舒城', '修2：station 角色 localStorage 残留站（怀远）被强制为本人站（舒城）');
    global.yfIsStation = function () { return false; };
    assert(gwLockStation('怀远') === '怀远', '修2：admin 行为不变（原值返回）');
    global.yfIsStation = function () { return true; };
  }
  assert(srcFix.indexOf("document.getElementById('viewToggle')") >= 0, '修3：yfFilterNav 含 viewToggle 门控');
  assert(srcFix.indexOf("document.getElementById('dashWeakTab')") >= 0 && srcFix.indexOf("dashView('grid')") >= 0, '修4：yfFilterNav 含需要盯的站门控与全站总览回退');
  assert(htmlFixIdx >= 0, '修4：dashWeakTab 按钮 id 已落盘');
}

/* 修5② 断言：fmtBotText 字面 <br> 归一为换行 + 先转义防注入 */
{
  const srcFix2 = fsFix.readFileSync(P.jsBlock('02'), 'utf8');
  function grab2(re) { const m = srcFix2.match(re); return m ? m[0] : null; }
  const mdEscCode = grab2(/function mdEsc\(s\)\{[^\n]*\}/);
  const inlineFmtCode = grab2(/function inlineFmt\(t\)\{[\s\S]*?\n\}/);
  const fmtCode = grab2(/function fmtBotText\(md\)\{[\s\S]*?\n\}/);
  assert(!!mdEscCode && !!inlineFmtCode && !!fmtCode, '修5②：mdEsc/inlineFmt/fmtBotText 可提取');
  if (mdEscCode && inlineFmtCode && fmtCode) {
    eval(mdEscCode); eval(inlineFmtCode); eval(fmtCode);
    const out1 = fmtBotText('第一行<br>第二行');
    assert(out1.indexOf('&lt;br&gt;') < 0 && out1.indexOf('第一行') >= 0 && out1.indexOf('第二行') >= 0, '修5②：字面 <br> 不再以转义文本残留，按换行渲染');
    const out2 = fmtBotText('<script>alert(1)<\/script>');
    assert(out2.indexOf('&lt;script&gt;') >= 0 && out2.indexOf('<script>') < 0, '修5②：bot 文本先转义，裸 <script> 不进入 innerHTML');
    const out3 = fmtBotText('A\nB');
    assert(out3.indexOf('A') >= 0 && out3.indexOf('B') >= 0 && out3.indexOf('\n') < 0, '修5②：\\n 换行正常渲染，无字面 \\n 残留');
  }
}

/* 修6 断言：yfRetry 网络类失败退避重试、业务失败不重试（微延迟注入） */
{
  const srcFix3 = fsFix.readFileSync(P.jsBlock('02'), 'utf8');
  const mRetry = srcFix3.match(/function yfRetry[\s\S]*?\n\}/);
  assert(!!mRetry, '修6：yfRetry 已注入主脚本');
  let finCount = 0;
  function fin6() { finCount++; if (finCount === 2) { console.log('-----'); console.log('pass=' + pass + ' fail=' + fail); process.exitCode = fail ? 1 : 0; } }
  if (mRetry) {
    eval(mRetry[0]);
    let c1 = 0;
    yfRetry(function () { c1++; return Promise.resolve(c1 < 3 ? { ok: false, network: true } : { ok: true }); }, null, [5, 5])
      .then(function (res) { assert(res.ok === true && c1 === 3, '修6：网络类失败自动重试 2 次后成功（退避 1.5s/4s，测试注入微延迟）'); fin6(); });
    let c2 = 0;
    yfRetry(function () { c2++; return Promise.resolve({ ok: false }); }, null, [5, 5])
      .then(function (res) { assert(c2 === 1 && res.ok === false, '修6：业务失败（4xx，无 network 标记）不重试'); fin6(); });
  } else { fin6(); fin6(); }
}

/* ================================ GW 成长引擎：动态月份 + 四项能力口径（2026-09 用户拍板口径重构，留痕新增） ================================
 * 口径变更：① 剔除「到场把控/入营守成」（集团可控环节）→ 降级「势头参考」；② 深度经营 = 科普转化新卡÷入营（旧采浆份数÷入营为错误口径）；
 * ③ 新增「科普渗透」= 科普数÷入营；④ 健康度档位 A≥3/B=2/C=1/D≤0；⑤ 月份一律从看板实际数据（DASH_DB/DASH_ORDER）推导。
 * 本节为新增断言（旧断言无 GW 能力口径项，无删除）；后续若再改口径，禁止删除断言，只能留痕改写。 */
{
  const gwSrcAll = fs.readFileSync(P.jsBlock('02'), 'utf8');
  const g0 = gwSrcAll.indexOf('成长引擎 GW');
  const w0 = gwSrcAll.indexOf('智能预警规则引擎');
  const z0 = gwSrcAll.indexOf('中台总览数据层');
  assert(g0 >= 0 && w0 > g0 && z0 > w0, 'GW0：成长引擎/预警/中台三区块可定位');
  const GW_SRC = gwSrcAll.slice(g0, w0);
  const WSRC = gwSrcAll.slice(w0, z0);
  const capArr = (GW_SRC.match(/var CAPS = \[([\s\S]*?)\];/) || ['',''])[1];
  const capKeys = (capArr.match(/k:'[a-z]+'/g) || []).map(x => x.slice(3, -1));
  assert(capKeys.join(',') === 'cardper,convper,sciop,parent', 'GW1：CAPS 恰为四项 cardper/convper/sciop/parent（实际 ' + capKeys.join(',') + '）');
  assert(capArr.indexOf("k:'arrive'") < 0 && capArr.indexOf("k:'enroll'") < 0 && capArr.indexOf("k:'volper'") < 0, 'GW2：到场把控/入营守成/旧深度经营(采浆)已剔除出能力排名');
  assert(GW_SRC.indexOf('convper: m.camp0 ? m.conv/m.camp0') >= 0, 'GW3：深度经营新公式 = 科普转化新卡数 ÷ 季累计入营（camp[0]）');
  assert(GW_SRC.indexOf('sciop  : m.camp0 ? m.sci/m.camp0') >= 0, 'GW4：科普渗透 = 科普数 ÷ 季累计入营（camp[0]）');
  assert(GW_SRC.indexOf("k:'volper'") < 0 && GW_SRC.indexOf('m.vol/m.r2') < 0, 'GW5：旧公式（采浆份数 ÷ 入营）根除');
  assert(/function months\(\)/.test(GW_SRC) && GW_SRC.indexOf('DASH_DB') >= 0 && GW_SRC.indexOf('DASH_ORDER') >= 0, 'GW6：月份从看板实际数据动态生成（DASH_DB/DASH_ORDER，兜底内嵌 M6/M7）');
  assert(GW_SRC.indexOf('months:months, curKey:curKey, prevKey:prevKey, monthLabel:monthLabel, spanLabel:spanLabel') >= 0, 'GW7：GW 导出 months/curKey/prevKey/monthLabel/spanLabel');
  assert(GW_SRC.indexOf('_benchKey = key;') >= 0 && GW_SRC.indexOf("months().join(',')") >= 0, 'GW8：bench 缓存键含月份——换月自动重算基准');
  assert(GW_SRC.indexOf('mLabel:monthLabel(ck)') >= 0 && GW_SRC.indexOf("pLabel:pk?monthLabel(pk):''") >= 0, 'GW9：raw 携带当前月/前一月标签（文案不写死）');
  const H = fs.readFileSync(P.INDEX_HTML, 'utf8');
  ['体检结论 · 基于 2026 年 6-7 月', '7 月你站', '6→7月入营势头下滑', '（7月入营 ', '7月入营总规模', '<th>7月入营',
   '数据周期：2026 年 6—7 月', '数据来自 6-7 月真实漏斗', '基于 2026 年 6-7 月真实数据'].forEach(t => {
    assert(H.indexOf(t) < 0, 'GW10：月份硬编码根除：「' + t + '」');
  });
  assert(gwSrcAll.indexOf("到场把控 <b>'+gwFmt(mo.arrive") >= 0 && gwSrcAll.indexOf("入营守成 <b>'+gwFmt(mo.enroll") >= 0, 'GW11：到场把控/入营守成降级至「势头参考」区展示（不进排名不产预警）');
  assert(H.indexOf("n>=3?['A'") >= 0 && H.indexOf('A≥3、B=2、C=1、D≤0') >= 0, 'GW12：健康度档位 A≥3/B=2/C=1/D≤0（四项口径）');
  assert(WSRC.indexOf('bk.B.convper') >= 0 && WSRC.indexOf('bk.B.sciop') >= 0 && WSRC.indexOf('bk.B.arrive') < 0 && WSRC.indexOf('bk.B.enroll') < 0 && WSRC.indexOf('bk.B.volper') < 0, 'GW13：风险预警只挂四项新能力');
  assert(WSRC.indexOf("t:mo.pLabel+'→'+mo.mLabel+'入营势头下滑'") >= 0, 'GW14：势头预警月份从数据推导');
  assert(GW_SRC.indexOf('sciop:{') >= 0 && GW_SRC.indexOf('convper:{') >= 0 && GW_SRC.indexOf('volper:{') < 0 && GW_SRC.indexOf('arrive:{') < 0 && GW_SRC.indexOf('enroll:{') < 0, 'GW15：处方库随口径更新（增 convper/sciop，撤 arrive/enroll/volper）');
  assert(H.indexOf('data-id="ka-qual">深度经营 · 质量管理') >= 0 && H.indexOf('data-id="ka-comm">科普渗透 · 沟通管理') >= 0 && H.indexOf('到场把控 · 沟通管理') < 0 && H.indexOf('入营守成 · 执行过程组') < 0, 'GW16：学习路线 chips 四项新映射（删到场把控/入营守成，新增科普渗透）');
  assert(H.indexOf('20 站排第') < 0 && H.indexOf('｜20 站中位') < 0 && H.indexOf('六项能力条') < 0 && H.indexOf('短板有六项') < 0, 'GW17：「20 站/六项」静态写死根除');
  assert(gwSrcAll.indexOf("bk.n+' 站排第 <b>'") >= 0 && gwSrcAll.indexOf("GW.CAPS.length+' 项") >= 0, 'GW18：站数/项数随数据动态（bk.n / CAPS.length）');
  /* ---- 季合计口径批次（分子分母同源逐月求和；旧「最新月单月」口径已废） ---- */
  assert(GW_SRC.indexOf('camp0:q.camp0') >= 0 && /function seasonRec\(st\)/.test(GW_SRC), 'GW19：raw 携带 camp0（季合计·逐月求和）——四能力分母数据源');
  assert(GW_SRC.indexOf('cardper: m.camp0 ? m.card/m.camp0') >= 0 && GW_SRC.indexOf('m.r2 ? m.card/m.r2') < 0, 'GW20：转化设计分母 = camp0（与 PM 达标线/分布/相关性同源）');
  assert(GW_SRC.indexOf('arr.slice().sort(function(a,b){return a-b;})') >= 0 && GW_SRC.indexOf('arr.filter(function(x){return x>0;})') < 0, 'GW21：中位数含零值全站（PM 口径，剔零会虚高基准）');
  assert(gwSrcAll.indexOf('÷ 入营人数') < 0 && (gwSrcAll.match(/÷ 季累计入营人数/g) || []).length >= 4, 'GW22：CAPS fx/口径说明统一「季累计入营」表述（旧的「÷ 入营人数」根除）');
  assert(gwSrcAll.indexOf("季累计入营 <b>'+r.camp0") >= 0 && gwSrcAll.indexOf("在营 <b>'+r.r2") < 0, 'GW23：诊断事实文案分母与口径同步（camp0/季累计入营）');
  assert(H.indexOf('tot.camp0+=r.camp0') >= 0, 'GW24：集团汇报合计累计 camp0（人均新卡/人均采浆分母同源）');
  /* ================= 时间选择器 + 同比打通（TD） ================= */
  const g2 = gwSrcAll.indexOf('var GW');
  const TD_SRC = gwSrcAll; // 数据层/渲染层/GW 都在 js_02
  const dashSrcDecoded = (() => {
    const tag = '<script type="text/plain" id="dashSrc">';
    const i = H.indexOf(tag), j = H.indexOf('</' + 'script>', i);
    return Buffer.from(H.slice(i + tag.length, j), 'base64').toString('utf8');
  })();
  assert(dashSrcDecoded.indexOf('var HIST=') >= 0 && dashSrcDecoded.indexOf('"2025S"') >= 0 && dashSrcDecoded.indexOf('"2025W"') >= 0, 'TD1：HIST 历史数据块已随 dashSrc 首屏注入（2025S/2025W）');
  assert(TD_SRC.indexOf("function curSeasonKey(){return (new Date().getFullYear())+'S';}") >= 0 && TD_SRC.indexOf('let DASH_SEASON=curSeasonKey();') >= 0, 'TD2：赛季状态声明——默认当年，赛季键由系统时钟推导（跨年自适应，不再写死 2026S）');
  assert(TD_SRC.indexOf('function seasonSrc()') >= 0 && TD_SRC.indexOf('HIST[DASH_SEASON].months') >= 0 && TD_SRC.indexOf('if(DASH_SEASON===curSeasonKey())return DASH_ORDER;') >= 0, 'TD3：数据访问层赛季感知——2026 读 DASH_DB，历史季只读 HIST.months');
  assert(TD_SRC.indexOf('function renderMonthSwitch()') >= 0 && TD_SRC.indexOf('setSeason(') >= 0 && TD_SRC.indexOf('setDashMonth(') >= 0 && TD_SRC.indexOf('onchange="setSeason(this.value)"') >= 0 && TD_SRC.indexOf('onchange="setDashMonth(this.value)"') >= 0 && TD_SRC.indexOf('>整季</option>') >= 0 && TD_SRC.indexOf("class=\"tsel\"") >= 0, 'TD4：两级时间选择器（赛季 + 整季/单月）已实现——下拉形态，赛季/时间两个 select 的 onchange 直连 setSeason/setDashMonth');
  assert(TD_SRC.indexOf('histSeasonList()') >= 0 && TD_SRC.indexOf("Object.keys(HIST).filter") >= 0, 'TD5：历史季清单从 HIST 动态生成（不写死季列表）');
  assert(TD_SRC.indexOf('function dashYoyPairs(s)') >= 0 && TD_SRC.indexOf("['入营','reg',2],['学生新卡','dev',0],['学生采量','dev',1],['科普人次','dev',3],['科普转化新卡','dev',4]") >= 0, 'TD6：同比五指标 = 入营/学生新卡/采量/科普/科普转化新卡');
  assert(TD_SRC.indexOf('function yoyPct(cur,base){if(cur===null||base===null||base===0)return null;') >= 0, 'TD7：同比分母为 0 或任一侧缺数 → null（前端显示「—」）');
  assert(TD_SRC.indexOf('今年新增统计项') >= 0 && TD_SRC.indexOf('无去年基线，不作同比') >= 0, 'TD8：家长参与不显示同比，标注「今年新增统计项」');
  assert(TD_SRC.indexOf('去年基线') >= 0 && TD_SRC.indexOf('不嵌套同比') >= 0, 'TD9：2025 视图显示「去年基线」角标，不嵌套同比');
  assert(TD_SRC.indexOf('function seasonHasStation(s)') >= 0 && TD_SRC.indexOf('未开展，无当季数据（不以 0 充数）') >= 0, 'TD10：未开展站（如丰镇 2025）显示「未开展」，不以 0 冒充数据');
  assert(TD_SRC.indexOf('function histBaseSeason()') >= 0 && TD_SRC.indexOf("histSeasonList().indexOf('2025S')>=0)?'2025S':null") >= 0, 'TD11：同比基线 = HIST 同类型历史季（2026S→2025S），逐月合计口径（HIST.season）');
  assert(TD_SRC.indexOf("'all'?'整季合计':(m+'月')") >= 0, 'TD12：dMonthLabel 标签语义 =「整季合计」');
  assert(TD_SRC.indexOf('function dashDB(){ /* 跟随看板赛季选择') >= 0 && TD_SRC.indexOf('ms.indexOf(DASH_CUR)>=0) return DASH_CUR;') >= 0, 'TD13：我的成长（GW）跟随看板赛季与月份选择');
  assert(TD_SRC.indexOf('if(DASH_SEASON===curSeasonKey())DASH_CUR=dLatest()||\'all\';') >= 0, 'TD14：云端数据应用不打断历史季只读视图');
  assert(TD_SRC.indexOf("payload={col:'dash_data',data:DASH_DB}") >= 0 && TD_SRC.indexOf('DASH_DB=HIST') < 0 && (TD_SRC.match(/HIST=(?!=)/g) || []).length === 1, 'TD15：HIST 只读——不进上传/云端（payload 原样），无任何 HIST 赋值');
  assert(TD_SRC.indexOf('const latestM=DASH_ORDER.length?DASH_ORDER[DASH_ORDER.length-1]:null;') >= 0, 'TD16：下载模版/上传链路永远读 2026 权威数据（不受赛季选择影响）');
  assert(TD_SRC.indexOf('function dCurTotN(key,idx)') >= 0 && TD_SRC.indexOf('function dRecVal(rec,key,idx){if(!rec||!rec[key])return null;') >= 0, 'TD17：null 语义取数（缺失字段=null→「—」，与 0 严格区分）');
  assert(H.indexOf('id="dashYoy"') >= 0, 'TD18：同比面板容器已挂看板 KPI 区之后');
}

/* ================================ 第五部分：论坛扩容 FBE（js_06 → FBE-BEGIN/END） ================================ */
/* 私信 / 版主角色显隐 / 积分规则勋章校验 / 档案白名单 —— 纯函数走 __FBE_TEST__ 导出，接线走源码断言 */
{
  const srcFBE = fs.readFileSync(P.jsBlock('06'), 'utf8');
  const fa = srcFBE.indexOf('/*FBE-BEGIN*/');
  const fbz = srcFBE.indexOf('/*FBE-END*/');
  assert(fa >= 0 && fbz > fa, 'FBE0：FBE 块标记存在于 js_06');
  const htmlMain = fs.readFileSync(P.INDEX_HTML, 'utf8');
  function cntIn(hay, t) { let n = 0, i = 0; while ((i = hay.indexOf(t, i)) !== -1) { n++; i += t.length; } return n; }
  if (fa >= 0 && fbz > fa) {
    const fbeCode = srcFBE.slice(fa, fbz + '/*FBE-END*/'.length);
    const emFBE = fbeCode.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
    assert(!emFBE, 'FBE0b：FBE 块零 emoji');
    (function () {
      const window = {};
      function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      eval(fbeCode);
      const T = window.__FBE_TEST__;
      assert(!!T && typeof T.fbeCanMod === 'function', 'FBE1：__FBE_TEST__ 导出可用');
      /* ---- 私信 threadId（与服务端 dmThreadId 同构：[a,b].sort().join('|')） ---- */
      assert(T.fbeThreadId('a', 'b') === 'a|b', 'FBE2：threadId 拼接');
      assert(T.fbeThreadId('李四', '张三') === '张三|李四', 'FBE3：threadId 字典序与后端同构');
      /* ---- 角色显隐矩阵：admin 全量 > 超版全版块 > 版主限本版块 ---- */
      const R = { super: ['超一'], boards: { recruit: ['版一'], camp: ['版二'] } };
      assert(T.fbeCanMod('admin1', 'recruit', R, true) === true, 'FBE4：admin 全量可操作');
      assert(T.fbeCanMod('超一', 'camp', R, false) === true, 'FBE5：超版全版块可操作');
      assert(T.fbeCanMod('版一', 'recruit', R, false) === true, 'FBE6：版主本版块可操作');
      assert(T.fbeCanMod('版一', 'camp', R, false) === false, 'FBE7：版主跨版块拒绝');
      assert(T.fbeCanMod('', 'recruit', R, false) === false, 'FBE8：未登录拒绝');
      assert(T.fbeCanMod('路人', 'recruit', R, false) === false, 'FBE9：普通用户拒绝');
      assert(T.fbeRoleOf('admin1', R, true) === 'admin', 'FBE10：roleOf admin');
      assert(T.fbeRoleOf('超一', R, false) === 'super', 'FBE11：roleOf super');
      assert(T.fbeRoleOf('版二', R, false) === 'mod', 'FBE12：roleOf mod');
      assert(T.fbeRoleOf('路人', R, false) === '', 'FBE13：roleOf 普通用户为空');
      assert(T.fbeBadgeHTML('admin1', R, true).indexOf('管理员') >= 0, 'FBE14：管理员徽章');
      assert(T.fbeBadgeHTML('超一', R, false).indexOf('超版') >= 0, 'FBE15：超版徽章');
      assert(T.fbeBadgeHTML('版一', R, false).indexOf('版主') >= 0, 'FBE16：版主徽章');
      assert(T.fbeBadgeHTML('路人', R, false) === '', 'FBE17：无角色无徽章');
      /* ---- 勋章 chip ---- */
      assert(T.fbeMedalsHTML(null) === '' && T.fbeMedalsHTML([]) === '', 'FBE18：无勋章渲染空串');
      const mh = T.fbeMedalsHTML([{ id: 'x', name: '初出茅庐', desc: '发布第一帖' }]);
      assert(mh.indexOf('初出茅庐') >= 0 && mh.indexOf('发布第一帖') >= 0, 'FBE19：勋章 chip 含 name 与 desc title');
      /* ---- dm 校验（1-500 字） ---- */
      assert(T.fbDmValidate('') !== '' && T.fbDmValidate('   ') !== '', 'FBE20：空/纯空白私信拦截');
      assert(T.fbDmValidate('x'.repeat(501)) !== '', 'FBE21：501 字拦截');
      assert(T.fbDmValidate('x'.repeat(500)) === '' && T.fbDmValidate('你好') === '', 'FBE22：500 字与正常文本放行');
      assert(T.dmErrMsg({ error: 'rate_limited' }).indexOf('50') >= 0, 'FBE23：429 文案含每日 50 条上限');
      assert(T.dmErrMsg(null) !== '' && T.dmErrMsg({ network: true, error: '网络异常，无法连接服务器' }) === '网络异常，无法连接服务器', 'FBE24：网络错误透传人工文案');
      /* ---- rules 编辑校验（镜像后端 validRulesPayload） ---- */
      assert(T.frRulesValidate({ post_new: 5, reply: 2 }, [{ id: 'a', name: '甲' }]) === '', 'FBE25：合法 rules 通过');
      assert(T.frRulesValidate({ post_new: -1 }, []) !== '', 'FBE26：负数积分拒绝');
      assert(T.frRulesValidate({ post_new: 1.5 }, []) !== '', 'FBE27：非整数积分拒绝');
      assert(T.frRulesValidate({ post_new: 1 }, [{ id: 'a', name: '甲' }, { id: 'a', name: '乙' }]) !== '', 'FBE28：medalId 重复拒绝');
      assert(T.frRulesValidate({ post_new: 1 }, [{ id: '', name: '甲' }]) !== '' && T.frRulesValidate({ post_new: 1 }, [{ id: 'a', name: '' }]) !== '', 'FBE29：空 id / 空 name 拒绝');
      assert(T.frRulesValidate(null, []) !== '' && T.frRulesValidate({}, 'x') !== '', 'FBE30：结构非法拒绝');
      /* ---- 档案表单白名单过滤（镜像后端 sanitizeProfileFields 语义） ---- */
      const f1 = T.pfSanitize(' 张三 ', ' 站长 3 年 ', null, ' 一句话 ');
      assert(f1.owner === '张三' && f1.exp === '站长 3 年' && f1.bio === '一句话', 'FBE31：pfSanitize trim 与字段保留');
      const f2 = T.pfSanitize('station', 'level', 'tag', 'note');
      assert(!('station' in f2) && !('level' in f2) && !('tag' in f2) && !('note' in f2), 'FBE32：白名单外字段全丢弃');
      assert(Object.keys(T.pfSanitize('', '', '', '')).length === 0, 'FBE33：全空不产生任何字段');
      assert(T.pfSanitize('x'.repeat(30), '', '', '').owner.length === 20, 'FBE34：owner 截 20 字');
      assert(T.pfSanitize('', 'x'.repeat(300), '', '').exp.length === 200, 'FBE35：exp 截 200 字');
      assert(T.pfSanitize('', '', '', 'x'.repeat(50)).bio.length === 30, 'FBE36：bio 截 30 字');
      assert(!('avatar' in T.pfSanitize('', '', 'data:image/png;base64,' + 'A'.repeat(3000), '')), 'FBE37：超 2000 字符 dataURL 不进 payload（防后端截断出脏数据）');
      assert(('avatar' in T.pfSanitize('', '', 'data:image/png;base64,AAA', '')), 'FBE38：小 dataURL 走白名单通道');
      /* ---- pending 双态文案 ---- */
      assert(T.pfPendingText(null) === '' && T.pfPendingText({}) === '', 'FBE39：无 pending 渲染空串');
      const pt = T.pfPendingText({ fields: { owner: '张三' }, submittedAt: new Date(2026, 8, 9, 10, 30).getTime() });
      assert(pt.indexOf('已提交') >= 0 && pt.indexOf('待管理员') >= 0 && pt.indexOf('09-09 10:30') >= 0, 'FBE40：pending 文案含状态与提交时间');
      /* ---- 契约接线（源码断言，端点/形状取自后端实读） ---- */
      assert(cntIn(fbeCode, "'/v1/forum/dm','POST'") >= 1 && cntIn(fbeCode, "'/v1/forum/dm','GET'") >= 2, 'FBE41：dm GET(列表/会话)/POST 端点');
      assert(fbeCode.indexOf('action:action') >= 0 && cntIn(fbeCode, "'grant'") >= 1 && cntIn(fbeCode, "'revoke'") >= 1, 'FBE42：medals grant/revoke 动作分发');
      assert(fbeCode.indexOf("'/v1/profiles/approve','POST'") >= 0 && fbeCode.indexOf('decision:decision') >= 0 && fbeCode.indexOf("'approve'") >= 0 && fbeCode.indexOf("'reject'") >= 0, 'FBE43：approve 契约 station+decision+note');
      assert(fbeCode.indexOf("'/v1/forum/rules','POST'") >= 0 && fbeCode.indexOf('points:pts') >= 0 && fbeCode.indexOf('medals:medals') >= 0, 'FBE44：rules 全量覆写 points+medals（勋章增删改走此端点）');
      assert(fbeCode.indexOf("'/v1/profiles/mine','POST'") >= 0 && fbeCode.indexOf("'/v1/profiles/mine','GET'") >= 0, 'FBE45：profiles/mine 提交与回读');
      assert(fbeCode.indexOf("'/v1/profiles/pending','GET'") >= 0 && fbeCode.indexOf("'/v1/forum/medals','POST'") >= 0 && fbeCode.indexOf("'/v1/forum/roles','POST'") >= 0, 'FBE46：待审列表/勋章授予/角色保存端点');
      assert(cntIn(htmlMain, 'fbeCanMod') >= 3 && htmlMain.indexOf('const canMod=') >= 0, 'FBE47：fbDetail canMod 接线（含 typeof 守卫）');
      assert(cntIn(htmlMain, 'fbSetTop') >= 2 && cntIn(htmlMain, 'fbDelPost') >= 2, 'FBE48：置顶/删帖函数定义+调用');
      assert(cntIn(htmlMain, 'fbDmPoll') >= 3 && htmlMain.indexOf("if(typeof fbDmPoll==='function')") >= 0, 'FBE49：startForumPoll 挂 fbDmPoll');
      assert(htmlMain.indexOf('if(typeof fbeBoot==="function")') >= 0, 'FBE50：fbInit 挂 fbeBoot');
      assert(htmlMain.indexOf('frLoadAdmin()') >= 0 && htmlMain.indexOf('pfLoadPending()') >= 0, 'FBE51：论坛管理挂角色+档案审核加载');
      /* ---- 论坛管理独立模块 + 私信发起新会话 + 双 fbInit 去重（2026-09-10 批次） ---- */
      assert(cntIn(htmlMain, '<section id="forumadmin">') === 1, 'FBE58：forumadmin 独立分区页面');
      assert(htmlMain.indexOf('data-tab="forumadmin"') >= 0 && /YF_ADMIN_ONLY\s*=\s*\{[^}]*forumadmin:1/.test(htmlMain), 'FBE59：侧栏入口 + admin-only 白名单');
      assert(cntIn(htmlMain, 'id="frRoles"') === 1 && cntIn(htmlMain, 'id="frRules"') === 1 && cntIn(htmlMain, 'id="frMedals"') === 1 && cntIn(htmlMain, 'id="pfPendingList"') === 1, 'FBE60：四个分区容器各一份');
      assert(cntIn(htmlMain, '论坛角色（超级版主 / 版主）') === 0 && cntIn(htmlMain, '<div class="um-sub">积分与勋章</div>') === 0, 'FBE61：账号弹窗三区已迁出（恢复清爽）');
      const fbInitCount = cntIn(htmlMain, 'function fbInit');
      const fbInitLine = (htmlMain.match(/function fbInit\(\)\{[^\n]*/) || [''])[0];
      assert(fbInitCount === 1 && fbInitLine.indexOf('fbeBoot') >= 0 && fbInitLine.indexOf('expInit') >= 0, 'FBE62：双 fbInit 合并为一个且带 fbeBoot+expInit 全职责');
      assert(htmlMain.indexOf("tab==='forumadmin'") >= 0, 'FBE63：applyTab 分发论坛管理渲染');
      /* FBE64/65 改口径：发起私信由「手打精确账号名」升级为「联系人下拉选择 + 空态快捷 chips」 */
      assert(cntIn(htmlMain, 'fbDmStart') >= 2 && htmlMain.indexOf('id="dmPeerSel"') >= 0 && htmlMain.indexOf('id="dmNewPeer"') < 0, 'FBE64：私信发起改为联系人下拉选择（不再手打账号名）');
      assert(htmlMain.indexOf('function fbDmContacts') >= 0 && htmlMain.indexOf("/v1/forum/contacts','GET'") >= 0 && htmlMain.indexOf("'/accounts','GET'") >= 0 && htmlMain.indexOf('FB_ROLES.super') >= 0, 'FBE65：联系人名单四来源（forum/contacts 权威 + admin /accounts 降级 + 论坛作者 + 版主超版）');
      assert(apiSrc.indexOf("p === 'forum/contacts'") >= 0 && apiSrc.indexOf('a.username !== user.username') >= 0 && apiSrc.indexOf("station: a.station || '' })") >= 0, 'FBE69：后端 forum/contacts 端点（全员可读、剔除自己、只回传 username/role/station）');
      assert(fbeCode.indexOf('function fbeDmBigSafe') >= 0 && fbeCode.indexOf("u===yfUsername()") >= 0 && htmlMain.indexOf("fbeDmBigSafe(au)") >= 0, 'FBE70：帖子详情「私信 TA」本人的帖子不渲染（与列表页 fbeDmMiniSafe 同口径）');
      assert(fbeCode.indexOf('function fbDmEnsureMask') >= 0 && fbeCode.indexOf('var m=fbDmEnsureMask();') >= 0, 'FBE71：dmMask 惰性创建——「私信 TA」直连路径不再静默返回');
      assert(fbeCode.indexOf('function fbDmResolveName') >= 0 && fbeCode.indexOf('_frAccts') >= 0 && fbeCode.indexOf("split('·')[0]") >= 0, 'FBE72：作者显示名（叶集·窦志鹏）解析回真实账号，且账号表优先于联系人名单精确匹配');
      assert(fbeCode.indexOf('fbDmTo(enc,true)') >= 0 && fbeCode.indexOf('(out.length||full)?out:null') >= 0, 'FBE73：名单未就绪时先加载再发起（一次性重试防循环），空结果不缓存');
      assert(htmlMain.indexOf("if(typeof fbeBoot==='function'){ try{ fbeBoot(); }catch(e){} }") >= 0, 'FBE74：fbeBoot 跨脚本块补调用（块#5 fbInit 执行时块#11 尚未定义，预载/未读轮询从未启动）');
      assert(fbeCode.indexOf('fbe-ct-chip') >= 0 && fbeCode.indexOf('fbDmRenderList([])') >= 0, 'FBE67：空态推荐联系人 chips + 名单晚到补渲染');
      assert(fbeCode.indexOf("j.error==='not_found'") >= 0 && fbeCode.indexOf('FB_DM_CONTACTS_FULL') >= 0, 'FBE68：账号不存在前置拦截 + 发送 404 退回会话列表');
      assert(fbeCode.indexOf("getElementById('frMedals')") >= 0 && fbeCode.indexOf('if(pbox&&mbox)') >= 0, 'FBE66：frRenderRules 积分/勋章双容器拆分（单容器兼容）');
      assert(htmlMain.indexOf('onclick="pfOpen()"') >= 0 && cntIn(htmlMain, '完善我的档案') >= 2, 'FBE52：档案按钮（station 本人可见）');
      assert(htmlMain.indexOf("fbeFillMedals(au,'fbeMedalsDetail')") >= 0 && htmlMain.indexOf("fbeFillMedals(au,'fbeMedalsProf')") >= 0, 'FBE53：详情/空间勋章异步填充');
      assert(htmlMain.indexOf('fbDmTo') >= 0 && htmlMain.indexOf('私信功能即将上线') < 0, 'FBE54：私信真实化，占位文案清除');
      const stCode = htmlMain.match(/const rep=thread\*_pt[^\n]*/);
      assert(!!stCode && stCode[0].indexOf('post_new') >= 0 && stCode[0].indexOf('liked_recv') >= 0 && htmlMain.indexOf("_pt('avatar_set',0)") >= 0 && htmlMain.indexOf("_pt('bio_set',0)") >= 0, 'FBE55：fbStats 声望公式读规则配置（含一次性头像/简介加成）');
      assert(cntIn(htmlMain, 'id="fbDmDot"') === 1, 'FBE56：侧栏论坛项小红点');
      assert(htmlMain.indexOf('fbe-medal') >= 0 && htmlMain.indexOf('fbe-pf-pending') >= 0 && htmlMain.indexOf('@media(max-width:414px)') >= 0, 'FBE57：FBE CSS（徽章/待审条/移动端 414 断点）');
      /* ===== 私信发送延迟优化（乐观上屏 / 单次 POST）FBE75-FBE82 ===== */
      const dmSendBody = (fbeCode.match(/function fbDmSend\([\s\S]*?\n\}/) || [''])[0];
      assert(dmSendBody.length > 0 && dmSendBody.indexOf('fbDmThread(') < 0, 'FBE75：fbDmSend 成功分支不再调 fbDmThread（双 GET 与整窗重建消除）');
      assert(fbeCode.indexOf('var FB_DM_MSGS=[];') >= 0 && fbeCode.indexOf('FB_DM_MSGS=j.messages') >= 0, 'FBE76：FB_DM_MSGS 本地副本声明 + 会话 GET 回调写入');
      assert(fbeCode.indexOf('function fbDmResend(') >= 0 && fbeCode.indexOf('fbe-resend') >= 0 && fbeCode.indexOf("fbDmResend(\\'") >= 0, 'FBE77：fbDmResend 存在且失败气泡绑定重发');
      assert(dmSendBody.indexOf('FB_DM_MSGS.push(') >= 0 && dmSendBody.indexOf("_state:'sending'") >= 0 && dmSendBody.indexOf("'POST'") < 0, 'FBE78：乐观上屏——POST 之前先 push sending 气泡（POST 已抽离到 fbDmPost）');
      assert(fbeCode.indexOf('.fbe-bub.fbe-sending') >= 0 || htmlMain.indexOf('.fbe-bub.fbe-sending') >= 0, 'FBE79：发送中气泡样式');
      assert(htmlMain.indexOf('.fbe-bub.fbe-fail{background:#fdeaea') >= 0, 'FBE80：失败气泡浅红配色（与 fbe-me/fbe-them 浅色气泡同色系，不用深底色）');
      assert(fbeCode.indexOf('function fbDmPost(') >= 0 && (fbeCode.match(/yfApi\('\/v1\/forum\/dm','POST'/g) || []).length === 1, 'FBE81：POST 抽离到 fbDmPost 且全文仅一处私信 POST 调用');
      assert(dmSendBody.indexOf('dmSendBtn') < 0 && dmSendBody.indexOf('btn.disabled') < 0 && fbeCode.indexOf('inp.focus();') >= 0, 'FBE82：发送不再禁用控件且输入框保持焦点');
      /* mid 全链路一致性：渲染层传出完整 _id，比对层不得再拼 local_ 前缀（否则重发永久失配） */
      const dmPostBody = (fbeCode.match(/function fbDmPost\([\s\S]*?\n\}/) || [''])[0];
      const dmResendBody = (fbeCode.match(/function fbDmResend\([\s\S]*?\n\}/) || [''])[0];
      assert(dmPostBody.indexOf("'local_'+") < 0 && dmResendBody.indexOf("'local_'+") < 0 && dmResendBody.indexOf('._id===mid') >= 0, 'FBE83：本地气泡 id 全链路传完整 _id，重发比对不再二次拼前缀');
      /* ===== 角色隔离加固（2026-09-08「该在管理端出现的就不要在员工端出现」）===== */
      const roleFn = (htmlMain.match(/function yfRole\(\)\{[^\n]*\}/) || [''])[0];
      assert(roleFn.length > 0 && roleFn.indexOf("||'admin'") < 0 && roleFn.indexOf("return 'admin'") < 0 && (roleFn.match(/'station'/g) || []).length === 2,
        'FBE84：yfRole() 最小权限默认值——yf_role 缺失/异常时返回 station，绝不 fail-open 成 admin（登出残留一屏会画出管理端 UI）');
      assert(htmlMain.indexOf('var YF_ADMIN_ONLY = {hq:1, exp:1, forumadmin:1};') >= 0, 'FBE85：管理端专属板块清单（hq/exp/forumadmin）未被改动，yfFilterNav 与 applyTab 双重上锁依赖它');
      const filterNavBody = (htmlMain.match(/function yfFilterNav\(\)\{[\s\S]*?\n\}/) || [''])[0];
      ['wbAdmin', 'hqReportCard', 'hqPptBtn', 'dashUpBtn', 'viewToggle', 'dashWeakTab'].forEach(function (cid) {
        assert(filterNavBody.indexOf("getElementById('" + cid + "')") >= 0, 'FBE86-' + cid + '：管理专属控件仍在 yfFilterNav 角色开关内（漏一个就会在员工端露出）');
      });
      /* ===== 热门话题方案二 + 档案入口迁移 + 年度自报三卡片（FBE87-FBE95） ===== */
      assert(htmlMain.indexOf('let _fbHotOpen=false') >= 0 && htmlMain.indexOf('function fbHotToggle') >= 0 && htmlMain.indexOf('id="fbHotToggleBtn"') >= 0 && htmlMain.indexOf("_fbHotOpen?'收起':'更多热门 ›'") >= 0,
        'FBE87：热门话题默认 4 张/展开 8 张——开关状态 + 按钮双态文案「更多热门/收起」');
      assert(htmlMain.indexOf('#1a4a7a 40%,#2b7cd3') < 0 && htmlMain.indexOf('#1e4468 100%') >= 0 && htmlMain.indexOf('padding:14px 16px 12px') >= 0 && htmlMain.indexOf('.fb-hot-toggle{flex-shrink:0') >= 0,
        'FBE88：热门区减压——渐变尾端收蓝 #1e4468（旧尾端 #2b7cd3 收掉）、padding/margin 收紧、pill 展开按钮样式（移动端替换副标占位）');
      const hotExport = fbeCode.indexOf('fbHotSlice:(typeof fbHotSlice===') >= 0;
      assert(htmlMain.indexOf('slice(0,open?8:4)') >= 0 && hotExport,
        'FBE89：fbHotSlice 纯函数（排序口径不变，默认 4 / 展开 8）并经 __FBE_TEST__ 导出');
      assert(htmlMain.indexOf('更新我的信息') >= 0 && htmlMain.indexOf('yf_pf_hint_dismissed') >= 0 && cntIn(htmlMain, 'pfHintDismiss') >= 2 && htmlMain.indexOf('此信息由集团内置，建议核对更新') >= 0,
        'FBE90：gwFile 起点卡常驻「更新我的信息」（仅 station）+ 一次性核对提示（可关闭，localStorage 记忆）');
      assert(fbeCode.indexOf('id="pfPost"') >= 0 && fbeCode.indexOf('本职岗位（40 字内）') >= 0 && fbeCode.indexOf('PF_CAPS={owner:20,exp:200,bio:30,post:40}') >= 0 && fbeCode.indexOf('pfSanitize(owner,exp,avatar,bio,post)') >= 0 && fbeCode.indexOf('pfSanitize(oEl.value,eEl.value,null,bEl.value,pEl.value)') >= 0,
        'FBE91：档案弹窗新增本职岗位（≤40 字）且随提交走 pfSanitize 五参');
      const ppBody = (fbeCode.match(/function pfPendingText\([\s\S]*?\n\}/) || [''])[0];
      assert(ppBody.indexOf("pending.status==='rejected'") >= 0 && ppBody.indexOf('驳回') >= 0 && ppBody.indexOf('理由：') >= 0 && ppBody.indexOf('rejectedAt') >= 0,
        'FBE92：pfPendingText 支持已驳回态（X月X日驳回+理由，重新提交覆盖）');
      assert(fbeCode.indexOf("'/v1/selfreport','GET'") >= 0 && fbeCode.indexOf("'/v1/selfreport','POST'") >= 0 && fbeCode.indexOf("'/v1/selfreport/pending','GET'") >= 0 && fbeCode.indexOf("'/v1/selfreport/approve','POST'") >= 0 && fbeCode.indexOf("'/v1/selfreport/overview','GET'") >= 0,
        'FBE93：年度自报五端点对接齐全（GET/POST selfreport + pending/approve/overview）');
      assert(fbeCode.indexOf('var SR_GOAL_MAX={annual:5,winter:3,summer:3};') >= 0 && fbeCode.indexOf('SR_GOAL_MAX[k]') >= 0 && fbeCode.indexOf('SR_DIM_MAX[k]') >= 0 && fbeCode.indexOf("'达成','部分达成','未达成','中途调整'") >= 0 && fbeCode.indexOf('maxlength="500"') >= 0 && fbeCode.indexOf('maxlength="800"') >= 0,
        'FBE94：目标三组上限（年5/寒3/暑3）+ 亮点三维度≤3（题30/文800）+ 完成四态 + 结果≤500');
      assert(cntIn(htmlMain, 'id="srCards"') === 1 && cntIn(htmlMain, 'id="srPendingList"') === 1 && cntIn(htmlMain, 'faAuditTab') >= 2 && cntIn(htmlMain, 'srMaybeLoad') >= 1 && cntIn(fbeCode, '年初定目标') >= 1 && cntIn(fbeCode, 'goalLockedAt') >= 3 && cntIn(fbeCode, '标记为修订') >= 1,
        'FBE95：三卡片挂成长档案页（srCards）+ 审核双页签并入档案审核 + 锁定修订确认 + 空态引导句');
      /* ===== 审核页可见内容 + 总览待审徽标（FBE96-FBE99） ===== */
      const pendRowBody = (fbeCode.match(/b2\.innerHTML=rows\.map\(function\(r\)\{[\s\S]*?\}\)\.join\(''\);/) || [''])[0];
      assert(pendRowBody.indexOf('srPendDetail(sec,r.payload,r.goalTexts)') >= 0 && pendRowBody.indexOf('sr-pend-body') >= 0,
        'FBE96：自报审核行必须渲染提交全文（sr-pend-body 内联 srPendDetail，附 goalTexts）——只给计数不给内容=无法审核');
      const pendDetBody = (fbeCode.match(/function srPendDetail\(section,p,gtexts\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(pendDetBody.indexOf("section==='goals'") >= 0 && pendDetBody.indexOf("section==='completions'") >= 0 && pendDetBody.indexOf("section==='highlights'") >= 0 && pendDetBody.indexOf('Object.keys(pl)') >= 0 && pendDetBody.indexOf("q.society") < 0 && pendDetBody.indexOf("'society','社会'") >= 0 && pendDetBody.indexOf('SR_ST_CN') >= 0,
        'FBE97：srPendDetail 三段全文——goals 逐条含口径 / completions 键控对象遍历+状态中文 / highlights social+society 双键');
      const briefBody = (fbeCode.match(/function srBrief\(section,payload\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(briefBody.indexOf('Object.keys(o)') >= 0 && briefBody.indexOf('q.social') >= 0 && briefBody.indexOf('q.society') >= 0 && briefBody.indexOf('payload.items') < 0,
        'FBE98：srBrief 计数口径对齐后端——completions 按键控对象计数（items 旧口径收掉）、highlights social/society 双读');
      assert(fbeCode.indexOf('r.pendingCount||0') >= 0 && fbeCode.indexOf('sr-pend-badge') >= 0 && fbeCode.indexOf("待审 '+pendN+' 段</b>") >= 0 && fbeCode.indexOf('待审批次见红色') >= 0,
        'FBE99：总览行消费 pendingCount 渲染「待审 N 段」红标 + 头部口径说明（计数=已批准）');
      /* ===== 智子用户消息双气泡/空蓝块修复（FBE120） ===== */
      const meRule = (htmlMain.match(/\.msg\.me\{[^}]*\}/) || [''])[0];
      assert(meRule.indexOf('margin-left:auto') >= 0 && meRule.indexOf('background') < 0 && meRule.indexOf('padding') < 0 && meRule.indexOf('justify-content') < 0,
        'FBE120：智子用户消息行只做布局（右对齐靠 row-reverse 默认主轴，禁加 justify-content——加了会把泡泡推到左边；旧版行级渐变背景+padding 叠内层气泡=巨大空蓝块，禁止回归）');
      assert(htmlMain.indexOf('#chat{overflow-x:hidden}') >= 0 && htmlMain.indexOf('.bot>*{min-width:0}') >= 0 && htmlMain.indexOf('overflow-wrap:anywhere') >= 0,
        'FBE120b：智子对话区防溢出护栏——chat 禁横向扩散 + bot 网格子项可收缩 + 用户气泡长串可断行');
      /* ===== 年度自报 × 数据关联（FBE100-FBE117）：契约逐字对齐后端 SR_METRICS/srCleanGoal/computeGoalActual ===== */
      const srT = T.srMetrics ? T.srMetrics() : null;
      assert(!!srT && Object.keys(srT).length === 11 && ['reg[2]','dev[0]','dev[1]','dev[2]','dev[3]','dev[4]','par[0]','cap.outreach','cap.conv','cap.family','ext[0]'].every(k => !!srT[k]),
        'FBE100：指标注册表 11 键齐全且键名与后端逐字一致（经 __FBE_TEST__.srMetrics 实例验证）');
      assert(srT['ext[0]'].dir === 'lte' && srT['ext[0]'].label === '安全/质量事件' && Object.keys(srT).every(k => k === 'ext[0]' || srT[k].dir === 'gte'),
        'FBE101：方向由注册表锁定不提供选择——ext[0] 唯一 lte，其余全 gte');
      assert(srT['cap.conv'].caliber === 'ratio' && srT['cap.family'].caliber === 'ratio' && srT['cap.outreach'].caliber === 'ratio' && srT['reg[2]'].caliber === 'seasonFinal' && srT['ext[0]'].caliber === 'seasonFinal',
        'FBE102：caliber 由注册表锁定（cap.* = ratio / 方括号键 = seasonFinal）');
      const cardGoalsBody = (fbeCode.match(/function srCardGoals\(\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(cardGoalsBody.indexOf('指标轨·对数据') >= 0 && cardGoalsBody.indexOf('证据轨·讲事实') >= 0 && cardGoalsBody.indexOf('aria-label="对照指标"') >= 0 && cardGoalsBody.indexOf('maxlength="200"') >= 0 && cardGoalsBody.indexOf('maxlength="60"') >= 0,
        'FBE103：双轨表单——cat 三类下拉 + track 双轨切换 + 指标轨（11 键下拉/目标值/口径备注≤60）/ 证据轨（事实描述≤200）');
      const submitBody = (fbeCode.match(/function srSubmit\(sec\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(submitBody.indexOf('请选择类型（品牌/发展/效能）') >= 0 && submitBody.indexOf('年度目标须三类齐备') >= 0 && submitBody.indexOf('missCats') >= 0,
        'FBE104：cat/track 必填逐条拦截 + 年度层三类各≥1 自查（toast 列缺类，与后端 400 口径一致）');
      assert(submitBody.indexOf('payload=keyed;') >= 0 && submitBody.indexOf('payload={items:') < 0 && submitBody.indexOf('未填完成结果') >= 0,
        'FBE105：completions 按键控对象提交（后端 srSanitizeSection 口径）+ result 必填拦截');
      const prefillBody = (fbeCode.match(/function srPrefillSuggest\(\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(fbeCode.indexOf('srPrefillSuggest();') >= 0 && prefillBody.indexOf('c[r.goalId].status=sc;') >= 0 && prefillBody.indexOf('!(c[r.goalId]&&c[r.goalId].status)') >= 0,
        'FBE106：suggest 预填——仅在本人未选状态时回填英文码，随 srLoad 挂载');
      const cplStatusBody = (fbeCode.match(/function srCplStatus\(id,el\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(cplStatusBody.indexOf('系统实测为 ') >= 0 && cplStatusBody.indexOf('，与您选择不一致，请确认') >= 0 && cplStatusBody.indexOf('srSuggestCode(a)') >= 0 && cplStatusBody.indexOf('srRender(); return;') >= 0,
        'FBE107：改选与实测不一致 → 温和确认，取消则回退（display 直引服务端文案）');
      const cardCplBody = (fbeCode.match(/function srCardCompletions\(\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(cardCplBody.indexOf('该目标当期暂无实测数据') >= 0 && cardCplBody.indexOf('系统实测：') >= 0 && cardCplBody.indexOf('a.met==null') >= 0 && cardCplBody.indexOf('SR_CPL_CODE.map') >= 0,
        'FBE108：met=null 显示「暂无实测」提示条（绝不显示「未达成」）+ 实测行直渲染服务端 display + 状态英文码选项');
      assert(fbeCode.indexOf('function srContrastRows') >= 0 && fbeCode.indexOf('function srContrastEntries') >= 0 && fbeCode.indexOf('<span>目标值</span><span>系统实测</span><span>本人自评+理由</span>') >= 0 && fbeCode.indexOf('自评与实测不一致') >= 0 && fbeCode.indexOf('旧格式目标，建议驳回让站长按新格式重填') >= 0 && fbeCode.indexOf("(r.contrast?srContrastRows(r.contrast,r.payload):'')") >= 0,
        'FBE109：待审行三列对照（目标值/系统实测/本人自评+理由，消费后端 goals 行 contrast）+ 矛盾红标 + legacy 降级提示（contrast 缺席时优雅降级）');
      const ctRowsBody = (fbeCode.match(/function srContrastRows\(contrast,payload\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(ctRowsBody.indexOf("a.met===true&&e.selfStatus==='missed'") >= 0 && ctRowsBody.indexOf("a.met===false&&e.selfStatus==='achieved'") >= 0 && ctRowsBody.indexOf('暂无实测') >= 0,
        'FBE110：三列对照矛盾判定交叉红标（达成↔missed / 未达成↔achieved）+ 实测缺数中性显示');
      const ovRowBody = (fbeCode.match(/function srOvRow\(r,i\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(ovRowBody.indexOf('r.actuals') >= 0 && ovRowBody.indexOf('｜实测：') >= 0 && ovRowBody.indexOf('缺数据月：') >= 0 && ovRowBody.indexOf('Math.round') < 0 && ovRowBody.indexOf('srGoalMeasureText(it)') >= 0 && ovRowBody.indexOf('SR_ST_CN[it.status]') >= 0,
        'FBE111：总览行消费 actuals——display 直渲染+缺数据月中性标注+完成状态中文化；不自算比例（无 Math.round）');
      const measBody = (fbeCode.match(/function srGoalMeasureText\(it\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(measBody.indexOf("typeof m==='object'") >= 0 && measBody.indexOf('｜口径：') >= 0 && measBody.indexOf('｜承诺：') >= 0 && measBody.indexOf('｜证据：') >= 0 && fbeCode.indexOf('esc(it.measure)') < 0,
        'FBE112：口径文案三形态（对象=承诺/旧字符串=原文/证据轨）——不再裸 esc 对象，[object Object] 根除（legacy 兼容）');
      const rowsBody = (fbeCode.match(/function srGoalRows\(src\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(rowsBody.indexOf('it.id||(k+\'-\'+idx)') >= 0 && fbeCode.indexOf("id:'g'+Date.now().toString(36)") >= 0,
        'FBE113：goalId 用目标稳定 id 挂靠（新建生成 g+ 随机 id；旧数据退回 season-idx）');
      const capGoalsBody = (fbeCode.match(/function srCapGoals\(arr,max\)\{[\s\S]*?\n\}/) || [''])[0];
      const tstoreBody = (fbeCode.match(/function srTargetStore\(v,mt\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(capGoalsBody.indexOf('srTargetStore(it.target,mt)') >= 0 && capGoalsBody.indexOf('track:') >= 0 && tstoreBody.indexOf("mt.caliber==='ratio'") >= 0 && tstoreBody.indexOf('Math.round(n*100)/10000') >= 0,
        'FBE114：提交重建——比例类 UI 输 0-100 → 存储 0-1 小数（70→0.7），caliber/dir 取注册表锁定值，单轨不带双字段');
      const promiseBody = (fbeCode.match(/function srPromiseMaybe\(\)\{[\s\S]*?\n\}/) || [''])[0];
      const blockBody = (fbeCode.match(/function gwPromiseBlockHtml\([\s\S]*?\n\}/) || [''])[0];
      const prowBody = (fbeCode.match(/function srPromiseRowHtml\([\s\S]*?\n\}/) || [''])[0];
      assert(promiseBody.indexOf('yfIsStation') >= 0 && promiseBody.indexOf("getAttribute('data-loaded')") >= 0 && promiseBody.indexOf("data-loaded','1'") >= 0 &&
        blockBody.indexOf('我的承诺兑现') >= 0 && blockBody.indexOf('我已立 <b>') >= 0 &&
        prowBody.indexOf('met===true') >= 0 && prowBody.indexOf('met===false') >= 0 &&
        prowBody.indexOf('srPromiseMeasured(a)') >= 0 && prowBody.indexOf('sr-promise-v') >= 0 &&
        /GW_TAB==='diag'\)\s*\{ el\.innerHTML = gwDiag\(st\); try\{ if\(typeof srPromiseMaybe==='function'\) srPromiseMaybe\(\); \}catch\(e\)\{\} \}/.test(htmlMain),
        'FBE115：站长端「我的承诺兑现」功能块（v1.1 §3）——仅 station、服务端 met 四状态机、data-loaded 标记驱动（废止「容器存在即早退」死锁）、挂诊断卡三卡下方且 gwDiag R1-R14 渲染逻辑零改动');
      assert(htmlMain.indexOf('.sr-dot-ok') >= 0 && htmlMain.indexOf('.sr-dot-bad') >= 0 && htmlMain.indexOf('.sr-dot-none') >= 0 && fbeCode.indexOf("sr-dot sr-dot-'+met") >= 0,
        'FBE116：承诺兑现三色状态点样式（绿=达成/红=未达/灰=待实测，CSS 三类齐全+JS 按服务端 met 动态挂类，圆点非 emoji）');
      assert(htmlMain.indexOf('var promiseSlot=') >= 0 && /promiseSlot=\(typeof yfIsStation!=='function'\|\|yfIsStation\(\)\)[\s\S]{0,90}id="srPromise"/.test(htmlMain),
        'FBE115b（新增·权威断言）：admin 下不产生 #srPromise 空容器——占位容器在 gwDiag 内按 yfIsStation() 门控（方案 §3.4）');
      /* ===== 成长档案·年度自报再入入口（一等交付项，方案 v1.1 §2.1/§2.4-4）+ 悬空 #gwTabs 清零 ===== */
      assert(htmlMain.indexOf('#gwTabs') < 0,
        'GWF1：悬空 #gwTabs 查询根除——页签随三问式改版整块移除，旧 3 处查询（gwShowDemo / gwDemo 脚注 / obGoto）恒为 null，已全清');
      assert(htmlMain.indexOf('function gwFileEntryHtml(') >= 0 && htmlMain.indexOf('成长档案与年度自报 ›') >= 0 &&
        htmlMain.indexOf("function gwOpenFile(){ GW_TAB='file'; gwPaint(); }") >= 0,
        "GWF2：折叠链底部常驻文字链「成长档案与年度自报 ›」+ gwOpenFile 走 GW_TAB='file';gwPaint()（可重复进入，不再只靠一次性 onboarding 引导）");
      const gwDiagTail = (function () {
        const i = htmlMain.indexOf("+ gwDetailToggleHtml() + '<div id=\"gwDetail\" hidden>' + h + '</div>'");
        return i < 0 ? '' : htmlMain.slice(i, i + 160);
      })();
      assert(gwDiagTail.indexOf('+ gwFileEntryHtml();') >= 0,
        'GWF3：入口挂在折叠链底部、且位于 #gwDetail 之外（#gwDetail 默认 hidden，放进去就不「常驻」）');
      assert(/\.gw-file-link\{[^}]*min-height:44px/.test(htmlMain),
        'GWF4：入口触摸区 ≥44px（WCAG 2.5.5）');
      /* ===== goalLockedAt 口径一致性（SRLA）：它是**未来时间戳**（通过时间+1 自然月），过期即失效 =====
         后端 index.js:2025 同口径 `bucket.goalLockedAt > Date.now()`。
         前端曾用 !!x 布尔化 → 锁定期已过仍永久显示锁定文案 + 永久弹 confirm（jsdom 下 confirm 未实现→静默 return）。 */
      assert(htmlMain.indexOf('!!(SR&&SR.goalLockedAt)') < 0 && htmlMain.indexOf('!!j.goalLockedAt') < 0 &&
        !/if\s*\(\s*SR\s*&&\s*SR\.goalLockedAt\s*&&/.test(htmlMain) &&
        cntIn(htmlMain, 'Number((SR&&SR.goalLockedAt)||0)>Date.now()') === 2 &&
        cntIn(htmlMain, 'Number(j.goalLockedAt||0)>Date.now()') === 1,
        'SRLA1：goalLockedAt 全文件零布尔化——两处视图统一 Number(...)>Date.now()（与后端 index.js:2025 同口径）');
      const lockExpr = (cardGoalsBody.match(/var locked=(Number\(\(SR&&SR\.goalLockedAt\)\|\|0\)>Date\.now\(\));/) || [])[1] || '';
      assert(lockExpr !== '', 'SRLA2：年度目标卡锁定判定为真实数值比较表达式（非布尔化）');
      const evalLock = new Function('SR', 'return (' + (lockExpr || 'false') + ');');
      const _now = Date.now();
      assert(evalLock({ goalLockedAt: _now + 86400000 }) === true, 'SRLA3：锁定期内（未来时间戳）→ locked=true');
      assert(evalLock({ goalLockedAt: _now - 86400000 }) === false, 'SRLA4：★负向——过去时间戳（锁定期已过）→ locked=false，不得永久锁死');
      assert(evalLock({ goalLockedAt: 0 }) === false && evalLock(null) === false && evalLock(undefined) === false,
        'SRLA5：★负向——从未批准(0)/SR 为空 → locked=false，不误报锁定');
      const cardFuture = T.srCardGoalsWithLock(_now + 86400000), cardPast = T.srCardGoalsWithLock(_now - 86400000);
      assert(cardFuture.indexOf('基线锁定于') >= 0, 'SRLA6：★行为级——锁定期内真渲染年度目标卡，锁定文案出现在视图上');
      assert(cardPast.indexOf('基线锁定于') < 0 && cardPast.indexOf('年度目标（2026）') >= 0,
        'SRLA7：★行为级·负向——过去时间戳真渲染视图，锁定文案必须消失（锁定期过期即失效）');
      /* 提交闸门：锁定期内才弹确认；文案按档位分（第二态=将标记为修订（仅一次）；第四态=修订机会已用尽、将被拒绝）。
         仅改告知文案，不新增前端拦截规则——服务端是权威。 */
      const gateBlock = (submitBody.match(/if\(Number\(\(SR&&SR\.goalLockedAt\)\|\|0\)>Date\.now\(\)\)\{[\s\S]*?if\(!confirm\(_cmsg\)\) return;\s*\n\s*\}/) || [''])[0];
      assert(gateBlock !== '', 'SRLA8：提交前确认闸门存在且为真实数值比较（Number((SR&&SR.goalLockedAt)||0)>Date.now()，非布尔化）');
      const TXT2 = '年度目标基线已锁定，本次提交将标记为修订（仅一次）。确认提交？';
      const TXT4 = '年度自报目标已锁定且修订机会已用尽，本次提交将被拒绝。确认继续？';
      assert(submitBody.indexOf("'" + TXT2 + "'") >= 0, 'SRLA9a：第二态确认文案逐字未漂移（' + TXT2 + '）');
      assert(submitBody.indexOf("'" + TXT4 + "'") >= 0, 'SRLA9b：第四态确认文案逐字落位（' + TXT4 + '）');
      assert(TXT4.indexOf('仅一次') < 0 && TXT4.indexOf('标记为修订') < 0, 'SRLA9c：★反向——第四态文案不得含「仅一次」/「标记为修订」等误导表述');
      let gateFn = null;
      try { gateFn = new Function('SR', 'confirm', 'srRevisedUsed', gateBlock + '\n return "PASS";'); } catch (e) { gateFn = null; }
      assert(typeof gateFn === 'function', 'SRLA10a：闸门块提取平衡、可构造（提取正确性自检）');
      const FUT = _now + 86400000, PAST = _now - 86400000;
      assert(!!gateFn && gateFn({ goalLockedAt: FUT }, function () { return false; }, function () { return false; }) === undefined,
        'SRLA10：★行为级——锁定期内（第二态）+ 用户取消确认 → 闸门拦住提交');
      assert(!!gateFn && gateFn({ goalLockedAt: FUT }, function () { return true; }, function () { return false; }) === 'PASS',
        'SRLA11：锁定期内（第二态）+ 用户确认 → 放行提交');
      assert(!!gateFn && gateFn({ goalLockedAt: PAST }, function () { return false; }, function () { return false; }) === 'PASS',
        'SRLA12：★行为级·负向——过去时间戳必须放行（不再永久拦截，也消除 jsdom 下静默 return 的假失败根源）');
      const seen2 = []; gateFn({ goalLockedAt: FUT }, function (m) { seen2.push(m); return true; }, function () { return false; });
      assert(seen2.length === 1 && seen2[0] === TXT2, 'SRLA13：★行为级——第二态 confirm 收到原文案（逐字）');
      const seen4 = []; gateFn({ goalLockedAt: FUT }, function (m) { seen4.push(m); return true; }, function () { return true; });
      assert(seen4.length === 1 && seen4[0] === TXT4, 'SRLA14：★行为级——第四态 confirm 收到新文案（逐字）');
      const r4b = gateFn({ goalLockedAt: FUT }, function () { return false; }, function () { return true; });
      assert(r4b === undefined, 'SRLA15：★行为级——第四态 + 用户取消 → 仍拦住提交（不因「将被拒绝」而放行）');
      /* ===== 第四态：卡片文案（口径同 srRevisedUsed，与后端 index.js:2025/2030-2034 对齐） ===== */
      const helperBody = (fbeCode.match(/function srRevisedUsed\(\)\{[\s\S]*?\n\}/) || [''])[0];
      assert(helperBody.indexOf("['annual','winter','summer'].some(") >= 0 && helperBody.indexOf('SR.goals[sk]') >= 0 &&
        helperBody.indexOf('x&&x.revisedAt') >= 0 && helperBody.indexOf('SR_DRAFT') < 0,
        'SR4S1：第四态判定唯一出口 srRevisedUsed()——取 SR.goals（已批准）带 revisedAt，不取 SR_DRAFT（对齐后端 index.js:2032）');
      assert(cardGoalsBody.indexOf('var used=srRevisedUsed();') >= 0 && cardGoalsBody.indexOf('if(locked){') >= 0 && cardGoalsBody.indexOf('lockHtml=used') >= 0,
        'SR4S2：卡片第四态仍受 locked 门控（locked && used），且 used 与提交闸门共用 srRevisedUsed()（防两处口径各写一份而漂移）');
      const cardUsed = T.srCardGoalsWithState(_now + 86400000, { annual: [{ id: 'g1', text: 'x', cat: 'brand', track: 'evidence', evidence: 'e', revisedAt: _now }], winter: [], summer: [] });
      assert(cardUsed.indexOf('修订机会已用尽') >= 0 && cardUsed.indexOf('不可再修改') >= 0 && cardUsed.indexOf('基线锁定于') < 0,
        'SR4S3：★行为级——锁定期内 + 已批准目标带 revisedAt → 渲染第四态「修订机会已用尽，不可再修改」（不再显示「仅一次」）');
      const cardFresh = T.srCardGoalsWithState(_now + 86400000, { annual: [{ id: 'g1', text: 'x' }], winter: [], summer: [] });
      assert(cardFresh.indexOf('基线锁定于') >= 0 && cardFresh.indexOf('修订机会已用尽') < 0,
        'SR4S4：★行为级·负向——锁定期内但无 revisedAt → 仍是第二态「仅一次修订」，不得误报「已用尽」');
      const cardPastUsed = T.srCardGoalsWithState(_now - 86400000, { annual: [{ id: 'g1', text: 'x', revisedAt: _now }], winter: [], summer: [] });
      assert(cardPastUsed.indexOf('修订机会已用尽') < 0 && cardPastUsed.indexOf('基线锁定于') < 0 && cardPastUsed.indexOf('年度目标（2026）') >= 0,
        'SR4S5：★行为级·负向——锁定期已过（过去时间戳）即便带 revisedAt 也不得显示第四态（过期即失效，不永久锁死）');
      assert(cardGoalsBody.indexOf('锁定后修改将标记为修订（仅一次）') >= 0,
        'SR4S6：第二态锁定文案逐字未漂移（第四态为新增分支，不改既有文案）');
      /* ===== 第四态 400 文案是否被吞（team-lead 指派核查）：yfApi 不因 4xx reject → srSubmit 能拿到 j.msg ===== */
      const yfApiBody = (htmlMain.match(/function yfApi\([\s\S]*?\n\}/) || [''])[0];
      assert(yfApiBody.indexOf('return r.json();') >= 0 && !/if\s*\(\s*r\.status\s*===\s*400\s*\)/.test(yfApiBody),
        'SR4S7：yfApi 对 400 不 reject——非 2xx 仅 409/403 特判，其余走 return r.json() 透传 body（fetch 本就不因 4xx reject），故第四态 400 的 body 会 resolve 给调用方');
      assert(submitBody.indexOf("toast((j&&j.msg)||(j&&j.error)||'提交失败')") >= 0,
        'SR4S8：srSubmit 失败分支读 j.msg||j.error → 服务端第四态 400 的人工文案（「修订机会仅一次（已使用）」）经 toast 透出，不被吞');
      /* ===== 承诺行实测值（方案 v1.1 §3.1 用户裁定：行内恢复实测数字）——直渲染服务端 display，前端零计算 ===== */
      assert(prowBody.indexOf('srPromiseMeasured(a)') >= 0 && prowBody.indexOf('class="sr-promise-v"') >= 0,
        'SRPD1：承诺行真的渲染实测值列（srPromiseMeasured(a) 落到 .sr-promise-v）');
      assert(prowBody.indexOf('Math.round') < 0 && prowBody.indexOf('Number(') < 0 && prowBody.indexOf('computeGoalActual') < 0 && prowBody.indexOf('parseFloat') < 0,
        'SRPD2：实测值前端零计算——行内不出现 Math.round/Number()/parseFloat/computeGoalActual（只直渲染 display）');
      assert(fbeCode.indexOf("return d!==''?d:'—';") >= 0,
        'SRPD3：无实测（display 缺失）返回「—」而非 0');
      const rowOk = T.srPromiseRowHtml({ a: { met: true, display: '82 / 300 张' }, it: { text: '全年新卡 300 张' } }, 0, false);
      assert(rowOk.indexOf('82 / 300 张') >= 0, 'SRPD4：★行为级——服务端 display（82 / 300 张）逐字渲染进行内');
      assert(rowOk.indexOf('已达成') >= 0 && rowOk.indexOf('sr-dot-ok') >= 0,
        'SRPD5：★状态机未变——状态词与圆点仍唯一由 met 决定');
      const rowPct = T.srPromiseRowHtml({ a: { met: false, display: '72% / 70%' }, it: { text: '科普转化率' } }, 1, false);
      assert(rowPct.indexOf('72% / 70%') >= 0 && rowPct.indexOf('未达到') >= 0 && rowPct.indexOf('sr-dot-bad') >= 0,
        'SRPD6：★行为级——未达行同样渲染 display，状态词/红点由 met 定（数字与徽标互不推导）');
      const rowNone = T.srPromiseRowHtml({ a: { met: null }, it: { text: '无实测项' } }, 2, false);
      assert(rowNone.indexOf('<span class="sr-promise-v">—</span>') >= 0,
        'SRPD7：★行为级·负向——met=null 且无 display → 实测列渲染「—」');
      assert(!/<span class="sr-promise-v">0<\/span>/.test(rowNone),
        'SRPD8：★行为级·负向——实测缺失绝不渲染 0（0 会被误读成"没干活"）');
      assert(rowNone.indexOf('待实测') >= 0 && rowNone.indexOf('sr-dot-none') >= 0,
        'SRPD9：met=null 状态词仍为「待实测」+ 灰点（四状态机零改动）');
      assert(/\.sr-promise-v\{[^}]*flex:none/.test(htmlMain) && /\.sr-promise-v\{[^}]*white-space:nowrap/.test(htmlMain),
        'SRPD10：数字列 flex:none + nowrap——320-414px 下不被压缩、不截断（§3.3 硬约束）');
      assert(htmlMain.indexOf('@media(max-width:414px){.sr-promise{padding:12px}') >= 0 &&
        htmlMain.indexOf('.sr-promise-t{flex:1 1 100%}') >= 0 && htmlMain.indexOf('.sr-promise-v{margin-left:0;order:2}') >= 0,
        'SRPD11：窄屏该行改两行排布（文案独占一行、数字列随第二行，不再挤在一行被压掉）');
      assert(fbeCode.indexOf('srMetrics:function') >= 0 && fbeCode.indexOf('srContrastEntries:srContrastEntries') >= 0 && fbeCode.indexOf('srGoalMeasureText:srGoalMeasureText') >= 0,
        'FBE117：新增测试导出（srMetrics/srCatName/srGoalNew/srGoalNorm/srPrefillSuggest/srContrast*/srGoalMeasureText）');
      assert(fbeCode.indexOf('SR={goals:j.goals||null,completions:j.completions||null') >= 0 && fbeCode.indexOf('SR_PEND=j.pending||{}') >= 0 && fbeCode.indexOf('j.report||{}') < 0,
        'FBE118：srLoad 消费 GET /v1/selfreport 扁平出参（goals/completions/pending）——旧 {report}/{pendings} 包裹假设根除，本人已批准内容与驳回态可见');
      /* ===== 成长页「一眼三问」三问式实现（Q31-Q313）：方案 v1.0 逐字规格 + 复用 #72 赛季数据层 ===== */
      const q3s = htmlMain.indexOf('var YF3Q='), q3e = htmlMain.indexOf('/* ============ ① 能力体检');
      const q3Code = (q3s >= 0 && q3e > q3s) ? htmlMain.slice(q3s, q3e) : '';
      assert(q3s >= 0 && q3e > q3s, 'Q30：YF3Q 引擎块存在于 gwDiag 之前（首屏三卡 + 详情折叠同一 script 域）');
      assert(q3Code.indexOf("dAll(s,'reg',2)") >= 0 && q3Code.indexOf('histSeasonRec(DASH_SEASON,s)') >= 0 && q3Code.indexOf("dAll(s,'par',0)") >= 0,
        'Q31：三问数据源——2026 季值=DASH_DB 三月逐月合计（dAll），2025 季值=HIST.season 只读（lead 审定数据层裁决）');
      assert(q3Code.indexOf("m>=1.2?'领跑期'") >= 0 && q3Code.indexOf("m>=1?'稳定期'") >= 0 && q3Code.indexOf("m>=0.7?'追赶期'") >= 0 && q3Code.indexOf("'起步期'") >= 0,
        'Q32：档位四档阈值锁定（m≥1.2 领跑 / ≥1.0 稳定 / ≥0.7 追赶 / 其余起步）');
      assert(q3Code.indexOf('second.ratio-weak.ratio<0.05') >= 0 && q3Code.indexOf('dropOf') >= 0,
        'Q33：短板并列裁决——最小两项差<0.05 时取同比降幅更大者（家长无同比回退绝对差）');
      assert(q3Code.indexOf("k==='parent'&&(mv==null||mv===0)") >= 0,
        'Q34：降级 3——家长参与为 0 时家校经营不参与档位计算（短板四选三）');
      assert(q3Code.indexOf('noMedian:nStation<3') >= 0 && q3Code.indexOf('先稳住势头，全站对比等数据齐了再给你看') >= 0,
        'Q35：降级 2——有数据站<3 家时档位退化为仅同比（逐字文案）');
      assert(q3Code.indexOf('这个季度还没有你的数据，先完成上报') >= 0 && q3Code.indexOf('openReportForm()') >= 0,
        'Q36：降级 1——本季未上报显示引导+去上报按钮（不以 0 冒充）');
      assert(q3Code.indexOf('mine+(med-mine)/2') >= 0,
        'Q37：验收线公式锁定——target=本站值+(全站中位−本站值)÷2（向中位推进半档）');
      assert(q3Code.indexOf('为今年新增统计项') >= 0 && q3Code.indexOf('yoy 恒 null') >= 0 && q3Code.indexOf("k!=='parent'&&lastC") >= 0,
        'Q38：家长参与无同比——yoy 恒 null，仅与全站中位比，依据句按「今年新增统计项」标注');
      assert(q3Code.indexOf('排头兵') >= 0 && q3Code.indexOf('照这个势头补得回来') >= 0 && q3Code.indexOf('每个入营学生 72 小时内完成一次电话回访') >= 0 && q3Code.indexOf('每场活动设家长专场时段') >= 0 && q3Code.indexOf('排一张科普排期表贴在墙上') >= 0,
        'Q39：文案逐字落位（定位句/好消息句/动作库四能力条目，方案 §3 模板）');
      assert(q3Code.indexOf('ratio<0.5?3') >= 0 && q3Code.indexOf('ratio<=0.85?2') >= 0,
        'Q310：动作条数规则锁定（比值<0.5→3 条 / 0.5-0.85→2 条 / >0.85→1 条，文案库不足封顶）');
      assert(htmlMain.indexOf('id="gwDetail" hidden') >= 0 && htmlMain.indexOf('function gwDetailToggle(') >= 0 && htmlMain.indexOf('查看详细数据 ›') >= 0 &&
        htmlMain.indexOf('return q3') >= 0 && htmlMain.indexOf("gwDetailToggleHtml() + '<div id=\"gwDetail\" hidden>' + h + '</div>'") >= 0,
        'Q311：详情层折叠——存量诊断内容整体降级进 gwDetail（默认 hidden），「查看详细数据」文字链开关（触摸区≥44px）；承诺块占位插在三卡与折叠链之间');
      assert(q3Code.indexOf('集团评价：') >= 0 && q3Code.indexOf('SEMI[st]') >= 0,
        'Q312：集团评价一句话降级进首屏定位卡尾行（半年度画像摘要，无记录省略不虚构）');
      assert((q3Code.match(/HIST\s*=/g) || []).length === 0 && q3Code.indexOf("HIST[DASH_SEASON]") < 0,
        'Q313：三问模块 HIST 只读——YF3Q 引擎内零 HIST 赋值、不直触 HIST 键（历史季一律经 histSeasonRec 只读取数）');
    })();
  }
}

/* ================================ 第二轮收尾（R2）：三卡行为级判定 / 打卡根除 / 2025 集团合计（fe-growth-r2 留痕新增） ================================ */
(function () {
  const src2 = fs.readFileSync(P.jsBlock('02'), 'utf8');
  /* ---------- R2 行为级：提取 YF3Q+文案+渲染真实代码，mock 数据层函数后逐场景执行 ---------- */
  const q3a = src2.indexOf('var YF3Q=');
  const q3b = src2.indexOf('/* ============ ① 能力体检');
  assert(q3a >= 0 && q3b > q3a, 'R2-0：YF3Q+文案库+三卡渲染块可整体提取');
  const q3Src = src2.slice(q3a, q3b);
  /* mock 站点季值：d=[enroll,card,conv,sci,parent]；y=2025 基线 [enrollLast,cardLast,convLast,sciLast] */
  function mk3q(MK, stations, opt) {
    opt = opt || {};
    const HIST = { '2025S': { label: '2025年暑假', season: {}, months: {} } };
    Object.keys(MK).forEach(function (k) {
      if (MK[k].y) HIST['2025S'].season[k] = { reg: [null, null, MK[k].y[0]], dev: [MK[k].y[1], null, null, MK[k].y[3], MK[k].y[2]], par: [null, null] };
    });
    function dAll(s, key, idx) {
      const r = MK[s]; if (!r) return 0;
      const map = { 'reg2': r.d[0], 'dev0': r.d[1], 'dev4': r.d[2], 'dev3': r.d[3], 'par0': r.d[4] };
      const v = map[key + idx]; return (v === undefined) ? 0 : v;
    }
    const f = new Function('DASH_SEASON', 'DASH_CUR', 'DASH_ORDER', 'DASH_DB', 'STATIONS', 'HIST',
      'seasonHasStation', 'seasonLabel', 'curSeasonTerm', 'PROF', 'SEMI', 'dAll', 'histBaseSeason', 'histSeasonRec', 'yfIsStation', 'curSeasonKey',
      q3Src + '\n;return {YF3Q:YF3Q,GW3_ACTS:GW3_ACTS,GW3_WHY:GW3_WHY,gw3Target:gw3Target,gwThreeQHtml:gwThreeQHtml};');
    return f('2026S', 'all', [], null, stations, HIST,
      function (s) { return !!MK[s]; }, function () { return '2026 年暑假'; }, function () { return '暑假'; },
      opt.PROF || {}, opt.SEMI || {}, dAll, function () { return '2025S'; },
      function (k, s) { return (HIST[k] && HIST[k].season[s]) || null; },
      function () { return !!opt.station; }, function () { return '2026S'; });
  }
  /* 场景一（方案 §3 渲染示例同构）：五站中位 sciop=0.42 / 本站 0.18；家长 0 → 四选三；同比 2 项向好 */
  const MK1 = {
    '本站': { d: [100, 25, 8, 18, 0], y: [74, 15, 12, 12] },
    '甲': { d: [100, 30, 10, 30, 50] }, '乙': { d: [100, 40, 12, 42, 80] },
    '丙': { d: [100, 45, 20, 50, 100] }, '丁': { d: [100, 55, 30, 60, 200] }
  };
  const M1 = mk3q(MK1, Object.keys(MK1), { PROF: { '本站': { note: '在家长沟通上有亮点，科普覆盖待加强。其次带教扎实。' } } });
  const A1 = M1.YF3Q.analyze('本站');
  assert(A1.stage === '起步期' && A1.m !== undefined && A1.m >= 0.5 && A1.m < 0.7, 'R2-1：档位判定——比值中位数 m 落 [0.5,0.7) → 起步期（实际 ' + A1.stage + '）');
  assert(A1.weak && A1.weak.k === 'sciop' && A1.upCount === 2, 'R2-2：短板=比值最小项（sciop），同比向好计数=2（实际 ' + (A1.weak && A1.weak.k) + '/' + A1.upCount + '）');
  const H1 = M1.gwThreeQHtml('本站');
  assert((H1.match(/class="gw3-card"/g) || []).length === 3, 'R2-3：正常态首屏恰三卡（定位/短板/动作）');
  assert(H1.indexOf('起步期') >= 0 && H1.indexOf('把科普渗透这一件事做扎实，就是最大的进步') >= 0, 'R2-4：定位句逐字（起步期模板+短板能力名变量替换）');
  assert(H1.indexOf('数据依据：2026 暑假季入营 100 人（去年同期 74 人），新卡 25 张，四项能力有 2 项好于去年同期。') >= 0, 'R2-5：依据句逐字（含赛季名「2026 暑假季」形态）');
  assert(H1.indexOf('全站中位是 0.42，你是 0.18，差距 57%。') >= 0, 'R2-6：差距句逐字（(中位−本站)÷中位 取整百分比）');
  assert(H1.indexOf('好消息是这项你在涨') >= 0 && H1.indexOf('照这个势头补得回来') >= 0, 'R2-7：同比在涨追加「好消息」句（逐字）');
  assert(H1.indexOf('下季科普数 ÷ 入营做到 0.30。') >= 0, 'R2-8：验收线=本站值+(中位−本站值)÷2 保留两位（0.18+(0.42−0.18)÷2=0.30）');
  assert(H1.indexOf('排一张科普排期表贴在墙上') >= 0 && H1.indexOf('把科普固定绑在体检日候检时段') >= 0, 'R2-9：动作条数——比值 0.43<0.5 应给 3 条、文案库仅 2 条则封顶 2 条');
  assert(H1.indexOf('集团评价：在家长沟通上有亮点，科普覆盖待加强') >= 0 && H1.indexOf('其次带教扎实') < 0, 'R2-10：集团评价取画像第一句（PROF 优先，只取一句）');
  assert(A1.caps.every(function (c) { return c.k !== 'parent' || c.ratio === null; }), 'R2-11：降级 3 行为级——家长参与 0 → 家校经营 ratio=null（退出档位计算，短板四选三）');
  /* 场景二：追赶期 + 短板并列（同比降幅大者胜出）：本站 cardper 比值 .72 / convper .7333（差 .0133<0.05） */
  const MK2 = {
    '本站': { d: [250, 72, 22, 120, 150], y: [250, 90, 15, 30] },
    '甲': { d: [100, 30, 10, 30, 50] }, '乙': { d: [100, 40, 12, 42, 80] },
    '丙': { d: [100, 45, 20, 50, 100] }, '丁': { d: [100, 55, 30, 60, 200] }
  };
  const A2 = mk3q(MK2, Object.keys(MK2), {}).YF3Q.analyze('本站');
  assert(A2.stage === '追赶期', 'R2-12：档位判定——m 落 [0.7,1.0) → 追赶期（实际 ' + A2.stage + '）');
  assert(A2.weak && A2.weak.k === 'cardper' && A2.caps[1].ratio - A2.caps[0].ratio < 0.05, 'R2-13：短板并列（差<0.05）→ 取同比降幅更大的转化设计（cardper 降幅 20% > convper 同比为涨）');
  const H2 = mk3q(MK2, Object.keys(MK2), {}).gwThreeQHtml('本站');
  assert(H2.indexOf('下季新卡 ÷ 入营做到 0.34。') >= 0, 'R2-14：追赶期短板验收线（0.288+(0.40−0.288)÷2=0.34，保留两位）+ 比值 0.5-0.85 给 2 条动作');
  /* 场景三：短板并列且一方为家长（无同比）→ 按绝对差裁决 */
  const MK3 = {
    '本站': { d: [100, 25, 8, 21, 40], y: [74, 20, 12, 12] },
    '甲': { d: [100, 30, 10, 30, 50] }, '乙': { d: [100, 40, 12, 42, 80] },
    '丙': { d: [100, 45, 20, 50, 100] }, '丁': { d: [100, 55, 30, 60, 200] }
  };
  const A3 = mk3q(MK3, Object.keys(MK3), {}).YF3Q.analyze('本站');
  assert(A3.weak && A3.weak.k === 'parent' && Math.abs(A3.caps[2].ratio - A3.caps[3].ratio) < 0.05, 'R2-15：家长参与（无同比）并列时按绝对差裁决（家校 (0.8−0.4)/0.8=50% > 科普同比降幅为负）');
  const H3 = mk3q(MK3, Object.keys(MK3), {}).gwThreeQHtml('本站');
  assert(H3.indexOf('来参加活动的家长偏少') >= 0 && H3.indexOf('家长参与 40 人，为今年新增统计项。') >= 0, 'R2-16：短板为家长参与时——人话解释逐字 + 「家长参与 N 人，为今年新增统计项」单列补充');
  /* 场景四：领跑期（最小比值 ≥1 → 无真实短板，短板卡/动作卡不渲染，不留自造文案） */
  const MK4 = {
    '本站': { d: [100, 60, 20, 60, 160], y: [74, 20, 12, 12] },
    '甲': { d: [100, 30, 10, 30, 50] }, '乙': { d: [100, 40, 12, 42, 80] },
    '丙': { d: [100, 45, 20, 50, 100] }, '丁': { d: [100, 55, 30, 60, 200] }
  };
  const M4 = mk3q(MK4, Object.keys(MK4), {});
  const A4 = M4.YF3Q.analyze('本站');
  const H4 = M4.gwThreeQHtml('本站');
  assert(A4.stage === '领跑期' && (H4.match(/class="gw3-card"/g) || []).length === 1 && H4.indexOf('差距 ') < 0, 'R2-17：领跑期定位句 + 最小比值≥1 → 只渲染定位卡（无假短板卡）');
  assert(H4.indexOf('排头兵') >= 0, 'R2-18：领跑期定位句逐字（排头兵模板）');
  /* 场景五/六：两种降级态 */
  const H5 = mk3q(MK1, Object.keys(MK1), {}).gwThreeQHtml('孤站');
  assert(H5.indexOf('这个季度还没有你的数据，先完成上报') >= 0 && H5.indexOf('去上报') >= 0 && H5.indexOf('gw3-card') < 0, 'R2-19：降级 1 行为级——本季未上报 → 引导句+去上报按钮，不留空白');
  const H6 = mk3q(MK1, ['本站', '甲'], {}).gwThreeQHtml('本站');
  assert(H6.indexOf('全站对比等数据齐了再给你看') >= 0 && H6.indexOf('gw3-stage') < 0, 'R2-20：降级 2 行为级——有数站<3 家 → 档位退化为仅同比（逐字句，无档位大字）');
  /* 场景七：集团评价回退链 PROF 缺 → SEMI；双缺 → 整行不显示 */
  const H7a = mk3q(MK1, Object.keys(MK1), { SEMI: { '本站': { yf: '延续优秀执行；六安分站新卡同比-20（科普来源不足）' } } }).gwThreeQHtml('本站');
  const H7b = mk3q(MK1, Object.keys(MK1), {}).gwThreeQHtml('本站');
  assert(H7a.indexOf('集团评价：延续优秀执行') >= 0, 'R2-21：集团评价回退——PROF 缺 → SEMI.yf');
  assert(H7b.indexOf('集团评价：') < 0, 'R2-22：集团评价双缺 → 整行不显示（不虚构）');
  /* 场景八：集团评价隐私边界（lead 定案 2026-09-27）——站级隐藏、管理端可见，与详情层组织侧评价原文同边界 */
  const H8a = mk3q(MK1, Object.keys(MK1), { PROF: { '本站': { note: '在家长沟通上有亮点。' } }, station: true }).gwThreeQHtml('本站');
  const H8b = mk3q(MK1, Object.keys(MK1), { PROF: { '本站': { note: '在家长沟通上有亮点。' } }, station: false }).gwThreeQHtml('本站');
  assert(H8a.indexOf('集团评价：') < 0, 'R2-33：权限 D——站级（yfIsStation=true）首屏不渲染「集团评价」摘要行');
  assert(H8b.indexOf('集团评价：在家长沟通上有亮点') >= 0, 'R2-34：权限 D——管理端（yfIsStation=false）首屏正常渲染「集团评价」摘要行');
  assert(q3Src.indexOf("yfIsStation==='function'&&yfIsStation()") >= 0 && q3Src.indexOf('gw3-org">集团评价：') >= 0, 'R2-35：权限 D——摘要行渲染经 yfIsStation 门控（与详情层组织侧评价原文 !yfIsStation 同一边界）');
  /* ---------- R2 静态：打卡机制/配对/散点根除 + 页签移除 ---------- */
  ['function gwRx(', 'gwStart(', 'gwFill(', 'gwBlock(', 'function gwPair(', 'gwAskBench(', 'gwQuadSvg(', '<div class="gw-tabs"', 'data-gw="rx"', "gw:'rx'", "gw:'pair'"].forEach(function (t) {
    assert(htmlMain.indexOf(t) < 0, 'R2-23：打卡/处方/配对/散点/页签根除——「' + t + '」零残留');
  });
  assert(htmlMain.indexOf('id="gwDetail" hidden') >= 0 && htmlMain.indexOf('gwDetailToggle(this)') >= 0, 'R2-24：详情层折叠保留（gwDetail 默认 hidden + 文字链开关）');
  /* ---------- R2 行为级：2025 视图集团合计（lead 裁定：该季权威记录站点全集，含站外历史站） ---------- */
  const dashSrcM = htmlMain.match(/<script type="text\/plain" id="dashSrc">([\s\S]*?)<\/script>/);
  assert(!!dashSrcM, 'R2-25：dashSrc 块可定位');
  const dashDecoded = Buffer.from(dashSrcM[1].trim(), 'base64').toString('utf8');
  const REAL = new Function(dashDecoded + '\n;return {HIST:HIST,STATIONS:STATIONS};')();
  const dLayer = src2.slice(src2.indexOf('let DASH_DB={'), src2.indexOf('function renderDashYoy'));
  assert(dLayer.indexOf('function histScopeRec()') >= 0 && dLayer.indexOf('Object.keys(hr)') >= 0, 'R2-26：集团合计口径改造落位——histScopeRec（整季=HIST.season/单月=HIST.months）+ 站点全集求和');
  function mkDLayer(season, cur) {
    /* 切片内 let DASH_DB/DASH_ORDER/DASH_CUR/DASH_SEASON 声明摘除，改由参数注入（避免重复声明） */
    const dl = dLayer.replace('let DASH_DB={};', '').replace('let DASH_ORDER=[];', '')
      .replace(/let DASH_CUR='all';/, '').replace(/let DASH_SEASON=curSeasonKey\(\);/, '');
    const f = new Function('DASH_SEASON', 'DASH_CUR', 'DASH_ORDER', 'DASH_DB', 'STATIONS', 'HIST',
      dl + '\n;return {dCurTot:dCurTot,dCurTotN:dCurTotN,yoyBaseTotal:yoyBaseTotal};');
    return f(season, cur, [], null, REAL.STATIONS, REAL.HIST);
  }
  assert(mkDLayer('2025W', 'all').dCurTotN('reg', 2) === 431, 'R2-27：自验硬线——2025W 整季集团入营合计=431（HIST.season 权威口径）');
  assert(mkDLayer('2025W', 'all').dCurTot('reg', 2) === 431, 'R2-28：2025W 整季集团合计（dCurTot 漏斗口径）同样=431');
  assert(mkDLayer('2025W', '1').dCurTotN('reg', 2) === 480, 'R2-29：2025W 单月（1月）合计=480——按该月记录站点全集（含磐安/文成/青田站外历史站，如实记录）');
  assert(mkDLayer('2026S', 'all').yoyBaseTotal('2025W', 'reg', 2) === 431, 'R2-30：2026 视图同比基线合计（yoyBaseTotal）=431——基线与 2025 视图同口径');
  const DL26 = { '6': { 'A': { reg: [10, 5, 3], dev: [1, 2, 0, 3, 1], camp: [3, 2, 1], par: [2, 0.5] }, 'B': { reg: [8, 4, 2], dev: [1, 1, 0, 2, 1], camp: [2, 1, 1], par: [1, 0.5] } }, '7': { 'A': { reg: [12, 8, 5], dev: [2, 3, 0, 4, 2], camp: [5, 3, 2], par: [3, 0.6] }, 'B': { reg: [6, 4, 3], dev: [1, 1, 0, 2, 1], camp: [3, 2, 1], par: [2, 0.6] } } };
  const f26 = new Function('DASH_SEASON', 'DASH_CUR', 'DASH_ORDER', 'DASH_DB', 'STATIONS', 'HIST', dLayer.replace('let DASH_DB={};', '').replace('let DASH_ORDER=[];', '').replace(/let DASH_CUR='all';/, '').replace(/let DASH_SEASON=curSeasonKey\(\);/, '') + '\n;return {dCurTotN:dCurTotN};');
  assert(f26('2026S', 'all', ['6', '7'], DL26, ['A', 'B'], REAL.HIST).dCurTotN('reg', 2) === 13, 'R2-31：2026 视图集团合计不受影响——仍按当前站名单逐月合计（3+2+5+3=13）');
  /* ---------- R2：dashSrc 与 dash_data.js 逐字节一致（门禁 5 自证） ---------- */
  const dd = fs.readFileSync(P.DASH_DATA_JS);
  assert(Buffer.compare(Buffer.from(dashDecoded, 'utf8'), dd) === 0, 'R2-32：dashSrc base64 解码与 dash_data.js 逐字节一致');
})();

/* ================ 看板四项修复（DBF）：地图联动 / 时间下拉+跨年 / 同比折叠 / 中台同步（fe-growth-r2 round2 新增） ================ */
(function () {
  const src2 = fs.readFileSync(P.jsBlock('02'), 'utf8');
  const H = fs.readFileSync(P.INDEX_HTML, 'utf8');

  /* ---- 注释感知源码剥离：用于「代码里零 2026S 字面量」判定（注释里提及不算） ---- */
  function stripComments(code) {
    let out = '', i = 0, q = null;
    while (i < code.length) {
      const c = code[i], n = code[i + 1];
      if (q) {
        out += c;
        if (c === '\\') { out += (n || ''); i += 2; continue; }
        if (c === q) q = null;
        i++; continue;
      }
      if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
      if (c === '/' && n === '*') { const e = code.indexOf('*/', i + 2); i = (e < 0 ? code.length : e + 2); continue; }
      if (c === '/' && n === '/') { const e = code.indexOf('\n', i); i = (e < 0 ? code.length : e); continue; }
      out += c; i++;
    }
    return out;
  }
  const codeOnly = stripComments(src2);

  /* ===== DBF-A：跨年健壮性（修复 B 的地基） ===== */
  assert(codeOnly.indexOf("'2026S'") < 0, 'DBF1：当年赛季零 2026S 硬编码（注释以外全清）——跨年后看板不再把当年数据当历史季读');
  assert(src2.indexOf("function curSeasonKey(){return (new Date().getFullYear())+'S';}") >= 0, 'DBF2：curSeasonKey() 由系统时钟推导（2026→2026S / 2027→2027S）');
  const cskUses = (codeOnly.match(/curSeasonKey\(\)/g) || []).length;
  assert(cskUses >= 15, 'DBF3：全站赛季判断统一走 curSeasonKey()（实际 ' + cskUses + ' 处，覆盖数据层/GW/三问/地图/云端应用）');
  assert(src2.indexOf('const seasons=[cur].concat(histSeasonList());') >= 0, 'DBF4：赛季下拉 = [当年].concat(HIST 历史季)——HIST 为空也不会出现空下拉（2027 可用）');

  /* ===== DBF-B：地图数据链（行为级） ===== */
  const mapA = src2.indexOf('var _isHistSeason=');
  const mapB = src2.indexOf('/* ===== 真实中国省界数据');
  assert(mapA >= 0 && mapB > mapA, 'DBF5：地图取数助手块可定位');
  const mapHelpers = src2.slice(mapA, mapB);
  assert(mapHelpers.indexOf('DASH_DB[') < 0 && mapHelpers.indexOf('DASH_ORDER') < 0, 'DBF6：地图不再直读 DASH_DB/DASH_ORDER（旧口径=永远今年全月，正是「地图不跟选择器变」的根因）');
  assert(mapHelpers.indexOf('return null;') >= 0, 'DBF7：无数据返回 null（与真实 0 严格区分）');
  const dashSrcM2 = H.match(/<script type="text\/plain" id="dashSrc">([\s\S]*?)<\/script>/);
  assert(!!dashSrcM2, 'DBF8：dashSrc 可定位');
  const REAL2 = new Function(Buffer.from(dashSrcM2[1].trim(), 'base64').toString('utf8') + '\n;return {HIST:HIST,STATIONS:STATIONS};')();
  function mkMap(season, cur, viewImpl) {
    const calls = { view: 0, hist: 0 };
    const histSeasonRec = function (k, st) { calls.hist++; return (REAL2.HIST[k] && REAL2.HIST[k].season) ? (REAL2.HIST[k].season[st] || null) : null; };
    const dRecVal = function (rec, k, i) { return (rec && rec[k] && rec[k][i] != null) ? rec[k][i] : null; };
    const dViewVal = function (name, k, i) { calls.view++; return viewImpl ? viewImpl(name, k, i) : null; };
    const f = new Function('DASH_SEASON', 'DASH_CUR', 'curSeasonKey', 'dViewVal', 'histSeasonRec', 'dRecVal',
      mapHelpers + '\n;return {getCampCount:getCampCount,mapCellOf:mapCellOf};');
    return { api: f(season, cur, function () { return '2026S'; }, dViewVal, histSeasonRec, dRecVal), calls: calls };
  }
  /* 历史季整季 → HIST.season（与集团合计同口径） */
  const m1 = mkMap('2025W', 'all');
  const want = REAL2.HIST['2025W'].season['五河'].reg[2];
  assert(m1.api.getCampCount('五河') === want, 'DBF9：历史季整季地图取 HIST.season 值（五河=' + want + '，与集团合计同口径，不再按月份求和）');
  assert(m1.calls.hist > 0 && m1.calls.view === 0, 'DBF10：历史季整季走 season 记录通道（未触碰 dViewVal）');
  /* 该季未收录站 → null（不是 0） */
  const m2 = mkMap('2025W', 'all');
  assert(m2.api.getCampCount('丰镇') === null, 'DBF11：历史季未开展站返回 null（丰镇 2025 寒假未收录）——绝不与真实 0 混同');
  /* 历史季单月 → 走 dViewVal（单月口径） */
  const m3 = mkMap('2025W', '1', function (n, k, i) { return (n === '五河' && k === 'reg' && i === 2) ? 480 : null; });
  assert(m3.api.getCampCount('五河') === 480 && m3.calls.view > 0 && m3.calls.hist === 0, 'DBF12：历史季单月地图走 dViewVal 单月口径（不套整季 season 记录）');
  /* 当年 → 走 dViewVal */
  const m4 = mkMap('2026S', 'all', function (n, k, i) { return (n === '五河' && k === 'reg' && i === 2) ? 82 : null; });
  assert(m4.api.getCampCount('五河') === 82 && m4.calls.hist === 0, 'DBF13：当年视图地图走 dViewVal（整季/单月由 DASH_CUR 决定）');
  /* 真实 0 照传 */
  const m5 = mkMap('2026S', 'all', function (n, k, i) { return (n === '怀远' && k === 'reg' && i === 2) ? 0 : null; });
  assert(m5.api.getCampCount('怀远') === 0, 'DBF14：真实上报 0 照传为 0（不当缺失，也不显示「未上报」）');
  /* null 一律跳过合计/最大值：源码级 */
  assert(src2.indexOf('if(s.camp===null||s.camp===undefined)return;') >= 0 && src2.indexOf('grandTotal=(grandTotal===null?0:grandTotal)+s.camp') >= 0, 'DBF15：地图合计/最高值跳过 null（0 不冒充缺失，缺失不拉低合计）');
  assert(src2.indexOf("(_isHistSeason?'未开展':'未上报')") >= 0, 'DBF16：地图站行 null 文案——历史季「未开展」/当年「未上报」，与真实 0 的「0人」区分');
  /* 2026-09-29：历史季灰板由自定灰值（#93A6BA hi/dotMid · #EFF2F5 lo）迁到**基线既有**灰阶
     （#94A3B8=slate-400 · #EEF2F6；另 dotHi/dotLo 由 #6E8299/#AFBECB → #6B7B8F/#B0BEC5）。
     原因：原 4 值不在 p0 扫描基线 c5f41fb 明文里 → 被 P0「新增硬编码色」判红（真实命中、非回归）。
     语义未变（历史季 = 灰蓝低饱和 + 「去年基线 · 只读」角标），故此处同步跟进钉值；
     色差 ΔRGB ≤ 13，观感不变。 */
  assert(src2.indexOf("_isHistSeason?'#94A3B8'") >= 0 && src2.indexOf("_isHistSeason?'#EEF2F6'") >= 0 && src2.indexOf('去年基线 · 只读') >= 0, 'DBF17：历史季切「去年基线 · 只读」灰蓝配色 + 角标');
  assert(src2.indexOf('if(svg._zmClean)svg._zmClean();') >= 0, 'DBF18：地图重建前解绑上一轮 zoom 监听（防监听器叠加）');

  /* ===== DBF-C：联动接线 ===== */
  assert(/function refreshDashViews\(\)\{[\s\S]*?renderChinaMap\(\)[\s\S]*?renderHQ\(\)/.test(src2), 'DBF19：refreshDashViews 同时重渲地图与中台总览（修复 A 与 D 的接线根因）');
  assert(src2.indexOf("if(typeof renderChinaMap==='function')renderChinaMap();") >= 0, 'DBF20：地图重渲带 typeof 守卫（模块未加载不炸）');
  assert(src2.indexOf("try{ if(typeof renderHQ==='function')renderHQ(); }catch(e){}") >= 0, 'DBF21：中台总览重渲带 try/catch（管理端异常不阻断看板切换）');

  /* ===== DBF-D：中台基准缓存键含赛季 ===== */
  const gwCode = src2.slice(src2.indexOf('var _bench = null'));
  assert(gwCode.indexOf("DASH_SEASON?DASH_SEASON:''") >= 0 && gwCode.indexOf("months().join(',')") >= 0 && gwCode.indexOf('_benchKey = key;') >= 0, 'DBF22：bench 缓存键 = 赛季 + 月份 + 站点清单（2026S/2025S 月份同名不再命中过期基准）');

  /* ===== DBF-E：同比折叠 ===== */
  assert(src2.indexOf('<details class="yoy-fold">') >= 0 && src2.indexOf('class="yoy-fold" open') < 0, 'DBF23：同比明细进 details 且默认收起（无 open 属性）');
  assert(src2.indexOf("展开 '+STATIONS.length+' 站逐站对照") >= 0, 'DBF24：折叠开关文案含站数（动态，不写死 20）');
  assert(src2.indexOf('class="yoy-sum"') >= 0 && src2.indexOf('>整季</option>') >= 0, 'DBF25：常显摘要行 + 时间下拉共存（首屏只留一行摘要）');
  assert(src2.indexOf('<tr><td class="k"><b>集团合计</b></td>') >= 0, 'DBF26：折叠明细内集团合计行与逐站行一字不少（no data loss）');
  assert(src2.indexOf('家长参与为今年新增统计项') >= 0 && src2.indexOf('该季未开展的站如实标注，不以 0 充数') >= 0, 'DBF27：家长参与口径说明与未开展标注随明细保留');
  assert(H.indexOf('yoy-sum{display:flex') >= 0 && H.indexOf('yoy-fold>summary{') >= 0, 'DBF28：摘要/折叠样式已落 CSS');
  assert(H.indexOf('tsel{font-family:inherit') >= 0 && H.indexOf('min-height:44px') >= 0, 'DBF29：下拉样式落 CSS 且触摸区 ≥44px');

  /* ===== DBF-F：跨年与历史季年份文案 ===== */
  assert(src2.indexOf('function dashPeriodText()') >= 0 && (src2.match(/dashPeriodText\(\)/g) || []).length >= 4, 'DBF30：数据周期/体检结论/推演示范三处年份文案统一走 dashPeriodText()（历史季显该季名，不再写死当前年份）');

  /* ===== DBF-G：P0 —— 修复触及区域内零 emoji ===== */
  const mapEmoji = mapHelpers.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
  assert(!mapEmoji, 'DBF31：地图区域零 emoji（原「地图数据来源」前的 emoji 已清除）');
  const yoyEmoji = src2.slice(src2.indexOf('function renderDashYoy'), src2.indexOf('function dashKpi')).match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
  assert(!yoyEmoji, 'DBF32：同比面板零 emoji');
})();


/* ================ 看板四项修复 · 数字级与跨年级锁死（DBF-X，fe-growth-r2 round2） ================ */
(function () {
  const src2 = fs.readFileSync(P.jsBlock('02'), 'utf8');
  const H = fs.readFileSync(P.INDEX_HTML, 'utf8');
  const MAPNAMES = ['舒城', '五河', '凤台', '定安', '广德', '怀远', '扎旗', '泾县', '灵璧', '翁旗', '左旗', '龙游', '叶集', '乐昌', '南陵', '庐江', '怀集', '宿松', '丰镇', '商都'];

  const dashSrcMX = H.match(/<script type="text\/plain" id="dashSrc">([\s\S]*?)<\/script>/);
  const REALX = new Function(Buffer.from(dashSrcMX[1].trim(), 'base64').toString('utf8') + '\n;return {HIST:HIST,STATIONS:STATIONS};')();

  /* ---------- 1. 地图 = 与选择器同源（数字级） ---------- */
  const mapA = src2.indexOf('var _isHistSeason=');
  const mapB = src2.indexOf('/* ===== 真实中国省界数据');
  const mapHelpers = src2.slice(mapA, mapB);
  function mkMapX(season, cur, viewImpl) {
    const histSeasonRec = function (k, st) { return (REALX.HIST[k] && REALX.HIST[k].season) ? (REALX.HIST[k].season[st] || null) : null; };
    const dRecVal = function (rec, k, i) { return (rec && rec[k] && rec[k][i] != null) ? rec[k][i] : null; };
    const dViewVal = function (name, k, i) { return viewImpl ? viewImpl(name, k, i) : null; };
    const f = new Function('DASH_SEASON', 'DASH_CUR', 'curSeasonKey', 'dViewVal', 'histSeasonRec', 'dRecVal',
      mapHelpers + '\n;return {getCampCount:getCampCount};');
    return f(season, cur, function () { return '2026S'; }, dViewVal, histSeasonRec, dRecVal);
  }
  function totalOf(api) {
    let sum = null, n = 0;
    MAPNAMES.forEach(function (nm) { const v = api.getCampCount(nm); if (v !== null && v !== undefined) { n++; sum = (sum === null ? 0 : sum) + v; } });
    return { sum: sum, n: n };
  }
  const t25S = totalOf(mkMapX('2025S', 'all'));
  assert(t25S.sum === 3435 && t25S.n === 19, 'DBF33：地图整季（2025S）= 3435 人 / 有数 19 站（丰镇未开展）——与集团合计同口径（实际 ' + t25S.sum + '/' + t25S.n + '）');
  const t25W = totalOf(mkMapX('2025W', 'all'));
  assert(t25W.sum === 431 && t25W.n === 17, 'DBF34：地图整季（2025W）= 431 人 / 有数 17 站（不是按月份求和的 480，实际 ' + t25W.sum + '/' + t25W.n + '）');
  function realView(season, month) {
    return function (name, key, idx) {
      const arr = REALX.HIST[season] && REALX.HIST[season].months && REALX.HIST[season].months[month];
      if (!arr) return null; const r = arr[name];
      return (r && r[key] && r[key][idx] != null) ? r[key][idx] : null;
    };
  }
  const t25S6 = totalOf(mkMapX('2025S', '6', realView('2025S', '6')));
  assert(t25S6.sum === 1179 && t25S6.n === 19, 'DBF35：地图单月口径 = 该月记录求和（2025S 6 月 = 1179 人 / 19 站，实际 ' + t25S6.sum + '/' + t25S6.n + '）');
  /* 当年走 dViewVal（不做 season 记录回退） */
  const tCur = totalOf(mkMapX('2026S', 'all', function () { return 7; }));
  assert(tCur.sum === 140 && tCur.n === 20, 'DBF36：当年视图地图走 dViewVal（20 站 × 7 = 140，实际 ' + tCur.sum + '/' + tCur.n + '）');

  /* ---------- 2. 跨年（2027）韧性：数据层行为级 ---------- */
  const dA = src2.indexOf('let DASH_DB={'), dB = src2.indexOf('function renderDashYoy');
  const dlBase = src2.slice(dA, dB)
    .replace('let DASH_DB={};', '')
    .replace('let DASH_ORDER=[];', '')
    .replace(/let DASH_CUR='all';/, '')
    .replace(/let DASH_SEASON=curSeasonKey\(\);/, '')
    .replace(/function curSeasonKey\(\)\{[^}]*\}/, '');
  assert(dlBase.indexOf('curSeasonKey(){') < 0 && dlBase.indexOf('DASH_DB={') < 0, 'DBF37：数据层切片可注入（声明与 curSeasonKey 定义已摘除）');
  function mkY(season, key, db, order, hist, year) {
    /* year 传入时注入假时钟（Date 形参遮蔽全局），用于验证「跨年后赛季名跟随系统年份」 */
    const params = ['DASH_SEASON', 'DASH_CUR', 'DASH_ORDER', 'DASH_DB', 'STATIONS', 'HIST', 'curSeasonKey'];
    const args = [season, 'all', order, db, REALX.STATIONS, hist, function () { return key; }];
    if (year) { params.push('Date'); args.push(function () { return { getFullYear: function () { return year; } }; }); }
    const f = Function.apply(null, params.concat([dlBase + '\n;return {seasonSrc:seasonSrc,seasonOrder:seasonOrder,seasonLabel:seasonLabel,dViewVal:dViewVal,dCurTotN:dCurTotN};']));
    return f.apply(null, args);
  }
  const DB27 = { '6': { '五河': { reg: [10, 8, 5], dev: [1, 2, 0, 3, 1], camp: [5, 3, 2], par: [2, 0.5] } } };
  const Y27 = mkY('2027S', '2027S', DB27, ['6'], {}, 2027);
  assert(Y27.seasonSrc() === DB27, 'DBF38：跨年韧性——2027 年当年赛季读 DASH_DB（旧写法读 HIST["2027S"] → undefined → 看板整块空白）');
  assert(Y27.seasonOrder().join(',') === '6', 'DBF39：2027 赛季月份取自 DASH_ORDER（不依赖 HIST）');
  assert(Y27.seasonLabel().indexOf('2027') >= 0, 'DBF40：2027 赛季名含年份（实际「' + Y27.seasonLabel() + '」）');
  assert(Y27.dViewVal('五河', 'reg', 2) === 5, 'DBF41：2027 当年视图取数正常（五河入营 5 —— 跨年后看板数字不为空）');
  const Y27h = mkY('2025S', '2027S', DB27, ['6'], {}, 2027);
  assert(Y27h.seasonSrc() === null && Y27h.seasonOrder().length === 0 && Y27h.dViewVal('五河', 'reg', 2) === null, 'DBF42：HIST 为空时历史季视图优雅退化（不抛错、不误取当年数据）');
})();

/* ================ 第三轮（I3）：成长页动作层（fe-growth-r2 留痕新增） ================
   方案依据：output/design/成长与学习版块增强方案.md v1.1 §2.2 / §2.3 / §2.4 / §6-4
   定位卡 0 CTA / 短板卡 1 主 CTA → 学习章 / 动作卡 1 主 CTA → 年度自报指标轨 ================ */
(function () {
  const src2i = fs.readFileSync(P.jsBlock('02'), 'utf8');
  const src6i = fs.readFileSync(P.jsBlock('06'), 'utf8');
  const qa = src2i.indexOf('var YF3Q='), qb = src2i.indexOf('/* ============ ① 能力体检');
  assert(qa >= 0 && qb > qa, 'I3R0：三卡渲染块可提取（动作层断言前提）');
  const q3i = src2i.slice(qa, qb);
  function mkI3(MK, stations, opt) {
    opt = opt || {};
    const HIST = { '2025S': { label: '2025年暑假', season: {}, months: {} } };
    Object.keys(MK).forEach(function (k) {
      if (MK[k].y) HIST['2025S'].season[k] = { reg: [null, null, MK[k].y[0]], dev: [MK[k].y[1], null, null, MK[k].y[3], MK[k].y[2]], par: [null, null] };
    });
    function dAll(s, key, idx) {
      const r = MK[s]; if (!r) return 0;
      const map = { 'reg2': r.d[0], 'dev0': r.d[1], 'dev4': r.d[2], 'dev3': r.d[3], 'par0': r.d[4] };
      const v = map[key + idx]; return (v === undefined) ? 0 : v;
    }
    const f = new Function('DASH_SEASON', 'DASH_CUR', 'DASH_ORDER', 'DASH_DB', 'STATIONS', 'HIST',
      'seasonHasStation', 'seasonLabel', 'curSeasonTerm', 'PROF', 'SEMI', 'dAll', 'histBaseSeason', 'histSeasonRec', 'yfIsStation', 'curSeasonKey',
      q3i + '\n;return {YF3Q:YF3Q,gwThreeQHtml:gwThreeQHtml};');
    return f('2026S', 'all', [], null, stations, HIST,
      function (s) { return !!MK[s]; }, function () { return '2026 年暑假'; }, function () { return '暑假'; },
      opt.PROF || {}, opt.SEMI || {}, dAll, function () { return '2025S'; },
      function (k, s) { return (HIST[k] && HIST[k].season[s]) || null; },
      function () { return !!opt.station; }, function () { return '2026S'; });
  }
  const MKI3 = {
    '本站': { d: [100, 25, 8, 18, 0], y: [74, 15, 12, 12] },
    '甲': { d: [100, 30, 10, 30, 50] }, '乙': { d: [100, 40, 12, 42, 80] },
    '丙': { d: [100, 45, 20, 50, 100] }, '丁': { d: [100, 55, 30, 60, 200] }
  };
  const HI3 = mkI3(MKI3, Object.keys(MKI3), {});
  const H3 = HI3.gwThreeQHtml('本站');
  const w3 = HI3.YF3Q.analyze('本站').weak;
  assert((H3.match(/class="gw3-capbtn"/g) || []).length === 1 &&
    H3.indexOf('这块怎么补 ›</button>') >= 0 &&
    H3.indexOf('class="gw3-capbtn" data-cw="' + w3.k + '"') >= 0 &&
    H3.indexOf('onclick="gw3HowToggle(this)"') >= 0,
    'I3R1：短板卡恰 1 个次按钮，逐字「这块怎么补 ›」，就地在位展开真实做法（data-cw=短板能力键=' + w3.k + '；'
    + '2026-10-01 用户改判「跳 PMP 理论章没有可参考性」，取代原 gw3GoBook 跳书方案 §2.2/§2.3）');
  assert((H3.match(/class="gw3-actbtn"/g) || []).length === 1 &&
    H3.indexOf('把这条立成季末验收 ›</button>') >= 0 &&
    H3.indexOf('class="gw3-actbtn" onclick="gw3GoPromise(\'' + w3.k + '\')"') >= 0,
    'I3R2：动作卡恰 1 个主按钮，逐字「把这条立成季末验收 ›」，落 gw3GoPromise(' + w3.k + ')（方案 §2.2/§2.3）');
  assert((H3.match(/<button type="button"/g) || []).length === 2,
    'I3R3：三卡内可点按钮恰 2 个（首屏减法：定位卡 0 + 短板卡 1 + 动作卡 1）');
  const i3c = H3.indexOf('class="gw3-capbtn"'), i3a = H3.indexOf('class="gw3-actbtn"');
  assert(i3c >= 0 && i3a > i3c, 'I3R4：两个 CTA 的渲染顺序与卡片顺序一致（短板卡先于动作卡）');
  const firstCard = H3.slice(0, H3.indexOf('</div>', H3.indexOf('class="gw3-card"')));
  assert(firstCard.indexOf('<button') < 0, 'I3R5：定位卡 0 CTA——第一张卡切片内零 button（纯信息卡，方案 §1-2）');
  /* 降级态：领跑期（无真短板）/ 未上报 / 全站中位不可得 → 两个 CTA 一律不渲染（方案 §7） */
  const MKlead = {
    '本站': { d: [100, 60, 20, 60, 160], y: [74, 20, 12, 12] },
    '甲': { d: [100, 30, 10, 30, 50] }, '乙': { d: [100, 40, 12, 42, 80] },
    '丙': { d: [100, 45, 20, 50, 100] }, '丁': { d: [100, 55, 30, 60, 200] }
  };
  const HL = mkI3(MKlead, Object.keys(MKlead), {}).gwThreeQHtml('本站');
  const HU = mkI3(MKI3, Object.keys(MKI3), {}).gwThreeQHtml('孤站');
  const HM = mkI3(MKI3, ['本站', '甲'], {}).gwThreeQHtml('本站');
  assert([HL, HU, HM].every(function (x) { return x.indexOf('gw3-capbtn') < 0 && x.indexOf('gw3-actbtn') < 0; }),
    'I3R6：降级态（领跑期无真短板 / 本季未上报 / 有数站<3 家中位不可得）两个 CTA 均不渲染，不造假动作位');
  /* 切片右边界改用「三卡动作层之后的无关规则」.gw3-guide{：原实现写死 1100 字符，
     该块内新增任意一条 .gw3-* 规则都会把 .gw3-actbtn 挤出窗口 → 断言脆红。
     语义上本块 = 从 .gw3-capbtn{ 到 .gw3-guide{ 之间，改后不再随新增规则误红。 */
  const cssI3 = htmlMain.slice(htmlMain.indexOf('.gw3-capbtn{'), htmlMain.indexOf('.gw3-guide{'));
  assert(/\.gw3-capbtn\{[^}]*width:100%[^}]*min-height:44px/.test(cssI3), 'I3R8：.gw3-capbtn 整行铺满 + 44px 触摸区（方案 §6-4 / WCAG 2.5.5）');
  assert(/\.gw3-actbtn\{[^}]*width:100%[^}]*min-height:44px/.test(cssI3), 'I3R9：.gw3-actbtn 整行铺满 + 44px 触摸区（方案 §6-4 / WCAG 2.5.5）');
  assert(cssI3.indexOf('prefers-reduced-motion') >= 0, 'I3R10：两个 CTA 的过渡纳入 prefers-reduced-motion 兜底');
  /* 行为机：真实代码切片，断言落点函数的两步链与降级链 */
  const a1i = src6i.indexOf('var GW3_BOOK={'), a2i = src6i.indexOf('/* 挂载：仅 station；data-loaded 标记区分');
  assert(a1i >= 0 && a2i > a1i, 'I3R11：动作层代码切片可提取（GW3_BOOK → gw3PromiseFill）');
  const actI3 = src6i.slice(a1i, a2i);
  assert(/GW3_BOOK=\{cardper:'ka-scope',convper:'ka-qual',sciop:'ka-comm',parent:'ka-stake'\}/.test(actI3),
    'I3R12：四能力→四章节映射逐字（与 lrRoutesHTML 路线 B 同表，方案 §2.3）');
  assert(/function gw3GoBook\(capKey\)\{[\s\S]*?applyTab\('learn'\)[\s\S]*?window\.lrJump\(id\)[\s\S]*?setTimeout\(tick,250\)/.test(actI3),
    'I3R13：gw3GoBook 链完整——applyTab(\'learn\') → window.lrJump(id) → 250ms 幂等轮询（2026-10-01：'
    + 'lrJump 已导出到 window；单次 400ms 兜底改多轮，因实测跨 4 万 px 的 smooth 定位不生效）'
    + '（方案 §2.3 降级）');
  /* 2026-10-01 用户改判：短板卡「怎么补」不再跳图书化课程（PMP 理论章），改为就地在位展开真实做法。
     新契约三条：① GW3_REAL 四能力齐备；② 内容取自 SEED_CASES/SEED_TEMPLATES（本页数据、离线可用）；
     ③ 面板懒渲染 —— 既省首屏开销，又消除「gwThreeQHtml 在脚本块 2、gw3HowHtml 在脚本块 5」的跨块
     加载期调用（实测会抛 ReferenceError 并让整个「我的成长」初始化失败）。 */
  const gw3RealOk = ['cardper', 'convper', 'sciop', 'parent'].every(function (k) {
    return new RegExp(k + '\\s*:\\s*\\{cases:\\[[^\\]]*\\],tpls:\\[[^\\]]*\\]\\}').test(actI3);
  });
  assert(gw3RealOk &&
    /function gw3HowHtml\(k,st\)\{[\s\S]*?GW3_REAL\[k\][\s\S]*?gw3CaseById\([\s\S]*?gw3TplById\(/.test(actI3) &&
    /function gw3HowToggle\(btn\)\{[\s\S]*?classList\.toggle\('on'\)/.test(actI3) &&
    /box\.innerHTML=gw3HowHtml\(/.test(actI3),
    'I3R17：短板卡「怎么补」就地在位展开真实做法——GW3_REAL 四能力映射齐备、素材取自 '
    + 'SEED_CASES/SEED_TEMPLATES、面板懒渲染（2026-10-01 用户改判，取代跳 PMP 理论章）');
  assert(/GW3_PROMISE=\{\s*cardper:\{metric:'dev\[0\]',abs:true\}/.test(actI3) && actI3.indexOf("cap.cardper") < 0,
    'I3R14：转化设计退化为绝对值 dev[0]，且不得出现未注册键 cap.cardper（裁决 1 契约红线）');
  assert(/function gw3GoPromise\(capKey\)\{[\s\S]*?yfIsStation\(\)[\s\S]*?'年度自报仅浆站账号使用'[\s\S]*?GW_TAB='file';\s*gwPaint\(\);[\s\S]*?tries>30/.test(actI3),
    'I3R15：gw3GoPromise 链完整——非 station 只 toast → GW_TAB=file + gwPaint → 3 秒未就绪只提示不静默失败（方案 §2.3）');
  assert(/srGoalAdd\('summer'\)/.test(actI3) && /srGoalField\('summer',idx,'track',\{value:'metric'\}\)/.test(actI3) &&
    /srGoalField\('summer',idx,'metric'/.test(actI3) && /srGoalField\('summer',idx,'target'/.test(actI3) &&
    /srGoalText\('summer',idx,/.test(actI3),
    'I3R16：预填顺序与字段逐字——srGoalAdd(summer) → track=metric → metric → target → text（方案 §2.3）');
  assert(actI3.indexOf("if(cfg.ratio) return line==null?0:Math.round(Number(line)*100)") >= 0 &&
    actI3.indexOf('return Math.ceil(Number(line)*enroll)') >= 0,
    'I3R17：目标值口径——比例类验收线×100 取整 / 绝对量类验收比值×本季入营 向上取整（方案 §2.3 映射表）');
})();

/* ================ 第三轮（I5）：诊断卡缓存键补身份维度（fe-growth-r2 留痕新增） ================
   缺陷：`yf:diag:cache:<month>` 只有月份维度 → 同浏览器换账号/换站后读到上一身份的诊断模型
        （含本站指标 + 组织侧评价摘要）= 跨账号越权读。修复：键补 账号 + 站点 两维。 ================ */
(function () {
  const a5 = htmlMain.indexOf('/* ---------- 诊断卡缓存身份维度');
  const b5 = htmlMain.indexOf('function dgBoot(force){');
  assert(a5 >= 0 && b5 > a5, 'I5R0：诊断卡缓存层代码切片可提取');
  const cs = htmlMain.slice(a5, b5);
  assert(/function dgCacheId\(\)/.test(cs) && /function dgCacheKey\(month\)\{ return 'yf:diag:cache:'\+dgCacheId\(\)\+':'\+month; \}/.test(cs),
    'I5R1：拼键统一出口 dgCacheKey(month) = yf:diag:cache:{身份}:{month}');
  assert(cs.indexOf("sessionStorage.getItem('yf:diag:cache:'+ptr.month") < 0 &&
    cs.indexOf("sessionStorage.setItem('yf:diag:cache:'+model.month") < 0,
    'I5R2：无维度旧拼键零残留（`\'yf:diag:cache:\'+month` 不得再出现）');
  assert(/sessionStorage\.setItem\('yf:diag:ptr',JSON\.stringify\(\{month:model\.month,id:dgCacheId\(\)\}\)\)/.test(cs),
    'I5R3：指针 yf:diag:ptr 同步记录身份 id（身份一变，指针即失效）');
  assert(cs.indexOf('if(ptr.id!==dgCacheId())return null;') >= 0,
    'I5R4：指针身份不一致（含旧版本无 id 指针）一律视为未命中——升级后不回读旧键是显式保证');
  assert(cs.indexOf("k.indexOf('yf:diag:cache:')===0") >= 0 &&
    (cs.match(/k\.indexOf\('yf:diag:cache:'\)===0/g) || []).length >= 2,
    'I5R5：前缀清扫语义保持（dgCacheSet 与 dgInvalidate 各一处，失效链未受影响）');
  /* 行为级：真实切片 + sessionStorage 替身，验证跨身份隔离 */
  function mkSS() {
    const m = new Map();
    return {
      get length() { return m.size; }, key(i) { return Array.from(m.keys())[i]; },
      getItem(k) { return m.has(k) ? m.get(k) : null; },
      setItem(k, v) { m.set(k, String(v)); }, removeItem(k) { m.delete(k); },
      dump() { return Array.from(m.entries()); }
    };
  }
  function mkC(u, s, r) {
    const ss = mkSS();
    const f = new Function('sessionStorage', 'yfUsername', 'yfMyStation', 'yfRole',
      cs + '\n;return {dgCacheId:dgCacheId,dgCacheKey:dgCacheKey,dgCacheGet:dgCacheGet,dgCacheSet:dgCacheSet,dgInvalidate:dgInvalidate};');
    return { ss: ss, api: f(ss, function () { return u; }, function () { return s; }, function () { return r; }) };
  }
  const MDA = { month: '2026-08', station: '五河', m: 1 };
  const c1 = mkC('王养运', '五河', 'station');
  c1.api.dgCacheSet(MDA);
  assert(!!c1.api.dgCacheGet() && c1.api.dgCacheGet().model.station === '五河', 'I5R6：同身份写读命中（缓存功能未被破坏）');
  const c2 = mkC('testadmin', '', 'admin');
  c2.ss.setItem('yf:diag:ptr', c1.ss.getItem('yf:diag:ptr'));
  c2.ss.setItem(c1.api.dgCacheKey('2026-08'), c1.ss.getItem(c1.api.dgCacheKey('2026-08')));
  assert(c2.api.dgCacheGet() === null,
    'I5R7：★行为级——把上一身份（王养运/五河）的指针与缓存原样搬到当前身份（testadmin）下，dgCacheGet() 仍必须未命中（跨账号越权读已封）');
  const c3 = mkC('王养运', '凤台', 'station');
  assert(c3.api.dgCacheKey('2026-08') !== c1.api.dgCacheKey('2026-08') && c3.api.dgCacheGet() === null,
    'I5R8：★行为级——同账号换站后键不同且未命中（站点维度生效，站级数据不跨站复用）');
  const c4 = mkC('', '', 'station');
  assert(c4.api.dgCacheKey('2026-08') === 'yf:diag:cache:-station|-:2026-08',
    'I5R9：身份双缺时退化为角色维度，不落空维度共享键 `yf:diag:cache::<month>`');
  const c5 = mkC('', '', 'admin');
  assert(c5.api.dgCacheKey('2026-08') !== c4.api.dgCacheKey('2026-08'), 'I5R10：身份双缺时 admin 与 station 仍互不串号');
  const c6 = mkC('王养运', '五河', 'station');
  c6.api.dgCacheSet(MDA);
  c6.api.dgInvalidate();
  assert(c6.ss.getItem('yf:diag:ptr') === null && c6.ss.dump().length === 0, 'I5R11：dgInvalidate 清干净（指针 + 身份前缀键）');
  /* ===== 任务A：页面状态符号统一为内联 SVG（yfIco 唯一出口）=====
     UI 不得再用字符型状态符号（✓✕⚠✅❌⬇…）——既守 P0-1（禁 emoji 当图标），也保证三通道字体/渲染一致。 */
  const icoTbl = (htmlMain.match(/var YF_ICO=\{[\s\S]*?\n\};/) || [''])[0];
  const icoFn = (htmlMain.match(/function yfIco\(name,size\)\{[\s\S]*?\n\}/) || [''])[0];
  assert(icoTbl !== '' && icoFn !== '', 'ICO1：状态图标唯一出口存在（YF_ICO 表 + yfIco 函数）');
  ['ok', 'x', 'warn', 'down', 'up', 'refresh', 'like', 'clip', 'info', 'star', 'clock'].forEach(function (k) {
    assert(icoTbl.indexOf('\n  ' + k + ":'") >= 0, 'ICO1：语义键齐全——' + k);
  });
  let ico = null;
  try { ico = new Function(icoTbl + '\n' + icoFn + '\n return yfIco;')(); } catch (e) { ico = null; }
  assert(typeof ico === 'function', 'ICO2：图标函数块提取平衡、可构造');
  const svgOk = (typeof ico === 'function') ? ico('ok') : '';
  assert(typeof svgOk === 'string' && svgOk.indexOf('<svg class="eic"') === 0 &&
    svgOk.indexOf('viewBox="0 0 24 24"') >= 0 && svgOk.slice(-6) === '</svg>',
    'ICO2：★行为级——yfIco 返回合法内联 <svg class="eic" viewBox="0 0 24 24">…</svg>');
  assert(typeof ico === 'function' && ico('nope') === '', 'ICO2：未知语义名返回空串（不抛错、不吐脏标记）');
  assert(svgOk.indexOf('fill=') < 0 && svgOk.indexOf('stroke=') < 0 && svgOk.indexOf('http') < 0,
    'ICO2：★着色/描边交给 .eic 类（禁内联 fill/stroke/硬编码色）+ 零外链（P0-2 对齐）');
  /* 反向①：全文不得再出现字符型状态符号（含 P0 区段外的手工 emoji，如 ⏰/⏳） */
  const STATUS_RE = /[✓✕✗⚠✅❌⬇⬆🔄👍📎★⚙📊🎯📍📱📢💡⏰⏳]/g;
  const statLeft = (htmlMain.match(STATUS_RE) || []);
  assert(statLeft.length === 0, 'ICO3：★反向——全文状态符号零残留（实际 ' + statLeft.length + ' 处：' + Array.from(new Set(statLeft)).join('') + '）');
  /* 反向②：P0 口径全文 emoji 计数归零（改前基线 60） */
  const p0Left = (htmlMain.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []);
  assert(p0Left.length === 0, 'ICO3：★反向——P0 口径全文 emoji 计数归零（实际 ' + p0Left.length + '，改前 60）');
  /* 调用点数量与清单一致（防漏改） */
  assert(cntIn(htmlMain, "yfIco('") === 27, 'ICO4：yfIco 调用点数量与清单一致（=27；B2 新增 2 处 chev：时间线连接符 + 回看链接；B-4 新增 1 处 chev：Sprint 节奏时间线；B5 新增 1 处 x：经验广场录入弹窗关闭键）');
  assert(cntIn(htmlMain, '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>') === 11,
    'ICO4：静态标记内联关闭图标数量与清单一致（=11）');
  assert(cntIn(htmlMain, '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>') === 1,
    'ICO4：静态标记内联成功图标数量与清单一致（=1）');
  assert(cntIn(htmlMain, 'function yfIco(name,size){') === 1 && cntIn(htmlMain, 'var YF_ICO={') === 1,
    'ICO5：唯一出口唯一——yfIco / YF_ICO 各仅一处定义（禁第二事实源）');
  /* ICO6/ICO7：图标化必然把可访问名一起拿走——aria-hidden 的图标不参与可访问名计算，
     原来靠文本「✕/×」撑着的按钮会变成无名控件（WCAG 4.1.2），AT 只会念「按钮」。
     ICO6 钉死已知 12 个关闭按钮；ICO7 是通用反向规则，管住后续新增的仅图标按钮。 */
  const XSVG = '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  assert(cntIn(htmlMain, 'class="um-x"') === 13, 'ICO6：um-x 关闭按钮 13 个（9 静态 + 4 JS 生成；B5 新增经验广场录入弹窗）');  assert((htmlMain.match(/class="um-x"[^>]*aria-label="关闭"/g) || []).length === 13,
    'ICO6：★13 个 um-x 全部带可访问名 aria-label="关闭"（实际 ' + (htmlMain.match(/class="um-x"[^>]*aria-label="关闭"/g) || []).length + ' 个）');
  /* ICO7 通用反向：仅含图标、无任何文本的按钮，开标签里必须有 aria-label / title */
  const unnamed = [];
  const staticOnly = htmlMain.match(/<button[^>]*>(?:<svg[\s\S]{0,400}?<\/svg>)<\/button>/g) || [];
  staticOnly.forEach(function (b) {
    const tag = b.slice(0, b.indexOf('>') + 1);
    if (tag.indexOf('aria-label=') < 0 && tag.indexOf('title=') < 0) unnamed.push('静态: ' + b.slice(0, 90));
  });
  /* JS 里「开标签 + 图标 + 收标签」三连：<button …>'+yfIco('x')+'</button>
     两个易踩的坑：① 不能要求开标签前有引号——rule-del 那两处前面是 style 属性的收尾引号；
     ② `</button>` 之后不能要求再跟引号——字符串还在继续（`</button></div>'`）。 */
  const jsOnly = htmlMain.match(/<button[^>]*>'\s*\+yfIco\('[a-z]+'\)\+'<\/button>/g) || [];
  jsOnly.forEach(function (b) {
    const tag = b.slice(0, b.indexOf('>') + 1);
    if (tag.indexOf('aria-label=') < 0 && tag.indexOf('title=') < 0) unnamed.push('JS: ' + b.slice(0, 90));
  });
  assert(staticOnly.length === 14, 'ICO7：静态仅图标按钮 14 个（9 um-x + ann-close + 4 处带 title 的图标位）——防断言空转（实际 ' + staticOnly.length + '）');
  assert(jsOnly.length === 6, 'ICO7：JS 生成的仅图标按钮 6 个（实际 ' + jsOnly.length + ' 个：4 um-x 带 aria-label + 2 rule-del 靠 title；B5 新增经验广场录入弹窗关闭键）');
  assert(unnamed.length === 0, 'ICO7：★反向——仅含图标的按钮零无名控件（实际 ' + unnamed.length + ' 个：' + unnamed.join(' | ') + '）');
  /* 字符型关闭字形不得与内联图标在同一 affordance 家族里混用 */
  assert(cntIn(htmlMain, '>×</button>') === 3 && cntIn(htmlMain, XSVG) === 11,
    'ICO7：um-x 家族零字符型关闭字形混用（>×</button> 仅剩 3 个 rm-btn/nx 图片与提示删除位；um-x 12 处全为内联 svg，与静态 XSVG 计数 11 一致：9 um-x 静态 + ann-close title 位 + 大屏退出按钮）');
})();

/* =====================================================================
 * PG 系列：管理端「生成汇报 PPT」（genHQPPT）
 * ---------------------------------------------------------------------
 * 用户需求（2026-09-28）：「新增一个生成汇报 PPT 的按钮，把数据看板和
 * 各站分析自动灌进 PPT 并下载，让用户可以直接拿去汇报」。
 *
 * 本组断言只钉「不可能靠人工复核发现、但一改就静默坏掉」的接缝：
 *   ① genHQPPT 与手工单站 genPPT 必须互不影响（后者函数体零改动）；
 *   ② 按钮必须长在导出区那一行内，且角色开关显式关掉（不靠父级隐藏）；
 *   ③ pptx 仍走点击懒加载，不得被改成首屏预载（首屏体积是硬约束）；
 *   ④ 口径文案单一事实源——HTML 汇报材料与 PPT 不许各写一份；
 *   ⑤ 缺数据页必须显式说「暂无数据」，禁止用 0 顶替或留空壳。
 * 另：本轮「执行期真能生成 9 页 pptx」由交付时的运行期验证脚本给出（非本文件职责，
 * 因为本文件不做真 PptxGenJS 构建）；此处只保证结构不被改坏。
 * ===================================================================== */
{
  const pgFn = (htmlMain.match(/function genHQPPT\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert(pgFn.length > 0, 'PG1：genHQPPT 函数存在（管理端汇报 PPT 生成入口）');

  /* ① genPPT 函数体零改动：用特征串钉死（手工单站 PPT 是既有功能，不能被顺手改回归） */
  const genPptFn = (htmlMain.match(/function genPPT\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert(genPptFn.length > 0, 'PG2：genPPT（工厂手工单站 PPT）函数仍可切出');
  [
    "var TITLES={recruit:'招募启动方案',mid:'运营中期进展',close:'结营成果总结',train:'负责人培训课件',custom:'工作汇报'};",
    "var C={\n        bg:'FFFFFF',",
    "p.writeFile({fileName:st+'_'+title+'.pptx'})",
    "s5.addChart(p.ChartType.bar,[{name:'指标数值',labels:labels,values:values}],{",
    "se.addText('谢谢聆听'"
  ].forEach(function (t, i) {
    assert(genPptFn.indexOf(t) >= 0, 'PG2：★genPPT 函数体未被改动——特征串 ' + (i + 1) + ' 仍在');
  });
  assert(cntIn(htmlMain, 'function genPPT(){') === 1 && cntIn(htmlMain, 'function genHQPPT(){') === 1,
    'PG2：genPPT / genHQPPT 各自唯一定义（新功能独立函数，不寄生在既有函数里）');
  assert(genPptFn.indexOf('genHQPPT') < 0 && genPptFn.indexOf('hqReportHTML') < 0,
    'PG2：genPPT 不引用新功能符号（两者零耦合，改一边不影响另一边）');

  /* ② 按钮落点：必须在「导出集团汇报材料」同一 up-row 内，且同排 */
  const expAt = htmlMain.indexOf('onclick="hqExportReport()"');
  assert(expAt >= 0, 'PG3：既有「导出集团汇报材料」按钮可定位');
  const rowStart = htmlMain.lastIndexOf('<div class="up-row">', expAt);
  const rowEnd = htmlMain.indexOf('</div>', expAt);
  assert(rowStart >= 0 && rowEnd > expAt, 'PG3：导出区 up-row 可定位');
  const rowHtml = htmlMain.slice(rowStart, rowEnd);
  assert(rowHtml.indexOf('id="hqPptBtn"') >= 0, 'PG3：★「生成汇报 PPT」按钮就在导出区那一行内');
  assert(rowHtml.indexOf('onclick="genHQPPT()"') >= 0, 'PG3：按钮直连 genHQPPT()');
  assert(cntIn(htmlMain, 'id="hqPptBtn"') === 1, 'PG3：hqPptBtn id 唯一');
  assert(cntIn(htmlMain, 'onclick="genHQPPT()"') === 1, 'PG3：genHQPPT 调用点唯一（无幽灵入口）');

  /* ③ 角色门禁：控件级显式开关 + 函数内 admin 守卫（双保险，缺一即员工端泄漏/越权） */
  const navFn = (htmlMain.match(/function yfFilterNav\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert(navFn.indexOf("getElementById('hqPptBtn')") >= 0 && navFn.indexOf("pb.style.display = yfIsAdmin() ? '' : 'none'") >= 0,
    'PG4：★yfFilterNav 显式按角色开关 hqPptBtn（不靠父级卡片隐藏——门禁按元素自身 display 判定）');
  assert(pgFn.indexOf("if(typeof yfIsAdmin==='function' && !yfIsAdmin())") >= 0,
    'PG4：genHQPPT 函数体内有 admin 守卫（负责人端即便直调也拿不到数据）');
  assert(pgFn.indexOf("toast('汇报 PPT 仅管理端可导出')") >= 0, 'PG4：越权调用有明确拒绝文案');

  /* ④ pptx 仍点击懒加载 + 不引入外部依赖 */
  assert(pgFn.indexOf("window.__yfLoadLib('pptx')") >= 0 && pgFn.indexOf("typeof PptxGenJS==='undefined'") >= 0,
    'PG5：★PPT 库仍走 __yfLoadLib 点击懒加载（未改成首屏预载）');
  assert(cntIn(htmlMain, "window.__yfLoadLib('pptx')") === 2,
    'PG5：pptx 懒加载调用点恰 2 处（工厂 genPPT + 集团 genHQPPT），无新增热路径预载');
  assert(pgFn.indexOf('.then(function(){ genHQPPT(); })') >= 0, 'PG5：首点加载完成后自续跑（用户无感知二跳）');
  assert(pgFn.indexOf('<script') < 0 && pgFn.indexOf('http://') < 0 && pgFn.indexOf('https://') < 0,
    'PG5：零外链/零外部文件引用（断网可用）');

  /* ⑤ 口径单一事实源：HTML 汇报材料与 PPT 共用 HQ_CALIB，不许各写一份 */
  assert(cntIn(htmlMain, "var HQ_CALIB = '") === 1, 'PG6：HQ_CALIB 唯一定义（集团汇报口径单一事实源）');
  assert(htmlMain.indexOf("var HQ_CALIB_HTML = HQ_CALIB.replace(") >= 0, 'PG6：HTML 版由 HQ_CALIB 派生（加粗只做一次替换，不另抄一份）');
  const hqRepFn = (htmlMain.match(/function hqReportHTML\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert(hqRepFn.indexOf('HQ_CALIB_HTML') >= 0, 'PG6：hqReportHTML 消费派生常量（不再是内联字面量）');
  assert(pgFn.indexOf('HQ_CALIB') >= 0 && pgFn.indexOf('HQ_CALIB_HTML') < 0,
    'PG6：★genHQPPT 用纯文本版口径（PPT 不渲染 <b>，但文字逐字相同）');
  /* 防漂移：口径正文在全文只许存在 1 份。用「后半句长片段」而不是那句加粗关键句——
     关键句在 HQ_CALIB、加粗 replace 的 needle、以及本文件的说明注释里各出现一次，
     拿它计数会把注释也算进去；长片段只有真正复制一份口径才会出现第 2 次。 */
  assert(cntIn(htmlMain, '四项能力全部由各站真实漏斗反推（转化设计=新卡/季累计入营') === 1,
    'PG6：★口径正文全文仅 1 份（唯一事实源；复制第二份即口径漂移，实际 ' +
    cntIn(htmlMain, '四项能力全部由各站真实漏斗反推（转化设计=新卡/季累计入营') + ' 份）');

  /* ⑥ 不缺项不说谎：缺数据页显式「暂无数据」，趋势取数与 GW.raw 同一条优先级 */
  assert((pgFn.match(/暂无数据/g) || []).length >= 4, 'PG7：缺数据页显式标注「暂无数据」（漏斗/总表/标杆/深钻/趋势各页均有兜底）');
  assert(pgFn.indexOf('if(n>0) trend.push(') >= 0, 'PG7：★趋势只收有实际上报的月份（n>0 才入列，不用 0 顶替）');
  assert(pgFn.indexOf('function monthMap(k)') >= 0 && pgFn.indexOf("if(k==='7'&&typeof M7!=='undefined'&&M7) return M7;") >= 0 && pgFn.indexOf("if(k==='6'&&typeof M6!=='undefined'&&M6) return M6;") >= 0,
    'PG7：★趋势月度取数与 GW.raw 同一条优先级（db 优先，实时季回落内置基线 M6/M7）——否则会出现「各站页有数、趋势页说暂无数据」的自相矛盾');
  assert(pgFn.indexOf('trendFallback') >= 0, 'PG7：回落内置基线时页面显式告知数据源（不静默换口径）');

  /* ⑦ 版式：9 页、原生图表与原生表格、配色沿用既有调色板（禁紫粉） */
  /* 只数调用点（`=nextSlide()`）：函数定义行是 `function nextSlide(){`，它也含 `nextSlide()` 子串，
     一起数会永远多 1（这正是「断言写错却看起来像产品坏了」的典型）。 */
  const pgPages = (pgFn.match(/=nextSlide\(\)/g) || []).length;
  assert(pgPages === 9, 'PG8：本轮 9 页（实际 ' + pgPages + ' 页）');
  assert(pgFn.indexOf('s3.addChart(p.ChartType.bar,') >= 0, 'PG8：漏斗页用 PptxGenJS 原生柱状图');
  assert(pgFn.indexOf('s8.addChart(p.ChartType.line,') >= 0, 'PG8：趋势页用 PptxGenJS 原生折线图');
  const pgTables = (pgFn.match(/\.addTable\(t\d,/g) || []).length;   /* 必须带 g：无 g 时 match 只返回首个匹配 */
  assert(pgTables === 2, 'PG8：总表页与预警页用 PptxGenJS 原生表格（实际 ' + pgTables + ' 处，期望 2）');
  assert(/purple|pink|A855F7|7C3AED|EC4899/i.test(pgFn) === false, 'PG8：零紫粉系色值（P0-2）');
  assert(pgFn.indexOf("navy:'0B2545'") >= 0 && pgFn.indexOf("gold:'C8A04B'") >= 0 && pgFn.indexOf("cyan:'389BE5'") >= 0,
    'PG8：调色板沿用 genPPT 既有藏蓝/金/青（与手工 PPT 同一视觉家族）');
  /* P0-1：PPT 文案零 emoji（全文口径已由 ICO3 把守，此处再钉新增函数的局部作用域） */
  assert((pgFn.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length === 0,
    'PG8：genHQPPT 零 emoji（P0-1）');
}

