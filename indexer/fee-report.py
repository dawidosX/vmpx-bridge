#!/usr/bin/env python3
"""Read-only fee report for the testnet bridge (Sepolia <-> X1 testnet). Never signs or sends anything."""
import json, urllib.request, base64, struct, time, sys
SEP = ["https://ethereum-sepolia.publicnode.com", "https://sepolia.gateway.tenderly.co"]
X1 = "https://rpc.testnet.x1.xyz"
HOOK = "0x72bcd91fc700d665e0e681fdf7ab3b7ed9a8f3d8"
PROTO = "0x13ac3349cb159fe86a22cf42dda803d9f7309db5"
MAILBOX = "0xffaef09b3cd11d9b20d1a19becca54eec2884766"
IGP_PROG = "JLoJ1h1jHptFr2WndUQHq5kWDy8L5jrKfujZfBw2s57"; IGP = "Be8bQp2EhQVa4ZGimjzj3kGZ7CvK6Jj4Ftt8rUjeDVZg"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58(b):
    n = int.from_bytes(b, "big"); s = ""
    while n: n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s
def rpc(url, m, p):
    for i in range(4):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": m, "params": p}).encode(), {"content-type": "application/json", "user-agent": "fee-report"}), timeout=30).read())
            if "error" in r: raise RuntimeError(r["error"])
            return r["result"]
        except Exception as e:
            last = e; time.sleep(1 + i)
    raise last
def erpc(m, p):
    last = None
    for u in SEP:
        try: return rpc(u, m, p)
        except Exception as e: last = e
    raise last
def kec(sig):
    import subprocess; return subprocess.run(["cast", "keccak", sig], capture_output=True, text=True).stdout.strip()
def api_all():
    items, page = [], 1
    while True:
        d = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://bridge.x1watch.xyz/api/transfers?page={page}", headers={"user-agent": "Mozilla/5.0 (fee-report)"}), timeout=20).read())
        items += d["items"]
        if page >= d["pages"]: return items
        page += 1
E = 1e18; L = 1e9
out = {}
items = api_all(); by_id = {i["id"]: i for i in items}
now = int(time.time()); DAY = now - 86400
print(f"transfers in history: {len(items)}  (e2x {sum(i['dir']=='e2x' for i in items)}, x2e {sum(i['dir']=='x2e' for i in items)})")

# 1. fee hook
T_CH = kec("FeeCharged(bytes32,address,uint256,uint256,bool)"); T_WD = kec("FeesWithdrawn(address,uint256)"); T_BS = kec("BeneficiarySet(address)")
tip = int(erpc("eth_blockNumber", []), 16)
logs = []; frm = 12005000
while frm <= tip:
    to = min(frm + 4999, tip)
    logs += erpc("eth_getLogs", [{"fromBlock": hex(frm), "toBlock": hex(to), "address": HOOK}]); frm = to + 1
first = min((int(l["blockNumber"], 16) for l in logs), default=None)
ch = [l for l in logs if l["topics"][0] == T_CH]; wd = [l for l in logs if l["topics"][0] == T_WD]
fees = []
for l in ch:
    d = bytes.fromhex(l["data"][2:]); amount, fee, stale = int.from_bytes(d[0:32], "big"), int.from_bytes(d[32:64], "big"), int.from_bytes(d[64:96], "big")
    mid = l["topics"][1]; it = by_id.get(mid, {})
    fees.append({"id": mid, "fee": fee, "stale": bool(stale), "bot": it.get("bot"), "sent": it.get("sent"), "block": int(l["blockNumber"], 16)})
bal = int(erpc("eth_getBalance", [HOOK, "latest"]), 16)
withdrawn = sum(int(l["data"][2:][64:128] or "0", 16) if len(l["data"]) > 66 else int(l["data"], 16) for l in wd)
print("\n== 1. VmpxEthFeeHook", HOOK)
print(f"first event block {first}; FeeCharged events {len(ch)}; FeesWithdrawn {len(wd)}; BeneficiarySet {sum(l['topics'][0]==T_BS for l in logs)}")
tot = sum(f["fee"] for f in fees)
print(f"balance {bal/E:.6f} ETH | sum FeeCharged {tot/E:.6f} ETH | withdrawn {withdrawn/E:.6f} ETH | balance-sum diff {(bal-tot+withdrawn)/E:.9f}")
print(f"avg fee {tot/max(1,len(fees))/E:.6f} ETH | stale fallback {sum(f['stale'] for f in fees)} (sum {sum(f['fee'] for f in fees if f['stale'])/E:.4f} ETH)")
for k, g in (("bot", [f for f in fees if f["bot"] is True]), ("people", [f for f in fees if f["bot"] is False]), ("unknown", [f for f in fees if f["bot"] is None])):
    print(f"  {k}: {len(g)} transfers, {sum(f['fee'] for f in g)/E:.6f} ETH")
print(f"  last 24 h: {sum(1 for f in fees if (f['sent'] or 0) >= DAY)} transfers, {sum(f['fee'] for f in fees if (f['sent'] or 0) >= DAY)/E:.6f} ETH")

# 3. protocol fee (Mailbox required hook)
pf = int(erpc("eth_call", [{"to": PROTO, "data": kec("protocolFee()")[:10]}, "latest"]), 16)
n_e2x = sum(1 for i in items if i["dir"] == "e2x")
print(f"\n== 3. Hyperlane protocol fee (Sepolia required hook {PROTO}): {pf} wei per message x {n_e2x} e2x = {pf*n_e2x} wei; X1 mailbox logs 'Protocol fee of 0'")

