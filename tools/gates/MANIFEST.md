# 门禁套件 MANIFEST（工具链纳管 #92）

> 权威仓库 = **`yangfan-os-ghpages`**（本目录 `tools/gates/` 纳入其版控）。
> 目的：让「五道门禁」可复现、可交给 CI/任何人跑，而不是散落在某人临时目录里。

## 单入口

```bash
bash tools/gates/run_gates_iso.sh [tag]
```

- **任意 cwd 均可**：脚本自定位（`cd "$(dirname "$0")"` 后所有路径由 `paths.js` 以 `__dirname` 解析），提取产物写 `os.tmpdir()`。
- **退出码**：`0` = 全绿；非 `0` = 有门禁红（供调用方/CI 判定，**不靠人读日志**）。
- **日志**：`${TMPDIR}/yf-gates-iso_<tag>.log`（脚本末行回显 `log=<路径>`）。
- **环境变量**：`YF_NODE`（node 可执行，默认下方 22.22.2-2）、`YF_TEST_PORT`（GATE4 隔离端口，默认 9101）、`YF_PPT_PORT`（GATE5 隔离端口，默认 9103，与 GATE4 分开，两条车道不抢端口）。

## 目录内文件职责

| 文件 | 职责 |
|---|---|
| `paths.js` | **路径唯一权威出口**。读路径全部以 `__dirname` 为基（`INDEX_HTML` / `DASH_DATA_JS` / `YF_API_INDEX`），产物写 `os.tmpdir()/yf-gates-<hash>/`（`BUILD_DIR`）与 `os.tmpdir()/yf-gates-shadow-<hash>/`（`RUNS_DIR`）。跨仓库定位：`findYfApiDir()` 自 `FRONT_ROOT` 逐级向上（≤6 层）查找 `yangfan-cloud/yf-api/index.js`。**任何脚本不得再出现相对 `./` 或硬编码绝对路径。** |
| `extract.js` | **GATE1**：把 `index.html` 内联 `<script>` 块抽成 `js_01..js_0N.js`（写 `BUILD_DIR`）。末行固定输出 `YF_TMP=<绝对路径（正斜杠）>`，供入口取用。 |
| `run_gates_iso.sh` | **唯一入口**：串联 GATE1 extract → GATE2 `node --check` → GATE3 test_rules → GATE4 e2e（隔离车道）→ GATE5 ppt_smoke（功能绿）。 |
| `test_rules.js` | **GATE3**：静态 + 行为级断言（在 jsdom 沙箱内加载被抽出的脚本块）。 |
| `mk_shadow.js` | **GATE4 前置**：每轮生成**全新 virgin shadow store**（`yf-gates-shadow-<hash>/run_<ts>`）；后端 `index.js` 由**真实源复制**并 **md5 逐字节校验**；输出 `SHADOW=<dir>`。 |
| `e2e_dual_role.js` | **GATE4**：jsdom 双角色（管理端 / 负责人端）端到端 26 场景；后端指向 `YF_API_DIR`（入口默认注入 shadow 目录）。管理专属控件清单 `ADMIN_ONLY_CTRLS` 现 **7** 项（新增「集团汇报 PPT 生成按钮 `hqPptBtn`」），S11/A7/S14 文案按 `ADMIN_ONLY_CTRLS.length` 自取，改清单不必再改文案。 |
| `ppt_smoke.js` | **GATE5**（功能绿）：在 jsdom 里登录管理端，**真跑一次 `genHQPPT()`** 并抓回真实 `.pptx` 字节逐项验（9 页 / 原生表格 ≥2 / 原生柱+折线图 / 口径逐字且唯一 / 缺月不以 0 顶替 / 负责人端直调拿不到字节）。**零源码改动**：只 patch `PptxGenJS.prototype.writeFile` 换掉「最后一步落盘」。独立端口 `YF_PPT_PORT`（默认 9103）、独立 virgin shadow 库（自调 mk_shadow.js），与 GATE4 互不干扰。前置失败一律 `exit 3`（不静默跳过）。 |
| `p0_scan.js` | **P0 终检**（可独立跑，不在 iso 流水线内）：对 `<基线> → HEAD`（或传 `WORKTREE` 扫未提交工作区）的 `index.html` 新增行做确定性扫描——emoji 作图标 / 紫粉系 / 硬编码颜色（按**新增色值**判，见下「P0 扫描口径」）/ 外部 CDN / 中文字面量半角标点（判定前先剥 HTML 实体，见同节）。末尾自带 **14 条规则自检（SELFTEST）**，不通过即非 0 退出。<br>**基线（`BASE_CANDIDATES`，2026-09-28 事故后重锚）**：原基线 `f5949a4` 随 `.git` 事故丢失，改锚现存权威基线 **`c5f41fb`**（= 事故后从 GitHub 恢复的 master）。运行时按序解析第一个**可解析**的候选并打印实际使用的基线；全部解析不到 → **`exit 9` FATAL**（绝不静默降级）。`BASE` 是固定 SHA 而非 HEAD，故后续每笔提交仍相对它累计扫描，不会出现「基线=HEAD 导致新增行恒为 0」的假绿。 |

## 前置（运行环境）

- **node `22.22.2-2`**（基线）。**v22.12.0 会 SEGFAULT，不得降级。** 默认路径写在 `run_gates_iso.sh` 的 `YF_NODE`，可用环境变量覆盖。
- **jsdom**：`C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom`（e2e 依赖，见 `e2e_dual_role.js` 的 `NODE_PATH_VAL`）。
- **跨仓库依赖**：GATE4 需要后端 `yangfan-cloud/yf-api/index.js`。`mk_shadow.js` 经 `paths.js:findYfApiDir()` 定位**工作区仓库**的该文件（**不是**本仓库内的副本），逐字节复制 + md5 校验后再播种。定位不到 → GATE4 直接 `exit 9` 报 FATAL。
- **端口**：GATE4 默认 `9101`（`YF_TEST_PORT` 可覆盖）、GATE5 默认 `9103`（`YF_PPT_PORT` 可覆盖），避免与真实服务冲突，且两条车道互不抢端口。
- **GATE5 的跨仓库前置**同 GATE4（自调 `mk_shadow.js` 造 virgin shadow 库并 md5 校验真实后端）。

## 基线数字（**写死**——未复核请勿改）

