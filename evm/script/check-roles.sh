#!/usr/bin/env bash
# Read-only acceptance checks for the role migration (Codex round 4, R4-07; full audit 2026-11-01, F-02). Two separate
# gates, so a passing step-2B check is never read as "the deployer holds nothing":
#
#   check-roles.sh 2b    Timelock after step 2B. The holders of every timelock role are RECONSTRUCTED from the
#                        RoleGranted/RoleRevoked events since the Timelock's deployment block and must be EXACTLY:
#                          PROPOSER_ROLE        = {SAFE}
#                          EXECUTOR_ROLE        = {SAFE}
#                          CANCELLER_ROLE       = {SAFE, GUARDIAN}
#                          TIMELOCK_ADMIN_ROLE  = {TIMELOCK}            (self-administered, no external admin)
#                          any other role (e.g. DEFAULT_ADMIN_ROLE 0x00) = {}
#                        Every reconstructed holder and every address ever seen in a role event (plus the deployer, the
#                        old guardian, the Safe, the guardian, the Timelock and address(0)) is cross-checked with
#                        hasRole() at the same block; any mismatch means the history is incomplete = FAIL.
#                        Role admins must be the constructor's (all four administered by TIMELOCK_ADMIN_ROLE), and those
#                        constructor events must be found at the deployment block (proof the scan starts there).
#                        getMinDelay() must equal the expected delay: EXPECT_MIN_DELAY, else 172800 on mainnet (chain 1)
#                        and 300 on Sepolia (chain 11155111); any other chain needs EXPECT_MIN_DELAY; on mainnet an
#                        expected delay below 172800 is itself a FAIL. No scheduled operation may still be pending.
#   check-roles.sh full  the whole migration: 2b + guardian / pendingGuardian, pausers (exact set reconstructed from
#                        PauserSet events since the EmergencyPauser's deployment block, cross-checked with isPauser), fee
#                        hook price updater and beneficiary, router treasury, contract owners, Safe owners / threshold /
#                        modules / guard, and (if X1_* is set) every X1 authority through svm/compat/check-x1.mjs.
#
# History is fail-closed: an unknown deployment block, a log chunk that still fails after LOG_RETRIES attempts, a chunk
# whose answer is not a well-formed log list for the requested range, or event history that disagrees with hasRole()
# is a FAIL, never a pass.
#
# Deployment blocks: TIMELOCK_DEPLOY_BLOCK (FROM_BLOCK is accepted as the old name) and PAUSER_DEPLOY_BLOCK. Given or
#   not, the block is verified on LOGS_RPC: code at the block and no code one block earlier. When not given it is found
#   by binary search on `cast code --block`. Both need an archive node for old blocks (pruned history = FAIL).
#
# Env (addresses only, nothing secret): ETH_RPC, TIMELOCK, SAFE, GUARDIAN, DEPLOYER, OLD_GUARDIAN,
#   LOGS_RPC (archive RPC used for logs and historic code; default ETH_RPC), LOG_CHUNK (blocks per eth_getLogs call,
#   default 50000; publicnode allows 50000, ethpandaops 30000), LOG_RETRIES (default 3), LOG_RETRY_SLEEP (s, default 2),
#   EXPECT_MIN_DELAY (seconds, optional), TIMELOCK_DEPLOY_BLOCK (optional)
#   full only: ROUTER, PROXY_ADMIN, FEE_HOOK, RATE_ISM, PAUSE_ISM, PAUSE_HOOK, PAUSER (EmergencyPauser), PAUSERS (csv,
#   expected exact set, may be empty), PAUSER_DEPLOY_BLOCK (optional), PRICE_UPDATER (expected or 0x0 when retired),
#   BENEFICIARY, TREASURY, SAFE_OWNERS (csv) and SAFE_THRESHOLD, optional NESTED_SAFE / NESTED_OWNERS / NESTED_THRESHOLD,
#   optional X1_RPC X1_MINT X1_PROGRAM X1_MAILBOX X1_DEPLOYER + the --expect-* values in X1_CHECK_ARGS
# All calls are pinned to one block (the lower tip of ETH_RPC and LOGS_RPC), the same block the log scan ends at.
# Exit 1 on any FAIL. Never sends a transaction. Tests: evm/script/test/check-roles.test.sh (fake cast, no RPC).
set -uo pipefail
MODE="${1:?usage: check-roles.sh 2b|full}"
case "$MODE" in 2b|full) ;; *) echo "usage: check-roles.sh 2b|full"; exit 2 ;; esac
: "${ETH_RPC:?}" "${TIMELOCK:?}" "${SAFE:?}" "${GUARDIAN:?}" "${DEPLOYER:?}" "${OLD_GUARDIAN:?}"
LOGS_RPC="${LOGS_RPC:-$ETH_RPC}"
LOG_CHUNK="${LOG_CHUNK:-50000}"; LOG_RETRIES="${LOG_RETRIES:-3}"; LOG_RETRY_SLEEP="${LOG_RETRY_SLEEP:-2}"
TIMELOCK_DEPLOY_BLOCK="${TIMELOCK_DEPLOY_BLOCK:-${FROM_BLOCK:-}}"
FAILS=0
ok(){ echo "PASS  $*"; }; bad(){ echo "FAIL  $*"; FAILS=$((FAILS+1)); }
info(){ echo "INFO  $*"; }
finish(){ echo; if [ "$FAILS" = 0 ]; then echo "RESULT: $MODE OK"; exit 0; fi; echo "RESULT: $MODE $FAILS FAIL"; exit 1; }
abort(){ bad "$*"; echo "      (aborted: nothing after this point can be checked)"; finish; }
lc(){ tr 'A-F' 'a-f'; }
isnum(){ case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
WORK=$(mktemp -d "${TMPDIR:-/tmp}/check-roles.XXXXXX") || { echo "FAIL  mktemp"; exit 1; }
trap 'rm -rf "$WORK"' EXIT

Z=0x0000000000000000000000000000000000000000
# keccak256 of the role names / event signatures (OpenZeppelin 4.x TimelockController, as deployed by DeployEth.s.sol)
P=0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1   # PROPOSER_ROLE
E=0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63   # EXECUTOR_ROLE
C=0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783   # CANCELLER_ROLE
A=0x5f58e3a2316349923ce3780f8d587db2d72378aed66a8261c916544fa6846ca5   # TIMELOCK_ADMIN_ROLE
D=0x0000000000000000000000000000000000000000000000000000000000000000   # DEFAULT_ADMIN_ROLE (must stay empty)
T_GRANTED=0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d   # RoleGranted(bytes32,address,address)
T_REVOKED=0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b   # RoleRevoked(bytes32,address,address)
T_ADMINCHG=0xbd79b86ffe0ab8e8776151514217cd7cacd52c909f66475c3af44e129f0b00ff  # RoleAdminChanged(bytes32,bytes32,bytes32)
T_SCHEDULED=0x4cf4410cc57040e44862ef0f45f3dd5a5e02db8eb8add648d4b0e236f1d07dca # CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)
T_PAUSERSET=0xa11b5803b8a35081b8f993e0dee5bc30301a3d83f644e5ab2ff39f972f0a807f # PauserSet(address,bool)
rolename(){ case "$1" in $P) echo PROPOSER;; $E) echo EXECUTOR;; $C) echo CANCELLER;; $A) echo TIMELOCK_ADMIN;; $D) echo DEFAULT_ADMIN;; *) echo "role $1";; esac; }
label(){ local a; a=$(echo "$1" | lc)
  case "$a" in
    "$(echo "$TIMELOCK" | lc)") echo "$1 (timelock)";; "$(echo "$SAFE" | lc)") echo "$1 (Safe)";;
    "$(echo "$GUARDIAN" | lc)") echo "$1 (guardian)";; "$(echo "$DEPLOYER" | lc)") echo "$1 (DEPLOYER)";;
    "$(echo "$OLD_GUARDIAN" | lc)") echo "$1 (OLD GUARDIAN)";; "$Z") echo "$1 (address(0) = anyone)";; *) echo "$1";;
  esac; }
