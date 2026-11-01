#!/usr/bin/env bash
# Runs every local test suite OFFLINE and aggregates the results (audit F-06).
#
#   scripts/run-all-tests.sh            all offline suites; exit 0 only if every non-skipped suite passed
#   scripts/run-all-tests.sh --online   the same, plus the network checks (live X1 testnet query), reported separately
#
# Never writes into the repository: logs go to $TEST_LOG_DIR (default: a fresh temp dir, printed at the end).
# The economic simulation writes results next to its script, so it runs on a copy in the temp dir.
# A suite whose toolchain is missing is SKIP: not a pass and not a failure. Works with macOS bash 3.2.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ONLINE=0
for a in "$@"; do
  case "$a" in
    --online) ONLINE=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a (use --online or --help)" >&2; exit 2 ;;
  esac
done
export PATH="$HOME/.foundry/bin:$HOME/.cargo/bin:$PATH"

LOGS="${TEST_LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/vmpx-tests.XXXXXX")}"
mkdir -p "$LOGS" || exit 2
case "$(cd "$LOGS" && pwd)/" in
  "$ROOT"/*) echo "TEST_LOG_DIR must be outside the repository ($LOGS)" >&2; exit 2 ;;
esac

NAMES=(); RESULTS=(); NOTES=(); TIMES=()
record() { NAMES+=("$1"); RESULTS+=("$2"); NOTES+=("$3"); TIMES+=("$4"); }
have() { command -v "$1" >/dev/null 2>&1; }

# a short count line from the runners' own summaries (best effort, only for the table)
summary_of() {
  local f=$1 s
  s=$(grep -E '^ℹ (pass|fail|skipped) ' "$f" | awk '{printf "%s %s, ", $2, $3}' | sed 's/, $//')               # node --test
  [ -n "$s" ] || s=$(grep -E '^Ran [0-9]+ test suites?' "$f" | tail -1 | sed -E 's/ in [^:]*: / /; s/ \(.*\)//')  # forge
  [ -n "$s" ] || s=$(grep -E '^Ran [0-9]+ tests? in' "$f" | tail -1 | sed -E 's/ in .*//')                       # unittest
  [ -n "$s" ] || s=$(grep -E '^test result:' "$f" | head -1 | sed -E 's/^test result: //; s/; finished.*//')      # cargo
  [ -n "$s" ] || s=$(grep -E '(passed|failed|PASS|FAIL|checked)' "$f" | tail -1 | cut -c1-80)
  [ -n "$s" ] || s="(exit code only)"
  printf %s "$s"
}

# run <name> <dir> <cmd...>: runs in <dir>, log in $LOGS/NN-<slug>.log, PASS/FAIL by exit code
run() {
  local name=$1 dir=$2; shift 2
  local slug log t0=$SECONDS rc dt note
  slug=$(printf %s "$name" | tr -c 'A-Za-z0-9' '-' | tr -s '-' | sed 's/-$//')
  log="$LOGS/$(printf %02d $((${#NAMES[@]} + 1)))-$slug.log"
  printf '>>> %-36s ' "$name"
  ( cd "$dir" && "$@" ) >"$log" 2>&1; rc=$?
  dt=$((SECONDS - t0)); note=$(summary_of "$log")
  if [ $rc -eq 0 ]; then record "$name" PASS "$note" "$dt"; echo "PASS (${dt}s) $note"
  else record "$name" FAIL "exit $rc; $note" "$dt"; echo "FAIL (exit $rc, ${dt}s) $note"; tail -n 15 "$log" | sed 's/^/    | /'; fi
}
skip() { record "$1" SKIP "$2" 0; printf '>>> %-36s SKIP: %s\n' "$1" "$2"; }

echo "eVMPX bridge: offline test suites, $(date -u +%Y-%m-%dT%H:%M:%SZ); logs: $LOGS"