| 门禁 | 基线 | 说明 |
|---|---|---|
| GATE1 extract | **6 块** | `index.html` 内联 `<script>` 恰 6 个 |
| GATE2 node --check | **6 / 6 OK** | `js_01..js_06` 语法全过 |
| GATE3 test_rules | **pass=724 fail=0** | 见下「基线沿革」（2026-10-01：新契约 `I3R17` +1） |
| GATE4 e2e | **26 PASS / 0 FAIL / 0 SKIP**（≈50–55s） | 双角色 26 场景（S11/A7/S14 现覆盖 **7** 个管理专属控件） |
| GATE5 ppt_smoke | **18 PASS / 0 FAIL / 0 SKIP**（≈18s） | 功能绿：管理端真跑 `genHQPPT()` → 真实 pptx **679340 字节 / 9 页**；原生表格 2 张（总表 10 列 × 21 行）+ 原生柱/折线图各 1；口径三句逐字且唯一；缺月折不画线；负责人端直调 0 字节 |
| GATE-SW sw_selfcheck | **23 PASS / 0 FAIL**（≈0s） | **`sw.js` 是 `p0_scan` 的盲区**（不属 index.html 内联块），单列门禁。A 文件语法 / B 离线可用性 + **B6–B10 导航分支「缓存优先」防回归** / C 版本纪律。见下「GATE-SW 说明」 |

入口末行固定输出 `RESULT: PASS (RC=0)`。

### 基线沿革（防误判）

- team-lead 快照记为 **521**（第四态补齐后）。
- 本笔「确认框文案分档」把 `SRLA9` 拆为 `SRLA9a/9b/9c`（净 **+2**）并新增 `SRLA13/14/15`（净 **+3**），故 **521 → 526（+5）**。
- 本笔「状态符号统一为内联 SVG」新增 `ICO1`–`ICO7` 共 **28 条**：
  - `ICO1`–`ICO5` = **22 条**——ICO1 出口存在 + 11 语义键齐全（12）；ICO2 可构造 / 合法 svg / 未知键空串 / 零内联着色零外链（4）；ICO3 状态符号与 P0 emoji 双向归零（2）；ICO4 调用点数量钉死 23 / 静态关闭 11 / 静态成功 1（3）；ICO5 唯一定义（1）。
  - `ICO6`–`ICO7` = **6 条**——图标化必然把可访问名一起拿走（`aria-hidden` 的图标不参与可访问名计算，原来靠文本 `✕` 撑着的按钮会变成无名控件，WCAG 4.1.2）：ICO6 钉死 12 个 `um-x` 全部带 `aria-label="关闭"`（2）；ICO7 是**通用反向规则**，管住后续新增的仅图标按钮——静态仅图标按钮 14 个 / JS 生成 5 个均须带 `aria-label` 或 `title`，零无名控件，另加 `um-x` 家族零字符型字形混用（4）。
  - 故 **526 → 554（+28）**。
- 本笔「B1 学习版块版式注入层」（设计规格 §4.2 + §4.6）新增 B1 断言共 **23 条**，故 **554 → 577（+23）**：
  - 前提 2 条：注入 `<style>` 追加到 iframe `<head>` 末尾（覆盖成立的前提）；注入层零 `!important`（不靠 important 压课文，逼特异性算对）。
  - B1-1 阅读测量 2 条：`.main` 上限 860px；正文测量 34em（含 hero 段落与 `.lead`——课文导语是 `<div class="lead">` 不是 `p`，只写 `p` 会漏掉它）。
  - B1-2 字号行高 2 条：`.deepbox` 13.5px/1.85 → 17px/1.9；四级层级 22 / 17 / 15.5 / 15 全部落地。
  - B1-3 章节节奏 1 条。
  - B1-4 特异性陷阱 1 条：课文警句是 `.deepbox .warn`（两类选择器），只写 `.warn` 会被压住。
  - B1-5/B1-6 2 条：内嵌页 `header{display:none}`（省约 96px）；`html,body{overscroll-behavior:contain}`（滚动链必须在内嵌文档侧吞掉，外层 iframe 元素上写管不到内层滚动）。
  - B1-7/B1-8 6 条：≤700 窄屏回退；701-768 转单列；`.toc-btn` 显式 `display:flex`（课文 `@media(min-width:701px)` 里是 `display:none`）；`.side-mask` 显式 `display:block`；`.toc-btn` 触摸高 ≥44px **两段都有**（§4.6②，课文只有 padding ≈36px，WCAG 2.5.5）。
  - 反向/防漂移 5 条：被覆盖的课文规则确实存在（`.deepbox` 13.5px / `h2` 19px / `.deepbox .warn` / `.wrap` 1240px）；课文恰 1 个 `<header>`（故 `header{display:none}` 不误伤）；课文断点仍是 700/701/720（768 是注入层叠加，没改课文）；注入层硬编码色仅允许 `#fff`。
  - B1-9 高度 2 条：iframe 首帧 `calc(100dvh - 150px)` → `104px` 且仅一处定义（旧值零残留）；`lrFit` 仍是运行时唯一权威（`h>320` 才覆盖内联首帧值）。
  - 断言牙齿（注释不误报 / 真违规必报）已做变异测试：注释里的 `!important` 不命中；注入层真塞 `!important` → FAIL；注入层真塞 `#00ff00` → FAIL；抠掉任一处的 `min-height:44px` → 对应断言 FAIL。
  - 判据（id 集合 diff）：新增 `B1`×5 + `B1-1`×2 + `B1-2`×2 + `B1-3`×1 + `B1-4`×1 + `B1-5`×2 + `B1-6`×1 + `B1-7`×2 + `B1-8`×5 + `B1-9`×2 = **23 条**。
- 判据（id 集合 diff）：
  - 旧：`SRLA1-8, SRLA9, SRLA10, SRLA10a, SRLA11, SRLA12` + `SR4S1-8`
  - 新：`SRLA1-8, SRLA9a, SRLA9b, SRLA9c, SRLA10, SRLA10a, SRLA11, SRLA12, SRLA13, SRLA14, SRLA15` + `SR4S1-8` + `ICO1-7`
