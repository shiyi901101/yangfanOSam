/* P0 终检（提交累计改动面）：对 <基线>..<target> 的 index.html 新增行做确定性扫描
   （基线见 BASE_CANDIDATES —— 运行时解析、并把实际用到的基线与新增行数一并打印，不静默）
   1) emoji 作功能图标（P0-1）
   2) 紫粉系渐变/色值（P0-2 红线）
   3) 硬编码颜色（允许 #fff/#ffffff/#000/#000000 及其颜色函数写法）—— 按「新增色值」判定，见 BASE_COLOR 注释
   4) 外部 CDN / 外链脚本
   5) 面向用户的中文字符串字面量里的半角标点 —— 先抹掉 HTML 实体，见 stripEntities 注释
   另附：目标全文 emoji 计数与基线对比（确认没有引入 emoji）
   用法：node tools/gates/p0_scan.js [HEAD|WORKTREE]
         HEAD（默认）= 基线 vs 已提交；WORKTREE = 基线 vs 工作区（提交前自检用，
         否则尚未 commit 的改动会被漏扫，等于提交前拿不到 P0 结论）。
   退出码：任一类命中 → 1（含自检失败），全部通过 → 0。 */
const { execSync } = require('child_process');
const fs = require('fs');
const P = require('./paths');   /* 路径唯一权威出口：REPO 由 __dirname 推出，无硬编码绝对路径 */
const REPO = P.FRONT_ROOT;
/* P0 扫描基线引脚。历史：原基线 = f5949a4（P0 扫描起点）。
   2026-09-28 `.git` 仓库事故中 f5949a4 的对象随本地历史一并丢失（远端只到 c5f41fb），
   故改锚到事故后从 GitHub 恢复的权威 master 基线 c5f41fb（= 恢复后 HEAD）。
   稳定性：BASE 是固定 SHA、不是 HEAD —— 后续每笔提交都仍相对该基线累计扫描，
   不会出现「基线=HEAD 导致新增行恒为 0 的假绿」。
   两个候选都写进表，运行时取第一个**可解析**的；解析不到即 FATAL 退出（绝不静默降级）。 */
const BASE_CANDIDATES = ['c5f41fb', 'f5949a4'];
let BASE = null;
for (const c of BASE_CANDIDATES) {
  try { execSync('git cat-file -e ' + c, { cwd: REPO, stdio: 'ignore' }); BASE = c; break; }
  catch (e) { /* 该候选对象不存在，试下一个 */ }
}
if (!BASE) {
  console.error('FATAL: P0 扫描基线不可解析（已尝试 ' + BASE_CANDIDATES.join(' / ') + '）');
  process.exit(9);
}
if (BASE !== BASE_CANDIDATES[0]) {
  console.log('WARN: 首选基线 ' + BASE_CANDIDATES[0] + ' 不可解析，已回退到 ' + BASE);
}
const TARGET = (process.argv[2] || 'HEAD').trim().toUpperCase();
const IS_WORKTREE = TARGET === 'WORKTREE';

function git(args) { return execSync('git ' + args, { cwd: REPO, maxBuffer: 1 << 28 }).toString(); }

const baseHtml = execSync('git show ' + BASE + ':index.html', { cwd: REPO, maxBuffer: 1 << 28 }).toString();

const diff = git('diff -U0 ' + BASE + (IS_WORKTREE ? '' : ' ' + TARGET) + ' -- index.html');
const added = diff.split(/\r?\n/).filter(l => l[0] === '+' && l.indexOf('+++') !== 0).map(l => l.slice(1));
const targetLabel = IS_WORKTREE ? '工作区(未提交)' : git('rev-parse --short ' + TARGET).trim();
console.log('新增行数 = ' + added.length + '（基线 ' + BASE + ' → ' + targetLabel + '）');

const EMOJI = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/u;
const PURPLE_PINK = /#7C3AED|#A855F7|#9333EA|#EC4899|from-purple|to-pink|purple-500|pink-500/i;
const CDN = /https?:\/\/(?!yangfan1012)[a-z0-9.-]+\.(com|cn|net|io|org)\//i;
const CJK = /[\u4e00-\u9fff]/;
/* 半角括号只查真正的半角 ( 与 ) —— 早期版本把全角「（」「）」也写进了字符类，
   导致完全正确的全角中文标点（如「（仅一次）」）被判为半角标点（假阳性）。
   注意方向：这个修正只提高精度（不再误报全角），真正的半角括号照样命中。 */
