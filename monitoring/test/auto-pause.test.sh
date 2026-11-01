#!/usr/bin/env bash
# auto-pause.sh against fake metrics and a fake `cast` (no network, no keys). Usage: bash monitoring/test/auto-pause.test.sh
# The fake chain lives in $CHAIN: `pub` = broadcast hashes, `mined` = hashes with a receipt (nonce = BASE_NONCE + mined).
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d); trap 'rm -rf "$T"; kill $SRV 2>/dev/null' EXIT
mkdir -p "$T/bin" "$T/www"
cat > "$T/bin/cast" <<'C'
#!/bin/sh
echo "cast $*" >> "$CAST_LOG"; echo "cast $*" >> "$ARGV_LOG"
mkdir -p "$CHAIN"; touch "$CHAIN/mined" "$CHAIN/pub"
cmd=$1; shift; rpc=; [ "${1:-}" = --rpc-url ] && { rpc=$2; shift 2; }
sfx=; [ "$rpc" = y ] && sfx=2       # ETH_RPC2=y: VAR2 overrides VAR for the second RPC
v() { eval "x=\${$1$sfx:-}"; [ -n "$x" ] || eval "x=\${$1:-}"; printf %s "$x"; }
kec() { printf '0x%s\n' "$(printf %s "$1" | shasum -a 256 | cut -c1-64)"; }
opt() { echo " $* " | sed -E "s/.* $1 ([^ ]+) .*/\1/"; }
hex() { printf %s "$1" | od -An -tx1 | tr -d ' \n'; }
case "$cmd" in
  wallet) echo "${WALLET:-0x000000000000000000000000000000000000bEEF}" ;;
  chain-id) echo "${CHAIN_ID:-11155111}" ;;
  calldata) echo "0x$(hex "$2")" ;;
  nonce) [ -n "${NONCE_FAIL:-}" ] && exit 1; echo $(( ${BASE_NONCE:-5} + $(wc -l < "$CHAIN/mined") + ${NONCE_EXTRA:-0} )) ;;
  base-fee) echo "${BASE_FEE:-1000000000}" ;;
  rpc) echo '"0x3b9aca00"' ;;
  block-number) echo "${HEAD:-20}" ;;
  mktx) [ -n "${MKTX_FAIL:-}" ] && { echo "Error: wrong keystore password" >&2; exit 1; }
        # a real RLP EIP-1559 envelope (chain, nonce, fees, to, calldata) with a dummy signature
        python3 -c '