# 2. X1 IGP
acc = rpc(X1, "getAccountInfo", [IGP, {"encoding": "base64", "commitment": "finalized"}])["value"]
d = base64.b64decode(acc["data"][0]); lam = acc["lamports"]
rent = rpc(X1, "getMinimumBalanceForRentExemption", [len(d)])
o = 1 + 8 + 1 + 32  # initialized, discriminator, bump, salt
owner = None
if d[o] == 1: owner = b58(d[o+1:o+33]); o += 33
else: o += 1
benef = b58(d[o:o+32]); o += 32
n = struct.unpack_from("<I", d, o)[0]; o += 4; oracles = {}
for _ in range(n):
    dom = struct.unpack_from("<I", d, o)[0]; o += 4; tag = d[o]; o += 1
    rate = int.from_bytes(d[o:o+16], "little"); gp = int.from_bytes(d[o+16:o+32], "little"); dec = d[o+32]; o += 33
    oracles[dom] = (rate, gp, dec)
pays = rpc(X1, "getProgramAccounts", [IGP_PROG, {"encoding": "base64", "commitment": "finalized", "filters": [{"memcmp": {"offset": 1, "bytes": b58(b"GASPAYMT")}}]}])
gp_list = []
for a in pays:
    x = base64.b64decode(a["account"]["data"][0]); p = 9
    seq = struct.unpack_from("<Q", x, p)[0]; igp = b58(x[p+8:p+40]); dom = struct.unpack_from("<I", x, p+40)[0]
    mid = "0x" + x[p+44:p+76].hex(); gas = struct.unpack_from("<Q", x, p+76)[0]; pay = struct.unpack_from("<Q", x, p+84)[0]
    if igp == IGP: gp_list.append({"id": mid, "gas": gas, "pay": pay, "dom": dom, "bot": by_id.get(mid, {}).get("bot"), "sent": by_id.get(mid, {}).get("sent")})
paid = sum(g["pay"] for g in gp_list)
print(f"\n== 2. X1 IGP {IGP}")
print(f"owner {owner} | beneficiary {benef} | claim(): anyone can call, lamports above rent go to the beneficiary")
print(f"balance {lam/L:.6f} XNT, rent-exempt minimum {rent/L:.6f} XNT, claimable {(lam-rent)/L:.6f} XNT")
print(f"gas payments {len(gp_list)}, sum {paid/L:.6f} XNT, gas quoted {sum(g['gas'] for g in gp_list)} | claimed so far ~{(paid-(lam-rent))/L:.6f} XNT")
for k, g in (("bot", [x for x in gp_list if x["bot"] is True]), ("people", [x for x in gp_list if x["bot"] is False]), ("unknown", [x for x in gp_list if x["bot"] is None])):
    print(f"  {k}: {len(g)} payments, {sum(x['pay'] for x in g)/L:.6f} XNT")
print(f"  last 24 h: {sum(1 for x in gp_list if (x['sent'] or 0) >= DAY)} payments, {sum(x['pay'] for x in gp_list if (x['sent'] or 0) >= DAY)/L:.6f} XNT")
if 11155111 in oracles:
    rate, gp, dec = oracles[11155111]
    print(f"gas oracle for Sepolia: token_exchange_rate {rate}, gas_price {gp} wei, token_decimals {dec}")

# relayer spend: Sepolia gas of X1->ETH deliveries, X1 fees of ETH->X1 deliveries
eth_cost = 0; relayers = set(); gas_used = []
for i in items:
    if i["dir"] == "x2e" and i.get("delivered_tx"):
        r = None
        for u in SEP:
            try: r = rpc(u, "eth_getTransactionReceipt", [i["delivered_tx"]])
            except Exception: r = None
            if r: break
        if not r: print("  no receipt for", i["delivered_tx"]); continue
        c = int(r["gasUsed"], 16) * int(r["effectiveGasPrice"], 16); eth_cost += c; relayers.add(r["from"]); gas_used.append(int(r["gasUsed"], 16))
x1_cost = 0; x1_payers = set(); n1 = 0
for i in items:
    if i["dir"] == "e2x" and i.get("delivered_tx"):
        t = rpc(X1, "getTransaction", [i["delivered_tx"], {"encoding": "json", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}])
        if not t: continue
        x1_payers.add(t["transaction"]["message"]["accountKeys"][0]); x1_cost += t["meta"]["preBalances"][0] - t["meta"]["postBalances"][0]; n1 += 1
print(f"\n== relayer spend")
print(f"Sepolia (X1->ETH deliveries): {len(gas_used)} tx from {sorted(relayers)}, gasUsed avg {sum(gas_used)//max(1,len(gas_used))}, cost {eth_cost/E:.6f} ETH")
print(f"X1 (ETH->X1 deliveries, fee payer drop incl. rent for new accounts): {n1} tx from {sorted(x1_payers)}, cost {x1_cost/L:.6f} XNT")
json.dump({"hook_fees_wei": tot, "igp_paid_lamports": paid, "eth_relayer_cost_wei": eth_cost, "x1_relayer_cost_lamports": x1_cost}, open(sys.argv[1] if len(sys.argv) > 1 else "/dev/null", "w"))