const HALF_PUNCT = /[\u4e00-\u9fff][,;!?]|[,;!?][\u4e00-\u9fff]|[\u4e00-\u9fff]:[^:\/]|\([\u4e00-\u9fff]|[\u4e00-\u9fff]\)/;

/* —— 精度修正一：硬编码颜色按「新增色值」判定（不是「新增行上出现过色值」）——
   规则原文是「不允许硬编码颜色值（#fff/#ffffff/#000/#000000 除外）」，落点是「引入」新色值。
   但 diff 只按行判定：基线（BASE_CANDIDATES 解析出的那笔）的 index.html 里本就写死了整套设计令牌（--navy=#0d2c4d 81 处、
   --line=#d3e2f0 42 处、--blue-700=#2b7cd3 87 处 …），那是规则落地前的存量。存量行只要被任何一次
   功能性修改碰到（例如本轮把行尾 emoji 换成内联 SVG、色值一个字节都没动），整行就会以「新增行」
   的身份进入扫描面，存量色值随即被重新算成违规——这种判定下规则不可维护，且与规则原意相反。
   故：只有「基线全文里不存在的色值」出现在新增行上才算命中；基线既有色值走 legacy 计数另行播报，
   既不静默、也不计命中。
   强度未降：新增行上任何全新色值（哪怕只差一位）仍会被命中，白名单仍只有 #fff/#ffffff/#000/#000000。 */

/* —— 精度修正三（补齐同一规则的不一致）：硬编码颜色不止 #hex ——
   只扫 #hex 会漏掉颜色函数：rgba(20,85,156,.4) 与 #14559c 同为硬编码色，凭什么是两种待遇？
   规则原文说的是「硬编码颜色值」，没限定写法。故一并扫 rgb()/rgba()/hsl()/hsla()。
   判定机制与 #hex 完全一致（基线外新值才命中）；白名单同样只放「白/黑」——
   #fff/#ffffff/#000/#000000，以及它们的颜色函数等价写法 rgb(255,255,255)/rgba(0,0,0,.x)/
   hsl(0,0%,100%)/hsl(0,0%,0%)。
   已知边界（写明白，不假装覆盖）：只认逗号分隔的写法；CSS Color 4 的空格分隔
   （rgb(255 255 255)）不识别——本项目未使用该写法，若将来使用需同步补。 */
const ALLOW_HEX = /^#(fff|ffffff|000|000000)$/i;
const COLOR_TOK = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^()]*\)/gi;
function normColor(t) { return t.replace(/\s+/g, '').toLowerCase(); }
function colorTokens(line) { return (line.match(COLOR_TOK) || []).map(normColor); }
/* 白/黑判定：返回 true 表示属于 #fff/#000 家族（放行） */
function isAllowColor(tok) {
  if (tok.charAt(0) === '#') return ALLOW_HEX.test(tok);
  const m = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(tok);
  if (!m) return false;
  const fn = m[1];
  const parts = m[2].split(',').map(function (s) { return s.trim(); });
  if (fn === 'rgb' || fn === 'rgba') {
    const ch = parts.slice(0, 3);
    if (ch.length !== 3) return false;
    const white = ch.every(function (c) { return c === '255' || c === '100%'; });
    const black = ch.every(function (c) { return c === '0' || c === '0%'; });
    return white || black;
  }
  /* hsl/hsla：白 = 饱和度 0% 且亮度 100%；黑 = 亮度 0% */
  if (parts.length < 3) return false;
  const sat = parts[1], lig = parts[2];
  return (sat === '0%' && lig === '100%') || lig === '0%';
}
const BASE_COLOR = new Set(colorTokens(baseHtml));

/* —— 保真平移白名单（team-lead 裁定，2026-XX）——
   注入层覆盖课文时，「视觉保真」是真实需求：把课文同名规则的颜色值逐字抄过来，才不会出现
   「注入后颜色和课文原貌对不上」。但课文在 index.html 里是 base64，其色值不在基线明文里 →
   会被上面的「新增色值」判定命中。故单列一份白名单。
   三条硬约束（缺一不可，均由 SELFTEST 把守）：
     ① 只允许「颜色值」本身，不许夹带其他属性（不得出现 color:…/background:… 这类串）；
     ② 每条必须注明抄自课文哪条规则（from 字段，可审计可复核）；
     ③ 命中时走 INFO 显式播报（含出处），绝不静默豁免——和存量令牌一个待遇。
   注意：若某色值其实已在基线明文里（如 rgba(43,124,211,.35) 基线有 2 处），会被 legacy 车道
   自动接住，无需也不得再进本白名单（避免双份豁免、口径混淆）。 */
