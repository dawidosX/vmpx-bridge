#!/usr/bin/env bash
# check-roles.sh against a fake `cast` (no network, no keys). Usage: bash evm/script/test/check-roles.test.sh
# The fake chain is one JSON file ($FAKE): tip, chain id, deployment blocks, every log, the timelock delay, pending ids,
# plain call answers and failure switches. hasRole/isPauser are derived from the logs unless overridden, like a real node.
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd); SCRIPT="$HERE/check-roles.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
cat > "$T/bin/cast" <<'C'
#!/usr/bin/env python3
import json, os, sys
S = json.load(open(os.environ["FAKE"]))
args = sys.argv[1:]; cmd = args.pop(0); opt = {}; pos = []; flags = ("--block", "--rpc-url", "--from-block", "--to-block", "--address")
while args:
    a = args.pop(0)
    if a in flags: opt[a] = args.pop(0)
    elif a == "--json": opt[a] = True
    else: pos.append(a)
open(os.environ["FAKE"] + ".log", "a").write(cmd + " " + " ".join(sys.argv[2:]) + "\n")
def die(m): print("Error: " + m, file=sys.stderr); sys.exit(1)
def counter(name):
    p = os.environ["FAKE"] + "." + name; n = int(open(p).read()) + 1 if os.path.exists(p) else 1
    open(p, "w").write(str(n)); return n
lc = str.lower; G, R = "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d", "0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b"
PS = "0xa11b5803b8a35081b8f993e0dee5bc30301a3d83f644e5ab2ff39f972f0a807f"
logs = sorted(S["logs"], key=lambda l: (l["b"], l["i"]))
def blk(): b = opt.get("--block", "latest"); return S["tip"] if b == "latest" else int(b)
if cmd == "block-number": print(S["tip"])
elif cmd == "chain-id": print(S.get("chain", 11155111))
elif cmd == "to-dec": print(int(pos[0], 16))
elif cmd == "storage": print("0x" + "0" * 64)
elif cmd == "code":
    if S.get("code_fail"): die("server returned an error response: error code 4444: pruned history unavailable")
    d = S["deploy"].get(lc(pos[0])); print("0x6080604052" if d is not None and blk() >= d else "0x")
elif cmd == "logs":
    f, t, ad = int(opt["--from-block"]), int(opt["--to-block"]), lc(opt["--address"])
    if S.get("logs_fail"): die("server returned an error response: error code 4444: pruned history unavailable")
    if t - f + 1 > S.get("max_range", 10**9): die("exceed maximum block range")
    if f in S.get("fail_chunk_from", []): die("chunk refused")
    if f in S.get("fail_once_from", []) and counter("once%d" % f) == 1: die("temporary")
    if S.get("garbage"): print("<html>502 Bad Gateway</html>"); sys.exit(0)
    out = [{"address": ad, "topics": l["t"], "data": l.get("d", "0x"), "blockNumber": hex(l["b"]), "logIndex": hex(l["i"]), "removed": False}
           for l in logs if lc(l["a"]) == ad and f <= l["b"] <= t and l["b"] >= S.get("logs_pruned_below", 0)]
    if S.get("out_of_range") and out: out[0]["blockNumber"] = hex(t + 5)
    print(json.dumps(out))
elif cmd == "call":
    to, sig, rest = lc(pos[0]), pos[1], [lc(x) for x in pos[2:]]; b = blk()
    key = "|".join([to, sig] + rest)
    if key in S.get("calls", {}): print(S["calls"][key])
    elif sig.startswith("hasRole("):
        if key in S.get("hasrole_override", {}): print(S["hasrole_override"][key]); sys.exit(0)
        held = False
        for l in logs:
            if lc(l["a"]) == to and l["b"] <= b and l["t"][0] in (G, R) and l["t"][1] == rest[0] and "0x" + l["t"][2][-40:] == rest[1]:
                held = l["t"][0] == G
        print("true" if held else "false")
    elif sig.startswith("isPauser("):
        on = False
        for l in logs:
            if lc(l["a"]) == to and l["b"] <= b and l["t"][0] == PS and "0x" + l["t"][1][-40:] == rest[0]: on = int(l["d"], 16) != 0
        print("true" if on else "false")
    elif sig.startswith("getMinDelay("): v = S.get("delay", 300); print(v if v < 100000 else "%d [%.3e]" % (v, v))
    elif sig.startswith("isOperationPending("): print("true" if rest[0] in S.get("pending", []) else "false")
    else: die("fake cast: no answer for call " + key)