- **基线校正 + 本笔新增**（管理端汇报 PPT，`genHQPPT`）：
  - **先校正一处陈旧基线**：上表此前记 `pass=577`，但本笔动手前实测已是 `pass=625 fail=0`（577 → 625 的 48 条增量未回写本表）。本次以**实测**为准重记，不沿用旧值。
  - 本笔新增 **39 条**，`625 → 664`：
    - `PG1`×1 + `PG2`×8 + `PG3`×6 + `PG4`×3 + `PG5`×4 + `PG6`×5 + `PG7`×4 + `PG8`×7 = **38 条**（新 PG 组：`genHQPPT` 存在 / `genPPT` 函数体特征串零改动 / 按钮落在导出区同一 `up-row` / 角色双保险 / `pptx` 仍点击懒加载 / 口径单一事实源 / 缺数据页不说谎 / 9 页 + 原生图表表格 + 零紫粉零 emoji）。
    - `FBE86` 枚举新增 `hqPptBtn`（管理专属控件清单 5 → 6 个）**+1 条**。
  - 判据（id 集合 diff）：`+PG1, PG2×8, PG3×6, PG4×3, PG5×4, PG6×5, PG7×4, PG8×7, FBE86-hqPptBtn` = 39。
  - **牙齿测试（变异测试，10/10 全部命中）**：拆角色开关 → `PG4` 红；删 admin 守卫 → `PG4` 红；改 `genPPT` 标题字面量 → `PG2` 红；按钮挪出 `up-row` → `PG3` 红（4 条）；懒加载改首屏预载 → `PG5` 红（2 条）；口径复制第二份 → `PG6` 红；趋势用 0 顶替 → `PG7` 红；删 M6/M7 回落 → `PG7` 红；少一页 → `PG8` 红；塞 emoji → `PG8` 红。每轮跑完还原并 **md5 逐字节校验**。
  - **e2e 侧同样的牙齿测试**：把 `hqPptBtn` 的角色开关抠掉后重跑四道门禁 → `S11 FAIL 泄漏 1 个: hqPptBtn` + `S14 FAIL`，而 `A7` 仍 PASS（管理端对照组不受影响），实测 `24 PASS / 2 FAIL`；证明这条枚举不是摆设。
- **本笔新增 GATE5 `ppt_smoke`（功能绿）**（team-lead 2026-09-28 裁决纳入，接在 GATE4 之后）：
  - **动机**：GATE3 的 PG1~PG8 全是**结构**证据，证明不了「点下去真能出一个能拿去讲的 `.pptx`」——PptxGenJS 的选项名写错、表格列宽/行数越界、chart 类型不支持，只在**真构建**时才抛错，静态断言一条都拦不住。本项目门禁口径是「能证明功能真的能用」，不是「能证明代码存在」，故补这一道运行期真跑。
  - **做法（`index.html` 零改动）**：jsdom 里登录管理端 → `__yfLoadLib('pptx')` 走页面自己的点击懒加载 → patch `PptxGenJS.prototype.writeFile`（内部改用 `this.write({outputType:'base64'})` 把字节交回门禁后解包校验；jsdom 域内没有 Node Buffer，走 `nodebuffer` 会报 not supported）→ 调 `genHQPPT()`。**构建路径（addSlide/addShape/addText/addTable/addChart/write）与生产完全一致，只替换最后一步落盘**。
  - **词法全局陷阱（实测，写下来免得后人再踩）**：`DASH_DB` 是脚本顶层 `let/const` 词法绑定，**不在 `window` 上**（`win.DASH_DB===undefined`），只能经 `win.eval(...)` 读写；`win.JSZip` 要等 `__yfLoadLib('pptx')` 之后才出现。
  - **隔离车道**：端口 `YF_PPT_PORT` 默认 **9103**（GATE4 用 9101；独立验证 worker 用 9102），自调 `mk_shadow.js` 造**独立** virgin shadow 库并 md5 校验真实后端；跑完 netstat+taskkill 清端口残留。前置失败（jsdom 缺失 / shadow 造不出 / 后端起不来 / 隔离校验不过）一律 **`exit 3` 并打印原因——绝不静默跳过**。
  - **断言 17 条**（A 组 11 / B 组 3 / C 组 3），基线 `17 PASS / 0 FAIL / 0 SKIP`（≈18s）。基线产物：**679364 字节 / 9 页**（字节数随生成日期文本浮动，故门禁只设 20KB 下限，不钉死；页数/表格/图表/口径是硬钉）。
    - A 组（管理端真跑）：非空字节（>20KB）· 运行期零 JS 错误 · **9 页** · 原生表格 ≥2（`<a:tbl>`）· 总表 **10 列** × **21 行**（表头 + 20 站）· 原生**柱状图 + 折线图**各 1 · 柱状图 3 个真实数值（4469/3424/1758）· 口径三句逐字齐全 · 口径 `不以到场率、入营率评价好坏` 全文**仅 1 次**。
    - B 组（缺月不以 0 顶替）：注入「6/7 月有上报、8 月有键但无人上报」→ 折线**类目恰 2 个**（6 月/7 月）· 第 8 页写明「缺月 8 月…不以 0 顶替」。
    - C 组（负向）：负责人端按钮 `display:none` · **直调 `genHQPPT()` 拿不到字节** · 有明确「仅管理端」拒绝文案。
  - **牙齿测试（变异测试，10/10 全部命中；每轮还原并 md5 逐字节校验 `index.html`）**：删 admin 守卫 → `C1,C2` 红；缺月用 0 顶替 → `B1,B2` 红；缺月不写口径行 → `B2` 红；多一页 → `A2` 红；两张原生表格换文本框 → `A3,A3b,A3c` 红；去掉 4 项能力表头（总表少 4 列）→ `A3b` 红；折线图分支关掉 → `A4,B1,B2` 红；口径复制第二份 → `A5b` 红；口径改字 → `A5` 红；不再落盘 → `A1,A2,B1` 红。还原后 `index.html` md5 = `d2071cecfec43f46b2f26caa6ec9b60b`（与变异前一致）。
    - 记一条**判据修正**：最初用「把 `colW` 少写一项」当 `A3b` 的变异，实测**不红**——PptxGenJS 的 `gridCol` 数取自**表头单元格数**而非 `colW` 长度，故该变异改不到列数。换成「去掉 4 项能力表头」后才真红。这类「变异本身没改到被断言的那根轴」的假 MISS，必须靠**看变异是否真改变了产物**来甄别，不能只看断言红没红。