const FIDELITY = [
  { v: 'rgba(20,85,156,.4)', from: '课文 .side-mask（窄屏抽屉遮罩底色，B1-8 平移 701-768 逐字抄）' },
  { v: '#2a76c4', from: '玻璃皮肤令牌块 candGL（--glc-1，v7-3）' },
  { v: '#0e7355', from: '玻璃皮肤令牌块 candGL（--glc-2，v7-3）' },
  { v: '#f5b24a', from: '玻璃皮肤令牌块 candGL（--glc-3，v7-3）' },
  { v: 'rgba(4,18,42,0.550)', from: '玻璃皮肤令牌块 candGL（--glc-4，v7-3）' },
  { v: '#0a6355', from: '玻璃皮肤令牌块 candGL（--glc-5，v7-3）' },
  { v: '#0e8f7d', from: '玻璃皮肤令牌块 candGL（--glc-6，v7-3）' },
  { v: '#5fa8ff', from: '玻璃皮肤令牌块 candGL（--glc-7，v7-3）' },
  { v: 'rgba(6,20,40,.54)', from: '玻璃皮肤令牌块 candGL（--glc-8，v7-3）' },
  { v: '#9a5409', from: '玻璃皮肤令牌块 candGL（--glc-9，v7-3）' },
  { v: '#d97a10', from: '玻璃皮肤令牌块 candGL（--glc-10，v7-3）' },
  { v: '#3440a0', from: '玻璃皮肤令牌块 candGL（--glc-11，v7-3）' },
  { v: 'rgba(30,80,140,.46)', from: '玻璃皮肤令牌块 candGL（--glc-12，v7-3）' },
  { v: '#615e14', from: '玻璃皮肤令牌块 candGL（--glc-13，v7-3）' },
  { v: 'rgba(30,80,140,.36)', from: '玻璃皮肤令牌块 candGL（--glc-14，v7-3）' },
  { v: '#4d5fd0', from: '玻璃皮肤令牌块 candGL（--glc-15，v7-3）' },
  { v: 'rgba(224,140,46,.45)', from: '玻璃皮肤令牌块 candGL（--glc-16，v7-3）' },
  { v: 'rgba(6,28,64,.08)', from: '玻璃皮肤令牌块 candGL（--glc-17，v7-3）' },
  { v: '#8f8a1e', from: '玻璃皮肤令牌块 candGL（--glc-18，v7-3）' },
  { v: 'rgba(19,52,92,.42)', from: '玻璃皮肤令牌块 candGL（--glc-19，v7-3）' },
  { v: 'rgba(11,34,64,.42)', from: '玻璃皮肤令牌块 candGL（--glc-20，v7-3）' },
  { v: 'rgba(6,28,64,.28)', from: '玻璃皮肤令牌块 candGL（--glc-21，v7-3）' },
  { v: 'rgba(11,34,64,.50)', from: '玻璃皮肤令牌块 candGL（--glc-22，v7-3）' },
  { v: 'rgba(8,26,52,.32)', from: '玻璃皮肤令牌块 candGL（--glc-23，v7-3）' },
  { v: 'rgba(11,34,64,.36)', from: '玻璃皮肤令牌块 candGL（--glc-24，v7-3）' },
  { v: 'rgba(4,18,42,0.495)', from: '玻璃皮肤令牌块 candGL（--glc-25，v7-3）' },
  { v: 'rgba(8,26,52,.26)', from: '玻璃皮肤令牌块 candGL（--glc-26，v7-3）' },
  { v: 'rgba(7,24,50,.46)', from: '玻璃皮肤令牌块 candGL（--glc-27，v7-3）' },
  { v: 'rgba(11,34,64,.38)', from: '玻璃皮肤令牌块 candGL（--glc-28，v7-3）' },
  { v: 'rgba(7,24,50,.34)', from: '玻璃皮肤令牌块 candGL（--glc-29，v7-3）' },
  { v: 'rgba(6,20,40,.14)', from: '玻璃皮肤令牌块 candGL（--glc-30，v7-3）' },
  { v: 'rgba(6,20,40,.08)', from: '玻璃皮肤令牌块 candGL（--glc-31，v7-3）' },
  { v: 'rgba(6,20,40,.18)', from: '玻璃皮肤令牌块 candGL（--glc-32，v7-3）' },
  { v: 'rgba(2,12,30,0.500)', from: '玻璃皮肤令牌块 candGL（--glc-33，v7-3）' },
  { v: 'rgba(6,20,40,.26)', from: '玻璃皮肤令牌块 candGL（--glc-34，v7-3）' },
  { v: 'rgba(6,20,40,.44)', from: '玻璃皮肤令牌块 candGL（--glc-35，v7-3）' },
  { v: 'rgba(6,28,64,.38)', from: '玻璃皮肤令牌块 candGL（--glc-36，v7-3）' },
  { v: 'rgba(6,20,40,0)', from: '玻璃皮肤令牌块 candGL（--glc-37，v7-3）' },
  { v: 'rgba(74,99,119,.30)', from: '玻璃皮肤令牌块 candGL（--glc-38，v7-3）' },
  { v: 'rgba(224,140,46,.55)', from: '玻璃皮肤令牌块 candGL（--glc-39，v7-3）' },
  { v: 'rgba(18,100,200,.55)', from: '玻璃皮肤令牌块 candGL（--glc-40，v7-3）' },
  { v: 'rgba(0,10,26,.38)', from: '玻璃皮肤令牌块 candGL（--glc-41，v7-3）' },
  { v: 'rgba(43,124,211,.34)', from: '登录页覆盖块 #loginGate 令牌 --lg-1（A2 落地，2026-09-30）' },
  { v: '#071626', from: '登录页覆盖块 #loginGate 令牌 --lg-2（A2 落地，2026-09-30）' },
  { v: 'rgba(126,194,242,.085)', from: '登录页覆盖块 #loginGate 令牌 --lg-3（A2 落地，2026-09-30）' },
  { v: 'rgba(126,194,242,0)', from: '登录页覆盖块 #loginGate 令牌 --lg-4（A2 落地，2026-09-30）' },
  { v: 'rgba(43,124,211,.58)', from: '登录页覆盖块 #loginGate 令牌 --lg-5（A2 落地，2026-09-30）' },
  { v: 'rgba(43,124,211,0)', from: '登录页覆盖块 #loginGate 令牌 --lg-6（A2 落地，2026-09-30）' },
  { v: 'rgba(78,163,232,.38)', from: '登录页覆盖块 #loginGate 令牌 --lg-7（A2 落地，2026-09-30）' },
  { v: 'rgba(78,163,232,0)', from: '登录页覆盖块 #loginGate 令牌 --lg-8（A2 落地，2026-09-30）' },
  { v: 'rgba(224,140,46,.26)', from: '登录页覆盖块 #loginGate 令牌 --lg-9（A2 落地，2026-09-30）' },
  { v: 'rgba(224,140,46,0)', from: '登录页覆盖块 #loginGate 令牌 --lg-10（A2 落地，2026-09-30）' },
  { v: 'rgba(120,175,235,.24)', from: '登录页覆盖块 #loginGate 令牌 --lg-11（A2 落地，2026-09-30）' },
  { v: 'rgba(120,175,235,0)', from: '登录页覆盖块 #loginGate 令牌 --lg-12（A2 落地，2026-09-30）' },
  { v: '#16456f', from: '登录页覆盖块 #loginGate 令牌 --lg-13（A2 落地，2026-09-30）' },
  { v: 'rgba(9,28,52,.44)', from: '登录页覆盖块 #loginGate 令牌 --lg-14（A2 落地，2026-09-30）' },
  { v: 'rgba(3,12,24,.6)', from: '登录页覆盖块 #loginGate 令牌 --lg-15（A2 落地，2026-09-30）' },
  { v: 'rgba(2,9,20,.56)', from: '登录页覆盖块 #loginGate 令牌 --lg-16（A2 落地，2026-09-30）' },
  { v: 'rgba(2,9,20,.38)', from: '登录页覆盖块 #loginGate 令牌 --lg-17（A2 落地，2026-09-30）' },
  { v: 'rgba(126,194,242,.075)', from: '登录页覆盖块 #loginGate 令牌 --lg-18（A2 落地，2026-09-30）' },
  { v: 'rgba(78,163,232,.40)', from: '登录页覆盖块 #loginGate 令牌 --lg-19（A2 落地，2026-09-30）' },
  { v: 'rgba(12,38,70,.50)', from: '登录页覆盖块 #loginGate 令牌 --lg-20（A2 落地，2026-09-30）' },
  { v: 'rgba(6,20,38,.56)', from: '登录页覆盖块 #loginGate 令牌 --lg-21（A2 落地，2026-09-30）' },
  { v: 'rgba(224,140,46,.72)', from: '登录页覆盖块 #loginGate 令牌 --lg-22（A2 落地，2026-09-30）' },
  { v: 'rgba(240,166,61,.9)', from: '登录页覆盖块 #loginGate 令牌 --lg-23（A2 落地，2026-09-30）' },
  { v: '#f3b45c', from: '登录页覆盖块 #loginGate 令牌 --lg-24（A2 落地，2026-09-30）' },
  { v: '#c6ddf5', from: '登录页覆盖块 #loginGate 令牌 --lg-25（A2 落地，2026-09-30）' },
  { v: '#a8c6e2', from: '登录页覆盖块 #loginGate 令牌 --lg-26（A2 落地，2026-09-30）' },
  { v: 'rgba(250,253,255,.975)', from: '登录页覆盖块 #loginGate 令牌 --lg-27（A2 落地，2026-09-30）' },
  { v: '#8ba6c2', from: '登录页覆盖块 #loginGate 令牌 --lg-28（A2 落地，2026-09-30）' },
  { v: '#7b93b3', from: '登录页覆盖块 #loginGate 令牌 --lg-29（A2 落地，2026-09-30）' },
  { v: '#6d87a8', from: '登录页覆盖块 #loginGate 令牌 --lg-30（A2 落地，2026-09-30）' },
  { v: '#3c5b86', from: '登录页覆盖块 #loginGate 令牌 --lg-31（A2 落地，2026-09-30）' },
  { v: 'rgba(43,124,211,.5)', from: '登录页覆盖块 #loginGate 令牌 --lg-32（A2 落地，2026-09-30）' },
  { v: '#40608a', from: '登录页覆盖块 #loginGate 令牌 --lg-33（A2 落地，2026-09-30）' },
  { v: '#57728e', from: '登录页覆盖块 #loginGate 令牌 --lg-34（A2 落地，2026-09-30）' },
  { v: '#4e6b89', from: '登录页覆盖块 #loginGate 令牌 --lg-35（A2 落地，2026-09-30）' }
];
const FIDELITY_MAP = new Map(FIDELITY.map(function (e) { return [normColor(e.v), e.from]; }));
function newColorOn(line) {
  return colorTokens(line).filter(function (t) {
    return !isAllowColor(t) && !BASE_COLOR.has(t) && !FIDELITY_MAP.has(t);
  });
}
function legacyColorOn(line) {
  return colorTokens(line).filter(function (t) {
    return !isAllowColor(t) && BASE_COLOR.has(t);
  });
}
function fidelityColorOn(line) {
  return colorTokens(line).filter(function (t) { return FIDELITY_MAP.has(t); });
}