else: die("fake cast: unknown command " + cmd)
C
chmod +x "$T/bin/cast"

# addresses (the Sepolia ones from docs/15; X = an unexpected extra account)
# placeholder addresses of the fake chain (not real accounts)
TL=0x00000000000000000000000000000000000071e1; SAFE=0x0000000000000000000000000000000000005afe
GUARD=0x000000000000000000000000000000000000600d; DEP=0x00000000000000000000000000000000000de901
OLDG=0x00000000000000000000000000000000000001d6; X=0x00000000000000000000000000000000000badad
PAU=0x921c892e30fcb3b2c164c967228174d97d519f4f; BOT=0x0000000000000000000000000000000000000b07

# gen SCENARIO [python statements mutating S]: writes $T/fake.json
gen() {
  python3 - "$T/fake.json" "$1" <<PY
import json, sys
TL, SAFE, GUARD, DEP, OLDG, X, PAU, BOT = "$TL", "$SAFE", "$GUARD", "$DEP", "$OLDG", "$X", "$PAU", "$BOT"
P = "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1"; E = "0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63"
C = "0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783"; A = "0x5f58e3a2316349923ce3780f8d587db2d72378aed66a8261c916544fa6846ca5"
D = "0x" + "0" * 64
G, R = "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d", "0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b"
AC = "0xbd79b86ffe0ab8e8776151514217cd7cacd52c909f66475c3af44e129f0b00ff"; CS = "0x4cf4410cc57040e44862ef0f45f3dd5a5e02db8eb8add648d4b0e236f1d07dca"
PS = "0xa11b5803b8a35081b8f993e0dee5bc30301a3d83f644e5ab2ff39f972f0a807f"
w = lambda a: "0x" + "0" * 24 + a[2:]
idx = [0]
def ev(b, t, a=TL, d="0x"): idx[0] += 1; S["logs"].append({"a": a, "b": b, "i": idx[0], "t": t, "d": d})
grant = lambda b, role, who: ev(b, [G, role, w(who), w(DEP)])
revoke = lambda b, role, who: ev(b, [R, role, w(who), w(SAFE)])
S = {"tip": 1000, "chain": 11155111, "deploy": {TL: 100, PAU: 120}, "delay": 300, "logs": [], "pending": [], "calls": {}}
# constructor (block 100): role admins, timelock + deployer admin, deployer proposer/executor/canceller, old guardian canceller,
# deployer renounces admin
for r in (A, P, E, C): ev(100, [AC, r, D, A])
grant(100, A, TL); grant(100, A, DEP); grant(100, P, DEP); grant(100, C, DEP); grant(100, E, DEP); grant(100, C, OLDG)
ev(100, [R, A, w(DEP), w(DEP)])
# pauser deployed at 120 with one bot pauser
ev(120, [PS, w(BOT)], a=PAU, d="0x" + "0" * 63 + "1")
# step 2A (block 400): Safe proposer/executor/canceller, guardian Ledger canceller
ev(399, [CS, "0x" + "aa" * 32, D]); grant(400, P, SAFE); grant(400, E, SAFE); grant(400, C, SAFE); grant(400, C, GUARD)
# step 2B (block 700, scheduled by the Safe at 650)
ev(650, [CS, "0x" + "bb" * 32, D]); revoke(700, P, DEP); revoke(700, E, DEP); revoke(700, C, DEP); revoke(700, C, OLDG)
calls = {(PAU, "guardian()(address)"): GUARD, (PAU, "pendingGuardian()(address)"): "0x" + "0" * 40,
         ("0x00000000000000000000000000000000000fee00", "priceUpdater()(address)"): "0x" + "0" * 40,
         ("0x00000000000000000000000000000000000fee00", "beneficiary()(address)"): SAFE,
         ("0x0000000000000000000000000000000000000a11", "treasury()(address)"): SAFE,
         (SAFE, "getOwners()(address[])"): "[0x00000000000000000000000000000000000000a1, 0x00000000000000000000000000000000000000a2]",
         (SAFE, "getThreshold()(uint256)"): "2", (SAFE, "getModulesPaginated(address,uint256)(address[],address)|0x0000000000000000000000000000000000000001|10"): "[]\n0x0000000000000000000000000000000000000001"}
for c in ("0x0000000000000000000000000000000000000a11", "0x0000000000000000000000000000000000000a12", "0x00000000000000000000000000000000000fee00", "0x0000000000000000000000000000000000000a13"):
    calls[(c, "owner()(address)")] = TL
for c in ("0x0000000000000000000000000000000000000a14", "0x0000000000000000000000000000000000000a15"): calls[(c, "owner()(address)")] = PAU
S["calls"] = {"|".join(k): v for k, v in calls.items()}
exec(sys.argv[2])
json.dump(S, open(sys.argv[1], "w"))
PY
}
# run MODE [VAR=value ...]: the gate with the Sepolia addresses, 300-block chunks, no retry sleep
run() { local mode=$1; shift
  env PATH="$T/bin:$PATH" FAKE="$T/fake.json" ETH_RPC=fake LOGS_RPC=fake2 LOG_CHUNK=300 LOG_RETRY_SLEEP=0 \
    TIMELOCK=$TL SAFE=$SAFE GUARDIAN=$GUARD DEPLOYER=$DEP OLD_GUARDIAN=$OLDG \
    ROUTER=0x0000000000000000000000000000000000000a11 PROXY_ADMIN=0x0000000000000000000000000000000000000a12 \
    FEE_HOOK=0x00000000000000000000000000000000000fee00 RATE_ISM=0x0000000000000000000000000000000000000a13 \
    PAUSE_ISM=0x0000000000000000000000000000000000000a14 PAUSE_HOOK=0x0000000000000000000000000000000000000a15 \
    PAUSER=$PAU PAUSERS=$BOT PRICE_UPDATER=0x0000000000000000000000000000000000000000 BENEFICIARY=$SAFE TREASURY=$SAFE \
    SAFE_OWNERS=0x00000000000000000000000000000000000000a2,0x00000000000000000000000000000000000000a1 SAFE_THRESHOLD=2 \
    "$@" bash "$SCRIPT" "$mode" > "$T/out" 2>&1; echo $? > "$T/rc"; }