import sys
def h(l, o):
    if l < 56: return bytes([o + l])
    b = l.to_bytes((l.bit_length() + 7) // 8, "big"); return bytes([o + 55 + len(b)]) + b
def e(x):
    if isinstance(x, list): p = b"".join(e(i) for i in x); return h(len(p), 0xc0) + p
    if isinstance(x, int): x = x.to_bytes((x.bit_length() + 7) // 8, "big") if x else b""
    return x if len(x) == 1 and x[0] < 0x80 else h(len(x), 0x80) + x
c, n, pr, mf, to, data = sys.argv[1:7]
print("0x02" + e([int(c), int(n), int(pr), int(mf), 100000, bytes.fromhex(to[2:]), 0, bytes.fromhex(data), [], 1, 7, 9]).hex())' \
          "${MKTX_CHAIN:-${CHAIN_ID:-11155111}}" "$(opt --nonce "$@")" "$(opt --priority-gas-price "$@")" "$(opt --gas-price "$@")" "$1" "$(hex "$3")" ;;
  keccak) [ $# = 0 ] && set -- "$(cat)"; kec "$1" ;;
  receipt) grep -qx "$1" "$CHAIN/mined" || { echo '{"schema_version":1,"success":false,"data":null}'; exit 1; }
           bn='"blockNumber":"0x10",'; [ -n "${NO_BLOCKNUM:-}" ] && bn=
           printf '{"transactionHash":"%s","status":"%s",%s"blockHash":"0xb16"}\n' "$1" "${RSTATUS:-0x1}" "$bn" ;;
  block) if [ "$1" = latest ]; then   # head per RPC before a broadcast: HEAD/HEAD2, HEAD_AGE/HEAD_AGE2 (s), HEAD_FAIL/HEAD_FAIL2;
           # after a broadcast in this run: HEAD, age HEAD_AGE_POST
           if grep -q '^curl' "$CAST_LOG"; then n=${HEAD:-20}; a=${HEAD_AGE_POST:-2}; else
           [ -n "$(v HEAD_FAIL)" ] && { echo "Error: rpc down" >&2; exit 1; }
           n=$(v HEAD); n=${n:-20}; a=$(v HEAD_AGE); a=${a:-2}; fi
           printf '{"schema_version":1,"success":true,"data":{"number":"0x%x","timestamp":"0x%x","hash":"0xh"}}\n' "$n" $(( $(date +%s) - a ))
         else echo "${CANON:-0xb16}"; fi ;;
  call) # at the receipt block 16: CALL_SEQ (comma list, "lag" = node behind -> error), then PAUSED;
        # at a head: POST_LATEST after a broadcast in this run, else PRE_LATEST if set, else by `mined` (VAR2 = second RPC)
        b=$(opt --block "$@")
        if [ "$b" = 16 ]; then
          n=$(grep -c 'block 16$' "$CAST_LOG"); a=$(echo "${CALL_SEQ:-}" | cut -d, -f"$n"); [ -n "$a" ] || a=${PAUSED:-true}
        elif grep -q '^curl' "$CAST_LOG"; then a=$(v POST_LATEST); a=${a:-true}
        elif [ -n "$(v PRE_LATEST)" ]; then a=$(v PRE_LATEST)
        elif [ -s "$CHAIN/mined" ]; then a=$(v POST_LATEST); a=${a:-true}; else a=false; fi
        [ "$a" = lag ] && { echo "Error: header not found" >&2; exit 1; }
        echo "$a" ;;
esac
C
# fake JSON-RPC eth_sendRawTransaction behind curl (metrics requests go to the real curl)
cat > "$T/bin/curl" <<C
#!/bin/sh
echo "curl \$*" >> "\$ARGV_LOG"
case "\$*" in *127.0.0.1:8797*) exec $(command -v curl) "\$@" ;; esac
C
cat >> "$T/bin/curl" <<'C'
echo "curl $*" >> "$CAST_LOG"; mkdir -p "$CHAIN"; touch "$CHAIN/mined" "$CHAIN/pub"
f=; for a; do case "$a" in @*) f=${a#@} ;; esac; done
n=$(grep -c '^curl' "$CAST_LOG"); [ "$n" -gt "${PUBLISH_FAILS:-0}" ] || { echo "curl: (7) Failed to connect" >&2; exit 7; }
python3 -c 'import os,sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$f" > "$CHAIN/bodymode"
raw=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["params"][0])' "$f")
h=0x$(printf %s "$raw" | shasum -a 256 | cut -c1-64); echo "$h" >> "$CHAIN/pub"; [ "${MINE:-0}" = 1 ] && echo "$h" >> "$CHAIN/mined"
[ -n "${KNOWN:-}" ] && { echo '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"already known"}}'; exit 0; }
echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"${RPC_HASH:-$h}\"}"
C
cat > "$T/bin/python3" <<C
#!/bin/sh
echo "python3 \$*" >> "\$ARGV_LOG"
exec $(command -v python3) "\$@"
C
printf '#!/bin/sh\nshift\nexec "$@"\n' > "$T/bin/timeout"; chmod +x "$T/bin/"*
(cd "$T/www" && exec python3 -m http.server 8797 --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!; sleep 1
N=$(date +%s); pass=0; fail=0
m() { printf 'vmpx_bridge_severity %s\nvmpx_bridge_last_result_timestamp %s\nvmpx_bridge_last_critical_timestamp %s\nvmpx_bridge_unknown_seconds %s\n' "$2" "$3" "$4" "$5" > "$T/www/$1"; }
# S=<name>: state dir and fake chain shared by runs with the same name (default: fresh for each run)
run() { local f=$1 s=${S:-r$RANDOM$RANDOM}; shift; : > "$T/cast.log"; env PATH="$T/bin:$PATH" CAST_LOG="$T/cast.log" ARGV_LOG="$T/argv.log" CHAIN="$T/chain/$s" AP_STATE_DIR="$T/state/$s" \
  METRICS_URL="http://127.0.0.1:8797/$f" ETH_RPC=x ETH_RPC2=y PAUSER=$PA PAUSER_ACCOUNT=k ETH_KEYSTORE_PASSWORD_FILE=/dev/null PAUSE_ISM=0xI PAUSE_HOOK=0xH \
  SEND_TIMEOUT=2 CONFIRM_INTERVAL=1 "$@" bash "$HERE/auto-pause.sh" > "$T/out" 2>&1; echo $?; }
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; sed 's/^/      /' "$T/out"; fail=$((fail+1)); fi; }
pend() { [ -f "$T/state/$1/pending.json" ]; }
np() { grep -c '^curl' "$T/cast.log"; }; nm() { grep -c '^cast mktx' "$T/cast.log"; }
I="incident=crit-$N"; PA=0x00000000000000000000000000000000000000AA
m fresh 2 "$N" "$N" 0; m stale_crit 2 "$N" $((N-300)) 0; m hung 2 $((N-400)) $((N-400)) 0; m ok 0 "$N" 0 0; m unknown 3 "$N" 0 900