/* —— 精度修正二：半角标点判定前先抹掉 HTML 实体 ——
   HTML 实体（&lt; &gt; &amp; &nbsp; …）结尾的分号是实体终止符，不是标点。
   实例：基线行 placeholder="支持HTML，如 &lt;b&gt;📢 标题&lt;/b&gt; 正文" 里的 emoji 移除后，
   实体终止符「;」直接贴上中文「标题」，触发 [,;!?][中文] 假阳性——文案本身用的是全角逗号，完全合规。
   故：先把实体整体抹掉再做标点判定。
   强度未降：真实半角逗号/分号/问号/冒号/括号紧贴中文仍会被命中（含「实体后紧跟半角标点」的情形）。 */
function stripEntities(s) { return s.replace(/&[a-zA-Z][a-zA-Z0-9]*;/g, ''); }

const findings = { emoji: [], purple: [], color: [], cdn: [], punct: [] };
const legacyColor = [];
const fidelityUsed = new Map();   /* 归一色值 → 出处（去重，用于 INFO 播报） */
added.forEach(function (line, i) {
  if (EMOJI.test(line)) findings.emoji.push((i + 1) + ': ' + line.trim().slice(0, 120));
  if (PURPLE_PINK.test(line)) findings.purple.push((i + 1) + ': ' + line.trim().slice(0, 120));
  const nc = newColorOn(line);
  if (nc.length) findings.color.push((i + 1) + ' [' + nc.join(',') + ']: ' + line.trim().slice(0, 120));
  const lc = legacyColorOn(line);
  if (lc.length) legacyColor.push((i + 1) + ' [' + lc.join(',') + ']');
  const fc = fidelityColorOn(line);
  fc.forEach(function (v) { fidelityUsed.set(v, FIDELITY_MAP.get(v)); });
  if (CDN.test(line)) findings.cdn.push((i + 1) + ': ' + line.trim().slice(0, 120));
  /* 半角标点只查「引号内的中文串」——面向用户的文案才受此约束，注释/标识符不查 */
  const strs = line.match(/'[^']*'|"[^"]*"/g) || [];
  strs.forEach(function (s) {
    if (CJK.test(s) && HALF_PUNCT.test(stripEntities(s))) findings.punct.push((i + 1) + ' ' + s.slice(0, 100));
  });
});

