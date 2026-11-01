#!/usr/bin/env bash
# Timer target: if the collateral monitor reports a FRESHLY CONFIRMED CRITICAL, stop the bridge.
# CRITICAL comes only from evidence matched by message ID or a mint change (round C, docs/16-auto-pause-model.md).
# Uses a dedicated PAUSER key (Foundry keystore). That key can ONLY call EmergencyPauser.pauseAll.
#   env: METRICS_URL (default http://127.0.0.1:9465/metrics), ETH_RPC, PAUSER (EmergencyPauser address),
#        ETH_RPC2 (second, independent RPC: required to SKIP a send because the bridge is already paused; R11-02)
#        PAUSER_ACCOUNT (keystore name) or PAUSER_KEYSTORE (path of the keystore file; for a systemd unit with ProtectHome),
#        ETH_KEYSTORE_PASSWORD_FILE (default: $CREDENTIALS_DIRECTORY/pauser-pass, i.e. systemd LoadCredential=pauser-pass:...),
#        PAUSE_ISM, PAUSE_HOOK (verification after the call; MANDATORY, missing = exit 2),
#        DRY_RUN=1 (default): only log what would be done; DRY_RUN=0 sends pauseAll
#        MAX_RESULT_AGE (s, 120): the last FINISHED tick must be this recent, and the CRITICAL must come from it (R5-04)
#        MAX_UNKNOWN (s, 600): coverage unknown for longer -> ALERT line (a human looks; no automatic pause)
#        SEND_TRIES (3 broadcast attempts per run), SEND_TIMEOUT (90 s: signing/broadcast limit and receipt wait per run),
#        CHECK_TIMEOUT (20 s per read), CONFIRM_TIMEOUT (120 s), CONFIRM_INTERVAL (5 s, also the poll/retry interval)
#        AP_STATE_DIR (default ${STATE_DIRECTORY:-/var/lib/vmpx-autopause}; systemd StateDirectory=vmpx-autopause)
#        CONFIRMATIONS (2): receipt block depth before the receipt counts
#        REPLACE_AFTER (180 s): an unmined tx signed longer ago is replaced (same nonce, both fees >= +25%)
#        MAX_FEE_CAP (wei, 300 gwei), PRIORITY_FEE_MIN (wei, 1 gwei), PAUSE_GAS_LIMIT (optional, else estimated)
#        HEAD_MAX_AGE (30 s): a head older than this (local clock) is stale; HEAD_MAX_SKEW (3 blocks) between the RPCs
# R5-07: pauseAll() is sent FIRST; the diagnosis (are both directions paused?) comes after it, with its own time limit.
# Pause drill 1 Nov 2026: the diagnosis reads both flags AT THE BLOCK OF THE RECEIPT (`cast call --block N`); a node
# that does not have that block yet (or any RPC error) is "not answered yet", never "not paused".
# R10-01: a send that timed out may still be mined. The tx is signed WITHOUT broadcasting (`cast mktx`, explicit nonce
# and fees); its hash and raw bytes go to pending.json (tmp + rename) BEFORE the broadcast. Every later run settles
# that record first: a receipt of any recorded hash, else the same raw tx again or, after REPLACE_AFTER, a replacement
# of the SAME nonce. A new nonce only after the record is settled. Timeout = result UNKNOWN, never "failed".
# A receipt counts only with a block number, CONFIRMATIONS deep, its block hash canonical (`cast block N --field hash`).
# Incident = crit-<vmpx_bridge_last_critical_timestamp>; a settled successful pauseAll is kept in done/<incident>.json.
# R11-01: pending.json is bound to signer (from), chain ID, PAUSER and calldata, checked against the decoded raw tx when
# written and against the live configuration before any rebroadcast or replacement; a mismatch stops (ALERT UNKNOWN).
# R11-02: "already paused" counts only at fresh (HEAD_MAX_AGE), agreeing (HEAD_MAX_SKEW) heads of ETH_RPC and ETH_RPC2,
# flags read at each RPC's own head; any doubt = send (pauseAll is idempotent). The state after the pause likewise.
# R11-05: the raw tx never goes to argv: stdin of the state helper and `cast keccak`, broadcast by curl from a 0600 file.
set -uo pipefail
umask 077
ts() { date -u +%FT%TZ; }
# round D: both verification targets are mandatory (a pause that cannot be verified must not look successful)
for v in PAUSE_ISM PAUSE_HOOK; do
  [ -n "${!v:-}" ] || { echo "$(ts) ALERT $v not set: configuration error, auto-pause not running"; exit 2; }