- **本笔「B-4 敏捷章手工编排」（设计规格 §4.5 六块）**：把 `#agile` 从 B2 通用流水摘出、整章按 §4.5 逐字文案手工编排，GATE3 新增 **59 条**，`664 → 723`：
  - **口径修正（撞类名）**：§4.5 的六块里 `.sec-hero/.tbl/.kcard` 与 B2 撞类名，两套都跑会出现「两个章首卡、两张对照表、两套术语卡」。故 `LR_B2_IDS` 去掉 `agile`（源码注释留痕），**B2 处理其余 18 章，敏捷章由 `lrB4Apply` 负责**。
  - **B2 既有计数断言「同步但不改弱」**：`.sec-hero = LR_B2_IDS.length`、`.tbl = grid2N+1`、`.kcard/.glossary = termN`、`.fold = foldableN` 全部保留，只有**期望值的推导范围**由「全文 `querySelectorAll`」改为「**B2 流水实际处理的章**」（`b2secs = LR_B2_IDS.map(getElementById)`）——原来把 agile 算进去的分母，现在由 B-4 的断言接手，**不是把 19 硬改成 18 了事**。19 章骨架冻结点改为**推导**：`LESSON_CH_IDS`（19，写死=冻结）→ `B2_EXPECT_IDS = LESSON_CH_IDS.split(',').filter(x => x !== 'agile')`（18，算出来），B2 与 B-4 两段断言**共用同一条骨架常量**，避免各写一份而漂移。
  - **条数**：B-4 新断言 **57 条**（源码层 12 / 数据逐字 6 / 真实 DOM 29 / 行为层 10）；B2 段新增 **2 条**（`18 章在课文里都找得到`、`流水章清单必须全部落在课文 19 章骨架内`），原有断言均为**原位改推导**（不新增条数）。`ICO4` 的 `yfIco` 调用点清单 **25 → 26**（B-4 新增 1 处 `chev`）同样**原位更新、不新增条数**。故净 **+59 = 57 + 2**（判据：`pass` 实测 664 → 723）。
  - **关键牙齿（DOM 层真跑 jsdom + `lrInjectAll` 全流程）**：agile 六块数量与 §4.5 一一对应（结论卡 1 / 表 2 = 价值观 **3 列 × 4 行** + Spotify **4 列 × 4 行** / 时间线 1 条 × **4 节点** / 术语卡 1 组 × **7 张** / 操作板 1 个 × **13 输入框**）；**六块与 3.A/3.B/3.C、`.r3` 的文档序 = §4.5 序位**；其余 18 章仍走 B2 且**总数不变**（`19 = 18+1`、`18 = (15+1)+2`、`6 = 5+1`、`16 = 15+1`、`fold/glossary` 不变）；课文 19 章骨架冻结；源块 `display:none` **收起而非删除**（术语 UL 1 个 + Spotify 3 段）；**幂等**；**注入层引入 emoji = 0**（83 − 83）；章首卡紧随 `h2`。
  - **操作板行为层**：键 `yf_lr_agile_plan`（下划线命名空间）；**按季分槽**，季槽键 = `curSeasonKey()`（与看板赛季判定同源）；「保存 → 卸载再注入 → 回填」闭环；`maxlength` 40 / 16；**清空只清当前季**且输入框同步清空；预置既有键（`yf:lr:read` / `yf:lr:route` / `yf:lr3:pg-init` / `yf_growth_v1`）**逐字节未动 + 零新键**；源码零网络调用面。
  - **牙齿测试（变异测试，20/20 命中；每轮还原后 md5 逐字节校验）**：见下方「变异测试留痕」。
  - **本笔五道门禁实测**：GATE1 `extracted 6 JS blocks`；GATE2 `js_01..js_06 : OK`；GATE3 **pass=723 fail=0**；GATE4 **26 PASS / 0 FAIL / 0 SKIP**；GATE5 **17 PASS / 0 FAIL / 0 SKIP**；P0 终检 **当时全绿**（**注：该结论基于旧基线 `f5949a4`；基线重锚到 `c5f41fb` 后曾短暂报红，已于 2026-09-29 同日关闭 —— 见下方「基线重锚后的命中与关闭」**）。
- **本笔「≤360px 极窄屏溢出回弹」（2026-09-29）**：注入层 `LR_CSS` 末尾新增 1 条 `@media(max-width:360px)`，使 `320 / 343 / 360 / 375 / 414` 五档**溢出元素均为 0**。**断言条数不变（仍 `pass=723`）** —— 纯 CSS 兜底，不新增受断言守卫的结构。
  - 真机实测（系统 Edge headless，**iframe 宽即视口**）：修前 320 档 **5 处**溢出 —— `.main` +17 / `section#ka-comm` +18 / `h2#ka-comm` +34 / `h2#ka-proc` +2 / `.case.good` +11，且书**无横向滚动条 → 内容被裁且滚不回来**。
  - 根因两层：① 课文 `section h2{display:flex}` 是 nowrap 弹性行，注入层把 h2 字号 `19px→22px`（`LR_CSS` 内 `section h2{font-size:22px;…}`）后，长拉丁术语（`Communication` 13 字母 / `Procurement` 11 字母）无断点可折；`.main` / `section` 属**被动溢出**（用「只修 h2」的对照组证明：修好 h2 后二者一并消失）。② 课文 `.case{display:grid;grid-template-columns:1fr 1fr}` 的 `1fr` 轨道 `min-width:auto` 被长串「Kniberg & Ivarsson」撑开。
  - **方案对比（均实测，非推断）**：**A** = h2 折行 + 允许断词 + `.case>*{min-width:0}` → 会让 `.case-kpi` 指标卡被挤爆（320 下**新溢 57px**），**弃用**；**B** = h2 折行 + ≤360 给 `.case` 降单列 → 五档全 **0**，**采用**。
  - **踩坑留痕**：CSS 注释里写了 `⚠️`，被 GATE3 的「注入层零 emoji 字面量」断言逮住（`pass=723 → 720 fail=3`），去掉后复绿 —— **注释也算源码，注入层注释同样不许出现 emoji / 状态符号**。