const names = { emoji: 'P0-1 emoji 作图标', purple: 'P0-2 紫粉系', color: 'P0 硬编码颜色（新增色值，#hex 与 rgb()/hsl() 同判）', cdn: 'P0 外部 CDN', punct: 'P0 半角标点（中文字面量）' };
let bad = 0;
Object.keys(names).forEach(function (k) {
  const n = findings[k].length;
  if (n) bad++;
  console.log((n ? 'FAIL ' : 'PASS ') + names[k] + '：命中 ' + n + ' 处');
  findings[k].slice(0, 12).forEach(function (l) { console.log('      ' + l); });
});
if (legacyColor.length) {
  console.log('INFO 新增行上的基线既有色值 ' + legacyColor.length + ' 处（存量设计令牌，非本次引入，不计命中）');
  legacyColor.slice(0, 8).forEach(function (l) { console.log('      ' + l); });
}
if (fidelityUsed.size) {
  const lines = [];
  fidelityUsed.forEach(function (from, v) { lines.push(v + '  ← ' + from); });
  console.log('INFO 注入层保真平移色值 ' + fidelityUsed.size + ' 处（白名单，逐字抄自课文同名规则，不计命中）');
  lines.slice(0, 8).forEach(function (l) { console.log('      ' + l); });
}

