#!/usr/bin/env python3
"""Read-only JSON API for the bridge.x1watch.xyz "Transactions" tab.

GET /api/transfers?page=&dir=all|e2x|x2e&bot=all|human|bot   newest first, 25 per page
GET /api/search?q=<ETH address | X1 address | ETH tx hash | X1 signature | messageId>   up to 50 matches
GET /api/stats/daily?days=30&bot=all|human|bot   per UTC day: inflow/outflow/net, counts, median delivery, fees, TVL
GET /api/stats/limits   lockbox, X1 supply, X1->ETH rate limit, fee parameters (read on-chain by the indexer every run)

Reads the snapshot bridge-ro.db that the indexer publishes with an atomic rename (opened read-only + immutable,
a fresh connection per request, so a new snapshot is picked up at once). Listens on 127.0.0.1 only; nginx in front
adds TLS, rate limiting and the security headers. Parameterised SQL only. Stdlib only.

Local development: --dev-static <dir> also serves the page from <dir> (never used by the systemd unit).
"""
import argparse, contextlib, json, os, re, sqlite3, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PER_PAGE, MAX_PAGE, MAX_SEARCH = 25, 1000, 50
ETH_EXPLORER, X1_EXPLORER = "https://sepolia.etherscan.io", "https://explorer.testnet.x1.xyz"
RE_ETH_ADDR = re.compile(r"0x[0-9a-fA-F]{40}")
RE_HASH32 = re.compile(r"0x[0-9a-fA-F]{64}")
RE_X1_ADDR = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")
RE_X1_SIG = re.compile(r"[1-9A-HJ-NP-Za-km-z]{64,88}")
COLS = ("id, dir, amount, sender, recipient, fee_payer, sent, sent_approx, sent_tx, delivered, delivered_approx, "
        "delivered_tx, delivered_block, x1_account, bot, fee_wei, igp_lamports, protocol_lamports, fee_vmpx")
DB = None

def classify(q):
    """(kind, normalised value) or (None, None). Only these shapes ever reach SQL."""
    if RE_ETH_ADDR.fullmatch(q): return "eth_address", q.lower()
    if RE_HASH32.fullmatch(q): return "hash", q.lower()
    if RE_X1_ADDR.fullmatch(q): return "x1_address", q
    if RE_X1_SIG.fullmatch(q): return "x1_signature", q
    return None, None

def item(r):
    e2x = r["dir"] == "e2x"
    if e2x:
        s = ETH_EXPLORER + "/tx/" + r["sent_tx"] if r["sent_tx"] else None
        d = (X1_EXPLORER + "/tx/" + r["delivered_tx"]) if r["delivered_tx"] else \
            (X1_EXPLORER + "/address/" + r["x1_account"] if r["delivered"] and r["x1_account"] else None)
    else:
        s = (X1_EXPLORER + "/tx/" + r["sent_tx"]) if r["sent_tx"] else \
            (X1_EXPLORER + "/address/" + r["x1_account"] if r["x1_account"] else None)
        d = (ETH_EXPLORER + "/tx/" + r["delivered_tx"]) if r["delivered_tx"] else \
            (ETH_EXPLORER + "/block/" + str(r["delivered_block"]) if r["delivered_block"] else None)
    approx = bool(r["sent_approx"] or r["delivered_approx"])
    return {"id": r["id"], "dir": r["dir"], "amount": r["amount"], "sender": r["sender"], "recipient": r["recipient"],
            "fee_payer": r["fee_payer"], "sent": r["sent"], "sent_tx": r["sent_tx"], "sent_link": s,
            "delivered": r["delivered"], "delivered_tx": r["delivered_tx"], "delivered_link": d,
            "status": "delivered" if r["delivered"] else "pending",
            "seconds": (r["delivered"] - r["sent"]) if r["delivered"] and r["sent"] and not approx else None,
            "approx": approx, "bot": bool(r["bot"]), "fee_wei": r["fee_wei"], "igp_lamports": r["igp_lamports"], "protocol_lamports": r["protocol_lamports"],
            "fee_vmpx": r["fee_vmpx"]}

