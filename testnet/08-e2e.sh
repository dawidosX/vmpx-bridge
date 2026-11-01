#!/usr/bin/env bash
# End-to-end on testnet. Requires validators + relayer running (07). Each check prints PASS/FAIL.
source "$(dirname "$0")/lib.sh"
R=$(state_get sepolia_router); TOK=$(state_get sepolia_token); P=$(state_get x1_token_program)
# The run takes ~1 h, so the three test keystore passwords are asked once, up front, checked, and kept in a
# 700 temp dir that is removed on exit (cast reads them via --password-file: never argv, env or logs).
PWDIR=$(mktemp -d "$WORK/.e2e-pw.XXXXXX"); trap 'rm -rf "$PWDIR"' EXIT
askpw(){ local p; printf "Haslo keystore'a %s (Enter = jak poprzednie): " "$1"; read -rs p; echo
  [ -n "$p" ] || p=${LASTPW:-}; LASTPW=$p; (umask 077; printf %s "$p" > "$PWDIR/$1")
  cast wallet address --account "$1" --password-file "$PWDIR/$1" >/dev/null 2>&1 || { echo "zle haslo do $1"; exit 1; }; }
for a in "$ETH_TEST_USER_ACCOUNT" "$PAUSER_ACCOUNT" "$GUARDIAN_ACCOUNT"; do askpw "$a"; done; unset LASTPW
# every Sepolia tx: label, hash, gasUsed -> $WORK/state/e2e-txs.jsonl (gas report); stderr kept for revert checks
TXLOG="$WORK/state/e2e-txs.jsonl"
# nonces are tracked here, not re-read per tx: right after a receipt a load-balanced RPC (publicnode) can still
# answer with the old nonce, and cast then resends it -> "replacement transaction underpriced" (29 Oct 2026)
snd(){ local label=$1 acct=$2 n; shift 2; n=$(cat "$PWDIR/$acct.nonce")
  cast send "$@" --nonce "$n" --rpc-url "$SEPOLIA_RPC" --account "$acct" --password-file "$PWDIR/$acct" --json 2>"$PWDIR/err" > "$PWDIR/out" \
    || { cat "$PWDIR/out" "$PWDIR/err" > "$PWDIR/fail"; cat "$PWDIR/fail"; return 1; }
  echo $((n+1)) > "$PWDIR/$acct.nonce"   # mined (even if reverted): the nonce is used
  jq -c --arg l "$label" '{label:$l, tx:.transactionHash, gasUsed:.gasUsed, status:.status}' "$PWDIR/out" | tee -a "$TXLOG"
  [ "$(jq -r .status "$PWDIR/out")" = 0x1 ]; }
USER_ETH=$(cast wallet address --account "$ETH_TEST_USER_ACCOUNT" --password-file "$PWDIR/$ETH_TEST_USER_ACCOUNT")
USER_X1=$(solana address -k "$X1_TEST_USER_KEYPAIR")
USER_X1_HEX=$(python3 - "$USER_X1" <<'PY'
import sys
A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n=0
for c in sys.argv[1]: n=n*58+A.index(c)
print('0x'+n.to_bytes(32,'big').hex())
PY
)
MINT=$(grep -oE "mint[^A-Za-z0-9]+[1-9A-HJ-NP-Za-km-z]{32,44}" "$WORK/state/x1-token-query.txt" | grep -oE "[1-9A-HJ-NP-Za-km-z]{32,44}$" | head -1 || true)
[ -n "${MINT:-}" ] || MINT=$(state_get x1_mint)   # if parsing failed: echo <MINT> > $WORK/state/x1_mint
echo "user eth $USER_ETH | user x1 $USER_X1 | mint $MINT"

# preflight: no Sepolia tx of ours still pending (a stuck one breaks every later send) ...
for a in "$ETH_TEST_USER_ACCOUNT" "$PAUSER_ACCOUNT" "$GUARDIAN_ACCOUNT"; do
  addr=$(cast wallet address --account "$a" --password-file "$PWDIR/$a")
  nl=$(cast nonce "$addr" --block latest --rpc-url "$SEPOLIA_RPC"); np=$(cast nonce "$addr" --block pending --rpc-url "$SEPOLIA_RPC")
  [ "$nl" = "$np" ] || { echo "STOP: $a ($addr) ma niepotwierdzone transakcje na Sepolii (nonce latest=$nl pending=$np)."
    echo "      Poczekaj na potwierdzenie albo zastap nonce $nl transakcja 0 ETH do siebie z wyzszym gas price."; exit 1; }
  echo "$nl" > "$PWDIR/$a.nonce"