PASSN=0; FAILN=0
# expect NAME pass|fail [grep pattern that must appear in the output]
expect() { local name=$1 want=$2 pat=${3:-} rc; rc=$(cat "$T/rc")
  if { [ "$want" = pass ] && [ "$rc" = 0 ] && grep -q "RESULT: .* OK" "$T/out"; } || \
     { [ "$want" = fail ] && [ "$rc" = 1 ] && grep -q "RESULT: .* FAIL" "$T/out"; }; then
    if [ -z "$pat" ] || grep -qE -- "$pat" "$T/out"; then echo "ok    $name"; PASSN=$((PASSN+1)); return; fi
  fi
  echo "FAIL  $name (exit $rc, wanted $want${pat:+, pattern '$pat'})"; sed 's/^/        /' "$T/out"; FAILN=$((FAILN+1)); }

gen ""; run 2b;                                                    expect "2b: exact sets after step 2B pass" pass "PROPOSER holders = \{$SAFE \(Safe\)\}"
grep -q "deployment block 100 (found by code-size binary search)" "$T/out" && grep -q "4 chunk" "$T/out" \
  && { echo "ok    2b: deployment block found by binary search, 4 chunks of 300"; PASSN=$((PASSN+1)); } \
  || { echo "FAIL  binary search / chunks"; cat "$T/out"; FAILN=$((FAILN+1)); }