rc=$(run fresh); check "dry run: fresh confirmed CRITICAL -> WOULD pauseAll with incident, nothing sent" '[ $rc = 0 ] && grep -q "WOULD pauseAll (DRY_RUN, nothing sent) $I" "$T/out" && [ ! -s "$T/cast.log" ]'
rc=$(run stale_crit DRY_RUN=0); check "CRITICAL kept from an older tick -> no action" '[ $rc = 0 ] && grep -q "no freshly confirmed" "$T/out" && [ ! -s "$T/cast.log" ]'
rc=$(run hung DRY_RUN=0); check "no finished tick for 400 s -> ALERT, no action" '[ $rc = 0 ] && grep -q "ALERT monitor has no finished tick" "$T/out"'
rc=$(run unknown DRY_RUN=0); check "long UNKNOWN -> ALERT, no pause" '[ $rc = 0 ] && grep -q "ALERT evidence unknown" "$T/out" && [ ! -s "$T/cast.log" ]'
rc=$(run ok DRY_RUN=0); check "OK -> no action" '[ $rc = 0 ] && [ ! -s "$T/cast.log" ]'
rc=$(S=ok1 run fresh DRY_RUN=0 MINE=1); H=$(grep -o "broadcast $I tx=0x[0-9a-f]*" "$T/out" | sed 's/.*tx=//')
check "signed (nonce 5) and recorded before broadcast, then both directions verified at the receipt block" '[ $rc = 0 ] && grep -q "CRITICAL -> pauseAll $I nonce=5" "$T/out" && grep -q "mktx.*--nonce 5 " "$T/cast.log" \
  && [ $(grep -n "^curl" "$T/cast.log" | head -1 | cut -d: -f1) -lt $(grep -n "block 16$" "$T/cast.log" | head -1 | cut -d: -f1) ] && [ $(grep -c "block 16$" "$T/cast.log") = 2 ] \
  && grep -q "pauseAll tx $H status 0x1 block 16 $I blockhash=0xb16" "$T/out" && grep -q "pause executed in block 16 $I tx=$H" "$T/out" && grep -q "bridge paused in both directions $I tx=$H" "$T/out" \
  && ! pend ok1 && [ -f "$T/state/ok1/done/crit-$N.json" ] && ! grep -q ALERT "$T/out"'