- **本笔「学习模块宽屏版式铺开（B 方案）」（2026-09-29）**：主应用 CSS 新增 2 条 + 注入层 `LR_CSS` 新增 **6 条** `@media(min-width:901px)` 组。
  - **GATE3 断言条数不变（仍 `pass=723 fail=0`）** —— 关键设计：B5 全部用**媒体查询包裹并追加**，**不改 B1 基线段的任何字面量**（`.main{max-width:860px}` / `34em` / `.deepbox 17px` 原样保留）。故 B1 的 23 条断言一条都不用动、也不用改钉值 —— 与上笔 `DBF17`（源级钉值必须同步）情况**不同**，这次靠「新增层叠加」规避了契约破坏。这是「新增层 vs 改钉值」的取舍范例：能叠加就不改钉值。
  - **问题（真机实测 1910x938，非推断）**：主容器 `.wrap` 带 `margin:0 auto`，在 `.main-area`（`display:flex;flex-direction:column`）里使 `align-items:stretch` 失效 → 宽度退化为按内容反推（fit-content），实测仅 **903px**，而可用宽 **1650px**（**白扔 45%**）。课文正文列因此只剩 **551px**（利用率 64%），两列对照表每列 8-10 个汉字即换行 —— 拥挤感主因是**列宽**而非字号（17px 落在 25-37 字/行理想区）。
  - **修法三处**：① 主应用 `.main-area>.wrap{width:100%;max-width:1800px}`（特异性 `0,2,0` 覆盖 `.wrap` 的 `0,1,0`；`*{box-sizing:border-box}` 在 L129，`width:100%` 不会被 padding 撑溢出）；② `#learn>.legend` / `#learn>.learn-tabs` 占位压缩（省下的高度由 `lrFit()` 按实时 `rect.top` 自动补给课程框，**不写死高度**）；③ 注入层 B5 六条：`.wrap` 1440 封顶 · `.main` 1060 封顶 · 段落与 `.deepbox` `max-width:44em` · `.deepbox 19px/1.95` · `body 18px` · `section h2 26px`。
  - **为何用媒体查询包裹而非直接改 B1 字面量**：① 窄屏必须保持 17px，直接改会被数组末尾的窄屏规则压掉；② B1 那组是基线契约。900px 及以下完整走 B1-7 / B1-8，**窄屏行为零变化**。
  - **真机实测（系统 Edge headless，iframe 宽即课文视口）**：1910x938 → 正文列 **551 → 1060px**、`.deepbox` **17 → 19px**（行高 37.05px）、课文总长 **66132 → 53362px（-19%）**；**9 档视口横向溢出元素均为 0**（1910 / 1440 / 1024 / 901 / 900 / 768 / 414 / 375 / 320）；<901px 完整回落基线（h2 22px / deepbox 17px / 正文列宽度不变）。
  - **实测特性（易误判，写下来免得后人踩）**：注入层的媒体查询在 **iframe 内文档**求值，用的是 **iframe 内宽**而非外层窗口宽 → B5 实际触发于**外层窗口约 1205px 以上**（1910 / 1440 / 1366 / 1280 生效；1024 走基线）。这与「宽屏专用」的语义一致，**不是缺陷**。
  - **范围核查（防波及误判）**：`class="wrap"` 全站仅 1 处（所有模块公共外框），故另测 dash / hq 两模块：1910 档均 0 溢出；dash 1440 / 1024 档有 4px / 9px 溢出，**A/B 对比（改动前 `c35ee3b` vs 改动后）逐项相同**（同为 `button#dashRefreshBtn.up-enter` 入场动画的瞬态位移）→ **存量现象、非本次引入**，不在本笔范围。
  - **本笔五道门禁实测**：GATE1 `extracted 6 JS blocks`；GATE2 `js_01..js_06 : OK`；GATE3 **pass=723 fail=0**；GATE4 **26 PASS / 0 FAIL / 0 SKIP**；GATE5 **17 PASS / 0 FAIL / 0 SKIP**；P0 终检 **5 类全 PASS**（SELFTEST 23/23，`RC=0`，新增行 1775）。

- **本笔「三合一止血 + 版式」（2026-10-01，用户拍板：个人成长绑定 + 对标结论 A+C + 地图版式同轮做完）**：GATE3 断言 **723 → 724（+1）**。
  - **三条改判（用户 2026-10-01 显式拍板，非自选）**，对应断言同步到**新契约**、强度不降：
    1. `I3R1` 短板卡次按钮落点由 `gw3GoBook('能力键')`（跳图书化课程的 PMP 理论章）改为 `gw3HowToggle(this)` + `data-cw="能力键"`（就地在位展开真实做法）。原方案 §2.2/§2.3 就本按钮作废 —— 用户判定「把个人成长和图书绑定…没啥用」；且四能力硬映射到 PMP 知识领域**类比不成立**（家长参与 12.7% 是执行问题，读「权力/利益矩阵」不解决）。
    2. `I3R13` `gw3GoBook` 链尾由 `setTimeout(jump,400)`（单次兜底）改为 `window.lrJump(id)` + `setTimeout(tick,250)`（最多 12 轮幂等轮询）。理由（实测）：`lrJump` 原为 LR IIFE 私有，主应用侧 `if(typeof lrJump==='function')` 守卫**恒为 false** ⇒ 静默空转（点「这块怎么补」后 10s，`scrollY` 恒 0、目标章仍在 **40277px** 处）；且跨 4 万 px 的 `{behavior:'smooth'}` 实测不生效，改为瞬时 `scrollIntoView()` + `scrollTo(offsetTop)` 兜底。**注意 `gw3GoBook` 未删除** —— 承诺块 CTA「去学习补一补 ›」仍在调用。
    3. `cssI3` 切片右边界由「`.gw3-capbtn{` 起 **1100 字符**」改为「**到 `.gw3-guide{` 止**」。理由：原写死长度属**脆断言** —— 该块内新增任意一条 `.gw3-*` 规则都会把 `.gw3-actbtn` 挤出窗口，令 `I3R9/I3R10` **假红**（本笔新增 11 条 `.gw3-how*` 即触发）。改后语义更准（整块 = 三卡动作层 CSS），且不再随新增规则误红。
  - **新增 `I3R17` 1 条**（净 +1）：钉住新契约三条 —— ① `GW3_REAL` 四能力（cardper/convper/sciop/parent）映射齐备；② `gw3HowHtml` 素材取自 `gw3CaseById`/`gw3TplById`（即 `SEED_CASES`/`SEED_TEMPLATES`，本页数据、离线可用）；③ `gw3HowToggle` 面板**懒渲染**（`box.innerHTML=gw3HowHtml(...)`）。
  - **懒渲染不是优化，是修 bug（GATE5 抓到的真缺陷）**：`gwThreeQHtml` 在**脚本块 2**（L2768–9974），`gw3HowHtml` 在**脚本块 5**（L11649–13486）。脚本块之间**不共享函数声明提升**；`gwThreeQHtml` 在页面加载期即被调用（`renderRhythm→gwPaint→gwDiag`），跨块调用时 `gw3HowHtml` 尚未求值 → `ReferenceError: gw3HowHtml is not defined`，**整个「我的成长」模块初始化失败**。改为点击时填充后，调用点必然晚于全部脚本块求值。
    - 同型坑：该块被 GATE3 `mkI3` **切片后在隔离作用域 eval**，故**不得调用切片外函数**。本笔首版误用 `esc()` 即被逮住（`ReferenceError: esc is not defined`，`test_rules exit=1`）。**写这一段的规矩：只用块内已定义的东西 + 受控字面量拼接。**
  - **P0 踩坑复现（第 2 次）**：新写的 JS 注释里带了 `🔴`，被 GATE3「注入层零 emoji 字面量」逮住（`FAIL B2 整个 LR 注入层…`，`rc=1`）—— 与 2026-09-29 那次（`LR_CSS` 注释写 `⚠️`，`723 → 720 fail=3`）**同型复发**。**结论：注释也算源码，`index.html` 全文（含注释）不得出现 emoji 或 emoji 区间字符。**
  - **本笔五道门禁实测**：GATE1 `extracted 6 JS blocks`；GATE2 `js_01..js_06 : OK`；GATE3 **pass=724 fail=0**；GATE4 **26 PASS / 0 FAIL / 0 SKIP**；GATE5 **17 PASS / 0 FAIL / 0 SKIP**；P0 终检 `RC=0`（SELFTEST **24/24**，5 类命中 0；新增行 2554）。
  - **运行期 node 版本纪律复现**：手工跑 `p0_scan.js` 时误用 `22.12.0` → **SEGFAULT（exit 139）**；换基线 `22.22.2-2` 后 `RC=0`。MANIFEST 早已写明「22.12.0 会 SEGFAULT，不得降级」—— **单跑任何门禁脚本都必须用 22.22.2-2**（`run_gates_iso.sh` 内部已固定，故整跑不受影响）。