labels(){ local x out=""; for x in $1; do out="$out${out:+, }$(label "$x")"; done; echo "{${out}}"; }
norm_set(){ echo "$@" | tr ', ' '\n\n' | grep . | lc | sort -u | tr '\n' ' ' | sed 's/ $//'; }

# --- RPC helpers --------------------------------------------------------------------------------------------------
retry(){ # retry CMD...: up to LOG_RETRIES attempts; stdout of the successful attempt; last stderr kept in $WORK/err
  local i=1
  while :; do
    if "$@" 2>"$WORK/err"; then return 0; fi
    [ "$i" -ge "$LOG_RETRIES" ] && return 1
    i=$((i+1)); sleep "$LOG_RETRY_SLEEP"
  done; }
lasterr(){ tr '\n' ' ' < "$WORK/err" 2>/dev/null | cut -c1-300; }
TIP=""
call(){ cast call "$@" --block "$TIP" --rpc-url "$ETH_RPC"; }
call1(){ call "$@" | awk 'NR==1{print $1}'; }   # first token: drops cast's "[1.728e5]" annotation
eqa(){ [ "$(echo "$1" | lc)" = "$(echo "$2" | lc)" ]; }

# has_code ADDR BLOCK -> 0 code, 1 no code, 2 RPC error (historic code needs an archive LOGS_RPC)
has_code(){ local c; c=$(retry cast code "$1" --block "$2" --rpc-url "$LOGS_RPC") || return 2
  case "$c" in 0x) return 1 ;; 0x[0-9a-fA-F]*) return 0 ;; *) return 2 ;; esac; }