rc=$(S=ok1 run fresh DRY_RUN=0 MINE=1 POST_LATEST=false); check "same incident is never paused twice (done record)" '[ $rc = 0 ] && grep -q "pauseAll already settled $I tx=$H" "$T/out" && [ $(nm) = 0 ] && [ $(np) = 0 ]'
rc=$(run fresh DRY_RUN=0 MINE=1 PUBLISH_FAILS=2); check "two broadcasts fail, third accepted (retries, same tx)" '[ $rc = 0 ] && [ $(np) = 3 ] && [ $(nm) = 1 ]'
rc=$(S=pf run fresh DRY_RUN=0 PUBLISH_FAILS=9); check "broadcast never accepted -> result UNKNOWN (not FAILED), record kept, exit 1" '[ $rc = 1 ] && grep -q "ALERT pauseAll result UNKNOWN $I tx=0x.* nonce=5 .*: may still be mined, settle the pauser nonce before any unpause" "$T/out" && ! grep -q FAILED "$T/out" && pend pf'
rc=$(S=mf run fresh DRY_RUN=0 MKTX_FAIL=1); check "signing fails -> ALERT FAILED (nothing broadcast), no record, exit 1" '[ $rc = 1 ] && grep -q "ALERT pauseAll FAILED $I nonce=5 nothing broadcast.*: pause by hand now" "$T/out" && [ $(np) = 0 ] && ! pend mf'
rc=$(run fresh DRY_RUN=0 MINE=1 PAUSED=false CONFIRM_TIMEOUT=3); check "mined but stays not paused at the receipt block -> ALERT after the confirm limit, exit 1" '[ $rc = 1 ] && grep -q "ALERT pause not confirmed $I" "$T/out" && [ $(grep -c "block 16$" "$T/cast.log") -ge 4 ]'
rc=$(run fresh DRY_RUN=0 MINE=1 CALL_SEQ=lag,false,true,true CONFIRM_TIMEOUT=20); check "pause drill 1 Nov: node behind the block / disagreeing reads -> read again, then confirmed" '[ $rc = 0 ] && grep -q "not confirmed yet" "$T/out" && grep -q "paused in both" "$T/out" && ! grep -q ALERT "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 PAUSED=lag CONFIRM_TIMEOUT=3); check "RPC never answers for the block -> ALERT (may have worked), never success" '[ $rc = 1 ] && grep -q "may still have worked" "$T/out" && ! grep -q "paused in both" "$T/out"'
rc=$(run fresh DRY_RUN=0 PAUSER_ACCOUNT= ); check "CRITICAL but no pauser key configured -> ALERT with incident, exit 1, nothing signed or sent" '[ $rc = 1 ] && grep -q "ALERT CRITICAL but no pauser key configured $I .*: pause by hand now" "$T/out" && [ $(nm) = 0 ] && [ $(np) = 0 ]'
rc=$(run fresh DRY_RUN=0 MINE=1 PAUSER_ACCOUNT= PAUSER_KEYSTORE=/k.json ETH_KEYSTORE_PASSWORD_FILE= CREDENTIALS_DIRECTORY=/cred); check "server mode: keystore file + systemd credential as password" '[ $rc = 0 ] && grep "^cast mktx" "$T/cast.log" | grep -q -- "--keystore /k.json --password-file /cred/pauser-pass"'
rc=$(run fresh DRY_RUN=0 PAUSE_ISM=); check "PAUSE_ISM missing -> configuration error, exit 2, nothing sent" '[ $rc = 2 ] && grep -q "PAUSE_ISM not set" "$T/out" && [ ! -s "$T/cast.log" ]'
rc=$(run ok PAUSE_HOOK=); check "PAUSE_HOOK missing -> exit 2 even when nothing to do" '[ $rc = 2 ] && grep -q "PAUSE_HOOK not set" "$T/out"'
rc=$(run fresh DRY_RUN=0 AP_STATE_DIR=/nonexistent-vmpx/state); check "state dir not writable -> configuration error, exit 2, nothing sent" '[ $rc = 2 ] && grep -q "ALERT STATE_DIRECTORY not set: configuration error" "$T/out" && [ ! -s "$T/cast.log" ]'
rc=$(run fresh DRY_RUN=0 PRE_LATEST=true); check "both RPCs at fresh agreeing heads show paused, no pending record -> no pauseAll" '[ $rc = 0 ] && grep -q "already paused at latest.*$I -> pauseAll not sent" "$T/out" && [ $(nm) = 0 ] && [ $(np) = 0 ]'
rc=$(run fresh DRY_RUN=0 MINE=1 POST_LATEST=false); check "executed in block N but unpaused at latest -> said explicitly, not a failure" '[ $rc = 0 ] && grep -q "pause executed in block 16 $I" "$T/out" && grep -q "bridge no longer paused at latest $I .*not a failure of the pause" "$T/out" && ! grep -q "bridge paused in both" "$T/out" && ! grep -q ALERT "$T/out"'