gen "S['logs'] = [l for l in S['logs'] if l['b'] != 700]"; run 2b;  expect "2b: before step 2B (deployer still holds roles) fails" fail "extra: +$DEP \(DEPLOYER\)"
gen "grant(800, P, X)"; run 2b;                                    expect "2b: extra proposer fails" fail "PROPOSER holders = .*$X"
gen "grant(800, E, X)"; run 2b;                                    expect "2b: extra executor fails" fail "EXECUTOR holders = .*$X"
gen "grant(800, C, X)"; run 2b;                                    expect "2b: extra canceller fails" fail "CANCELLER holders = .*$X"
gen "grant(800, A, X)"; run 2b;                                    expect "2b: extra timelock admin fails" fail "TIMELOCK_ADMIN holders = .*$X"
gen "grant(800, D, X)"; run 2b;                                    expect "2b: DEFAULT_ADMIN holder fails" fail "DEFAULT_ADMIN holders = .*$X"
gen "grant(800, '0x' + '12' * 32, X)"; run 2b;                     expect "2b: unknown role holder fails" fail "unexpected role 0x1212"
gen "grant(800, P, '0x' + '0' * 40)"; run 2b;                      expect "2b: proposer open to address(0) fails" fail "address\(0\) = anyone"
gen "revoke(800, C, GUARD)"; run 2b;                               expect "2b: guardian missing from cancellers fails" fail "missing: +$GUARD"
gen "grant(800, P, X); revoke(900, P, X); grant(810, A, X); revoke(820, A, X)"; run 2b
                                                                   expect "2b: granted then revoked is not a holder" pass
gen "S['delay'] = 0"; run 2b;                                      expect "2b: minDelay 0 fails" fail "minDelay is 0"
gen "S['delay'] = 600"; run 2b;                                    expect "2b: minDelay wrong fails" fail "minDelay = 600 s \(expected 300\)"
gen "S['delay'] = 600"; run 2b EXPECT_MIN_DELAY=600;               expect "2b: EXPECT_MIN_DELAY overrides the default" pass
gen "S['chain'] = 1; S['delay'] = 172800"; run 2b;                 expect "2b: mainnet 172800 passes" pass "minDelay = 172800 s"
gen "S['chain'] = 1; S['delay'] = 300"; run 2b;                    expect "2b: mainnet with testnet delay fails" fail "expected 172800"
gen "S['chain'] = 1; S['delay'] = 300"; run 2b EXPECT_MIN_DELAY=300; expect "2b: mainnet EXPECT_MIN_DELAY below 48 h fails" fail "below 48 h"
gen "S['chain'] = 17000"; run 2b;                                  expect "2b: unknown chain without EXPECT_MIN_DELAY fails" fail "set EXPECT_MIN_DELAY"
gen "S['logs_fail'] = True"; run 2b;                               expect "2b: logs unavailable fails" fail "event history incomplete"
rm -f "$T"/fake.json.*
gen "S['fail_chunk_from'] = [400]"; run 2b;                        expect "2b: one failing chunk fails" fail "chunk 400-699 failed after 3 attempt"
[ "$(grep -c "^logs .*--from-block 400 " "$T/fake.json.log")" = 3 ] && { echo "ok    2b: failing chunk retried LOG_RETRIES=3 times"; PASSN=$((PASSN+1)); } \
  || { echo "FAIL  retry count"; FAILN=$((FAILN+1)); }