# deploy_block NAME ADDR [GIVEN] -> prints the creation block; nonzero + message on stderr when it cannot be proven
deploy_block(){ local name=$1 addr=$2 given=${3:-} lo hi mid r
  if [ -n "$given" ]; then
    isnum "$given" || { echo "$name deployment block '$given' is not a number" >&2; return 1; }
    has_code "$addr" "$given"; r=$?
    [ $r = 2 ] && { echo "$name: cannot read code at block $given (pruned/unavailable history: $(lasterr))" >&2; return 1; }
    [ $r = 1 ] && { echo "$name has no code at the given deployment block $given (block too early or wrong address)" >&2; return 1; }
    if [ "$given" -gt 0 ]; then has_code "$addr" $((given-1)); r=$?
      [ $r = 2 ] && { echo "$name: cannot read code at block $((given-1)) (pruned/unavailable history: $(lasterr))" >&2; return 1; }
      [ $r = 0 ] && { echo "$name already has code at block $((given-1)): the given deployment block $given is too late, earlier events would be missed" >&2; return 1; }
    fi
    echo "$given"; return 0
  fi
  has_code "$addr" "$TIP"; r=$?
  [ $r = 2 ] && { echo "$name: cannot read code at the tip ($(lasterr))" >&2; return 1; }
  [ $r = 1 ] && { echo "$name has no code at block $TIP" >&2; return 1; }
  lo=0; hi=$TIP   # invariant: code at hi; no code below lo
  while [ "$lo" -lt "$hi" ]; do mid=$(( (lo+hi)/2 ))
    has_code "$addr" "$mid"; r=$?
    [ $r = 2 ] && { echo "$name: binary search needs code at block $mid, RPC refused (pruned history? set LOGS_RPC to an archive node): $(lasterr)" >&2; return 1; }
    if [ $r = 0 ]; then hi=$mid; else lo=$((mid+1)); fi
  done
  echo "$lo"; }

PY=$(cat <<'PY'
import json, sys
def num(x): return int(x, 16) if isinstance(x, str) else int(x)
def a20(t): return "0x" + t[-40:].lower()
cmd = sys.argv[1]
if cmd == "chunk":   # chunk RAW FROM TO ADDR OUT: validate one cast-logs answer, then append its logs as JSON lines
    raw, frm, to, addr, out = sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5].lower(), sys.argv[6]
    try: d = json.load(open(raw))
    except Exception as e: sys.exit(f"not JSON: {e}")
    if isinstance(d, dict):
        if d.get("success") is True and isinstance(d.get("data"), list): d = d["data"]
        else: sys.exit("error answer: " + json.dumps(d.get("errors", d))[:300])
    if not isinstance(d, list): sys.exit("answer is not a log list")
    lines = []
    for l in d:
        try: b, i, ad, tp = num(l["blockNumber"]), num(l["logIndex"]), l["address"].lower(), l["topics"]
        except Exception as e: sys.exit(f"malformed log: {e}")
        if ad != addr: sys.exit(f"log from {ad}, asked for {addr}")
        if not frm <= b <= to: sys.exit(f"log at block {b} outside {frm}-{to}")
        if l.get("removed"): sys.exit(f"removed (reorged) log at block {b}")
        lines.append(json.dumps({"b": b, "i": i, "t": [x.lower() for x in tp], "d": l.get("data", "0x")}) + "\n")
    with open(out, "a") as f: f.writelines(lines)
    sys.exit(0)