# R10-01: tx stays in the mempool
rc=$(S=mp run fresh DRY_RUN=0); H1=$(grep -o "broadcast $I tx=0x[0-9a-f]*" "$T/out" | sed 's/.*tx=//'); RAW=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["txs"][0]["raw"])' "$T/state/mp/pending.json" 2>/dev/null)
check "tx in mempool after the timeout -> ALERT result UNKNOWN, pending record (hash, nonce) kept, exit 1" '[ $rc = 1 ] && [ -n "$H1" ] && grep -q "ALERT pauseAll result UNKNOWN $I tx=$H1 nonce=5 " "$T/out" && pend mp && ! grep -q FAILED "$T/out" && grep -q "\"nonce\": 5" "$T/state/mp/pending.json"'
check "raw signed tx never printed" '[ -n "$RAW" ] && ! grep -qF "$RAW" "$T/out"'
rc=$(S=mp run ok DRY_RUN=0 REPLACE_AFTER=999); check "next run (metrics now OK) rebroadcasts the SAME tx and nonce, no new signature" '[ $rc = 1 ] && [ $(nm) = 0 ] && [ $(np) = 1 ] && grep -q "pauseAll broadcast $I tx=$H1 nonce=5$" "$T/out" && grep -q "result UNKNOWN $I tx=$H1 nonce=5" "$T/out"'
rc=$(S=mp run fresh DRY_RUN=1); check "DRY_RUN with a pending record -> ALERT UNKNOWN, nothing sent" '[ $rc = 1 ] && grep -q "ALERT pauseAll result UNKNOWN $I tx=$H1 nonce=5 .*DRY_RUN" "$T/out" && [ ! -s "$T/cast.log" ]'
rc=$(S=mp run fresh DRY_RUN=0 REPLACE_AFTER=0); H2=$(grep -o "broadcast $I tx=0x[0-9a-f]* nonce=5 replaces=$H1" "$T/out" | sed 's/.*tx=\(0x[0-9a-f]*\).*/\1/')
check "after REPLACE_AFTER: replacement of the SAME nonce, fees +25%, new hash recorded" '[ $rc = 1 ] && [ $(nm) = 1 ] && grep -q "mktx.*--nonce 5 --gas-price 3750000000 --priority-gas-price 1250000000" "$T/cast.log" && [ -n "$H2" ] && [ "$H2" != "$H1" ] && grep -q "$H2" "$T/state/mp/pending.json" && grep -q "$H1" "$T/state/mp/pending.json" && grep -q "hashes=$H1,$H2" "$T/out"'
echo "$H1" >> "$T/chain/mp/mined"
rc=$(S=mp run ok DRY_RUN=0); check "later receipt of the ORIGINAL tx settles the record (no broadcast)" '[ $rc = 0 ] && [ $(np) = 0 ] && grep -q "pauseAll tx $H1 status 0x1 block 16 $I" "$T/out" && grep -q "bridge paused in both directions $I tx=$H1" "$T/out" && ! pend mp && [ -f "$T/state/mp/done/crit-$N.json" ]'
rc=$(S=mp run fresh DRY_RUN=0); check "after that, the same incident is not paused again" '[ $rc = 0 ] && grep -q "already settled $I tx=$H1" "$T/out" && [ $(np) = 0 ]'
rc=$(S=rp run fresh DRY_RUN=0); rc=$(S=rp run fresh DRY_RUN=0 REPLACE_AFTER=0); H2=$(grep -o "tx=0x[0-9a-f]* nonce=5 replaces" "$T/out" | sed 's/tx=\(0x[0-9a-f]*\).*/\1/'); echo "$H2" >> "$T/chain/rp/mined"
rc=$(S=rp run fresh DRY_RUN=0); check "later receipt of the REPLACEMENT settles the record" '[ $rc = 0 ] && [ -n "$H2" ] && grep -q "pauseAll tx $H2 status 0x1 block 16" "$T/out" && ! pend rp'
rc=$(S=nu run fresh DRY_RUN=0); rc=$(S=nu run fresh DRY_RUN=0 NONCE_EXTRA=1); check "nonce consumed by an unknown tx (no receipt of ours) -> ALERT, no broadcast, record kept" '[ $rc = 1 ] && grep -q "ALERT pauseAll result UNKNOWN $I .*nonce=5 latest_nonce=6 .*nonce used by an unknown transaction" "$T/out" && [ $(np) = 0 ] && [ $(nm) = 0 ] && pend nu'
rc=$(S=s0 run fresh DRY_RUN=0 MINE=1 RSTATUS=0x0); check "receipt status 0 -> ALERT FAILED (nonce consumed), record closed, exit 1" '[ $rc = 1 ] && grep -q "pauseAll tx 0x[0-9a-f]* status 0x0 block 16" "$T/out" && grep -q "ALERT pauseAll FAILED $I .*status=0x0.*: pause by hand now" "$T/out" && ! pend s0 && ! grep -q "paused in both" "$T/out" && ls "$T/state/s0/history/" | grep -q failed'
rc=$(S=s0 run fresh DRY_RUN=0 MINE=1 PRE_LATEST=false POST_LATEST=true); check "after a status-0 receipt, a new attempt uses the NEXT nonce" '[ $rc = 0 ] && grep -q "mktx.*--nonce 6 " "$T/cast.log" && grep -q "paused in both" "$T/out"'
rc=$(S=nc run fresh DRY_RUN=0 MINE=1 CANON=0xdead); check "receipt in a non-canonical block -> not settled, UNKNOWN, record kept" '[ $rc = 1 ] && grep -q "reason=not-canonical" "$T/out" && ! grep -q "pauseAll tx .* status" "$T/out" && grep -q "result UNKNOWN" "$T/out" && pend nc && ! grep -q "paused in both" "$T/out"'
rc=$(S=nb run fresh DRY_RUN=0 MINE=1 NO_BLOCKNUM=1); check "receipt without blockNumber -> not settled, no read at latest instead" '[ $rc = 1 ] && grep -q "reason=no-block-number" "$T/out" && ! grep -q "pauseAll tx .* status" "$T/out" && pend nb && [ $(grep -c "^cast call " "$T/cast.log") = 4 ] && ! grep -q "call.*block latest" "$T/cast.log"'
rc=$(S=cf run fresh DRY_RUN=0 MINE=1 HEAD=16 PAUSED=false); check "receipt not CONFIRMATIONS deep -> not settled yet" '[ $rc = 1 ] && grep -q "reason=confirmations=1/2" "$T/out" && pend cf'
rc=$(S=cf run fresh DRY_RUN=0 MINE=1 HEAD=17); check "next run with depth 2 -> settled, no new broadcast" '[ $rc = 0 ] && [ $(np) = 0 ] && grep -q "pause executed in block 16" "$T/out" && ! pend cf'