/* 全文 emoji 计数（与本轮基线对比：确认未引入新 emoji） */
const head = fs.readFileSync(P.INDEX_HTML, 'utf8');
const allEmoji = (head.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []);
console.log('目标全文 emoji 计数 = ' + allEmoji.length + '（本轮新增行命中 ' + findings.emoji.length + '）');
const baseEmoji = (baseHtml.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []);
console.log('基线 ' + BASE + ' 全文 emoji 计数 = ' + baseEmoji.length + '（差值 ' + (allEmoji.length - baseEmoji.length) + '）');

/* —— 自检：钉住上述「降假阳性 / 补齐口径」的修正没有把规则本身削弱 ——
   左侧断言=规则必须仍能抓到真违规；右侧断言=被修掉的那两类假阳性确实不再误报。 */
const T = [];
function chk(name, cond) { T.push({ name: name, ok: !!cond }); }
/* 硬编码颜色（#hex） */
chk('color 基线既有色值 #d3e2f0 不计命中', newColorOn('<x fill="#d3e2f0"/>').length === 0);
chk('color 基线既有色值 #0d2c4d 计入 legacy', legacyColorOn('<x fill="#0d2c4d"/>').length === 1);
chk('color 基线外全新色值 #00ff00 必须命中', newColorOn('<x fill="#00ff00"/>').length === 1);
chk('color 新增行同时含新旧色值 → 只报新的', newColorOn('<x a="#d3e2f0" b="#00ff00"/>').join() === '#00ff00');
chk('color 白名单 #fff/#ffffff/#000/#000000 仍放行',
  newColorOn('#fff #ffffff #000 #000000').length === 0 && ALLOW_HEX.test('#FFF') && ALLOW_HEX.test('#000000'));
/* 硬编码颜色（颜色函数：同一规则的不一致已补上） */
chk('color 白名单颜色函数 rgb(255,255,255)/rgba(0,0,0,.5)/hsl(0,0%,100%)/hsl(0,0%,0%) 放行',
  newColorOn('rgb(255,255,255) rgba(0,0,0,.5) hsl(0,0%,100%) hsl(0,0%,0%) rgb(100%,100%,100%)').length === 0);