logs = sorted((json.loads(x) for x in open(sys.argv[2]) if x.strip()), key=lambda l: (l["b"], l["i"]))
if cmd == "roles":   # roles JSONL GRANTED REVOKED -> "SEEN role addr" (ever named) and "HOLD role addr" (final state)
    g, r = sys.argv[3], sys.argv[4]; state = {}
    for l in logs:
        t = l["t"]
        if t and t[0] in (g, r):
            if len(t) < 3: sys.exit("malformed role event")
            state[(t[1], a20(t[2]))] = (t[0] == g)
    for (role, a), held in sorted(state.items()):
        print("SEEN", role, a)
        if held: print("HOLD", role, a)
elif cmd == "adminchg":   # adminchg JSONL TOPIC -> "role previousAdmin newAdmin block"
    for l in logs:
        t = l["t"]
        if t and t[0] == sys.argv[3]: print(t[1], t[2], t[3], l["b"])
elif cmd == "topic1":     # topic1 JSONL TOPIC -> unique topic[1]
    print("\n".join(sorted({l["t"][1] for l in logs if l["t"] and l["t"][0] == sys.argv[3] and len(l["t"]) > 1})))
elif cmd == "pausers":    # pausers JSONL TOPIC -> "SEEN addr" and "HOLD addr" from the last PauserSet per address
    st = {}
    for l in logs:
        t = l["t"]
        if t and t[0] == sys.argv[3]:
            if len(t) < 2: sys.exit("malformed PauserSet")
            st[a20(t[1])] = int(l["d"], 16) != 0
    for a, on in sorted(st.items()):
        print("SEEN", a)
        if on: print("HOLD", a)
PY
)
py(){ python3 -c "$PY" "$@"; }

# fetch_logs NAME ADDR FROM OUT: every log of ADDR in [FROM, TIP], LOG_CHUNK blocks per call, each chunk retried;
# one chunk that still fails = nonzero (the caller FAILs). Prints the number of chunks.
fetch_logs(){ local name=$1 addr=$2 a=$3 out=$4 b n=0 why i
  : > "$out"
  { isnum "$LOG_CHUNK" && [ "$LOG_CHUNK" -gt 0 ]; } || { echo "LOG_CHUNK must be a positive integer" >&2; return 1; }
  while [ "$a" -le "$TIP" ]; do
    b=$((a + LOG_CHUNK - 1)); [ "$b" -gt "$TIP" ] && b=$TIP
    i=1
    while :; do
      why=""
      if cast logs --json --from-block "$a" --to-block "$b" --address "$addr" --rpc-url "$LOGS_RPC" >"$WORK/chunk" 2>"$WORK/err"; then
        why=$(py chunk "$WORK/chunk" "$a" "$b" "$addr" "$out" 2>&1) && break
      else why="$(lasterr) $(head -c 300 "$WORK/chunk" 2>/dev/null)"; fi
      if [ "$i" -ge "$LOG_RETRIES" ]; then echo "$name logs: chunk $a-$b failed after $LOG_RETRIES attempt(s): $why" >&2; return 1; fi
      i=$((i+1)); sleep "$LOG_RETRY_SLEEP"
    done
    n=$((n+1)); a=$((b+1))
  done
  echo "$n"; }

# --- snapshot block -----------------------------------------------------------------------------------------------
t1=$(retry cast block-number --rpc-url "$ETH_RPC") || abort "ETH_RPC block number unavailable: $(lasterr)"
t2=$(retry cast block-number --rpc-url "$LOGS_RPC") || abort "LOGS_RPC block number unavailable: $(lasterr)"
{ isnum "$t1" && isnum "$t2"; } || abort "block number is not a number ($t1 / $t2)"
TIP=$t1; [ "$t2" -lt "$TIP" ] && TIP=$t2
CHAIN=$(retry cast chain-id --rpc-url "$ETH_RPC") || abort "chain id unavailable: $(lasterr)"
info "chain $CHAIN, snapshot block $TIP (calls pinned to it, logs scanned up to it)"

