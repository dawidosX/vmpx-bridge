#!/usr/bin/env python3
"""Read-only indexer for bridge.x1watch.xyz: "Live transfers" (activity.json) and the "Transactions" tab (SQLite).

ETH->X1: Sepolia Mailbox Dispatch logs from the lockbox; delivered when a PROCESSD account for the message id
exists in the X1 mailbox program. X1->ETH: DISPATCH accounts in the X1 mailbox from the token program; delivered
when Sepolia Mailbox.processedAt(id) > 0. X1 transaction signatures, the X1->ETH sender (owner of the burned
tokens) and fee payer are filled in afterwards from the X1 RPC, retried while the public RPC lags.

Full history lives in bridge.db (written only here). After every run it is copied to bridge-ro.db (atomic replace)
for the read-only API, and activity.json (stats + last 20 + pending) is written for the page.
Stdlib only. No keys, no writes to any chain.
"""
import base64, hashlib, json, os, sqlite3, struct, sys, tempfile, time, urllib.request

CFG = {
    "sepolia_rpcs": ["https://ethereum-sepolia.publicnode.com", "https://sepolia.gateway.tenderly.co"],
    "x1_rpc": "https://rpc.testnet.x1.xyz",
    "lockbox": "0x048c8208b0b37157fbbd71a737a34b1c5a00f6c8",
    "eth_mailbox": "0xffaef09b3cd11d9b20d1a19becca54eec2884766",
    "x1_mailbox": "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk",
    "x1_program_hex": "724b3be00087c10e54637d08c713120a53092f5650f82a03fe3e22fd5e1e89cc",
    "eth_domain": 11155111, "x1_domain": 1479626325,
    "start_block": 12014705, "chunk": 2000, "keep": 20,
    "eth_explorer": "https://sepolia.etherscan.io", "x1_explorer": "https://explorer.testnet.x1.xyz",
    "bots_file": os.environ.get("BRIDGE_BOTS_FILE", "/etc/bridge-activity/bots.txt"),
    "x1_mint": "GjSYfUZueEiH7pjP6df1aJimEBzDZKdJbP17akxjCBzj", "enrich_max_tries": 10, "enrich_per_run": 25,
    # fees: bridge fee in ETH (VmpxEthFeeHook FeeCharged, ETH->X1) and IGP payment in XNT (GASPAYMT accounts, X1->ETH)
    "fee_hook": "0x72bcd91fc700d665e0e681fdf7ab3b7ed9a8f3d8", "fee_backfill_from": 12005000,
    "igp_program": "JLoJ1h1jHptFr2WndUQHq5kWDy8L5jrKfujZfBw2s57", "igp": "Be8bQp2EhQVa4ZGimjzj3kGZ7CvK6Jj4Ftt8rUjeDVZg",
    # on-chain values for the Statistics tab (read every run, stored in meta "chain"; the API has no network access)
    "eth_token": "0xcc0c84755384b041470c021d338639eda8831e09", "rate_limit": "0xc60b96ab835caba72b044c8735e12b21af9b3002",
    # bridge status (header indicator): pause switches on both chains, delays, operator note
    "pausable_hook": "0xf7f5b15f42335049889b06d5d79c97a835991227", "pausable_ism": "0xa4d4b8ca2242fe5b3385b52b6dbc4ba42dc9eb9e",
    "x1_token_pda": "HwsnsE3EYDxdn4xMXSWZsPFAThgLF9B7p4tYywfuH8UM", "x1_open_ism": "8b7zDV7vu5FFpspj7SkULdeMjiU1HjYeutsikKB83cRc",
    "status_note_file": os.environ.get("BRIDGE_STATUS_NOTE", "/etc/bridge-activity/status-note.txt"),
    "delay_pending_s": 300, "delay_limit_pct": 5,
    # LP treasury (Statistics): X1 treasury = beneficiary of the mailbox protocol fee (read on-chain); VMPX treasury on
    # Ethereum comes with router v2 (None until then)
    "x1_outbox": "BhMiDcPuVq4pGEpM7qg3ZY5eXL4f7KKUeEwtD1k4aMQJ", "treasury_eth": "0x3731cB932D3277f2C763D1f8bc8aADDe8B1c77B9",
    # LP VMPXe/XNT on X1 testnet (XDEX = Raydium CP-swap fork) vs the real VMPX market on Ethereum mainnet. Testnet pool
    # prices are a simulation: test tokens priced with mainnet XNT/USD. Market reads are on-chain only (no price APIs).
    "pool": {"program": "7EEuq61z9VKdkUzj7G36xGd7ncyz8KBtUwAWVjypYQHf", "state": "F2TzYELpVEhFo1nib8aiXeh9Gmk5zdeCV2uiKLE8UK34",
             "start_xnt": 15000000000, "start_vmpxe": 3686000000000,   # Initialize, tx 2kMvGiiN… (31 Oct 2026)
             "x1_mainnet_rpc": "https://rpc.mainnet.x1.xyz",
             "xnt_usdc_state": "CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR",   # XDEX mainnet WXNT/USDC.X (largest WXNT pool)
             "eth_rpcs": ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
             "vmpx_weth_v3": "0xd6eb9af2b8a37f5a7451e2a445cb93661a466a66",   # Uniswap v3 VMPX/WETH 1%, token0 = VMPX
             "usdc_weth_v2": "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc"},  # Uniswap v2 USDC/WETH, token0 = USDC
}
TOPIC_DISPATCH = "0x769f711d20c679153d382254f59892613b58a97cc876b249134ac25c80f9c814"   # Dispatch(address,uint32,bytes32,bytes)
TOPIC_DISPATCH_ID = "0x788dbc1b7152732178210e7f4d9d010ef016f9eafbe66786bd7169f56e0c353a"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

# ---------- keccak256 (pure python, for X1 message ids) ----------
_RC = [0x1, 0x8082, 0x800000000000808A, 0x8000000080008000, 0x808B, 0x80000001, 0x8000000080008081,
       0x8000000000008009, 0x8A, 0x88, 0x80008009, 0x8000000A, 0x8000808B, 0x800000000000008B, 0x8000000000008089,
       0x8000000000008003, 0x8000000000008002, 0x8000000000000080, 0x800A, 0x800000008000000A, 0x8000000080008081,
       0x8000000000008080, 0x80000001, 0x8000000080008008]
_ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]]
_M = (1 << 64) - 1
def _f(a):
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ (((c[(x + 1) % 5] << 1) | (c[(x + 1) % 5] >> 63)) & _M) for x in range(5)]
        a = [[a[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                r = _ROT[x][y]
                b[y][(2 * x + 3 * y) % 5] = ((a[x][y] << r) | (a[x][y] >> (64 - r))) & _M if r else a[x][y]
        a = [[b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        a[0][0] ^= rc
    return a
def keccak256(data: bytes) -> bytes:
    rate = 136
    p = bytearray(data) + b"\x01"
    p += b"\x00" * ((-len(p)) % rate); p[-1] |= 0x80
    a = [[0] * 5 for _ in range(5)]
    for off in range(0, len(p), rate):
        blk = p[off:off + rate]
        for i in range(rate // 8):
            a[i % 5][i // 5] ^= int.from_bytes(blk[8 * i:8 * i + 8], "little")
        a = _f(a)
    return b"".join(a[i % 5][i // 5].to_bytes(8, "little") for i in range(4))

# ---------- helpers ----------
def rpc(url, method, params):
    req = urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 {"content-type": "application/json", "user-agent": "bridge-activity/1"})
    for i in range(3):
        try:
            j = json.loads(urllib.request.urlopen(req, timeout=20).read())
            if "error" in j: raise RuntimeError(f"{method}: {j['error']}")
            return j["result"]
        except Exception:
            if i == 2: raise
            time.sleep(2 * (i + 1))
def erpc(method, params):
    last = None
    for u in CFG["sepolia_rpcs"]:
        try: return rpc(u, method, params)
        except Exception as e: last = e
    raise last
def b58(b: bytes) -> str:
    n = int.from_bytes(b, "big"); s = ""
    while n: n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s
def short(a): return a[:6] + "…" + a[-4:]
def b58dec(s: str) -> bytes:
    n = 0
    for c in s: n = n * 58 + B58.index(c)
    return b"\0" * (len(s) - len(s.lstrip("1"))) + (n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b"")

# ---- Solana PDA (Codex round 3, R-01: a delivery is accepted only from the account at the processed-message PDA)
_P = 2 ** 255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P
def on_curve(b: bytes) -> bool:
    """True if the 32 bytes decode to a point on ed25519 (a PDA must NOT be on the curve)."""
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= _P: return False
    u, v = (y * y - 1) % _P, (_D * y * y + 1) % _P
    x2 = u * pow(v, _P - 2, _P) % _P
    if x2 == 0: return (b[31] >> 7) == 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0: x = x * pow(2, (_P - 1) // 4, _P) % _P
    return (x * x - x2) % _P == 0
def find_pda(seeds, program_b58: str) -> str:
    prog = b58dec(program_b58)
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + prog + b"ProgramDerivedAddress").digest()
        if not on_curve(h): return b58(h)
    raise ValueError("no PDA")

def mailbox_account(pubkey: str, d: bytes, mailbox: str):
    """Classify an X1 mailbox account by its fixed layout: 1 byte `initialized` + 8-byte discriminator (upstream
    account-utils AccountData + mailbox accounts.rs). Never searches inside the data: a DISPATCH account carries an
    arbitrary sender-controlled message body (Codex round 3, R-01).
      ("processed", message_id_hex, slot)  only if the account is the processed-message PDA of that id
      ("dispatch", slot, encoded_message)
      None                                 anything else"""
    if len(d) < 9 or d[0] != 1: return None
    disc = d[1:9]
    if disc == b"PROCESSD" and len(d) >= 1 + 56:
        mid = d[17:49]
        if find_pda([b"hyperlane", b"-", b"processed_message", b"-", mid], mailbox) != pubkey: return None
        return ("processed", "0x" + mid.hex(), int.from_bytes(d[49:57], "little"))
    if disc == b"DISPATCH" and len(d) >= 1 + 52:
        return ("dispatch", int.from_bytes(d[13:21], "little"), d[53:])
    return None

def solvency(lockbox: int, supply9: int, pending_e2x: int, pending_x2e: int) -> int:
    """lockbox - liabilities (Codex round 3, R-03). Every locked token backs X1 supply, an ETH->X1 transfer not yet
    minted, or an X1->ETH burn not yet unlocked. >= 0: covered (the rest is a donation / direct transfer)."""
    return lockbox - (supply9 * 10 ** 9 + pending_e2x + pending_x2e)

SHORTFALL_ALARM_S = 1800
SHORTFALL_MAX_GAP_S = 180   # R6-06: a longer gap between successful runs restarts the timer (timer: 60 s after each run)
def unhashed_rows(db):
    """Rows the reorg check cannot cover (Codex round 5, R5-05): a deposit without its block hash or an X1->ETH
    delivery without one. Any such row makes the snapshot incomplete."""
    return db.execute("SELECT count(*) FROM transfers WHERE (dir='e2x' AND sent_blockhash IS NULL) "
                      "OR (dir='x2e' AND delivered IS NOT NULL AND delivered_blockhash IS NULL)").fetchone()[0]

def solvent_check(since: int, bal: int, complete: bool, now: int, last: int = 0):
    """(ok, since). Round C (docs/16-auto-pause-model.md): the balance rule is a heuristic for a human, never a pause.
    Reads of two chains are never one snapshot, so a shortfall is reported (ok=False, page alarm) only after it has
    lasted SHORTFALL_ALARM_S on consecutive runs; until then and with incomplete data: None ("checking"), never True.
    R6-06 / R7-04: `last` is the time of the previous COMPLETE check; an incomplete run breaks the continuity (the timer
    restarts) and a gap longer than SHORTFALL_MAX_GAP_S since the last complete check restarts it too."""
    if not complete: return None, 0
    if since and last and now - last > SHORTFALL_MAX_GAP_S: since = 0
    since = (since or now) if bal < 0 else 0
    if bal < 0: return (False if now - since >= SHORTFALL_ALARM_S else None), since
    return True, since
def load_bots():
    """Addresses of the operator's test bots (one per line, EVM 0x… or X1 base58); transfers touching them get bot=true."""
    try: return {l.strip().lower() for l in open(CFG["bots_file"]) if l.strip() and not l.startswith("#")}
    except OSError: return set()
def median(v):
    v = sorted(v)
    if not v: return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) // 2
def parse_msg(m: bytes):
    body = m[77:]
    return {"nonce": int.from_bytes(m[1:5], "big"), "origin": int.from_bytes(m[5:9], "big"), "sender": m[9:41].hex(),
            "dest": int.from_bytes(m[41:45], "big"), "recipient": m[45:77], "rcpt": body[0:32],
            "amount": int.from_bytes(body[32:64], "big")}
_bt, _ref = {}, {}
def x1_time(slot):
    """(unix time, approximate?) of an X1 slot. The public RPC keeps block times for ~1-2 days only; older slots
    are estimated from a recent reference slot and the current slot rate."""
    if slot not in _bt:
        try:
            t = rpc(CFG["x1_rpc"], "getBlockTime", [slot]); _bt[slot] = (t, False) if t else None
        except Exception:
            _bt[slot] = None
        if _bt[slot] is None:
            if not _ref:
                rs = rpc(CFG["x1_rpc"], "getSlot", [{"commitment": "finalized"}])
                ps = rpc(CFG["x1_rpc"], "getRecentPerformanceSamples", [60])
                _ref.update(slot=rs, time=rpc(CFG["x1_rpc"], "getBlockTime", [rs]),
                            rate=sum(p["numSlots"] for p in ps) / max(1, sum(p["samplePeriodSecs"] for p in ps)))
            _bt[slot] = (int(_ref["time"] - (_ref["slot"] - slot) / _ref["rate"]), True)
    return _bt[slot]

# ---------- main ----------
def write_json(path, obj):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix=".activity.")
    with os.fdopen(fd, "w") as f: json.dump(obj, f, separators=(",", ":"))
    os.chmod(tmp, 0o644); os.replace(tmp, path)

def log(msg): print(msg, file=sys.stderr)

# ---------- database ----------
SCHEMA = """
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,            -- Hyperlane message id 0x...64
  dir TEXT NOT NULL,              -- 'e2x' | 'x2e'
  amount TEXT NOT NULL,           -- 18 decimals
  sender TEXT, recipient TEXT,    -- ETH lowercase, X1 base58; X1->ETH sender = owner of the burned tokens
  fee_payer TEXT,                 -- X1->ETH: fee payer of the X1 transaction
  sent INTEGER, sent_approx INTEGER NOT NULL DEFAULT 0, sent_tx TEXT,
  delivered INTEGER, delivered_approx INTEGER NOT NULL DEFAULT 0, delivered_tx TEXT,
  delivered_block INTEGER,        -- X1->ETH: Sepolia block, when the tx hash is not known
  x1_account TEXT,                -- DISPATCH (X1->ETH) or PROCESSD (ETH->X1) account
  enrich_tries INTEGER NOT NULL DEFAULT 0,
  bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS t_sent ON transfers(sent DESC);
CREATE INDEX IF NOT EXISTS t_filter ON transfers(dir, bot, sent DESC);
CREATE INDEX IF NOT EXISTS t_bot ON transfers(bot, sent DESC);
CREATE INDEX IF NOT EXISTS t_sender ON transfers(sender);
CREATE INDEX IF NOT EXISTS t_recipient ON transfers(recipient);
CREATE INDEX IF NOT EXISTS t_fee_payer ON transfers(fee_payer);
CREATE INDEX IF NOT EXISTS t_sent_tx ON transfers(sent_tx);
CREATE INDEX IF NOT EXISTS t_delivered_tx ON transfers(delivered_tx);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""
def meta_get(db, k, default=None):
    r = db.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return json.loads(r[0]) if r else default
def meta_set(db, k, v): db.execute("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", (k, json.dumps(v)))

# ---------- X1 enrichment ----------
def x1_first_sig(pubkey):
    """Signature of the transaction that created an account (mailbox accounts are written once)."""
    sigs = rpc(CFG["x1_rpc"], "getSignaturesForAddress", [pubkey, {"commitment": "finalized", "limit": 1000}])
    ok = [s for s in sigs if not s.get("err")]
    return ok[-1]["signature"] if ok else None

def x1_burn_parties(sig, amount18):
    """(sender, fee_payer) of an X1->ETH transfer_remote tx. sender = owner of the burned tokens: the authority of
    burn/burnChecked on our mint, confirmed by the token balance drop. On disagreement sender is None."""
    tx = rpc(CFG["x1_rpc"], "getTransaction", [sig, {"encoding": "jsonParsed", "commitment": "finalized",
                                                      "maxSupportedTransactionVersion": 0}])
    if not tx: return None, None
    keys = tx["transaction"]["message"]["accountKeys"]
    fee_payer = keys[0]["pubkey"] if isinstance(keys[0], dict) else keys[0]
    ixs = list(tx["transaction"]["message"]["instructions"])
    for g in (tx["meta"] or {}).get("innerInstructions") or []: ixs += g["instructions"]
    auth = set()
    for ix in ixs:
        p = ix.get("parsed")
        if isinstance(p, dict) and p.get("type") in ("burn", "burnChecked") and p["info"].get("mint") == CFG["x1_mint"]:
            a = p["info"].get("authority") or p["info"].get("multisigAuthority")
            if a: auth.add(a)
    want = int(amount18) // 10 ** 9
    pre = {(b.get("owner"), b["mint"]): int(b["uiTokenAmount"]["amount"]) for b in tx["meta"].get("preTokenBalances") or []}
    post = {(b.get("owner"), b["mint"]): int(b["uiTokenAmount"]["amount"]) for b in tx["meta"].get("postTokenBalances") or []}
    bal = {o for (o, m), v in pre.items() if m == CFG["x1_mint"] and o and v - post.get((o, m), 0) == want}
    if len(auth) == 1 and (not bal or auth == bal): return next(iter(auth)), fee_payer
    if not auth and len(bal) == 1: return next(iter(bal)), fee_payer
    log(f"warn {sig}: burn authority {sorted(auth)} vs balance owners {sorted(bal)}; sender left empty")
    return None, fee_payer

def enrich(db):
    rows = db.execute("""SELECT id, dir, amount, x1_account FROM transfers WHERE x1_account IS NOT NULL
                         AND enrich_tries < ? AND ((dir='x2e' AND sent_tx IS NULL) OR (dir='e2x' AND delivered IS NOT NULL AND delivered_tx IS NULL))
                         ORDER BY sent DESC LIMIT ?""", (CFG["enrich_max_tries"], CFG["enrich_per_run"])).fetchall()
    for mid, d, amount, acct in rows:
        try:
            sig = x1_first_sig(acct)
            if sig and d == "x2e":
                sender, payer = x1_burn_parties(sig, amount)
                db.execute("UPDATE transfers SET sent_tx=?, sender=?, fee_payer=? WHERE id=?", (sig, sender, payer, mid))
            elif sig:
                db.execute("UPDATE transfers SET delivered_tx=? WHERE id=?", (sig, mid))
            else:
                db.execute("UPDATE transfers SET enrich_tries=enrich_tries+1 WHERE id=?", (mid,))
        except Exception as e:
            log(f"warn enrich {mid}: {e}")
            db.execute("UPDATE transfers SET enrich_tries=enrich_tries+1 WHERE id=?", (mid,))

def protocol_fees(db):
    """X1->ETH: the mailbox protocol fee (bridge fee in XNT, LP revenue) from the 'Protocol fee of N' log of the X1 tx."""
    rows = db.execute("""SELECT id, sent_tx FROM transfers WHERE dir='x2e' AND sent_tx IS NOT NULL AND protocol_lamports IS NULL
                         ORDER BY sent DESC LIMIT ?""", (CFG["enrich_per_run"],)).fetchall()
    for mid, sig in rows:
        try:
            t = rpc(CFG["x1_rpc"], "getTransaction", [sig, {"encoding": "json", "commitment": "finalized", "maxSupportedTransactionVersion": 0}])
            if not t: continue
            fee = next((int(l.split("Protocol fee of ")[1].split()[0]) for l in t["meta"].get("logMessages") or [] if "Protocol fee of " in l), 0)
            db.execute("UPDATE transfers SET protocol_lamports=? WHERE id=?", (fee, mid))
        except Exception as e:
            log(f"warn protocol fee {mid}: {e}")

# ---------- public views ----------
def links(r):
    """Explorer links of a transfer row (dict)."""
    ex, xx = CFG["eth_explorer"], CFG["x1_explorer"]
    if r["dir"] == "e2x":
        s = ex + "/tx/" + r["sent_tx"] if r["sent_tx"] else None
        d = (xx + "/tx/" + r["delivered_tx"]) if r["delivered_tx"] else (xx + "/address/" + r["x1_account"] if r["delivered"] and r["x1_account"] else None)
    else:
        s = (xx + "/tx/" + r["sent_tx"]) if r["sent_tx"] else (xx + "/address/" + r["x1_account"] if r["x1_account"] else None)
        d = (ex + "/tx/" + r["delivered_tx"]) if r["delivered_tx"] else (ex + "/block/" + str(r["delivered_block"]) if r["delivered_block"] else None)
    return s, d

def public_item(r):
    """activity.json item, same shape as v1."""
    s, d = links(r); approx = bool(r["sent_approx"] or r["delivered_approx"])
    return {"id": r["id"], "dir": r["dir"], "amount": r["amount"], "from": r["sender"], "to": r["recipient"],
            "sent": r["sent"], "sentApprox": bool(r["sent_approx"]), "sentTx": s,
            "delivered": r["delivered"], "deliveredApprox": bool(r["delivered_approx"]), "deliveredLink": d,
            "bot": bool(r["bot"]), "status": "delivered" if r["delivered"] else "pending",
            "seconds": (r["delivered"] - r["sent"]) if r["delivered"] and r["sent"] and not approx else None,
            "approx": approx, "fromShort": short(r["sender"]) if r["sender"] else None, "toShort": short(r["recipient"])}

TOPIC_FEE = "0x" + keccak256(b"FeeCharged(bytes32,address,uint256,uint256,bool)").hex()
TOPIC_BRIDGE_FEE = "0x" + keccak256(b"BridgeFeeTaken(bytes32,address,uint256,uint256)").hex()
def fee_logs(db, frm, to):
    """FeeCharged(messageId, payer, amount, feeWei, stale) of the fee hook -> transfers.fee_wei / fee_stale;
    BridgeFeeTaken(messageId, payer, gross, fee) of the lockbox (router v2, VMPX fee to the treasury) -> transfers.fee_vmpx.
    transfers.amount stays the message amount (= locked = minted on X1 = gross - fee)."""
    for lg in erpc("eth_getLogs", [{"fromBlock": hex(frm), "toBlock": hex(to), "address": CFG["fee_hook"], "topics": [TOPIC_FEE]}]):
        d = bytes.fromhex(lg["data"][2:])
        db.execute("UPDATE transfers SET fee_wei=?, fee_stale=? WHERE id=?",
                   (str(int.from_bytes(d[32:64], "big")), int.from_bytes(d[64:96], "big"), lg["topics"][1]))
    for lg in erpc("eth_getLogs", [{"fromBlock": hex(frm), "toBlock": hex(to), "address": CFG["lockbox"], "topics": [TOPIC_BRIDGE_FEE]}]):
        d = bytes.fromhex(lg["data"][2:])
        db.execute("UPDATE transfers SET fee_vmpx=? WHERE id=?", (str(int.from_bytes(d[32:64], "big")), lg["topics"][1]))

def igp_payments(db):
    """GASPAYMT accounts of our IGP (one per X1->ETH message) -> transfers.igp_lamports. A lagging RPC is harmless:
    rows already set are kept, missing ones are filled on a later run."""
    try:
        accs = rpc(CFG["x1_rpc"], "getProgramAccounts", [CFG["igp_program"], {"encoding": "base64", "commitment": "finalized",
                   "filters": [{"memcmp": {"offset": 1, "bytes": b58(b"GASPAYMT")}}]}])
    except Exception as e:
        log(f"warn igp payments: {e}"); return
    for a in accs:
        x = base64.b64decode(a["account"]["data"][0]); p = 9   # initialized flag + discriminator
        if len(x) < p + 92 or b58(x[p + 8:p + 40]) != CFG["igp"]: continue
        mid = "0x" + x[p + 44:p + 76].hex(); pay = struct.unpack_from("<Q", x, p + 84)[0]
        db.execute("UPDATE transfers SET igp_lamports=? WHERE id=? AND igp_lamports IS NULL", (pay, mid))

def sel(sig): return "0x" + keccak256(sig.encode()).hex()[:8]
def chain_state():
    """Lockbox / supply / X1->ETH rate limit / fee parameters. Any failed read leaves that field out."""
    out = {"fetched_at": int(time.time())}
    # every Ethereum read of this run is pinned to ONE block, recorded as the read point (Codex round 4, R4-01/R4-02)
    blk = hex(int(erpc("eth_blockNumber", []), 16)); out["eth_block"] = int(blk, 16)
    def call(to, data):
        r = erpc("eth_call", [{"to": to, "data": data}, blk]); return bytes.fromhex(r[2:])
    word = lambda b, i: int.from_bytes(b[32 * i:32 * i + 32], "big")
    reads = {
        "lockbox": (CFG["eth_token"], sel("balanceOf(address)") + CFG["lockbox"][2:].rjust(64, "0"), lambda b: str(word(b, 0))),
        "eth_total_supply": (CFG["eth_token"], sel("totalSupply()"), lambda b: str(word(b, 0))),
        "rl_capacity": (CFG["rate_limit"], sel("maxCapacity()"), lambda b: str(word(b, 0))),
        "rl_level": (CFG["rate_limit"], sel("calculateCurrentLevel()"), lambda b: str(word(b, 0))),
        "rl_refill_per_s": (CFG["rate_limit"], sel("refillRate()"), lambda b: str(word(b, 0))),
        "fee_params": (CFG["fee_hook"], sel("params()"), lambda b: {"fee_bps": word(b, 0), "min_fee_wei": str(word(b, 1)),
                       "max_fee_wei": str(word(b, 2)), "stale_fee_wei": str(word(b, 3)), "max_price_age_s": word(b, 4)}),
        "price_wei_per_token": (CFG["fee_hook"], sel("refPriceWeiPerToken()"), lambda b: str(word(b, 0))),
        "bridge_fee_bps": (CFG["lockbox"], sel("bridgeFeeBps()"), lambda b: word(b, 0)),   # router v2 (VMPX fee)
        "price_updated_at": (CFG["fee_hook"], sel("priceUpdatedAt()"), lambda b: word(b, 0)),
    }
    for k, (to, data, dec) in reads.items():
        try: out[k] = dec(call(to, data))
        except Exception as e: log(f"warn chain {k}: {e}")
    try:
        r = rpc(CFG["x1_rpc"], "getTokenSupply", [CFG["x1_mint"], {"commitment": "finalized"}])
        out["x1_supply"], out["x1_slot"] = r["value"]["amount"], r["context"]["slot"]
    except Exception as e: log(f"warn chain x1_supply: {e}")
    try: out.update(treasury_state())
    except Exception as e: log(f"warn chain treasury: {e}")
    try: out["lp_pool"] = pool_state()
    except Exception as e: log(f"warn chain pool: {e}")
    return out

def treasury_state():
    """Revenue that goes to the LP treasury vs. money that only covers delivery costs (hook ETH, IGP XNT)."""
    x1 = lambda m, p: rpc(CFG["x1_rpc"], m, p)
    def account(pk):
        v = x1("getAccountInfo", [pk, {"encoding": "base64", "commitment": "finalized"}])["value"]
        d = base64.b64decode(v["data"][0]); rent = x1("getMinimumBalanceForRentExemption", [len(d)])
        return d, v["lamports"], max(0, v["lamports"] - rent)
    d, _, claim = account(CFG["x1_outbox"])   # Outbox: initialized, domain, bump, owner, tree, count, max fee, fee, beneficiary
    o = 1 + 4 + 1; o += 33 if d[o] == 1 else 1; o += 32 * 32 + 8
    max_fee, fee = struct.unpack_from("<QQ", d, o); o += 16
    benef = b58(d[o:o + 32])
    t = {"protocol_fee_lamports": fee, "protocol_max_fee_lamports": max_fee, "treasury_x1": benef, "protocol_claimable_lamports": claim,
         "treasury_x1_xnt_lamports": x1("getBalance", [benef, {"commitment": "finalized"}])["value"]}
    try:
        accs = x1("getTokenAccountsByOwner", [benef, {"mint": CFG["x1_mint"]}, {"encoding": "jsonParsed", "commitment": "finalized"}])["value"]
        t["treasury_x1_vmpxe"] = str(sum(int(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for a in accs))
    except Exception as e: log(f"warn treasury vmpxe: {e}")
    t["treasury_eth"] = CFG["treasury_eth"]
    if CFG["treasury_eth"]:
        r = erpc("eth_call", [{"to": CFG["eth_token"], "data": sel("balanceOf(address)") + CFG["treasury_eth"][2:].rjust(64, "0")}, "latest"])
        t["treasury_eth_vmpx"] = str(int(r, 16))
    _, _, igp_claim = account(CFG["igp"])
    t["igp_claimable_lamports"] = igp_claim
    t["hook_eth_wei"] = str(int(erpc("eth_getBalance", [CFG["fee_hook"], "latest"]), 16))
    return t

WXNT = "So11111111111111111111111111111111111111112"
def cpmm_pool(url, state):
    """Reserves of an XDEX (Raydium CP-swap) pool: vault balance minus the protocol and fund fees it still holds.
    PoolState: 8 discriminator, 10 pubkeys (config, creator, vault0, vault1, lp mint, mint0, mint1, prog0, prog1, observation),
    auth bump, status, lp/mint0/mint1 decimals, lp supply, protocol fees 0/1, fund fees 0/1 (u64)."""
    d = base64.b64decode(rpc(url, "getAccountInfo", [state, {"encoding": "base64", "commitment": "confirmed"}])["value"]["data"][0])
    pk = lambda i: b58(d[8 + 32 * i:40 + 32 * i])
    _, _, _, dec0, dec1 = d[328:333]
    _, p0, p1, f0, f1 = struct.unpack_from("<QQQQQ", d, 333)
    v = rpc(url, "getMultipleAccounts", [[pk(2), pk(3)], {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]
    a0, a1 = (int(x["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for x in v)
    return {"mint0": pk(5), "mint1": pk(6), "dec0": dec0, "dec1": dec1, "r0": a0 - p0 - f0, "r1": a1 - p1 - f1}

def pool_state():
    """LP VMPXe/XNT on X1 testnet + market prices (XNT/USD from XDEX mainnet, VMPX/ETH and ETH/USD from Uniswap)."""
    P = CFG["pool"]; out = {"pool": P["state"], "program": P["program"], "simulation": True}
    q = cpmm_pool(CFG["x1_rpc"], P["state"])
    xnt, vm = (q["r0"], q["r1"]) if q["mint0"] == WXNT else (q["r1"], q["r0"])
    assert CFG["x1_mint"] in (q["mint0"], q["mint1"]), "pool is not VMPXe/XNT"
    out.update({"reserve_xnt_lamports": xnt, "reserve_vmpxe": str(vm), "price_xnt": xnt / vm if vm else None,
                "start_price_xnt": P["start_xnt"] / P["start_vmpxe"]})
    try:
        u = cpmm_pool(P["x1_mainnet_rpc"], P["xnt_usdc_state"])
        x, usd = (u["r0"], u["r1"]) if u["mint0"] == WXNT else (u["r1"], u["r0"])
        dx, du = (u["dec0"], u["dec1"]) if u["mint0"] == WXNT else (u["dec1"], u["dec0"])
        out["xnt_usd"] = (usd / 10 ** du) / (x / 10 ** dx)
    except Exception as e: log(f"warn pool xnt_usd: {e}")
    def ecall(to, data):
        last = None
        for url in P["eth_rpcs"]:
            try: return bytes.fromhex(rpc(url, "eth_call", [{"to": to, "data": data}, "latest"])[2:])
            except Exception as e: last = e
        raise last
    try:
        sq = int.from_bytes(ecall(P["vmpx_weth_v3"], sel("slot0()"))[:32], "big")
        r = ecall(P["usdc_weth_v2"], sel("getReserves()"))
        usdc, weth = int.from_bytes(r[:32], "big"), int.from_bytes(r[32:64], "big")
        out["eth_usd"] = (usdc / 1e6) / (weth / 1e18)
        out["vmpx_eth"] = (sq / 2 ** 96) ** 2   # both 18 decimals; token0 = VMPX, so WETH per VMPX
        out["vmpx_usd_eth"] = out["vmpx_eth"] * out["eth_usd"]
    except Exception as e: log(f"warn pool eth price: {e}")
    if out.get("price_xnt") and out.get("xnt_usd"):
        out["price_usd"] = out["price_xnt"] * out["xnt_usd"]
        out["start_price_usd"] = out["start_price_xnt"] * out["xnt_usd"]
        if out.get("vmpx_usd_eth"):
            out["diff_pct"] = (out["price_usd"] / out["vmpx_usd_eth"] - 1) * 100
            out["start_diff_pct"] = (out["start_price_usd"] / out["vmpx_usd_eth"] - 1) * 100
    return out

def status_note():
    """Operator note: lines 'en: …' / 'pl: …' (or plain text for both), max 280 characters each."""
    note = {}
    try:
        for line in open(CFG["status_note_file"], encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, sep, v = line.partition(":")
            if sep and k.strip().lower() in ("en", "pl"): note[k.strip().lower()] = v.strip()[:280]
            else: note.setdefault("en", line[:280]); note.setdefault("pl", line[:280])
    except OSError:
        pass
    return note or None

def bridge_status(db, chain):
    """live / delays / paused from on-chain switches and indexed data. Each check: id, ok (True/False/None = unknown)."""
    checks = []
    def eth_bool(addr, sig):
        try: return int(erpc("eth_call", [{"to": addr, "data": sel(sig)}, "latest"]), 16) != 0
        except Exception as e: log(f"warn status {sig} {addr}: {e}"); return None
    hp = eth_bool(CFG["pausable_hook"], "paused()"); checks.append({"id": "eth_hook", "ok": None if hp is None else not hp})
    ip = eth_bool(CFG["pausable_ism"], "paused()"); checks.append({"id": "eth_ism", "ok": None if ip is None else not ip})
    try:   # X1 token account: initialized, bump, mailbox, process authority, dispatch bump, decimals, remote decimals, owner, ISM
        d = base64.b64decode(rpc(CFG["x1_rpc"], "getAccountInfo", [CFG["x1_token_pda"], {"encoding": "base64", "commitment": "finalized"}])["value"]["data"][0])
        o = 1 + 1 + 32 + 32 + 3
        o += 33 if d[o] == 1 else 1
        ism = b58(d[o + 1:o + 33]) if d[o] == 1 else None
        checks.append({"id": "x1_ism", "ok": ism == CFG["x1_open_ism"], "value": ism})
    except Exception as e:
        log(f"warn status x1 ism: {e}"); checks.append({"id": "x1_ism", "ok": None})
    now = int(time.time())
    r = db.execute("SELECT min(sent) FROM transfers WHERE delivered IS NULL AND sent IS NOT NULL").fetchone()
    oldest = (now - r[0]) if r and r[0] else 0
    checks.append({"id": "pending", "ok": oldest <= CFG["delay_pending_s"], "value": oldest})
    try:
        pct = int(chain["rl_level"]) * 100 / max(1, int(chain["rl_capacity"]))
        checks.append({"id": "limit", "ok": pct >= CFG["delay_limit_pct"], "value": round(pct, 2)})
    except Exception:
        checks.append({"id": "limit", "ok": None})
    try:   # solvency (Codex I-01, round 3 R-03/R-04): lockbox >= X1 supply + everything in flight, both directions
        pend = {d: sum(int(r[0]) for r in db.execute("SELECT amount FROM transfers WHERE delivered IS NULL AND dir=?", (d,)))
                for d in ("e2x", "x2e")}
        bal = solvency(int(chain["lockbox"]), int(chain["x1_supply"]), pend["e2x"], pend["x2e"])
        c0 = meta_get(db, "cursor", {})
        complete = c0.get("x1_complete", False) is True and chain.get("x1_slot", -1) >= c0.get("x1_accounts_slot", 1 << 62) \
            and unhashed_rows(db) == 0
        ok, since = solvent_check(meta_get(db, "shortfall_since", 0), bal, complete, now, meta_get(db, "shortfall_last", 0))
        meta_set(db, "shortfall_since", since)
        if complete: meta_set(db, "shortfall_last", now)   # R7-04: only complete runs count for the continuity
        checks.append({"id": "solvent", "ok": ok, "value": str(bal), "pending_e2x": str(pend["e2x"]), "pending_x2e": str(pend["x2e"]),
                       "complete": complete, "eth_block": chain.get("eth_block"), "x1_slot": chain.get("x1_slot")})
    except Exception:
        checks.append({"id": "solvent", "ok": None})
    pause_ids = ("eth_hook", "eth_ism", "x1_ism")
    # lockbox below the X1 supply outranks everything: red alarm (Codex review N-5)
    if any(c["id"] == "solvent" and c["ok"] is False for c in checks): state = "insolvent"
    elif any(c["id"] in pause_ids and c["ok"] is False for c in checks): state = "paused"
    elif any(c["ok"] is not True for c in checks): state = "delays"
    else: state = "live"
    return {"state": state, "checks": checks, "at": now, "note": status_note()}

def snapshot(db, ro_path):
    """Consistent copy of the database for the read-only API, published with an atomic rename."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(ro_path), prefix=".bridge-ro.")
    os.close(fd)
    dst = sqlite3.connect(tmp)
    with dst: db.backup(dst)
    dst.execute("PRAGMA journal_mode=DELETE"); dst.close()
    os.chmod(tmp, 0o644); os.replace(tmp, ro_path)

def init_schema(db):
    db.executescript(SCHEMA)
    cols = {r[1] for r in db.execute("PRAGMA table_info(transfers)")}
    for c, t in (("fee_wei", "TEXT"), ("fee_stale", "INTEGER"), ("igp_lamports", "INTEGER"), ("protocol_lamports", "INTEGER"),
                 ("fee_vmpx", "TEXT"), ("sent_block", "INTEGER"), ("sent_blockhash", "TEXT"), ("delivered_blockhash", "TEXT"),
                 ("sent_final", "INTEGER"), ("delivered_final", "INTEGER")):
        if c not in cols: db.execute(f"ALTER TABLE transfers ADD COLUMN {c} {t}")

def dispatches_from_receipt(rc):
    """ALL Dispatch logs of the lockbox in a receipt (Codex round 6, R6-07: one transaction can dispatch several
    messages) -> [{id, amount, rcpt, time}] in log order."""
    lockbox_topic = "0x" + CFG["lockbox"][2:].lower().rjust(64, "0")
    out, t = [], None
    for lg in rc.get("logs", []):
        if lg["address"].lower() == CFG["eth_mailbox"].lower() and lg["topics"][:2] == [TOPIC_DISPATCH, lockbox_topic]:
            data = bytes.fromhex(lg["data"][2:]); n = int.from_bytes(data[32:64], "big"); msg = data[64:64 + n]; m = parse_msg(msg)
            if t is None: t = int(erpc("eth_getBlockByNumber", [rc["blockNumber"], False])["timestamp"], 16)
            out.append({"id": "0x" + keccak256(msg).hex(), "amount": m["amount"], "rcpt": b58(m["rcpt"]), "time": t})
    return out

# R6-07: idempotent merge of a deposit rebuilt from a receipt; only the sending fields are updated, a confirmed
# delivery (delivered*, fees) is never overwritten, and an existing sender is kept
UPSERT_DEPOSIT = ("INSERT INTO transfers(id, dir, amount, sender, recipient, sent, sent_tx, sent_block, sent_blockhash, sent_final) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount, recipient=excluded.recipient, "
                  "sent=excluded.sent, sent_tx=excluded.sent_tx, sent_block=excluded.sent_block, sent_blockhash=excluded.sent_blockhash, "
                  "sent_final=excluded.sent_final, sender=COALESCE(transfers.sender, excluded.sender)")

def reorg_check(db, fin):
    """Codex round 3 R-07 / round 4 R4-04: every row from a Sepolia block keeps its block hash and an explicit
    `*_final` flag. Each run re-checks EVERY non-final row against the canonical chain, including rows whose block
    the finalized head has just passed (a reorg during an indexer pause is still caught); a row is marked final only
    after one last successful check at or below `fin`. A deposit whose block left the chain is removed (or moved if
    its tx was re-included); an X1->ETH delivery whose block left the chain goes back to pending."""
    canon = {}
    def hash_of(n):
        if n not in canon: canon[n] = (erpc("eth_getBlockByNumber", [hex(n), False]) or {}).get("hash")
        return canon[n]
    for r in db.execute("SELECT id, sent_tx, sent_block, sent_blockhash, delivered FROM transfers "
                        "WHERE dir='e2x' AND sent_blockhash IS NOT NULL AND sent_final IS NOT 1").fetchall():
        if hash_of(r["sent_block"]) == r["sent_blockhash"]:
            if r["sent_block"] <= fin: db.execute("UPDATE transfers SET sent_final=1 WHERE id=?", (r["id"],))
            continue
        rc = erpc("eth_getTransactionReceipt", [r["sent_tx"]])
        ds = dispatches_from_receipt(rc) if rc and int(rc.get("status", "0x0"), 16) == 1 else []
        if ds:
            # Codex round 5, R5-06 / round 6, R6-07: the re-executed transaction may have dispatched other messages
            # (another Mailbox nonce -> another ID, possibly another amount, possibly several): every Dispatch of the
            # lockbox in the receipt is merged; the old row goes only if its ID is not among them and it was not minted
            nb = int(rc["blockNumber"], 16); fin_flag = 1 if nb <= fin and hash_of(nb) == rc["blockHash"] else None
            old = db.execute("SELECT sender FROM transfers WHERE id=?", (r["id"],)).fetchone()
            for d in ds:
                db.execute(UPSERT_DEPOSIT, (d["id"], "e2x", str(d["amount"]), old["sender"] if old else None, d["rcpt"], d["time"],
                                            r["sent_tx"], nb, rc["blockHash"], fin_flag))
            new_ids = [d["id"] for d in ds]
            if r["id"] not in new_ids:
                if r["delivered"] is None: db.execute("DELETE FROM transfers WHERE id=?", (r["id"],))
                else: log(f"warn reorg: deposit {r['id']} was minted on X1 but its transaction now dispatched {', '.join(new_ids)}")
            log(f"reorg: deposit {r['id']} re-included in block {nb}" + ("" if new_ids == [r["id"]] else f" as {', '.join(new_ids)}"))
        elif r["delivered"] is None:
            db.execute("DELETE FROM transfers WHERE id=?", (r["id"],)); log(f"reorg: deposit {r['id']} dropped, row removed")
        else:   # minted on X1 but the lock is gone from Ethereum: keep the row, the solvency check reports the gap
            log(f"warn reorg: deposit {r['id']} dropped from Ethereum after its mint on X1")
    for r in db.execute("SELECT id, delivered_block, delivered_blockhash FROM transfers WHERE dir='x2e' AND delivered IS NOT NULL "
                        "AND delivered_blockhash IS NOT NULL AND delivered_final IS NOT 1").fetchall():
        if hash_of(r["delivered_block"]) == r["delivered_blockhash"]:
            if r["delivered_block"] <= fin: db.execute("UPDATE transfers SET delivered_final=1 WHERE id=?", (r["id"],))
            continue
        db.execute("UPDATE transfers SET delivered=NULL, delivered_tx=NULL, delivered_block=NULL, delivered_blockhash=NULL, "
                   "delivered_final=NULL WHERE id=?", (r["id"],))
        log(f"reorg: delivery of {r['id']} left the chain, back to pending")

def run(out_path):
    base = os.path.dirname(os.path.abspath(out_path))
    db = sqlite3.connect(os.path.join(base, "bridge.db"), isolation_level=None)
    db.row_factory = sqlite3.Row
    init_schema(db)
    os.chmod(os.path.join(base, "bridge.db"), 0o640)
    db.execute("BEGIN IMMEDIATE")
    # Codex round 5, R5-05: no import of older records (they had no block hashes); an empty database is rebuilt from
    # the deployment block, every row with its block hash
    if meta_get(db, "cursor") is None:
        meta_set(db, "cursor", {"sepolia_block": CFG["start_block"] - 1})
    meta_set(db, "schema_version", 2)
    cur = meta_get(db, "cursor")
    if not meta_get(db, "fees_backfilled"):   # once: bridge fees of transfers indexed before fees were tracked
        frm = CFG["fee_backfill_from"]
        while frm <= cur["sepolia_block"]:
            to = min(frm + CFG["chunk"] - 1, cur["sepolia_block"]); fee_logs(db, frm, to); frm = to + 1
        meta_set(db, "fees_backfilled", int(time.time()))
    known = lambda mid: db.execute("SELECT 1 FROM transfers WHERE id=?", (mid,)).fetchone() is not None

    # ETH -> X1: Sepolia Dispatch logs from the lockbox. The cursor only moves to the FINALIZED block: the range
    # above it is scanned again every run, and rows from those blocks keep their block hash until they are final
    # (Codex round 3, R-07; reorg_check below)
    tip = int(erpc("eth_blockNumber", []), 16)
    fin = int(erpc("eth_getBlockByNumber", ["finalized", False])["number"], 16)
    cur["eth_tip"], cur["eth_fin"] = tip, fin
    reorg_check(db, fin)
    lockbox_topic = "0x" + CFG["lockbox"][2:].rjust(64, "0")
    frm = cur["sepolia_block"] + 1
    while frm <= tip:
        to = min(frm + CFG["chunk"] - 1, tip)
        logs = erpc("eth_getLogs", [{"fromBlock": hex(frm), "toBlock": hex(to), "address": CFG["eth_mailbox"],
                                     "topics": [TOPIC_DISPATCH, lockbox_topic]}])
        for lg in logs:
            data = bytes.fromhex(lg["data"][2:]); n = int.from_bytes(data[32:64], "big"); msg = data[64:64 + n]
            mid = "0x" + keccak256(msg).hex(); m = parse_msg(msg)
            if known(mid): continue
            blk = erpc("eth_getBlockByNumber", [lg["blockNumber"], False]); tx = erpc("eth_getTransactionByHash", [lg["transactionHash"]])
            db.execute("INSERT INTO transfers(id, dir, amount, sender, recipient, sent, sent_tx, sent_block, sent_blockhash) VALUES (?,?,?,?,?,?,?,?,?)",
                       (mid, "e2x", str(m["amount"]), tx["from"].lower(), b58(m["rcpt"]), int(blk["timestamp"], 16), lg["transactionHash"],
                        int(lg["blockNumber"], 16), lg["blockHash"]))
        fee_logs(db, frm, to)
        cur["sepolia_block"] = min(to, fin); frm = to + 1

    # X1 mailbox accounts: DISPATCH (X1 -> ETH) and PROCESSD (ETH -> X1 delivered)
    # public X1 RPC sits behind a load balancer whose backends lag: an answer with fewer accounts than last time
    # is retried and, if still short, ignored for this round (accounts are never deleted, only added)
    # Completeness (Codex round 4, R4-01) is judged by SLOTS, not only by the count: the answer must come from a slot
    # not older than the previous run's (a lagging backend serves an old list), and the X1 supply is read afterwards
    # at a slot >= this one (checked in bridge_status). Burns between the two reads are then in neither the list nor
    # the supply, which can only show a surplus for one run, never a false shortfall.
    accs, slot = [], None
    for _ in range(3):
        r = rpc(CFG["x1_rpc"], "getProgramAccounts", [CFG["x1_mailbox"], {"encoding": "base64", "commitment": "finalized", "withContext": True}])
        accs, slot = r["value"], r["context"]["slot"]
        if len(accs) >= cur.get("x1_accounts", 0) and slot >= cur.get("x1_accounts_slot", 0): break
        time.sleep(3)
    if len(accs) < cur.get("x1_accounts", 0) or slot < cur.get("x1_accounts_slot", 0): accs = []; cur["x1_complete"] = False
    else: cur["x1_accounts"] = len(accs); cur["x1_accounts_slot"] = slot; cur["x1_complete"] = True
    processed = {}
    igp_payments(db)
    for a in accs:
        k = mailbox_account(a["pubkey"], base64.b64decode(a["account"]["data"][0]), CFG["x1_mailbox"])
        if k is None: continue
        if k[0] == "processed":
            processed[k[1]] = (k[2], a["pubkey"]); continue
        slot, msg = k[1], k[2]
        m = parse_msg(msg)
        if m["sender"] != CFG["x1_program_hex"] or m["dest"] != CFG["eth_domain"]: continue
        mid = "0x" + keccak256(msg).hex()
        if not known(mid):
            t, approx = x1_time(slot)
            db.execute("INSERT INTO transfers(id, dir, amount, recipient, sent, sent_approx, x1_account) VALUES (?,?,?,?,?,?,?)",
                       (mid, "x2e", str(m["amount"]), "0x" + m["rcpt"][12:].hex(), t, int(approx), a["pubkey"]))

    # deliveries
    for r in db.execute("SELECT id, dir FROM transfers WHERE delivered IS NULL").fetchall():
        if r["dir"] == "e2x" and r["id"] in processed:
            slot, pk = processed[r["id"]]; t, approx = x1_time(slot)
            db.execute("UPDATE transfers SET delivered=?, delivered_approx=?, x1_account=? WHERE id=?", (t, int(approx), pk, r["id"]))
        elif r["dir"] == "x2e":
            blk = int(erpc("eth_call", [{"to": CFG["eth_mailbox"], "data": "0x07a2fda1" + r["id"][2:]}, "latest"]), 16)
            if blk:
                b = erpc("eth_getBlockByNumber", [hex(blk), False])
                logs = erpc("eth_getLogs", [{"fromBlock": hex(blk), "toBlock": hex(blk), "address": CFG["eth_mailbox"],
                                             "topics": ["0x1cae38cdd3d3919489272725a5ae62a4f48b2989b0dae843d3c279fee18073a9", r["id"]]}])
                db.execute("UPDATE transfers SET delivered=?, delivered_tx=?, delivered_block=?, delivered_blockhash=? WHERE id=?",
                           (int(b["timestamp"], 16), logs[0]["transactionHash"] if logs else None, blk, b["hash"], r["id"]))

    enrich(db)
    protocol_fees(db)

    # bot flag (bots.txt may change between runs)
    bots = load_bots()
    db.execute("UPDATE transfers SET bot=0")
    if bots:
        q = ",".join("?" * len(bots)); b = list(bots)
        db.execute(f"UPDATE transfers SET bot=1 WHERE lower(sender) IN ({q}) OR lower(recipient) IN ({q}) OR lower(fee_payer) IN ({q})", b * 3)
    meta_set(db, "cursor", cur)
    chain = chain_state()
    meta_set(db, "chain", chain)
    status = bridge_status(db, chain)
    meta_set(db, "status", status)
    db.execute("COMMIT")

    # stats + public file (same shape as v1)
    now = int(time.time())
    day = [dict(r) for r in db.execute("SELECT * FROM transfers WHERE sent >= ?", (now - 86400,))]
    exact = lambda r: r["delivered"] and r["sent"] and not (r["sent_approx"] or r["delivered_approx"])
    stats = {"total": db.execute("SELECT count(*) FROM transfers").fetchone()[0], "last24h": len(day),
             "last24h_bot": sum(1 for r in day if r["bot"]),
             "median_e2x_s": median([r["delivered"] - r["sent"] for r in day if r["dir"] == "e2x" and exact(r)]),
             "median_x2e_s": median([r["delivered"] - r["sent"] for r in day if r["dir"] == "x2e" and exact(r)]),
             "volume24h": "%.9f" % (sum(int(r["amount"]) for r in day) / 1e18)}
    fee = lambda rows, k: sum(int(r[k] or 0) for r in rows)
    allr = [dict(r) for r in db.execute("SELECT fee_wei, igp_lamports, protocol_lamports, fee_vmpx, bot FROM transfers")]
    stats["fees"] = {"eth_wei": str(fee(allr, "fee_wei")), "eth_wei_24h": str(fee(day, "fee_wei")),
                     "xnt_lamports": fee(allr, "igp_lamports"), "xnt_lamports_24h": fee(day, "igp_lamports"),
                     "eth_wei_bot": str(fee([r for r in allr if r["bot"]], "fee_wei")),
                     "xnt_lamports_bot": fee([r for r in allr if r["bot"]], "igp_lamports"),
                     # LP revenue: VMPX (router v2 bridge fee, BridgeFeeTaken) and the X1 mailbox protocol fee in XNT
                     "lp_vmpx": str(fee(allr, "fee_vmpx")), "lp_vmpx_24h": str(fee(day, "fee_vmpx")),
                     "lp_xnt_lamports": fee(allr, "protocol_lamports"), "lp_xnt_lamports_24h": fee(day, "protocol_lamports")}
    rows = [dict(r) for r in db.execute("SELECT * FROM transfers ORDER BY sent DESC LIMIT ?", (CFG["keep"],))]
    ids = {r["id"] for r in rows}
    rows += [dict(r) for r in db.execute("SELECT * FROM transfers WHERE delivered IS NULL ORDER BY sent DESC") if r["id"] not in ids]
    upd = int(time.time())
    # Codex round 4, R4-01: consumers (monitor, page) must see whether this snapshot is complete, not only how old it is
    # "complete" is a HEURISTIC (Codex round 5, R5-01): monotonic X1 list slots, supply read after the list, no
    # unhashed rows. It is not a proof of completeness; the automatic pause does not use it (docs/16).
    unhashed = unhashed_rows(db)
    index = {"complete": cur.get("x1_complete") is True and "lockbox" in chain and "x1_supply" in chain
                         and chain.get("x1_slot", -1) >= cur.get("x1_accounts_slot", 1 << 62) and unhashed == 0,
             "complete_is": "heuristic", "unhashed_rows": unhashed,
             "x1_accounts": cur.get("x1_accounts"), "x1_accounts_slot": cur.get("x1_accounts_slot"), "eth_scanned_to": cur.get("eth_tip"), "eth_finalized": cur.get("eth_fin"),
             "eth_block": chain.get("eth_block"), "x1_slot": chain.get("x1_slot")}
    out = {"network": "testnet", "updated": upd, "index": index, "stats": stats, "status": status, "items": [public_item(r) for r in rows]}
    write_json(out_path, out)
    snapshot(db, os.path.join(base, "bridge-ro.db"))
    db.close()
    out["cursor"] = cur
    return out

if __name__ == "__main__":
    o = run(sys.argv[1] if len(sys.argv) > 1 else "activity.json")
    print(f"ok items={len(o['items'])} total={o['stats']['total']} cursor={o['cursor']['sepolia_block']}")