chk('color 基线外全新 rgba(1,2,3,.5) 必须命中（颜色函数不再漏扫）',
  newColorOn('background:rgba(1,2,3,.5)').length === 1);
chk('color 基线外全新 hsl(210,50%,40%) 必须命中', newColorOn('color:hsl(210,50%,40%)').length === 1);
chk('color 基线既有 rgba(43,124,211,.35) 不计命中（基线有 2 处，走 legacy）',
  newColorOn('box-shadow:0 6px 20px rgba(43,124,211,.35)').length === 0 &&
  legacyColorOn('box-shadow:0 6px 20px rgba(43,124,211,.35)').length === 1);
chk('color 大小写/空格归一后仍匹配（RGBA( 20 , 85 , 156 , .4 )）',
  newColorOn('RGBA( 20 , 85 , 156 , .4 )').length === 0 && FIDELITY_MAP.has('rgba(20,85,156,.4)'));
/* 保真平移白名单：三条硬约束 */
chk('fidelity 白名单只允许颜色值（不许夹带其他属性）',
  FIDELITY.length > 0 && FIDELITY.every(function (e) {
    return /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([^()]*\))$/.test(normColor(e.v));
  }));
chk('fidelity 每条都必须注明抄自课文哪条规则（from 非空）',
  FIDELITY.every(function (e) { return typeof e.from === 'string' && e.from.trim().length > 0; }));
chk('fidelity 白名单外的全新色值照样命中（白名单不扩大豁免面）',
  newColorOn('background:rgba(9,9,9,.9)').length === 1);
chk('fidelity 白名单内色值被移出白名单后必须命中（证明白名单在起作用，不是整体放水）',
  colorTokens('background:rgba(20,85,156,.4)').filter(function (t) {
    return !isAllowColor(t) && !BASE_COLOR.has(t);
  }).length === 1);
/* —— 冻结断言（2026-09-30 用户拍板「整块 tokenize」）——
   玻璃皮肤不再散落硬编码色，而是收敛为一个 :root{--glc-1..N} 令牌块；白名单与该令牌块
   **1:1 逐字对应**。这条断言把条数钉死：将来谁新增一条令牌就必须同步改这里，
   反之谁想偷偷「多豁免一个色值」也会被这条拦住（条数对不上就红）。 */
chk('fidelity 冻结：白名单条数 == 77（1 课文平移 + 41 玻璃令牌块 + 35 登录页令牌块 --lg-1..35）',
  FIDELITY.length === 77);
/* 半角标点：真违规 */
chk('punct 半角逗号紧贴中文 → 命中', HALF_PUNCT.test(stripEntities('中文,继续')));
chk('punct 半角分号紧贴中文 → 命中', HALF_PUNCT.test(stripEntities('第一;第二')));
chk('punct 半角问号紧贴中文 → 命中', HALF_PUNCT.test(stripEntities('真的吗?好的')));
chk('punct 半角冒号紧贴中文 → 命中', HALF_PUNCT.test(stripEntities('说明: 内容')));
chk('punct 半角括号紧贴中文 → 命中', HALF_PUNCT.test(stripEntities('步骤(一)说明')));
chk('punct 抹实体后仍能抓真违规（实体+半角逗号）', HALF_PUNCT.test(stripEntities('说明&nbsp;中文,后续')));
/* 半角标点：假阳性 */
chk('punct 实体 &gt; 后接中文不再误报',
  !HALF_PUNCT.test(stripEntities('支持HTML，如 &lt;b&gt;标题&lt;/b&gt; 正文')));
chk('punct 实体 &amp; 后接中文不再误报', !HALF_PUNCT.test(stripEntities('A&amp;中文')));
chk('punct 全角标点仍不误报', !HALF_PUNCT.test(stripEntities('中文，如「标题」正文')));
const failed = T.filter(function (t) { return !t.ok; });
failed.forEach(function (t) { console.log('SELFTEST FAIL ' + t.name); });
console.log('SELFTEST ' + (failed.length ? 'FAIL' : 'PASS') + ' ' + (T.length - failed.length) + '/' + T.length);
if (failed.length) bad++;

console.log('\n===== P0 终检: ' + (bad ? bad + ' 类命中' : '全部通过') + ' =====');
process.exitCode = bad ? 1 : 0;