gate_2b() {
  echo "== step 2B: timelock roles (exact holder sets from events) and delay"
  local x y
  for x in "$SAFE" "$GUARDIAN"; do
    for y in "$DEPLOYER" "$OLD_GUARDIAN" "$Z" "$TIMELOCK"; do
      eqa "$x" "$y" && bad "configuration: $(label "$x") equals $(label "$y")"; done; done

  # minimum delay
  local exp got
  if [ -n "${EXPECT_MIN_DELAY:-}" ]; then exp=$EXPECT_MIN_DELAY
  elif [ "$CHAIN" = 1 ]; then exp=172800
  elif [ "$CHAIN" = 11155111 ]; then exp=300
  else exp=""; bad "chain $CHAIN: no default minimum delay, set EXPECT_MIN_DELAY"; fi
  if [ -n "$exp" ]; then
    if ! isnum "$exp"; then bad "EXPECT_MIN_DELAY '$exp' is not a number"
    else
      [ "$CHAIN" = 1 ] && [ "$exp" -lt 172800 ] && bad "mainnet: expected delay $exp s is below 48 h (172800 s)"
      got=$(call1 "$TIMELOCK" "getMinDelay()(uint256)")
      if [ "$got" = "$exp" ]; then ok "timelock minDelay = $got s (expected $exp)"
      elif [ "$got" = 0 ]; then bad "timelock minDelay is 0: every operation can run immediately (expected $exp)"
      else bad "timelock minDelay = ${got:-<no answer>} s (expected $exp)"; fi
    fi
  fi

  # role history
  local blk nch
  if ! blk=$(deploy_block timelock "$TIMELOCK" "$TIMELOCK_DEPLOY_BLOCK" 2>"$WORK/why"); then
    bad "timelock deployment block unknown: $(cat "$WORK/why") -> role holders cannot be reconstructed"; return; fi
  info "timelock deployment block $blk ($([ -n "$TIMELOCK_DEPLOY_BLOCK" ] && echo "given, verified by code size" || echo "found by code-size binary search"))"
  if ! nch=$(fetch_logs timelock "$TIMELOCK" "$blk" "$WORK/tl.jsonl" 2>"$WORK/why"); then
    bad "timelock event history incomplete: $(cat "$WORK/why") -> role holders cannot be reconstructed"; return; fi
  info "timelock logs $blk-$TIP: $(grep -c . "$WORK/tl.jsonl") events in $nch chunk(s) of <= $LOG_CHUNK blocks"

  # anchor: the constructor's RoleAdminChanged events must be in the scanned history, and no role admin may differ
  local adm role prev new b anchors=0 r
  if ! adm=$(py adminchg "$WORK/tl.jsonl" "$T_ADMINCHG"); then bad "cannot parse RoleAdminChanged events"; return; fi
  while read -r role prev new b; do [ -z "${role:-}" ] && continue
    if [ "$new" = "$A" ] && [ "$b" = "$blk" ]; then case "$role" in $A|$P|$E|$C) anchors=$((anchors+1));; esac
    else bad "role admin of $(rolename "$role") changed to $(rolename "$new") at block $b"; fi
  done <<<"$adm"
  [ "$anchors" = 4 ] && ok "constructor role admins found at block $blk (history starts at the deployment)" \
    || bad "constructor RoleAdminChanged events: $anchors of 4 at block $blk -> history does not start at the deployment"

  local ev
  if ! ev=$(py roles "$WORK/tl.jsonl" "$T_GRANTED" "$T_REVOKED"); then bad "cannot parse RoleGranted/RoleRevoked events"; return; fi
  echo "$ev" | awk '$1=="HOLD"{print $2, $3}' > "$WORK/hold"
  echo "$ev" | awk '$1=="SEEN"{print $2, $3}' > "$WORK/seen"
  grep -q "^$A $(echo "$TIMELOCK" | lc)$" "$WORK/seen" || bad "no RoleGranted of TIMELOCK_ADMIN to the timelock in the history -> history incomplete"

  # cross-check: events vs hasRole at the snapshot, for every role seen plus the five known ones
  local roles cand a want gotr mism=0 nchk=0
  roles=$(norm_set "$P $E $C $A $D $(awk '{print $1}' "$WORK/seen")")
  for role in $roles; do
    cand=$(norm_set "$(awk -v r="$role" '$1==r{print $2}' "$WORK/seen") $DEPLOYER $OLD_GUARDIAN $SAFE $GUARDIAN $TIMELOCK $Z")
    for a in $cand; do
      grep -q "^$role $a$" "$WORK/hold" && want=true || want=false
      gotr=$(call "$TIMELOCK" "hasRole(bytes32,address)(bool)" "$role" "$a"); nchk=$((nchk+1))
      [ "$gotr" = "$want" ] || { mism=$((mism+1)); bad "hasRole($(rolename "$role"), $(label "$a")) = ${gotr:-<no answer>} but the events say $want -> history incomplete or RPC error"; }
    done
  done
  [ "$mism" = 0 ] && ok "events agree with hasRole() for all $nchk (role, address) pairs"

  # exact sets
  local want_set have_set
  for x in "PROPOSER $P $SAFE" "EXECUTOR $E $SAFE" "CANCELLER $C $SAFE,$GUARDIAN" "TIMELOCK_ADMIN $A $TIMELOCK" "DEFAULT_ADMIN $D -"; do
    set -- $x; want_set=$(norm_set "$(echo "$3" | sed 's/^-$//')")
    have_set=$(norm_set "$(awk -v r="$2" '$1==r{print $2}' "$WORK/hold")")
    if [ "$have_set" = "$want_set" ]; then ok "$1 holders = $(labels "$have_set")"
    else bad "$1 holders = $(labels "$have_set"), expected exactly $(labels "$want_set")"
      for a in $have_set; do case " $want_set " in *" $a "*) ;; *) echo "      extra:   $(label "$a")";; esac; done
      for a in $want_set; do case " $have_set " in *" $a "*) ;; *) echo "      missing: $(label "$a")";; esac; done
    fi
  done
  for role in $(awk '{print $1}' "$WORK/hold" | sort -u); do case "$role" in $P|$E|$C|$A|$D) continue;; esac
    bad "unexpected $(rolename "$role") held by $(labels "$(awk -v r="$role" '$1==r{print $2}' "$WORK/hold")")"; done

  # every CallScheduled id that is neither done nor cancelled is still pending
  local ids pending=0 id
  ids=$(py topic1 "$WORK/tl.jsonl" "$T_SCHEDULED") || { bad "cannot parse CallScheduled events"; return; }
  info "scheduled operations since block $blk: $(echo "$ids" | grep -c .)"
  for id in $ids; do r=$(call "$TIMELOCK" "isOperationPending(bytes32)(bool)" "$id")
    case "$r" in false) ;; true) echo "      pending: $id"; pending=$((pending+1));; *) echo "      unreadable: $id"; pending=$((pending+1));; esac; done
  [ "$pending" = 0 ] && ok "no timelock operation pending" || bad "$pending timelock operation(s) pending or unreadable (listed above; check each)"
}