rm -f "$T"/fake.json.*
gen "S['fail_once_from'] = [400]"; run 2b;                         expect "2b: transient chunk error is retried and passes" pass
rm -f "$T"/fake.json.*
gen "S['max_range'] = 200"; run 2b;                                expect "2b: RPC range limit not covered by LOG_CHUNK fails" fail "failed after 3 attempt"
gen "S['max_range'] = 200"; run 2b LOG_CHUNK=200;                  expect "2b: smaller LOG_CHUNK covers the range limit" pass
gen "S['garbage'] = True"; run 2b;                                 expect "2b: non-JSON log answer fails" fail "not JSON"
gen "S['out_of_range'] = True"; run 2b;                            expect "2b: log outside the requested range fails" fail "outside"
gen "S['logs_pruned_below'] = 300"; run 2b;                        expect "2b: logs missing at the deployment block fail" fail "history does not start at the deployment"
gen "S['code_fail'] = True"; run 2b;                               expect "2b: deployment block unknown (pruned state) fails" fail "deployment block unknown"
gen "S['code_fail'] = True"; run 2b TIMELOCK_DEPLOY_BLOCK=100;     expect "2b: given block that cannot be verified fails" fail "deployment block unknown"
gen ""; run 2b TIMELOCK_DEPLOY_BLOCK=100;                          expect "2b: correct TIMELOCK_DEPLOY_BLOCK passes" pass "deployment block 100 \(given"
gen ""; run 2b TIMELOCK_DEPLOY_BLOCK=400;                          expect "2b: TIMELOCK_DEPLOY_BLOCK too late fails" fail "too late"
gen ""; run 2b TIMELOCK_DEPLOY_BLOCK=50;                           expect "2b: TIMELOCK_DEPLOY_BLOCK too early fails" fail "no code at the given"
gen ""; run 2b FROM_BLOCK=400;                                     expect "2b: old FROM_BLOCK name is verified too" fail "too late"
gen "S['deploy'].pop(TL)"; run 2b;                                 expect "2b: no code at the timelock fails" fail "no code at block"
gen "S['hasrole_override'] = {'|'.join([TL, 'hasRole(bytes32,address)(bool)', P, DEP]): 'true'}"; run 2b
                                                                   expect "2b: hasRole disagreeing with the events fails" fail "history incomplete"
gen "S['pending'] = ['0x' + 'bb' * 32]"; run 2b;                   expect "2b: pending operation fails" fail "pending: 0xbbbb"
gen ""; run 2b LOG_CHUNK=0;                                        expect "2b: LOG_CHUNK=0 fails" fail "LOG_CHUNK must be"
gen ""; run 2b SAFE=$DEP;                                          expect "2b: Safe = deployer misconfiguration fails" fail "configuration:"
gen ""; run full;                                                  expect "full: exact pauser set passes" pass "pausers = \{$BOT\}"
gen "ev(500, [PS, w(X)], a=PAU, d='0x' + '0' * 63 + '1')"; run full; expect "full: extra pauser fails" fail "pausers = .*$X"
gen "ev(500, [PS, w(X)], a=PAU, d='0x' + '0' * 63 + '1'); ev(600, [PS, w(X)], a=PAU, d='0x' + '0' * 64)"; run full
                                                                   expect "full: pauser enabled then disabled is not a pauser" pass
gen ""; run full PAUSERS=;                                         expect "full: pauser missing from the expected set fails" fail "expected exactly \{\}"
gen ""; run full PAUSER_DEPLOY_BLOCK=200;                          expect "full: PAUSER_DEPLOY_BLOCK too late fails" fail "pauser deployment block unknown"
gen "S['fail_chunk_from'] = [120]"; run full PAUSER_DEPLOY_BLOCK=120; expect "full: pauser log chunk failing fails" fail "pauser event history incomplete"

echo; echo "check-roles tests: $PASSN passed, $FAILN failed"
[ "$FAILN" = 0 ]