done
SD="${AP_STATE_DIR:-${STATE_DIRECTORY:-/var/lib/vmpx-autopause}}"; P="$SD/pending.json"
CT="${CHECK_TIMEOUT:-20}"; STO="${SEND_TIMEOUT:-90}"; CI="${CONFIRM_INTERVAL:-5}"; TRIES="${SEND_TRIES:-3}"
cr() { timeout "$2" cast "$3" --rpc-url "$1" "${@:4}"; }                         # cast <cmd> at RPC $1, time limit $2
c() { cr "$ETH_RPC" "$@"; }                                                       # ... at ETH_RPC
clean() { tail -1 | sed -E 's/0x[0-9a-fA-F]{80,}/0x<raw>/g' | cut -c1-200; }      # never log a raw signed tx
lc() { tr 'A-F' 'a-f' <<<"$1"; }
MSG() { echo "auto: collateral evidence CRITICAL $1"; }

# state helper (python3 -c, JSON, tmp + fsync + rename). The raw tx comes ONLY on stdin (new, add) and leaves only
# into a 0600 JSON-RPC body file (body); it is never printed. new/add decode the raw tx (EIP-1559) and refuse it unless
# chain ID, nonce, to, calldata and fees equal the record.
ST_PY=$(cat <<'PY'
import json, os, sys, time
sd, op, a = sys.argv[1], sys.argv[2], sys.argv[3:]
p = os.path.join(sd, "pending.json")
def save(path, d):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.tmp.%d" % (path, os.getpid())
    with open(tmp, "w") as f:
        json.dump(d, f); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(os.path.dirname(path), os.O_RDONLY); os.fsync(fd); os.close(fd)
def load(): return json.load(open(p))
def rlp(b, i):
    x = b[i]
    if x < 0x80: return b[i:i + 1], i + 1
    if x < 0xb8: s, l = i + 1, x - 0x80
    elif x < 0xc0: n = x - 0xb7; s, l = i + 1 + n, int.from_bytes(b[i + 1:i + 1 + n], "big")
    elif x < 0xf8: s, l = i + 1, x - 0xc0
    else: n = x - 0xf7; s, l = i + 1 + n, int.from_bytes(b[i + 1:i + 1 + n], "big")
    return (b[s:s + l] if x < 0xc0 else ("L", b[s:s + l])), s + l
def decode(raw):        # type-2 tx -> chain, nonce, prio, max_fee, to, data
    b = bytes.fromhex(raw[2:] if raw.startswith("0x") else raw)
    if not b or b[0] != 2: raise ValueError("not an EIP-1559 tx")
    lst, _ = rlp(b, 1); body, i, f = lst[1], 0, []
    while i < len(body) and len(f) < 8: v, i = rlp(body, i); f.append(v)
    n = lambda v: int.from_bytes(v, "big")
    return {"chain_id": n(f[0]), "nonce": n(f[1]), "prio": n(f[2]), "max_fee": n(f[3]), "to": "0x" + f[5].hex(), "call": "0x" + f[7].hex()}
def check(raw, want):
    d = decode(raw)
    bad = [k for k in want if str(d[k]).lower() != str(want[k]).lower()]
    if bad: sys.exit("raw tx does not match the record: " + ",".join(bad))
def tx(h, raw, mf, pr): return {"hash": h, "raw": raw, "max_fee": int(mf), "prio": int(pr), "signed_at": int(time.time())}
if op == "new":     # incident from nonce hash max_fee prio chain_id pauser call  (raw on stdin)
    inc, frm, n, h, mf, pr, cid, pa, call = a; raw = sys.stdin.read().strip()
    check(raw, {"chain_id": cid, "nonce": n, "to": pa, "call": call, "max_fee": mf, "prio": pr})
    save(p, {"v": 2, "incident": inc, "from": frm, "nonce": int(n), "chain_id": int(cid), "pauser": pa.lower(), "call": call.lower(),
             "first_sent_at": int(time.time()), "txs": [tx(h, raw, mf, pr)], "aliases": []})
elif op == "add":   # hash max_fee prio (raw on stdin): replacement of the same nonce
    h, mf, pr = a; raw = sys.stdin.read().strip(); d = load()
    check(raw, {"chain_id": d["chain_id"], "nonce": d["nonce"], "to": d["pauser"], "call": d["call"], "max_fee": mf, "prio": pr})
    d["txs"].append(tx(h, raw, mf, pr)); save(p, d)
elif op == "alias": # a tx hash reported by the RPC for one of our raw txs (looked up for receipts too)
    d = load(); d.setdefault("aliases", []).append(a[0]); save(p, d)
elif op == "get":   # line 1: incident from nonce first age last max_fee prio chain_id pauser bound; line 2 call; line 3 hashes
    d = load(); t = d["txs"][-1]
    try: raw = decode(t["raw"])
    except Exception: raw = {}
    bound = int(all(k in d for k in ("chain_id", "pauser", "call")))
    print(d["incident"], d["from"], d["nonce"], d["first_sent_at"], int(time.time()) - t["signed_at"], t["hash"], t["max_fee"], t["prio"],
          d.get("chain_id", raw.get("chain_id", "?")), d.get("pauser", raw.get("to", "?")), bound)
    print(d.get("call", raw.get("call", "?")))
    print(" ".join([x["hash"] for x in d["txs"]] + d.get("aliases", [])))
elif op == "body":  # hash path: JSON-RPC eth_sendRawTransaction body for that raw tx, mode 0600
    raw = next(x["raw"] for x in load()["txs"] if x["hash"] == a[0])
    if os.path.exists(a[1]): os.remove(a[1])
    fd = os.open(a[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f: json.dump({"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": [raw]}, f)
elif op == "close": # ok|failed tx block status: archive the record to history/; ok also writes done/<incident>.json
    out, h, b, s = a; d = load(); d.update(outcome=out, tx=h, block=int(b), status=s, closed_at=int(time.time()))
    if out == "ok":
        save(os.path.join(sd, "done", d["incident"] + ".json"), {k: d[k] for k in ("incident", "nonce", "tx", "block", "status", "closed_at")})
    save(os.path.join(sd, "history", "%s-n%d-%s.json" % (d["incident"], d["nonce"], out)), d)
    os.remove(p)
elif op == "done":  # incident -> tx of its settled successful pauseAll, if any
    f = os.path.join(sd, "done", a[0] + ".json")
    if os.path.exists(f): print(json.load(open(f))["tx"])
PY
)
st() { python3 -c "$ST_PY" "$SD" "$@"; }
# fees: base prio old_max_fee old_prio -> "max_fee prio" (market 2*base+prio; a replacement >= +25% on both), or "cap"
FEES_PY='
import sys
base, prio, old_mf, old_pr, pmin, cap = (int(str(x).strip().strip("\"") or "0", 0) for x in sys.argv[1:7])
pr = max(prio, pmin); mf = 2 * base + pr
if old_mf:
    pr = max(pr, -(-old_pr * 125 // 100)); mf = max(mf, -(-old_mf * 125 // 100), pr)
    if mf > cap: print("cap"); sys.exit()
pr = min(pr, cap); print(min(max(mf, pr), cap), pr)'
fees() { python3 -c "$FEES_PY" "$@" "${PRIORITY_FEE_MIN:-1000000000}" "${MAX_FEE_CAP:-300000000000}"; }
# JSON from cast (plain, or the newer {"schema_version":..,"data":..} envelope) -> requested fields, "-" if missing
J_PY='
import json, sys
try: d = json.loads(sys.stdin.read())
except Exception: d = None
if isinstance(d, dict) and "schema_version" in d: d = d.get("data")
if not isinstance(d, dict): print("none"); sys.exit()
out = []
for k in sys.argv[1:]:
    v = d.get(k)
    if k in ("number", "timestamp", "blockNumber"):
        try: v = int(v, 0) if isinstance(v, str) else int(v)
        except Exception: v = None
    out.append("-" if v is None or v == "" else str(v))
print(" ".join(out))'
j() { python3 -c "$J_PY" "$@"; }
# sign pauseAll for nonce $1 with fees $2 $3, no broadcast; raw tx on stdout (a pipe), error text in $SD/.err
sign() {
  local g=(); [ -n "${PAUSE_GAS_LIMIT:-}" ] && g=(--gas-limit "$PAUSE_GAS_LIMIT")
  c "$STO" mktx "$PAUSER" "pauseAll(string)" "$(MSG "$INC")" --nonce "$1" \
    --gas-price "$2" --priority-gas-price "$3" ${g[@]+"${g[@]}"} "${KEY[@]}" --password-file "$PWF" 2>"$SD/.err" | tail -1
}
txhash() { local h; h=$(printf '%s' "$1" | cast keccak 2>/dev/null) && [[ "$h" =~ ^0x[0-9a-fA-F]{64}$ ]] && echo "$h"; }   # stdin, not argv
signer() { timeout "$STO" cast wallet address "${KEY[@]}" --password-file "$PWF" 2>/dev/null | tail -1; }
# broadcast the recorded raw tx of hash $1 (TRIES attempts) by eth_sendRawTransaction; 0 = the RPC accepted it
publish() {
  local h=$1 extra=${2:-} out res r i body="$SD/.send.json"
  for i in $(seq 1 "$TRIES"); do
    st body "$h" "$body" || return 1
    out=$(curl -sS --max-time "$STO" -H 'Content-Type: application/json' --data-binary @"$body" "$ETH_RPC" 2>&1)
    rm -f "$body"
    res=$(python3 -c '
import json, sys
try: d = json.loads(sys.stdin.read())
except Exception: print("err not a JSON-RPC answer"); sys.exit()
r, e = d.get("result"), d.get("error") or {}
m = str(e.get("message", "")) if isinstance(e, dict) else str(e)
if isinstance(r, str) and r.startswith("0x"): print("ok", r)
elif "already known" in m.lower() or "known transaction" in m.lower(): print("known")
else: print("err", m.replace("\n", " ")[:160])' <<<"$out")
    case "$res" in
      ok\ *) r=${res#ok }
             if [ "$(lc "$r")" != "$(lc "$h")" ]; then st alias "$r"; HASHES="$HASHES $r"; extra="$extra rpc_tx=$r"; fi
             echo "$(ts) pauseAll broadcast incident=$INC tx=$h nonce=$NONCE$extra"; return 0 ;;
      known) echo "$(ts) pauseAll broadcast incident=$INC tx=$h nonce=$NONCE$extra rpc=already-known"; return 0 ;;
    esac
    echo "$(ts) broadcast attempt $i failed incident=$INC tx=$h: $(clean <<<"${res#err }")"
    [ "$i" -lt "$TRIES" ] && sleep "$CI"
  done
  return 1
}
# pause flags at block $2 on RPC $1 -> "unlocks deposits" (true|false|?)
flags() {
  local u d
  u=$(cr "$1" "$CT" call "$PAUSE_ISM" 'paused()(bool)' --block "$2" 2>/dev/null || echo '?')
  d=$(cr "$1" "$CT" call "$PAUSE_HOOK" 'paused()(bool)' --block "$2" 2>/dev/null || echo '?')
  case "$u" in true|false) ;; *) u='?' ;; esac; case "$d" in true|false) ;; *) d='?' ;; esac
  echo "$u $d"
}
# state at latest (R11-02): each RPC's own head must be fresh (HEAD_MAX_AGE) and >= $1, heads within HEAD_MAX_SKEW,
# flags read at that head, all RPCs agreeing. Prints "paused|open <detail>" or "unknown <reason>".
# $2 = need2: a second, different RPC (ETH_RPC2) is required.
state() {
  local min=$1 rpcs=("$ETH_RPC") i=0 r n t u d s all='' det='' first=''
  if [ -n "${ETH_RPC2:-}" ] && [ "${ETH_RPC2}" != "$ETH_RPC" ]; then rpcs+=("$ETH_RPC2")
  elif [ "${2:-}" = need2 ]; then echo "unknown ETH_RPC2 not set or equal to ETH_RPC (one RPC only)"; return; fi
  for r in "${rpcs[@]}"; do
    i=$((i + 1))
    read -r n t <<<"$(cr "$r" "$CT" block latest --json 2>/dev/null | j number timestamp)"
    { [[ "$n" =~ ^[0-9]+$ ]] && [[ "${t:-}" =~ ^[0-9]+$ ]]; } || { echo "unknown rpc$i head not read"; return; }
    [ $(( $(date +%s) - t )) -le "${HEAD_MAX_AGE:-30}" ] || { echo "unknown rpc$i head $n stale ($(( $(date +%s) - t ))s old)"; return; }
    [ "$n" -ge "$min" ] || { echo "unknown rpc$i head $n below block $min"; return; }
    if [ -z "$first" ]; then first=$n
    elif [ $(( n > first ? n - first : first - n )) -gt "${HEAD_MAX_SKEW:-3}" ]; then echo "unknown heads disagree ($first vs $n)"; return; fi
    read -r u d <<<"$(flags "$r" "$n")"
    { [ "$u" = '?' ] || [ "$d" = '?' ]; } && { echo "unknown rpc$i flags unreadable at head $n"; return; }
    if [ "$u" = true ] && [ "$d" = true ]; then s=paused; else s=open; fi
    [ -n "$all" ] && [ "$all" != "$s" ] && { echo "unknown RPCs disagree:$det rpc$i=$n:$u/$d"; return; }
    all=$s; det="$det rpc$i=$n:$u/$d"
  done
  echo "$all latest=$first heads=$(tr ' ' ',' <<<"${det# }")"
}
# after a settled status-1 receipt at block $1 of tx $2: "executed in block N", then the state at a fresh latest
diagnose() {
  local B=$1 H=$2 u d s deadline
  deadline=$(( $(date +%s) + ${CONFIRM_TIMEOUT:-120} ))
  while :; do
    read -r u d <<<"$(flags "$ETH_RPC" "$B")"
    echo "$(ts) after pauseAll (block $B): unlocks_paused=$u deposits_paused=$d incident=$INC"
    [ "$u" = true ] && [ "$d" = true ] && break
    [ "$(date +%s)" -ge "$deadline" ] && { echo "$(ts) ALERT pause not confirmed incident=$INC tx=$H block=$B unlocks=$u deposits=$d within ${CONFIRM_TIMEOUT:-120}s: the pause may still have worked, check by hand now"; exit 1; }
    echo "$(ts) not confirmed yet (RPC behind or answers disagree), reading again"
    sleep "$CI"
  done
  echo "$(ts) pause executed in block $B incident=$INC tx=$H"
  while :; do
    s=$(state "$B")
    case "$s" in
      paused\ *) echo "$(ts) bridge paused in both directions incident=$INC tx=$H ${s#paused }"; exit 0 ;;
      open\ *) echo "$(ts) bridge no longer paused at latest incident=$INC tx=$H ${s#open }: unpaused after block $B, not a failure of the pause"; exit 0 ;;
    esac
    [ "$(date +%s)" -ge "$deadline" ] && { echo "$(ts) ALERT pause not confirmed incident=$INC tx=$H executed in block $B, current state at latest unknown (${s#unknown }): the pause may still have worked, check by hand now"; exit 1; }
    sleep "$CI"
  done
}
# one receipt check of hash $1: 0 = settled (legacy tx line, then "block status"), 1 = no receipt, 2 = not settled (reason on fd 3)
settled() {
  local h=$1 L r bn bh s canon
  L=$(c "$CT" block-number 2>/dev/null)          # read BEFORE the receipt: the canonical check below is at this depth
  r=$(c "$CT" receipt "$h" --async --json 2>/dev/null) || return 1
  read -r bn bh s <<<"$(j blockNumber blockHash status <<<"$r")"
  [ "$bn" = none ] && return 1
  [ "$bn" = - ] && { echo "no-block-number" >&3; return 2; }        # never fall back to `latest`
  case "$s" in 0x1|1|0x0|0) ;; *) echo "status-$s" >&3; return 2 ;; esac
  [[ "$L" =~ ^[0-9]+$ ]] || { echo "block-number-unreadable" >&3; return 2; }
  [ $(( L - bn + 1 )) -ge "${CONFIRMATIONS:-2}" ] || { echo "confirmations=$(( L - bn + 1 ))/${CONFIRMATIONS:-2}" >&3; return 2; }
  canon=$(c "$CT" block "$bn" --field hash 2>/dev/null) || { echo "block-$bn-unreadable" >&3; return 2; }
  [ "$canon" = "$bh" ] || { echo "not-canonical blockhash=$bh canonical=$canon" >&3; return 2; }
  echo "$(ts) pauseAll tx $h status $s block $bn incident=$INC blockhash=$bh"
  echo "$bn $s"
}
seen() { local h; for h in $HASHES; do settled "$h" 3>/dev/null >/dev/null; [ $? != 1 ] && return 0; done; return 1; }
# wait up to SEND_TIMEOUT for a recorded hash to settle; settles the record, or exits with UNKNOWN
await() {
  local deadline h out rc why last='' n s
  deadline=$(( $(date +%s) + STO ))
  while :; do
    for h in $HASHES; do
      out=$(settled "$h" 3>"$SD/.why"); rc=$?
      if [ $rc = 0 ]; then
        sed '$d' <<<"$out"; read -r n s <<<"$(tail -1 <<<"$out")"
        case "$s" in
          0x1|1) st close ok "$h" "$n" "$s" || echo "$(ts) done record not written incident=$INC (pending record may remain)"
                 diagnose "$n" "$h" ;;
          *) st close failed "$h" "$n" "$s"
             echo "$(ts) ALERT pauseAll FAILED incident=$INC tx=$h nonce=$NONCE status=$s block=$n (nonce consumed, a new attempt uses the next nonce): pause by hand now"; exit 1 ;;
        esac
      fi
      if [ $rc = 2 ]; then why=$(cat "$SD/.why"); [ "$h $why" != "$last" ] && echo "$(ts) pauseAll receipt not settled yet incident=$INC tx=$h reason=$why"; last="$h $why"; fi
    done
    [ "$(date +%s)" -ge "$deadline" ] && break
    sleep "$CI"
  done
  echo "$(ts) ALERT pauseAll result UNKNOWN incident=$INC tx=$LAST nonce=$NONCE hashes=$(tr ' ' ',' <<<"$HASHES") no settled receipt within ${STO}s: may still be mined, settle the pauser nonce before any unpause"
  exit 1
}
load_pending() {
  local l1 l2 l3; { read -r l1 && read -r l2 && read -r l3; } < <(st get 2>/dev/null) || return 1
  read -r INC FROM NONCE FIRST AGE LAST LMF LPR RCHAIN RPAUSER BOUND <<<"$l1"; RCALL=$l2; HASHES=$l3
  [[ "$NONCE" =~ ^[0-9]+$ ]] && [ -n "$HASHES" ]
}
# R11-01: the pending record must belong to this signer, chain and pauser before anything is (re)sent; $1 = rebroadcast|replace
unbound() { echo "$(ts) ALERT pauseAll result UNKNOWN incident=$INC tx=$LAST nonce=$NONCE pending record bound to another signer/chain/pauser ($1): may still be mined, settle the pauser nonce before any unpause"; exit 1; }
bind() {
  local cid me
  cid=$(c "$CT" chain-id 2>/dev/null); [[ "$cid" =~ ^[0-9]+$ ]] || unbound "chain ID of ETH_RPC not read"
  [ "$cid" = "$RCHAIN" ] || unbound "chain $RCHAIN, ETH_RPC is chain $cid"
  [ "$(lc "$RPAUSER")" = "$(lc "${PAUSER:-}")" ] || unbound "pauser $RPAUSER, configured ${PAUSER:-none}"
  if haskey; then
    me=$(signer); [ "$(lc "$me")" = "$(lc "$FROM")" ] || unbound "signer $FROM, current key ${me:-unreadable}"
  elif [ "$1" = replace ]; then unbound "no key to check the signer"; fi
  [ "$1" = replace ] || return 0
  [ "$BOUND" = 1 ] || unbound "old-format record without chain/pauser/call binding, no replacement"
  [ "$(lc "$(cast calldata 'pauseAll(string)' "$(MSG "$INC")" 2>/dev/null)")" = "$(lc "$RCALL")" ] || unbound "calldata differs from the record"
}