N=$(date +%s); I="incident=crit-$N"; m fresh 2 "$N" "$N" 0   # fresh CRITICAL again (MAX_RESULT_AGE)
# R11-02: "already paused" only at fresh, agreeing heads of two RPCs; any doubt = send
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true HEAD_AGE=120); check "stale head shows paused -> pauseAll IS sent (reason logged)" '[ $rc = 0 ] && [ $(nm) = 1 ] && [ $(np) = 1 ] && grep -q "CRITICAL, sending pauseAll $I reason=\"pause state at latest not proven: rpc1 head 20 stale" "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true HEAD_AGE2=120); check "second RPC head stale -> sent" '[ $rc = 0 ] && [ $(np) = 1 ] && grep -q "reason=.*rpc2 head 20 stale" "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true ETH_RPC2=); check "only one RPC configured, it shows paused -> sent" '[ $rc = 0 ] && [ $(np) = 1 ] && grep -q "reason=.*ETH_RPC2 not set" "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true ETH_RPC2=x); check "ETH_RPC2 equal to ETH_RPC -> not independent, sent" '[ $rc = 0 ] && [ $(np) = 1 ]'
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true HEAD2=30); check "heads disagree (20 vs 30) -> sent" '[ $rc = 0 ] && [ $(np) = 1 ] && grep -q "reason=.*heads disagree (20 vs 30)" "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true PRE_LATEST2=false); check "one RPC paused, the other open -> sent" '[ $rc = 0 ] && [ $(np) = 1 ] && grep -q "reason=.*RPCs disagree" "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true HEAD_FAIL2=1); check "second RPC head not read -> sent" '[ $rc = 0 ] && [ $(np) = 1 ] && grep -q "reason=.*rpc2 head not read" "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 PRE_LATEST=true HEAD2=22); check "both fresh, within HEAD_MAX_SKEW, both paused -> skipped" '[ $rc = 0 ] && [ $(np) = 0 ] && grep -q "already paused at latest.*rpc1=20:true/true,rpc2=22:true/true" "$T/out"'
rc=$(run fresh DRY_RUN=0 MINE=1 HEAD_AGE_POST=120 CONFIRM_TIMEOUT=2); check "after the receipt, stale latest -> state UNKNOWN (ALERT), never \"still paused\"" '[ $rc = 1 ] && grep -q "pause executed in block 16" "$T/out" && grep -q "ALERT pause not confirmed $I .*current state at latest unknown (rpc1 head 20 stale" "$T/out" && ! grep -q "bridge paused in both" "$T/out"'