- **本笔「Service Worker 加固 + GATE-SW 新增」（2026-10-03，用户唯一要求「稳定、不会出错」）**：
  - **动机（用户场景）**：平台要铺给 **20 站**用，站端多为跨国弱网。要给出「GitHub / CloudBase 还能不能撑」的结论，并要求稳定不出错。
  - **发现并修复的真缺陷（静默型）**：`sw.js` 初版用「网络优先」，**导航请求从未被写进 SW 缓存**（`caches.keys()` 里只有 CORE 的 4 个图标 + manifest，**从来没有任何版本的 index.html**）。断网之所以能用，全靠 Chromium 的 HTTP 磁盘缓存；而 GitHub Pages 只给 `Cache-Control: max-age=600` ⇒ **超过 10 分钟断网即打不开**，且**无任何报错**。
    - **改法**：v4 导航分支改为「**缓存优先 + 后台静默更新**」——有缓存立刻返回（保证断网可用 + 秒开），同时后台 fetch 最新版回写（下次打开即新版，版本仍自动前进）；无缓存走网络并**显式 await 回写**；首次 + 断网返回可读 503 页。离线窗口从 10 分钟 → **无限期**。
    - **取舍（明确写下来）**：用户**这次**打开可能看到上一版，差异通常只在下次打开时体现。这是「稳定优先」的主动选择——**要「永远打得开」，不要「永远最新」**。
  - **线上 CDP 验收 10/10 全绿**（`output/_scratch/_sw_accept_v4.js`，真实 Edge headless + 线上 https）：
    - 二次导航（SW 缓存命中）**517ms · transferSize=0**
    - `workerStart=2` ⇒ **导航确实经 SW 接管**（这条是最硬的证据）
    - SW 缓存含**完整 index.html 4302860 字节**（`cache.match` 五写法探测此前全 MISS 是**测试脚本缺陷**：dump 前只等 3–4s，4.3MB 落盘需 ~6s；且只等 `active=activated` 没等 `controller=yes`）
    - 断网（**先 `Network.clearBrowserCache` 清 HTTP 磁盘缓存**以排除兜底）**559ms** 打开、内容非空、非 503 兜底页
    - 断网 + 带查询串（`?cb=`）**509ms** 打开 ⇒ `ignoreSearch` 生效
  - **GATE-SW 同步新增 5 条防回归断言（18 → 23 条）**：B6 导航分支先 `cache.match` / B7 命中即 `return cached`（退回网络优先即红）/ B8 无缓存显式 await 回写 / B9 首次断网有 503 兜底页 / B10 https 协议判断（**兼作测试纪律**：本地 http 下 SW 永不注册，实测 `no-reg`）。
    - **`NET_TIMEOUT` 断言改条件式**：v4 后该常量已无调用方（`netFirst` 改为收 `ms` 参数），原断言会逼人保留死代码 ⇒ 改为「存在时校验格式」+ 新增「`netFirst` 若存在必须是纯函数」。
    - **变异测试**：去掉 `if (cached) return cached` → `FAIL B7`；删 https 判断 → `FAIL B10`（各跑完即还原并复核 blob SHA）。
  - **本笔六道门禁实测**：GATE1 `extracted 6 JS blocks`；GATE2 `js_01..js_06 : OK`；GATE3 **pass=724 fail=0**；GATE4 **26 PASS / 0 FAIL / 0 SKIP**；GATE5 **18 PASS / 0 FAIL / 0 SKIP**；**GATE-SW 23 PASS / 0 FAIL**；P0 终检 `RC=0`（SELFTEST **24/24**，5 类命中 0）。
  - **部署**：`sw.js` v4 blob `471df06321` 已推 GitHub Pages（`main` + `master` 双 ref，commit `d29346d7`）+ CloudBase（ETag 与本地 md5 逐字一致）。`index.html` **本笔零改动**（blob `8b11c743`）。

## P0 扫描口径（三处精度修正 + 保真平移白名单 —— **降假阳性 / 补口径缺口，均不降强度**）

三处都是「判定维度」修正，不是把红线调松；每处都配了 SELFTEST 反证（真违规必须命中、被修的假阳性必须不命中），SELFTEST 不通过 → 退出码非 0。当前 **SELFTEST 23/23**（原 14 条 → +9 条，覆盖颜色函数、白名单两条硬约束、以及「白名单移出后必须命中」）。

