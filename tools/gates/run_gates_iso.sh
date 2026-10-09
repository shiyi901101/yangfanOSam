#!/bin/bash
# =====================================================================
# 门禁套件「唯一入口」（工具链纳管 #92）
#   GATE1 extract（index.html → 6 个内联 <script> 块）
#   GATE2 node --check js_01..js_06
#   GATE3 test_rules.js（静态 + 行为级断言）
#   GATE4 e2e_dual_role.js（隔离车道：每轮全新 virgin shadow store + md5 校验）
#   GATE5 ppt_smoke.js（功能绿：管理端真跑 genHQPPT 出 14 页 pptx；独立端口、独立影子库）
#   GATE-SW sw_selfcheck.js（PWA 离线可用性 + 版本纪律；sw.js 不属 index.html
#                           内联块，是 p0_scan 的盲区——2026-10-03 新增补齐）
# ---------------------------------------------------------------------
# 用法: bash tools/gates/run_gates_iso.sh [tag]
#   · 任意 cwd 均可 —— 脚本自定位（dirname $0）后 cd 到自身目录；
#     所有读文件路径由 paths.js 以 __dirname 解析，提取产物写 os.tmpdir()，不依赖 cwd。
#   · 环境变量：YF_NODE（node 可执行，默认下方 22.22.2）、YF_TEST_PORT（GATE4 隔离端口，默认 9101）、
#     YF_PPT_PORT（GATE5 隔离端口，默认 9103——与 GATE4 分开，两条车道不抢端口）。
#   · 基线（MANIFEST.md 写死）：extract 6 块 / node --check 6/6 /
#     test_rules 760 pass 0 fail / e2e 26 PASS 0 FAIL 0 SKIP / ppt_smoke 18 PASS 0 FAIL 0 SKIP /
#     sw_selfcheck 23 PASS 0 FAIL（含 B6–B10 导航分支「缓存优先」防回归）。
#   · 退出码：0=全绿；非 0=有门禁红（供调用方/CI 判定，不靠人看日志）。
#   · 失败口径：任一前置失败（jsdom 缺失 / shadow 造不出 / 后端起不来 / 隔离校验不过）
#     都必须非零退出并打印原因（GATE5 前置失败固定 exit 3），绝不把「跳过」当「绿」。
# =====================================================================
set -u
GATES_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$GATES_DIR" || exit 9

NODE="${YF_NODE:-C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe}"
TAG="${1:-run}"
ISO_PORT="${YF_TEST_PORT:-9101}"
PPT_PORT="${YF_PPT_PORT:-9103}"
TMPROOT="$("$NODE" -e "console.log(require('os').tmpdir().replace(/\\\\/g,'/'))")"
LOG="$TMPROOT/yf-gates-iso_$TAG.log"

RC=0
{
  echo "=== 门禁套件 run_gates_iso.sh（tag=$TAG · GATE4 端口=$ISO_PORT · GATE5 端口=$PPT_PORT） ==="
  echo "=== node version（基线 22.22.2） ==="
  "$NODE" --version
  echo "=== [GATE1] extract 6 script blocks ==="
  EXTRACT_OUT="$("$NODE" ./extract.js)"
  echo "$EXTRACT_OUT"
  case "$EXTRACT_OUT" in
    *"extracted 6 JS blocks"*) : ;;
    *) echo "GATE1 FAIL：期望 6 块，实际输出见上"; RC=1 ;;
  esac
  TMP="$(printf '%s\n' "$EXTRACT_OUT" | sed -n 's/^YF_TMP=//p' | tail -1)"
  if [ -z "$TMP" ]; then echo "GATE1 FATAL：未取到 YF_TMP（extract 未输出产物目录）"; RC=1; fi
  echo "=== [GATE2] node --check js_01..js_06（$TMP） ==="
  for i in 01 02 03 04 05 06; do
    if out=$("$NODE" --check "$TMP/js_$i.js" 2>&1); then echo "js_$i : OK"; else echo "js_$i : $out"; RC=1; fi
  done
  echo "=== [GATE3] test_rules.js ==="
  "$NODE" ./test_rules.js; TRC=$?
  echo "test_rules exit=$TRC"
  [ "$TRC" -ne 0 ] && RC=1
  echo "=== [GATE4] e2e_dual_role.js（隔离车道：virgin shadow store + 端口 $ISO_PORT） ==="
  SHADOW_OUT="$("$NODE" ./mk_shadow.js 2>&1)"
  echo "$SHADOW_OUT"
  SHADOW_DIR="$(printf '%s\n' "$SHADOW_OUT" | sed -n 's/^SHADOW=//p' | tail -1)"
  if [ -z "$SHADOW_DIR" ] || [ ! -d "$SHADOW_DIR" ]; then
    echo "FATAL: 影子目录生成失败，GATE4 中止（不静默跳过——跳过会被当成绿）"
    echo "e2e exit=9"
    RC=1
  else
    YF_API_DIR="$SHADOW_DIR" YF_TEST_PORT="$ISO_PORT" "$NODE" ./e2e_dual_role.js; ERC=$?
    echo "e2e exit=$ERC"
    [ "$ERC" -ne 0 ] && RC=1
  fi
  echo "=== [GATE5] ppt_smoke.js（功能绿：管理端真跑 genHQPPT 出 14 页 pptx · 端口 $PPT_PORT） ==="
  YF_PPT_PORT="$PPT_PORT" "$NODE" ./ppt_smoke.js; PRC=$?
  echo "ppt_smoke exit=$PRC"
  [ "$PRC" -ne 0 ] && RC=1
  echo "=== [GATE-SW] sw_selfcheck.js（PWA 离线可用性 + 导航分支缓存优先防回归） ==="
  SW_OUT="$("$NODE" ./sw_selfcheck.js 2>&1)"; SWRC=$?
  echo "$SW_OUT"
  echo "sw_selfcheck exit=$SWRC"
  [ "$SWRC" -ne 0 ] && RC=1
  echo "=== RESULT: $([ "$RC" -eq 0 ] && echo PASS || echo FAIL) (RC=$RC) ==="
} > "$LOG" 2>&1

echo "log=$LOG"
exit "$RC"