N=$(date +%s); I="incident=crit-$N"; m fresh 2 "$N" "$N" 0
# R11-01: pending record bound to signer, chain, pauser, calldata
rc=$(S=kr run fresh DRY_RUN=0); HK=$(grep -o "broadcast $I tx=0x[0-9a-f]*" "$T/out" | sed 's/.*tx=//')
check "pending record carries from, chain_id, pauser, call" 'python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d[\"chain_id\"]==11155111 and d[\"pauser\"]==sys.argv[2].lower() and d[\"from\"].lower().endswith(\"beef\") and d[\"call\"].startswith(\"0x\")" "$T/state/kr/pending.json" "$PA"'
rc=$(S=kr run fresh DRY_RUN=0 REPLACE_AFTER=0 WALLET=0x000000000000000000000000000000000000CAFE); check "key rotated with a pending record -> no signing with the other key, ALERT, exit 1" '[ $rc = 1 ] && [ $(nm) = 0 ] && [ $(np) = 0 ] && grep -q "ALERT pauseAll result UNKNOWN $I tx=$HK nonce=5 pending record bound to another signer/chain/pauser (signer .*CAFE.*: may still be mined, settle the pauser nonce before any unpause" "$T/out" && pend kr'
rc=$(S=kr run fresh DRY_RUN=0 REPLACE_AFTER=999 WALLET=0x000000000000000000000000000000000000CAFE); check "key rotated -> no rebroadcast either" '[ $rc = 1 ] && [ $(np) = 0 ] && grep -q "bound to another signer/chain/pauser (signer" "$T/out"'
rc=$(S=kr run fresh DRY_RUN=0 REPLACE_AFTER=0 CHAIN_ID=1); check "ETH_RPC on another chain -> ALERT, nothing sent" '[ $rc = 1 ] && [ $(nm) = 0 ] && [ $(np) = 0 ] && grep -q "bound to another signer/chain/pauser (chain 11155111, ETH_RPC is chain 1)" "$T/out"'
rc=$(S=kr run fresh DRY_RUN=0 REPLACE_AFTER=0 PAUSER=0x00000000000000000000000000000000000000BB); check "PAUSER changed -> ALERT, nothing sent" '[ $rc = 1 ] && [ $(nm) = 0 ] && [ $(np) = 0 ] && grep -q "bound to another signer/chain/pauser (pauser" "$T/out"'
rc=$(S=kr run fresh DRY_RUN=0 REPLACE_AFTER=0); check "same signer/chain/pauser -> replacement allowed" '[ $rc = 1 ] && [ $(nm) = 1 ] && grep -q "replaces=$HK" "$T/out"'
rc=$(S=of run fresh DRY_RUN=0); python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); [d.pop(k) for k in ("v","chain_id","pauser","call","aliases")]; json.dump(d,open(p,"w"))' "$T/state/of/pending.json"
rc=$(S=of run fresh DRY_RUN=0 REPLACE_AFTER=0); check "old-format record: no replacement, the identical raw rebroadcast (chain from the raw tx matches)" '[ $rc = 1 ] && [ $(nm) = 0 ] && [ $(np) = 1 ] && grep -q "no replacement $I nonce=5: old-format" "$T/out"'
rc=$(S=of run fresh DRY_RUN=0 REPLACE_AFTER=0 CHAIN_ID=1); check "old-format record on another chain -> ALERT, no rebroadcast" '[ $rc = 1 ] && [ $(np) = 0 ] && grep -q "bound to another signer/chain/pauser (chain 11155111, ETH_RPC is chain 1)" "$T/out"'
rc=$(S=mc run fresh DRY_RUN=0 MKTX_CHAIN=1); check "signed tx for another chain than chain-id -> refused before broadcast (FAILED, no record)" '[ $rc = 1 ] && [ $(np) = 0 ] && grep -q "ALERT pauseAll FAILED $I nonce=5 nothing broadcast (pending record not written: raw tx does not match the record: chain_id)" "$T/out" && ! pend mc'