| # | 规则 | 旧判定（有假阳性） | 新判定 | 强度反证（SELFTEST 里跑） | 触发本次修正的真实案例 |
|---|---|---|---|---|---|
| 1 | 硬编码颜色 | 新增行上出现任何非白名单色值即命中 | 只有**基线全文里不存在的**色值才算命中；基线既有色值另走 `INFO 新增行上的基线既有色值 N 处` 播报（不计命中、不静默） | `#00ff00` 等基线外色值仍必命中；白名单仍只有 `#fff/#ffffff/#000/#000000` | 基线本就把整套设计令牌写死在 `index.html`（`#0d2c4d` 81 处 / `#2b7cd3` 87 处 / `#d3e2f0` 42 处 / `#e6f0fa` 4 处）。把行尾 emoji 换成内联 SVG 时色值一个字节没动，整行却以「新增行」身份进扫描面 → 存量令牌被反复重算成违规，规则不可维护 |
| 2 | 中文字面量半角标点 | 直接对字符串套半角标点正则 | 判定前先剥掉 HTML 实体（`&lt; &gt; &amp; &nbsp; …`） | 半角 `,;?!:`、半角括号紧贴中文仍命中；「实体后紧跟半角标点+中文」也仍命中 | 基线 `placeholder="支持HTML，如 &lt;b&gt;📢 标题&lt;/b&gt; 正文"` 的 emoji 移除后，实体终止符 `;` 直接贴上中文「标题」，触发 `[,;!?][中文]` —— 文案本身用全角逗号，完全合规 |
| 3 | 硬编码颜色**写法**（同一规则的不一致） | 只扫 `#hex` | 一并扫颜色函数 `rgb()/rgba()/hsl()/hsla()`，判定机制与 `#hex` **完全一致**（基线外新值才命中） | 全新 `rgba(1,2,3,.5)`、`hsl(210,50%,40%)` 必命中；白名单放行 `rgb(255,255,255)`/`rgba(0,0,0,.5)`/`hsl(0,0%,100%)`/`hsl(0,0%,0%)`；基线既有 `rgba(43,124,211,.35)` 不计命中 | 注入层 B1-8 平移课文窄屏样式时抄了 `rgba(20,85,156,.4)`。它和 `#14559c` 是同一类东西，只扫 `#hex` 就是同一规则两套待遇（门禁裂缝） |

**已知边界（写明白，不假装覆盖）**：颜色函数只认逗号分隔写法；CSS Color 4 的空格分隔（`rgb(255 255 255)`）不识别——本项目未使用该写法，若将来使用需同步补。

**代价与边界（写清以免后人误用）**：口径 1 之下，「复用基线既有色值」不再报错——这正是规则原意（禁的是**引入**新硬编码色值），但也意味着**新增 UI 若照抄存量令牌**不会被拦；新增 UI 的颜色仍应优先走 `var(--token)`。口径 2 之下，`&...;` 被整体抹掉，规则无法再借实体分号做「半角分号」判定——实际不存在这种合规诉求。

### 保真平移白名单（`FIDELITY`，进版控、走 `INFO` 播报）

注入层覆盖课文时「视觉保真」是真实需求：把课文同名规则的颜色值**逐字抄**过来，注入后才不会和课文原貌对不上。但课文在 `index.html` 里是 **base64**，其色值不在基线明文里 → 会被上面的「新增色值」判定命中。故单列白名单，三条硬约束（均由 SELFTEST 把守）：

1. **只允许「颜色值」本身，不许夹带其他属性**（不得出现 `color:…`/`background:…` 这类串）；
2. **每条必须注明抄自课文哪条规则**（`from` 字段，可审计可复核）；
3. **命中时走 `INFO` 显式播报（含出处），绝不静默豁免**——与存量令牌同待遇。

**不得双份豁免**：若某色值其实已在基线明文里（如 `rgba(43,124,211,.35)` 基线有 2 处），会被 legacy 车道自动接住，**无需也不得**再进白名单（否则双份豁免、口径混淆）。当前白名单**仅 1 条**：`rgba(20,85,156,.4)` ← 课文 `.side-mask`（窄屏抽屉遮罩底色）。

**牙齿测试**（证明白名单承重、不是整体放水）：把该条从白名单删掉 → `rgba(20,85,156,.4)` 立刻被报为命中且整检 FAIL（同时 SELFTEST 自身也红 2 条）。反向牙齿：注入层真塞全新 `rgba(1,2,3,.5)` → FAIL 并报出该值；退出码契约实测 `MUT_RC=1 / CLEAN_RC=0`。


### 基线重锚后的命中与关闭（2026-09-29 登记 → 同日**已关闭**）

`p0_scan.js` 的扫描基线因 `.git` 事故由 `f5949a4` 重锚为 `c5f41fb` 后扫描面变宽，暴露 **1 类真实命中**：

| 命中 | 位置 | 原值 | 处置 |
|---|---|---|---|
| 硬编码色值 ×5（4 个唯一值） | `renderChinaMap()` 的**历史季灰板**（`_isHistSeason` 三元分支） | `#93A6BA`(hi/dotMid) · `#EFF2F5`(lo) · `#6E8299`(dotHi) · `#AFBECB`(dotLo) | **已改采基线既有灰阶**，见下 |

**定性**：基线位移导致的**真实命中**（这 4 个值确实不在 `c5f41fb` 里），**不是回归**。

**关闭方式（选项①复用基线既有灰值）**：

| 角色 | 原值 | 新值 | ΔRGB |
|---|---|---|---|
| `hi` / `dotMid`（有浆站省份 / 有数据） | `#93A6BA` | `#94A3B8`（= slate-400） | 3.7 |
| `lo`（其他省份） | `#EFF2F5` | `#EEF2F6` | 1.4 |
| `dotHi`（高入营站点） | `#6E8299` | `#6B7B8F` | 12.6 |
| `dotLo`（低入营站点） | `#AFBECB` | `#B0BEC5` | 6.1 |

4 个新值**均在基线 `c5f41fb` 明文内**（各出现 1–3 次）→ 落入 legacy 车道，`INFO` 播报、不计命中。
语义不变（历史季仍为灰蓝低饱和 + 「去年基线 · 只读」角标），ΔRGB ≤ 13 → 观感不变。

- **同步改动**：GATE3 的 `DBF17` 是**源级钉值**断言（把灰值字面量钉在源码里）→ 已同步钉到新值并注记迁移原因。
- **复验**：P0 终检 `全部通过 (RC=0)`；GATE3 `pass=723 fail=0`。
- **注意（长期有效）**：单纯把 hex 提成 `const` 或设计令牌**不能**转绿 —— 只要该值出现在新增行且不在基线里，规则仍会命中；
  要转绿只能**复用基线已存在的色值**，或走可审计白名单。