PWF="${ETH_KEYSTORE_PASSWORD_FILE:-${CREDENTIALS_DIRECTORY:+$CREDENTIALS_DIRECTORY/pauser-pass}}"
if [ -n "${PAUSER_KEYSTORE:-}" ]; then KEY=(--keystore "$PAUSER_KEYSTORE"); elif [ -n "${PAUSER_ACCOUNT:-}" ]; then KEY=(--account "$PAUSER_ACCOUNT"); else KEY=(); fi
haskey() { [ ${#KEY[@]} -gt 0 ] && [ -n "$PWF" ]; }

if [ "${DRY_RUN:-1}" = 0 ]; then
  { mkdir -p "$SD" && [ -w "$SD" ]; } 2>/dev/null || { echo "$(ts) ALERT STATE_DIRECTORY not set: configuration error, auto-pause not running (dir=$SD missing or not writable)"; exit 2; }
  exec 9>>"$SD/lock"   # flock on the inherited fd stays held by this shell until it exits
  python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null || { echo "$(ts) another auto-pause run holds the lock -> no action"; exit 0; }
fi

# a pending (unsettled) pauseAll is settled FIRST, on every run, whatever the metrics say now (R10-01)
if [ -f "$P" ]; then
  load_pending || { echo "$(ts) ALERT pauseAll result UNKNOWN incident=? tx=? nonce=? pending record unreadable ($P): may still be mined, settle the pauser nonce before any unpause"; exit 1; }
  [ "${DRY_RUN:-1}" != 0 ] && { echo "$(ts) ALERT pauseAll result UNKNOWN incident=$INC tx=$LAST nonce=$NONCE pending record not reconciled (DRY_RUN): may still be mined, settle the pauser nonce before any unpause"; exit 1; }
  echo "$(ts) pending pauseAll incident=$INC nonce=$NONCE tx=$LAST age=${AGE}s: settling it first, no new nonce"
  if ! seen; then
    n=$(c "$CT" nonce "$FROM" --block latest 2>/dev/null)
    if [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -gt "$NONCE" ]; then
      seen || { echo "$(ts) ALERT pauseAll result UNKNOWN incident=$INC tx=$LAST nonce=$NONCE latest_nonce=$n hashes=$(tr ' ' ',' <<<"$HASHES") nonce used by an unknown transaction (or our receipt not visible yet): may still be mined, settle the pauser nonce before any unpause"; exit 1; }
    else
      nf=
      if [ "$AGE" -ge "${REPLACE_AFTER:-180}" ] && haskey && [ "$BOUND" = 1 ]; then
        bind replace
        nf=$(fees "$(c "$CT" base-fee latest 2>/dev/null)" "$(c "$CT" rpc eth_maxPriorityFeePerGas 2>/dev/null)" "$LMF" "$LPR" 2>/dev/null)
        [ "$nf" = cap ] && { echo "$(ts) replacement would exceed MAX_FEE_CAP incident=$INC nonce=$NONCE: rebroadcasting the same tx"; nf=; }
      else
        [ "$AGE" -ge "${REPLACE_AFTER:-180}" ] && [ "$BOUND" != 1 ] && echo "$(ts) no replacement incident=$INC nonce=$NONCE: old-format pending record (no chain/pauser/call binding), rebroadcasting the same tx"
        bind rebroadcast
      fi
      if [ -n "$nf" ]; then
        read -r mf pr <<<"$nf"; old=$LAST
        if raw=$(sign "$NONCE" "$mf" "$pr") && h=$(txhash "$raw") && st add "$h" "$mf" "$pr" <<<"$raw" && load_pending; then
          publish "$h" " replaces=$old max_fee=$mf prio=$pr" || echo "$(ts) replacement not accepted by the RPC incident=$INC tx=$h nonce=$NONCE"
        else
          echo "$(ts) replacement not signed incident=$INC nonce=$NONCE: $(clean <"$SD/.err" 2>/dev/null); rebroadcasting the same tx"
          publish "$LAST" || echo "$(ts) rebroadcast not accepted by the RPC incident=$INC tx=$LAST nonce=$NONCE"
        fi
        unset raw
      else
        publish "$LAST" || echo "$(ts) rebroadcast not accepted by the RPC incident=$INC tx=$LAST nonce=$NONCE"
      fi
    fi
  fi
  await
fi

M=$(curl -fsS --max-time 10 "${METRICS_URL:-http://127.0.0.1:9465/metrics}") || { echo "$(ts) ALERT metrics unreachable -> no action"; exit 0; }
get() { awk -v k="$1" '$1==k{print $2}' <<<"$M"; }
NOW=$(date +%s)
SEV=$(get vmpx_bridge_severity); RES=$(get vmpx_bridge_last_result_timestamp); CRIT=$(get vmpx_bridge_last_critical_timestamp); UNK=$(get vmpx_bridge_unknown_seconds)
RES_AGE=$(( NOW - ${RES:-0} ))
if [ "$RES_AGE" -gt "${MAX_RESULT_AGE:-120}" ]; then echo "$(ts) ALERT monitor has no finished tick for ${RES_AGE}s -> no action"; exit 0; fi
if [ "${SEV:-3}" = 3 ] && [ "${UNK:-0}" -gt "${MAX_UNKNOWN:-600}" ]; then echo "$(ts) ALERT evidence unknown for ${UNK}s -> no action, check now"; exit 0; fi
if [ "${SEV:-3}" != 2 ]; then echo "$(ts) severity=${SEV:-unknown} -> no action"; exit 0; fi
# the CRITICAL must be the result of the last finished tick (not an older one kept while new ticks hang)
if [ "${CRIT:-0}" -lt "${RES:-0}" ] || [ $(( NOW - ${CRIT:-0} )) -gt "${MAX_RESULT_AGE:-120}" ]; then
  echo "$(ts) ALERT severity=2 but no freshly confirmed CRITICAL (critical=${CRIT:-0}, result=${RES:-0}) -> no action"; exit 0
fi
INC="crit-$(tr -cd '0-9' <<<"$CRIT")"
if [ "${DRY_RUN:-1}" != 0 ]; then echo "$(ts) CRITICAL (confirmed $(( NOW - CRIT ))s ago) -> WOULD pauseAll (DRY_RUN, nothing sent) incident=$INC"; exit 0; fi

# never a second pauseAll for an incident with a settled successful one
d=$(st done "$INC" 2>/dev/null); [ -n "$d" ] && { echo "$(ts) pauseAll already settled incident=$INC tx=$d -> not sent again"; exit 0; }
# skip only when BOTH RPCs show both directions paused at a fresh, agreeing head (R11-02); any doubt = send
s=$(state 0 need2)
case "$s" in
  paused\ *) echo "$(ts) CRITICAL but bridge already paused at latest (both directions, fresh agreeing heads on 2 RPCs, ${s#paused }) incident=$INC -> pauseAll not sent"; exit 0 ;;
  open\ *) why="not paused at latest, ${s#open }" ;;
  *) why="pause state at latest not proven: ${s#unknown }" ;;