# 1. EVM (Foundry; via_ir and solc come from foundry.toml). A `solc = "/path"` line pointing to a missing compiler is
#    overridden by FOUNDRY_SOLC_VERSION=0.8.22 for this run only; foundry.toml is never edited.
if have forge; then
  SOLC_LINE=$(grep -E '^[[:space:]]*solc[[:space:]]*=' "$ROOT/evm/foundry.toml" | head -1 | sed -E 's/^[^=]*=[[:space:]]*"?([^"]*)"?.*/\1/')
  case "$SOLC_LINE" in
    */*) [ -x "$SOLC_LINE" ] || { export FOUNDRY_SOLC_VERSION=0.8.22; echo "    (solc path $SOLC_LINE missing: FOUNDRY_SOLC_VERSION=0.8.22)"; } ;;
  esac
  # offline: SEPOLIA_FORK_RPC unset, so the fork dry run (ForkSepoliaV2) reports its tests as skipped, never as passed
  if [ $ONLINE -eq 1 ]; then run "evm: forge test" "$ROOT/evm" forge test
  else run "evm: forge test" "$ROOT/evm" env -u SEPOLIA_FORK_RPC forge test; fi
else skip "evm: forge test" "forge not installed (foundryup)"; fi

# 2. EVM ops scripts with their own tests (e.g. check-roles), whatever exists in this checkout
found=0
for t in "$ROOT"/evm/script/test/*.test.sh; do
  [ -f "$t" ] || continue; found=1
  run "evm: script/test/$(basename "$t")" "$ROOT" bash "$t"
done
[ $found -eq 1 ] || skip "evm: script/test/*.test.sh" "none in this checkout"

# 3. Monitor, Telegram alerts, evidence, state (node:test); frontend core; auto-pause (fake cast, 127.0.0.1 only)
if have node; then
  run "monitoring: node --test" "$ROOT/monitoring" sh -c 'node --test test/*.mjs'
  run "frontend: core.test.mjs" "$ROOT" node --test frontend/tests/core.test.mjs
else skip "monitoring: node --test" "node not installed"; skip "frontend: core.test.mjs" "node not installed"; fi
run "monitoring: auto-pause.test.sh" "$ROOT" bash monitoring/test/auto-pause.test.sh

# 4. Indexer and API (Python stdlib); economics simulation (asserts the collateral invariant) on a copy
if have python3; then
  run "indexer: unittest" "$ROOT/indexer" python3 -B -m unittest test_activity.py test_api.py
  mkdir -p "$LOGS/economics" && cp "$ROOT/economics/sim.py" "$LOGS/economics/"
  run "economics: sim.py (copy)" "$LOGS/economics" python3 -B -I sim.py
else skip "indexer: unittest" "python3 not installed"; skip "economics: sim.py (copy)" "python3 not installed"; fi

# 5. Rust (Sealevel decimals arithmetic), offline
found=0
for c in "$ROOT"/svm/*/Cargo.toml; do
  [ -f "$c" ] || continue; found=1; d=$(dirname "$c")
  if have cargo; then run "svm: cargo test $(basename "$d")" "$d" cargo test --offline
  else skip "svm: cargo test $(basename "$d")" "cargo not installed (rustup)"; fi
done
[ $found -eq 1 ] || skip "svm: cargo test" "no Cargo.toml under svm/"

# 6. Syntax of every shell script (bash -n), outside dependencies and build output
syntax_check() {
  local bad=0 n=0 f
  while IFS= read -r f; do
    n=$((n + 1))
    bash -n "$f" || { echo "SYNTAX ERROR: $f"; bad=$((bad + 1)); }
  done < <(find . -name '*.sh' -not -path '*/node_modules/*' -not -path './evm/lib/*' -not -path '*/target/*' -not -path './.git/*' | sort)
  echo "checked $n shell scripts, $bad with syntax errors"
  [ $bad -eq 0 ]
}
run "bash -n: all *.sh" "$ROOT" syntax_check

# --- network checks: only with --online, reported as their own rows -----------------------------------------------
if [ $ONLINE -eq 1 ]; then
  with_timeout() { local s=$1; shift; if have timeout; then timeout "$s" "$@"; elif have gtimeout; then gtimeout "$s" "$@"; else perl -e 'alarm shift; exec @ARGV or die' "$s" "$@"; fi; }
  if have node; then run "online: X1 compat (check-x1.mjs)" "$ROOT/svm/compat" with_timeout 60 node check-x1.mjs --rpc "${X1_RPC:-https://rpc.testnet.x1.xyz}"
  else skip "online: X1 compat (check-x1.mjs)" "node not installed"; fi
fi

# --- summary --------------------------------------------------------------------------------------------------------
pass=0 fail=0 skipped=0
echo
echo "===================================================================================================="
printf '%-38s %-6s %6s  %s\n' "SUITE" "RESULT" "TIME" "DETAILS"
echo "----------------------------------------------------------------------------------------------------"
i=0
while [ $i -lt ${#NAMES[@]} ]; do
  printf '%-38s %-6s %5ss  %s\n' "${NAMES[$i]}" "${RESULTS[$i]}" "${TIMES[$i]}" "${NOTES[$i]}"
  case "${RESULTS[$i]}" in PASS) pass=$((pass + 1)) ;; FAIL) fail=$((fail + 1)) ;; SKIP) skipped=$((skipped + 1)) ;; esac
  i=$((i + 1))
done
echo "----------------------------------------------------------------------------------------------------"
echo "passed $pass, failed $fail, skipped $skipped (skipped is not passed)$([ $ONLINE -eq 1 ] || echo "; network checks not run (--online)")"
echo "logs: $LOGS"
[ $fail -eq 0 ] && [ $pass -gt 0 ]