N=$(date +%s); I="incident=crit-$N"; m fresh 2 "$N" "$N" 0
# R11-05: raw only on stdin / in a 0600 file
rc=$(S=ah run fresh DRY_RUN=0 MINE=1 RPC_HASH=0x00000000000000000000000000000000000000000000000000000000000000aa); check "RPC reports another tx hash -> recorded as alias, logged" '[ $rc = 0 ] && grep -q "rpc_tx=0x0*aa" "$T/out"'
rc=$(S=kn run fresh DRY_RUN=0 MINE=1 KNOWN=1); check "RPC says already known -> accepted" '[ $rc = 0 ] && grep -q "rpc=already-known" "$T/out"'
check "broadcast body file is 0600 and removed" '[ "$(cat "$T/chain/kn/bodymode")" = 0o600 ] && [ ! -f "$T/state/kn/.send.json" ]'
RAWS=$(python3 -c 'import glob,json,sys
for f in glob.glob(sys.argv[1]+"/state/*/pending.json")+glob.glob(sys.argv[1]+"/state/*/history/*.json"):
    for t in json.load(open(f)).get("txs", []): print(t["raw"][2:])' "$T")
check "no raw signed tx in the argv of any process (cast, curl, python3)" '[ $(wc -l <<<"$RAWS") -ge 10 ] && grep -q "^cast keccak$" "$T/argv.log" && grep -q "^python3 -c" "$T/argv.log" && ! grep -qFf <(echo "$RAWS") "$T/argv.log"'
echo "RESULT: $pass PASS / $fail FAIL"; [ "$fail" = 0 ]