safe_check() { # $1 name, $2 safe, $3 owners csv, $4 threshold
  local o; o=$(call "$2" "getOwners()(address[])" | lc | tr -d '[] ' | tr ',' '\n' | sort | paste -sd, -)
  local want; want=$(echo "$3" | lc | tr -d ' ' | tr ',' '\n' | sort | paste -sd, -)
  [ "$o" = "$want" ] && ok "$1 owners" || bad "$1 owners: $o (expected $want)"
  local th; th=$(call1 "$2" "getThreshold()(uint256)")
  [ "$th" = "$4" ] && ok "$1 threshold $4" || bad "$1 threshold $th (expected $4)"
  local mods; mods=$(call "$2" "getModulesPaginated(address,uint256)(address[],address)" 0x0000000000000000000000000000000000000001 10 | head -1)
  [ "$mods" = "[]" ] && ok "$1 has no modules" || bad "$1 modules: $mods"
  local g; g=$(cast storage "$2" 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8 --block "$TIP" --rpc-url "$ETH_RPC")
  [ "$(cast to-dec "$g" 2>/dev/null)" = 0 ] && ok "$1 has no guard" || bad "$1 guard set: $g"
}

gate_full() {
  : "${PAUSER:?}" "${PAUSERS?}" "${ROUTER:?}" "${PROXY_ADMIN:?}" "${FEE_HOOK:?}" "${RATE_ISM:?}" "${PAUSE_ISM:?}" "${PAUSE_HOOK:?}"
  : "${PRICE_UPDATER:?}" "${BENEFICIARY:?}" "${TREASURY:?}" "${SAFE_OWNERS:?}" "${SAFE_THRESHOLD:?}"
  gate_2b
  echo "== full migration"
  eqa "$(call "$PAUSER" "guardian()(address)")" "$GUARDIAN" && ok "guardian = expected" || bad "guardian = $(call "$PAUSER" "guardian()(address)")"
  eqa "$(call "$PAUSER" "pendingGuardian()(address)")" "$Z" && ok "no pending guardian" || bad "pendingGuardian = $(call "$PAUSER" "pendingGuardian()(address)")"
  # pausers: isPauser is a mapping; the exact set is reconstructed from PauserSet events since the pauser's deployment
  local blk ev hold want a got w mism=0
  if ! blk=$(deploy_block pauser "$PAUSER" "${PAUSER_DEPLOY_BLOCK:-}" 2>"$WORK/why"); then
    bad "pauser deployment block unknown: $(cat "$WORK/why") -> pausers cannot be reconstructed"
  elif ! fetch_logs pauser "$PAUSER" "$blk" "$WORK/p.jsonl" >/dev/null 2>"$WORK/why"; then
    bad "pauser event history incomplete: $(cat "$WORK/why") -> pausers cannot be reconstructed"
  elif ! ev=$(py pausers "$WORK/p.jsonl" "$T_PAUSERSET"); then bad "cannot parse PauserSet events"
  else
    info "pauser deployment block $blk; addresses in PauserSet events: $(echo "$ev" | grep -c '^SEEN')"
    hold=$(norm_set "$(echo "$ev" | awk '$1=="HOLD"{print $2}')"); want=$(norm_set "$PAUSERS")
    for a in $(norm_set "$(echo "$ev" | awk '$1=="SEEN"{print $2}') $want $DEPLOYER $OLD_GUARDIAN"); do
      case " $hold " in *" $a "*) w=true;; *) w=false;; esac
      got=$(call "$PAUSER" "isPauser(address)(bool)" "$a")
      [ "$got" = "$w" ] || { mism=$((mism+1)); bad "isPauser($(label "$a")) = ${got:-<no answer>} but the events say $w -> history incomplete"; }
    done
    [ "$mism" = 0 ] && ok "PauserSet events agree with isPauser()"
    [ "$hold" = "$want" ] && ok "pausers = $(labels "$hold")" || bad "pausers = $(labels "$hold"), expected exactly $(labels "$want")"
  fi
  eqa "$(call "$FEE_HOOK" "priceUpdater()(address)")" "$PRICE_UPDATER" && ok "fee hook price updater = expected" || bad "fee hook price updater = $(call "$FEE_HOOK" "priceUpdater()(address)")"
  for x in "fee hook beneficiary|$FEE_HOOK|beneficiary()(address)|$BENEFICIARY" "router treasury|$ROUTER|treasury()(address)|$TREASURY"; do
    IFS='|' read -r n c s w <<<"$x"; v=$(call "$c" "$s")
    eqa "$v" "$w" && ok "$n = expected" || bad "$n = $v (expected $w)"
    eqa "$v" "$DEPLOYER" && bad "$n is the deployer"
  done
  for x in "router|$ROUTER|$TIMELOCK" "proxy admin|$PROXY_ADMIN|$TIMELOCK" "fee hook|$FEE_HOOK|$TIMELOCK" "rate ISM|$RATE_ISM|$TIMELOCK" "pause ISM|$PAUSE_ISM|$PAUSER" "pause hook|$PAUSE_HOOK|$PAUSER"; do
    IFS='|' read -r n c w <<<"$x"; v=$(call "$c" "owner()(address)")
    eqa "$v" "$w" && ok "$n owner" || bad "$n owner = $v (expected $w)"
  done
  safe_check "admin Safe" "$SAFE" "$SAFE_OWNERS" "$SAFE_THRESHOLD"
  [ -n "${NESTED_SAFE:-}" ] && safe_check "nested Safe" "$NESTED_SAFE" "${NESTED_OWNERS:?}" "${NESTED_THRESHOLD:?}"
  if [ -n "${X1_RPC:-}" ]; then
    echo "== X1 authorities (check-x1.mjs --mainnet --deployer)"
    # shellcheck disable=SC2086
    node "$(dirname "$0")/../../svm/compat/check-x1.mjs" --rpc "$X1_RPC" --post-deploy --mint "${X1_MINT:?}" --program "${X1_PROGRAM:?}" \
      --mailbox "${X1_MAILBOX:?}" --mainnet --deployer "${X1_DEPLOYER:?}" ${X1_CHECK_ARGS:-} | grep -E "^(FAIL|PASS)  .*(authority|owner|deployer)" \
      && true; [ "${PIPESTATUS[0]}" = 0 ] && ok "X1 authorities" || bad "X1 authorities (see FAIL lines above)"
  else info "X1_RPC not set: X1 authorities not checked"; fi
}

case "$MODE" in 2b) gate_2b ;; full) gate_full ;; esac
finish