### 已知命中（当前状态：**无**）


## GATE-SW 说明（`sw_selfcheck.js`，2026-10-03 新增）

**为什么需要一个专门扫 `sw.js` 的门禁**：`p0_scan.js` 只扫 `index.html`，而 `sw.js` 是**独立文件**、不属那 6 个内联块，故 **P0 终检完全看不到它**。偏偏 SW 承载「二次打开秒开 + 断网可用」，且它的失效方式是**静默的**——用户只会觉得"有点慢"或"偶尔打不开"，不会有任何报错。

### 断言分组（23 条）

| 组 | 条数 | 内容 |
|---|---|---|
| A 文件与语法 | 2 | `sw.js` / `manifest.json` 存在；manifest 可 JSON 解析 |
| B 离线可用性 | 13 | 内联注册 / manifest 引用 / CORE 非空且文件真实存在 / CORE 不含 index.html / icons 真实存在且 ≥2 / start_url / scope / skipWaiting / clients.claim / **B6–B9 导航分支缓存优先四连** / **B10 https 协议判断** |
| C 版本纪律 | 3 | `CACHE` 存在且为字符串字面量、含 `v<数字>`；`netFirst` 若存在必须是纯函数 |

### 🔴 B6–B10 是本门禁的核心价值（防静默退化）

2026-10-03 实测踩到的真实缺陷：早期实现用「网络优先」策略，结果**导航请求从未被写进 SW 缓存**（缓存里只有 CORE 的 4 个图标）。断网之所以能用，全靠 Chromium 的 HTTP 磁盘缓存——而 GitHub Pages 只给 `Cache-Control: max-age=600`。**超过 10 分钟断网即打不开**，且这个退化**没有任何报错**。

- **B6**：导航分支必须先 `cache.match`。
- **B7**：命中缓存时**直接 `return cached`**（不是"拿缓存放旁边、等网络回来再决定"）——退回网络优先即红。
- **B8**：无缓存时须显式 `await` 网络结果并回写，保证首次访问一定落盘。
- **B9**：首次访问 + 断网须返回**可读的 503 兜底页**，不能白屏。
- **B10**：`index.html` 中的 SW 注册必须带 `location.protocol!=='https:'` 判断。**兼作测试纪律**——本地 http 下 SW 永不注册（实测 `no-reg`），任何"本地 http 复现 SW 行为"的尝试都是白费功夫，必须线上 https 或本地起 https。

### 变异测试（证明断言有牙齿）

| 注入的缺陷 | 预期 | 实测 |
|---|---|---|
| 去掉 `if (cached) { … return cached }`（退回网络优先） | B7 红 | ✅ `FAIL B7` |
| 删掉 `location.protocol!=='https:'` 判断 | B10 红 | ✅ `FAIL B10` |
| `CACHE` 退化为 `'yf-os'`（无版本号） | C 组红 | ✅ `FAIL CACHE 值含 v<数字>` |
| CORE 加回 `./index.html` | B3 红 | ✅ `FAIL CORE 不含 index.html` |
| CORE 写不存在的文件 | B2 红 | ✅ `FAIL CORE 清单里每个文件真实存在` |

### ⚠️ 本门禁只做静态断言

运行时的「缓存到底有没有落盘」不在门禁范围（需联网 + 真浏览器）。该部分由 **`output/_scratch/_sw_accept_v4.js`** 覆盖——线上 CDP 验收 10 项：首开可用 / SW 激活并接管 / **缓存含完整 index.html（>4MB）** / `workerStart>0` 证明导航过 SW / 断网（清 HTTP 缓存后）可开 / 走真缓存非兜底页 / 带查询串可开 / 恢复联网可用。**每次改 `sw.js` 后必须跑一次**（实测基线：二次导航 **517ms** · `transferSize: 0`；断网 **559ms**）。

## 红线（长期约束）

1. **派生物必须每轮从真实源重生成，禁止手工维护副本。** shadow store、`js_0N.js` 提取产物一律即时生成（写 `os.tmpdir()`）。仓库内**不得**出现 `js_0X.js` 或 shadow 数据的**手工副本**——副本必然与真实源漂移，门禁就会去验一个假的绿。
2. **单入口**：只允许 `run_gates_iso.sh`。若保留薄壳（如旧的 `run_gates.sh` / `run_gates_lite.sh`），**只能转调 iso**，**不得**含流水线/断言体。旧三份 runner 已归档至 `.tmp-verify/_archive_pre_92/`（仓库外，不纳管），以免出现第二事实源。
3. **路径一律 `__dirname` 基**：验收标准 = 在**任意 cwd** 直接跑，四道门禁产出与上表**相同**数字。
4. **FATAL 不静默跳过**：任一前置失败（如 shadow 生成失败）必须非 0 退出，**绝不**把「跳过」当成「绿」。
5. **调原生 exe 的路径：一律用盘符路径，或先 `cd` 再走相对路径。** Git Bash(MSYS) 会把 `/d/...` 形式的**参数**改写成 `d:\d\...` 再交给 `node`/`git` 等原生 exe → 报 `Cannot find module 'd:\d\...'` / `fatal: could not read log file`。本项目已踩 4 次，**最险的一次**：牙齿脚本 `restore()` 里的 `node "…/extract.js"` 静默 no-op —— `index.html` 已还原、但提取产物 `js_04.js` 仍是变异版，**差一点留下「源码干净、门禁却按变异版跑」的假绿**。
   - ✗ 反面：`node "/d/repo/tools/gates/extract.js"`、`git commit -F "/d/x/msg.txt"`
   - ✓ 正面：`node "D:/repo/tools/gates/extract.js"`，或 `cd /d/repo && node tools/gates/extract.js`
   - **自查手段**：任何「本应改变状态」的命令之后，**回读被改对象**（`grep` 提取产物 / `md5sum` 源文件）确认真的变了——不要凭命令返回码推断。

## 运行示例

```bash
# 全绿判定（退出码 0）
bash tools/gates/run_gates_iso.sh accept && echo OK

# 换隔离端口（避开占用）
YF_TEST_PORT=9201 bash tools/gates/run_gates_iso.sh accept2

# 单独跑 P0 终检（扫已提交 HEAD）
node tools/gates/p0_scan.js
# 扫未提交工作区
node tools/gates/p0_scan.js WORKTREE
```