esac
echo "$(ts) CRITICAL, sending pauseAll incident=$INC reason=\"$why\""
# the pauser key: a keystore file (server) or a named Foundry account (operator's machine); nothing to sign with = ALERT
haskey || { echo "$(ts) ALERT CRITICAL but no pauser key configured incident=$INC (PAUSER_KEYSTORE/PAUSER_ACCOUNT, password file): pause by hand now"; exit 1; }
NONCE=?
fail() { echo "$(ts) ALERT pauseAll FAILED incident=$INC nonce=$NONCE nothing broadcast ($1): pause by hand now"; exit 1; }
FROM=$(signer); [[ "$FROM" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "pauser address not read (key or password)"
cid=$(c "$CT" chain-id 2>/dev/null); [[ "$cid" =~ ^[0-9]+$ ]] || fail "chain ID not read"
call=$(cast calldata 'pauseAll(string)' "$(MSG "$INC")" 2>/dev/null); [[ "$call" =~ ^0x[0-9a-fA-F]+$ ]] || fail "calldata not built"
n=$(c "$CT" nonce "$FROM" --block latest 2>/dev/null); [[ "$n" =~ ^[0-9]+$ ]] || fail "nonce not read"; NONCE=$n
b=$(c "$CT" base-fee latest 2>/dev/null); [[ "$b" =~ ^[0-9]+$ ]] || fail "base fee not read"
read -r mf pr <<<"$(fees "$b" "$(c "$CT" rpc eth_maxPriorityFeePerGas 2>/dev/null)" 0 0 2>/dev/null)"
{ [[ "${mf:-}" =~ ^[0-9]+$ ]] && [ "$mf" -gt 0 ]; } || fail "fees not read"
echo "$(ts) CRITICAL -> pauseAll incident=$INC nonce=$NONCE max_fee=$mf prio=$pr chain=$cid"
raw=$(sign "$NONCE" "$mf" "$pr"); [[ "$raw" =~ ^0x[0-9a-fA-F]+$ ]] || fail "not signed: $(clean <"$SD/.err" 2>/dev/null)"
h=$(txhash "$raw") || fail "tx hash not computed"
# identity before waiting: the record (checked against the decoded raw tx) exists before any broadcast
st new "$INC" "$FROM" "$NONCE" "$h" "$mf" "$pr" "$cid" "$PAUSER" "$call" <<<"$raw" 2>"$SD/.err" || fail "pending record not written: $(clean <"$SD/.err")"
unset raw; load_pending || fail "pending record not readable in $SD"
publish "$h" || echo "$(ts) broadcast not accepted by the RPC after $TRIES attempts incident=$INC tx=$h nonce=$NONCE (it may still have reached a node)"
await