def connect():
    db = sqlite3.connect(f"file:{DB}?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    return db

def transfers(qs):
    try: page = int(qs.get("page", "1"))
    except ValueError: raise BadRequest("page must be a number")
    if not 1 <= page <= MAX_PAGE: raise BadRequest(f"page must be 1-{MAX_PAGE}")
    d, b = qs.get("dir", "all"), qs.get("bot", "all")
    if d not in ("all", "e2x", "x2e"): raise BadRequest("dir must be all, e2x or x2e")
    if b not in ("all", "human", "bot"): raise BadRequest("bot must be all, human or bot")
    where, args = [], []
    if d != "all": where.append("dir = ?"); args.append(d)
    if b != "all": where.append("bot = ?"); args.append(1 if b == "bot" else 0)
    w = (" WHERE " + " AND ".join(where)) if where else ""
    with contextlib.closing(connect()) as db:
        total = db.execute("SELECT count(*) FROM transfers" + w, args).fetchone()[0]
        rows = db.execute(f"SELECT {COLS} FROM transfers{w} ORDER BY sent DESC, id LIMIT ? OFFSET ?",
                          args + [PER_PAGE, (page - 1) * PER_PAGE]).fetchall()
    return {"page": page, "pages": max(1, -(-total // PER_PAGE)), "total": total, "per_page": PER_PAGE,
            "dir": d, "bot": b, "items": [item(r) for r in rows]}

def search(qs):
    q = qs.get("q", "").strip()
    if not q or len(q) > 100: raise BadRequest("q is required (max 100 characters)")
    kind, v = classify(q)
    if not kind: raise BadRequest("unrecognised format: expected an ETH or X1 address, a transaction hash or a message id")
    if kind == "eth_address": sql, args = "sender = ? OR recipient = ?", [v, v]
    elif kind == "hash": sql, args = "id = ? OR sent_tx = ? OR delivered_tx = ?", [v, v, v]
    elif kind == "x1_address": sql, args = "sender = ? OR recipient = ? OR fee_payer = ?", [v, v, v]
    else: sql, args = "sent_tx = ? OR delivered_tx = ?", [v, v]
    with contextlib.closing(connect()) as db:
        rows = db.execute(f"SELECT {COLS} FROM transfers WHERE {sql} ORDER BY sent DESC, id LIMIT ?", args + [MAX_SEARCH]).fetchall()
    return {"q": q, "kind": kind, "items": [item(r) for r in rows]}

def median(v):
    v = sorted(v)
    if not v: return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) // 2

# Codex round 3, R-11: the daily stats scan the whole history, so (1) results are cached per snapshot of the
# database (the indexer replaces bridge-ro.db once a minute; the key includes its mtime) and (2) at most
# MAX_BUSY requests compute at the same time; the rest get 503 after QUEUE_WAIT_S instead of piling up.
MAX_BUSY, QUEUE_WAIT_S = 2, 2.0
_busy = threading.BoundedSemaphore(MAX_BUSY)
_cache, _cache_lock = {}, threading.Lock()
class Busy(Exception): pass

# Codex round 4, R4-08: the cache key is built from the NORMALISED parameters (unknown ones are rejected before),
# so ?days=90&x=1, ?days=090 ... all hit the same entry; at most MAX_INFLIGHT requests are handled at once.
MAX_INFLIGHT = 32
_inflight = threading.BoundedSemaphore(MAX_INFLIGHT)

def cached(fn):
    def wrap(*norm):
        try: mt = os.stat(DB).st_mtime_ns
        except OSError: mt = 0
        key = (fn.__name__, mt, norm)
        with _cache_lock:
            if key in _cache: return _cache[key]
        if not _busy.acquire(timeout=QUEUE_WAIT_S): raise Busy()
        try: out = fn(*norm)
        finally: _busy.release()
        with _cache_lock:
            if any(k[1] != mt for k in _cache): _cache.clear()   # new snapshot: drop the old results
            if len(_cache) < 512: _cache[key] = out
        return out
    wrap.__name__ = fn.__name__
    return wrap

def stats_daily(qs):
    try: days = int(qs.get("days", "30"))
    except ValueError: raise BadRequest("days must be a number")
    if not 1 <= days <= 90: raise BadRequest("days must be 1-90")
    b = qs.get("bot", "all")
    if b not in ("all", "human", "bot"): raise BadRequest("bot must be all, human or bot")
    return _stats_daily(days, b)

@cached
def _stats_daily(days, b):
    now = int(time.time()); today = now - now % 86400; start = today - (days - 1) * 86400
    with contextlib.closing(connect()) as db:
        rows = db.execute("SELECT dir, amount, sent, delivered, sent_approx, delivered_approx, bot, fee_wei, igp_lamports, protocol_lamports, fee_vmpx FROM transfers").fetchall()
    keep = lambda r: b == "all" or (r["bot"] == 1) == (b == "bot")
    out = []
    for d in range(start, today + 86400, 86400):
        day = [r for r in rows if r["sent"] and d <= r["sent"] < d + 86400 and keep(r)]
        inflow = sum(int(r["amount"]) for r in day if r["dir"] == "e2x"); outflow = sum(int(r["amount"]) for r in day if r["dir"] == "x2e")
        exact = lambda r: r["delivered"] and not (r["sent_approx"] or r["delivered_approx"])
        end = d + 86400   # TVL (always all traffic): locked at send for ETH->X1, unlocked at delivery for X1->ETH
        tvl = sum(int(r["amount"]) for r in rows if r["dir"] == "e2x" and r["sent"] and r["sent"] < end) \
            - sum(int(r["amount"]) for r in rows if r["dir"] == "x2e" and r["delivered"] and r["delivered"] < end)
        out.append({"day": time.strftime("%Y-%m-%d", time.gmtime(d)), "in": str(inflow), "out": str(outflow), "net": str(inflow - outflow),
                    "count": len(day), "count_e2x": sum(r["dir"] == "e2x" for r in day), "count_x2e": sum(r["dir"] == "x2e" for r in day),
                    "median_e2x_s": median([r["delivered"] - r["sent"] for r in day if r["dir"] == "e2x" and exact(r)]),
                    "median_x2e_s": median([r["delivered"] - r["sent"] for r in day if r["dir"] == "x2e" and exact(r)]),
                    "fee_wei": str(sum(int(r["fee_wei"] or 0) for r in day)), "igp_lamports": sum(int(r["igp_lamports"] or 0) for r in day),
                    "protocol_lamports": sum(int(r["protocol_lamports"] or 0) for r in day),
                    "fee_vmpx": str(sum(int(r["fee_vmpx"] or 0) for r in day)),
                    "tvl": str(tvl)})
    hour0 = now - now % 3600 - 23 * 3600; hourly = []
    for h in range(hour0, hour0 + 24 * 3600, 3600):
        hr = [r for r in rows if r["sent"] and h <= r["sent"] < h + 3600 and keep(r)]
        hourly.append({"t": h, "in": str(sum(int(r["amount"]) for r in hr if r["dir"] == "e2x")), "out": str(sum(int(r["amount"]) for r in hr if r["dir"] == "x2e"))})
    last = [r for r in rows if r["sent"] and r["sent"] >= now - 86400 and keep(r)]
    i24 = sum(int(r["amount"]) for r in last if r["dir"] == "e2x"); o24 = sum(int(r["amount"]) for r in last if r["dir"] == "x2e")
    return {"days": out, "hourly": hourly, "bot": b, "now": now,
            "last24h": {"in": str(i24), "out": str(o24), "net": str(i24 - o24), "count": len(last),
                        "count_e2x": sum(r["dir"] == "e2x" for r in last), "count_x2e": sum(r["dir"] == "x2e" for r in last)}}

def stats_limits(qs):
    with contextlib.closing(connect()) as db:
        r = db.execute("SELECT v FROM meta WHERE k='chain'").fetchone()
        last_igp = db.execute("SELECT igp_lamports FROM transfers WHERE igp_lamports IS NOT NULL ORDER BY sent DESC LIMIT 1").fetchone()
    c = json.loads(r[0]) if r else {}
    if "rl_capacity" in c and "rl_level" in c and "rl_refill_per_s" in c:
        cap, lvl, rate = int(c["rl_capacity"]), int(c["rl_level"]), int(c["rl_refill_per_s"])
        c["rl_used"] = str(max(0, cap - lvl)); c["rl_full_in_s"] = (cap - lvl) // rate if rate else None
    c["last_igp_lamports"] = last_igp[0] if last_igp else None
    c["age_s"] = int(time.time()) - c.get("fetched_at", 0) if c.get("fetched_at") else None
    return c

class BadRequest(Exception): pass
ROUTES = {"/api/transfers": transfers, "/api/search": search, "/api/stats/daily": stats_daily, "/api/stats/limits": stats_limits}
PARAMS = {"/api/transfers": {"page", "dir", "bot"}, "/api/search": {"q"}, "/api/stats/daily": {"days", "bot"}, "/api/stats/limits": set()}

class Handler(BaseHTTPRequestHandler):
    server_version = "bridge-api"; sys_version = ""
    timeout = 15   # slow clients do not hold a thread forever
    static_dir = None

    def send_json(self, code, obj, head=False):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", ("public, max-age=60" if self.path.startswith("/api/stats/") else "public, max-age=15") if code == 200 else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head: self.wfile.write(body)

    def handle_get(self, head):
        u = urlsplit(self.path)
        fn = ROUTES.get(u.path)
        if fn is None:
            if self.static_dir and not u.path.startswith("/api/"): return self.serve_static(u.path, head)
            return self.send_json(404, {"error": "not found"}, head)
        if not _inflight.acquire(blocking=False): return self.send_json(503, {"error": "busy, try again"}, head)
        try:
            qs = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True, max_num_fields=10).items()}
            extra = set(qs) - PARAMS[u.path]
            if extra: raise BadRequest("unknown parameter: " + ", ".join(sorted(extra))[:80])
            self.send_json(200, fn(qs), head)
        except BadRequest as e: self.send_json(400, {"error": str(e)}, head)
        except Busy: self.send_json(503, {"error": "busy, try again"}, head)
        except ValueError: self.send_json(400, {"error": "bad query string"}, head)
        except Exception as e:
            print(f"error {u.path}: {type(e).__name__}: {e}", file=sys.stderr)
            self.send_json(503, {"error": "temporarily unavailable"}, head)
        finally:
            _inflight.release()

    def do_GET(self): self.handle_get(False)
    def do_HEAD(self): self.handle_get(True)
    def method_not_allowed(self):
        self.send_response(405); self.send_header("Allow", "GET, HEAD"); self.send_header("Content-Length", "0"); self.end_headers()
    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = method_not_allowed

    def serve_static(self, path, head):   # --dev-static only
        rel = "index.html" if path in ("/", "/index.html") else path.lstrip("/")
        f = os.path.realpath(os.path.join(self.static_dir, rel))
        if not f.startswith(self.static_dir + os.sep) or not os.path.isfile(f):
            return self.send_json(404, {"error": "not found"}, head)
        body = open(f, "rb").read()
        ct = {"html": "text/html", "js": "application/javascript", "json": "application/json"}.get(f.rsplit(".", 1)[-1], "application/octet-stream")
        self.send_response(200); self.send_header("Content-Type", ct + "; charset=utf-8"); self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        if not head: self.wfile.write(body)

    def log_message(self, fmt, *a): pass   # nginx keeps the access log

def main():
    global DB
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/var/lib/bridge-activity/bridge-ro.db")
    ap.add_argument("--port", type=int, default=8794)
    ap.add_argument("--dev-static", help="development only: also serve the page from this directory")
    a = ap.parse_args()
    DB = os.path.abspath(a.db)
    if a.dev_static: Handler.static_dir = os.path.realpath(a.dev_static)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    srv.daemon_threads = True
    print(f"bridge-api on 127.0.0.1:{a.port}, db {DB}" + (f", static {Handler.static_dir}" if a.dev_static else ""), file=sys.stderr)
    srv.serve_forever()

if __name__ == "__main__":
    main()