done
# ... and no bridge message in flight: everything locked on Sepolia (18 dec) must be minted on X1 (9 dec),
# otherwise a late delivery from an earlier run lands in this run's balance checks
LK=$(cast call "$TOK" "balanceOf(address)(uint256)" "$R" --rpc-url "$SEPOLIA_RPC" | awk '{print $1}')
SUP=$(spl-token supply "$MINT" -u "$X1_RPC" --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
# The lockbox may legally hold MORE than the X1 supply (donations, direct transfers: Codex I-01), so the start state
# is recorded as a surplus S0 and the final check expects the same surplus (round 3, sec. 8). Stop other traffic
# (test bot) for the run: its transfers would change the surplus while this test is in flight.
S0=$(python3 -c "from decimal import Decimal as D; print($LK - int(D('$SUP')*10**18))")
[ "${S0#-}" = "$S0" ] || { echo "STOP: lockbox Sepolia = $LK wei < podaz VMPXe na X1 = $SUP: niedobor pokrycia."; exit 1; }
[ "$S0" = 0 ] || echo "UWAGA: lockbox ma nadwyzke $S0 wei ponad podaz X1 (wiadomosc w drodze albo darowizna); koncowa kontrola oczekuje tej samej nadwyzki"
PASSES=0; FAILS=0
ok(){ echo "PASS  $1"; PASSES=$((PASSES+1)); }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
x1bal(){ spl-token balance --owner "$USER_X1" "$MINT" -u "$X1_RPC" --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb 2>/dev/null || echo 0; }
ethbal(){ cast call "$TOK" "balanceOf(address)(uint256)" "$USER_ETH" --rpc-url "$SEPOLIA_RPC" | awk '{print $1}'; }
locked(){ cast call "$TOK" "balanceOf(address)(uint256)" "$R" --rpc-url "$SEPOLIA_RPC" | awk '{print $1}'; }
waitfor(){ local desc=$1 cmd=$2 want=$3 t=0; while [ $t -lt ${4:-1800} ]; do v=$(eval "$cmd"); [ "$v" = "$want" ] && { ok "$desc ($((t))s)"; return 0; }; sleep 20; t=$((t+20)); done; bad "$desc (last=$v want=$want)"; return 1; }
deposit(){ snd "transferRemote $1" "$ETH_TEST_USER_ACCOUNT" "$R" "transferRemote(uint32,bytes32,uint256)" "$X1_DOMAIN" "$USER_X1_HEX" "$1" --value 0.01ether; }

# 0. setup
snd "mintTo (mock)" "$ETH_TEST_USER_ACCOUNT" "$TOK" "mintTo(address,uint256)" "$USER_ETH" 10000000000000000000000 >/dev/null
snd approve "$ETH_TEST_USER_ACCOUNT" "$TOK" "approve(address,uint256)" "$R" 115792089237316195423570985008687907853269984665640564039457584007913129639935
X0=$(x1bal); E0=$(ethbal); L0=$(locked)

# 1. dust rejected on-chain
# only an on-chain revert counts (not e.g. a password or RPC error)
if deposit 1000000000000000001 >/dev/null; then bad "dust amount accepted"
# cast --json prints the error on stdout, so snd keeps stdout+stderr of a failed send in $PWDIR/fail;
# 0x641a25e7 = AmountNotMultipleOfDustUnit(uint256,uint256)
elif grep -qiE 'revert|0x641a25e7' "$PWDIR/fail"; then ok "dust amount rejected ($(grep -oiE '0x641a25e7|execution reverted' "$PWDIR/fail" | head -1))"
else bad "dust deposit failed without a revert: $(head -c 200 "$PWDIR/fail")"; fi

# 2. ETH -> X1 round trip (100 VMPX). Router v2 keeps the bridge fee (3%) for the treasury: X1 receives the net
net18(){ cast call "$R" "quoteBridgeFee(uint256)(uint256,uint256)" "$1" --rpc-url "$SEPOLIA_RPC" | sed -n 2p | awk '{print $1}'; }
N100=$(net18 100000000000000000000)
deposit 100000000000000000000 && ok "deposit 100 sent (overpaid 0.01 ETH, refund expected)"
waitfor "net $N100 wei minted on X1" "x1bal" "$(python3 -c "from decimal import Decimal as D; print(format((D('$X0')+D($N100)/10**18).normalize(), 'f'))")" || { echo "STOP: no delivery Sepolia -> X1"; exit 1; }

# 3. X1 -> ETH (40 VMPXe)
sl token transfer-remote --program-id "$P" "$X1_TEST_USER_KEYPAIR" 40000000000 "$SEPOLIA_DOMAIN" "$(b32 "$USER_ETH")" synthetic | tee "$WORK/state/e2e-x1-transfer-40.txt"
waitfor "40 VMPX unlocked on Sepolia" "ethbal" "$(python3 -c "print($E0 - 100*10**18 + 40*10**18)")" || { echo "STOP: no delivery X1 -> Sepolia"; exit 1; }

# 4. EMERGENCY STOP by a single pauser key: deposits AND unlocks stop, nothing is lost
EP=$(state_get sepolia_pauser)
snd pauseAll "$PAUSER_ACCOUNT" "$EP" "pauseAll(string)" "e2e drill" && ok "pauseAll by single pauser key"
B=$(ethbal); deposit 1000000000000000000 >/dev/null && bad "deposit while paused succeeded" || ok "deposit blocked while paused"
[ "$(ethbal)" = "$B" ] && ok "no tokens taken while paused" || bad "balance changed while paused"
sl token transfer-remote --program-id "$P" "$X1_TEST_USER_KEYPAIR" 10000000000 "$SEPOLIA_DOMAIN" "$(b32 "$USER_ETH")" synthetic
sleep 600; [ "$(ethbal)" = "$B" ] && ok "unlock held for 10 min while paused" || bad "unlock happened while paused"
snd "unpause by pauser" "$PAUSER_ACCOUNT" "$EP" "unpause(bool,bool)" false true >/dev/null && bad "pauser could unpause" || ok "pauser cannot unpause"

# 5. guardian restarts; held unlock is delivered
snd "unpause by guardian" "$GUARDIAN_ACCOUNT" "$EP" "unpause(bool,bool)" true true && ok "guardian unpaused"
waitfor "held unlock delivered after unpause" "ethbal" "$(python3 -c "print($B + 10*10**18)")"

# 6. pause mints on X1 (ISM switch to closed) -> ETH->X1 waits, then completes
sl token set-interchain-security-module --program-id "$P" --ism "$(state_get x1_closed_ism)"
B=$(x1bal); N5=$(net18 5000000000000000000); deposit 5000000000000000000
sleep 600; [ "$(x1bal)" = "$B" ] && ok "mint held for 10 min with closed ISM" || bad "mint happened with closed ISM"
sl token set-interchain-security-module --program-id "$P" --ism "$(state_get x1_open_ism)"
waitfor "held mint (net $N5 wei) delivered after ISM restored" "x1bal" "$(python3 -c "from decimal import Decimal as D; print(format((D('$B')+D($N5)/10**18).normalize(), 'f'))")"

# 7. collateral invariant
SUP=$(spl-token supply "$MINT" -u "$X1_RPC" --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
python3 - "$(locked)" "$SUP" "$S0" <<'PY' && ok "lockbox - X1 supply == surplus at start (nothing lost or created)" || bad "collateral mismatch"
import sys; from decimal import Decimal
locked=int(sys.argv[1]); sup=Decimal(sys.argv[2]); s0=int(sys.argv[3])
surplus=locked-int(sup*10**18)
print("locked", locked, "supply", sup, "surplus", surplus, "surplus at start", s0); sys.exit(0 if surplus==s0 else 1)
PY

# 8. post-deploy authorities
# fail closed (Codex M-02): the expected authorities come from testnet.env and must be set explicitly, even when they
# are the testnet deployer; the ISM, router and mailbox come from the deployment state, the ISM validator set and
# threshold from the same variables 03-deploy-x1-core.sh used. The token storage PDA is derived from its seeds.
node "$REPO/svm/compat/check-x1.mjs" --rpc "$X1_RPC" --post-deploy --mint "$MINT" --program "$P" \
  --mailbox "$(state_get x1_mailbox)" \
  --expect-upgrade-authority "${X1_EXPECT_UPGRADE_AUTHORITY:?set X1_EXPECT_UPGRADE_AUTHORITY in testnet.env}" \
  --expect-metadata-authority "${X1_EXPECT_METADATA_AUTHORITY:?set X1_EXPECT_METADATA_AUTHORITY in testnet.env}" \
  --expect-owner "${X1_EXPECT_TOKEN_OWNER:?set X1_EXPECT_TOKEN_OWNER in testnet.env}" \
  --expect-igp-beneficiary "${X1_EXPECT_IGP_BENEFICIARY:?set X1_EXPECT_IGP_BENEFICIARY in testnet.env}" \
  --expect-ism "$(state_get x1_open_ism)" --expect-router "$SEPOLIA_DOMAIN:$(state_get sepolia_router)" \
  --expect-validators "$SEPOLIA_VALIDATORS" --expect-threshold "$SEPOLIA_THRESHOLD" \
  && ok "X1 authorities check" || bad "X1 authorities check (see output)"

echo; echo "RESULT: $PASSES PASS / $FAILS FAIL"; [ $FAILS -eq 0 ]
