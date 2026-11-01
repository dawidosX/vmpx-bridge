#!/usr/bin/env python3
"""Unit tests for bridge-api.py stats caching and the concurrency limit (Codex round 3, R-11). Stdlib only.
   python3 -m unittest indexer/test_api.py"""
import importlib.util, os, sqlite3, tempfile, unittest

_spec = importlib.util.spec_from_file_location("bridge_api", os.path.join(os.path.dirname(__file__), "bridge-api.py"))
api = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(api)
_act = importlib.util.spec_from_file_location("activity", os.path.join(os.path.dirname(__file__), "activity.py"))
act = importlib.util.module_from_spec(_act); _act.loader.exec_module(act)

class StatsCache(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(); api.DB = os.path.join(self.dir, "bridge-ro.db")
        db = sqlite3.connect(api.DB); act.init_schema(db)
        db.execute("INSERT INTO transfers(id, dir, amount, sent, delivered) VALUES ('0x1', 'e2x', '5', 1000, 1010)"); db.commit(); db.close()
        api._cache.clear(); self.calls = 0
        orig = api.connect
        def counting():
            self.calls += 1; return orig()
        self._orig, api.connect = orig, counting
    def tearDown(self): api.connect = self._orig

    def test_same_snapshot_is_computed_once(self):
        a = api.stats_daily({"days": "30"}); b = api.stats_daily({"days": "30"})
        self.assertEqual(a, b); self.assertEqual(self.calls, 1)
        api.stats_daily({"days": "7"}); self.assertEqual(self.calls, 2, "other parameters: own entry")

    def test_new_snapshot_invalidates(self):
        api.stats_daily({"days": "30"})
        st = os.stat(api.DB); os.utime(api.DB, ns=(st.st_atime_ns, st.st_mtime_ns + 10**9))
        api.stats_daily({"days": "30"}); self.assertEqual(self.calls, 2)

    def test_R408_equivalent_queries_share_one_entry(self):
        api.stats_daily({"days": "30"}); api.stats_daily({"days": "030", "bot": "all"}); api.stats_daily({})
        self.assertEqual(self.calls, 1, "normalised key: days=30, 030 and the default are one entry")

    def test_R408_unknown_parameter_rejected(self):
        import io
        class Fake(api.Handler):
            def __init__(self, path): self.path = path; self.sent = None
            def send_json(self, code, obj, head=False): self.sent = (code, obj)
        h = Fake("/api/stats/daily?days=90&x=1"); h.handle_get(False)
        self.assertEqual(h.sent[0], 400); self.assertIn("unknown parameter", h.sent[1]["error"])
        h = Fake("/api/stats/daily?days=90&bot=human"); h.handle_get(False)
        self.assertEqual(h.sent[0], 200)
        self.assertEqual(self.calls, 1, "the rejected request computed nothing")

    def test_busy_when_all_slots_taken(self):
        for _ in range(api.MAX_BUSY): api._busy.acquire()
        old, api.QUEUE_WAIT_S = api.QUEUE_WAIT_S, 0.05
        try:
            with self.assertRaises(api.Busy): api.stats_daily({"days": "3"})
        finally:
            api.QUEUE_WAIT_S = old
            for _ in range(api.MAX_BUSY): api._busy.release()

class PageQueries(unittest.TestCase):
    """Every query the page sends (frontend/www/app.js loadTx, stats.js) must be accepted (200); unknown parameters
    stay rejected (R4-08). Queries taken from the page code, 31 Oct 2026."""
    def setUp(self):
        self.dir = tempfile.mkdtemp(); api.DB = os.path.join(self.dir, "bridge-ro.db")
        db = sqlite3.connect(api.DB); act.init_schema(db)
        db.execute("INSERT INTO transfers(id, dir, amount, sender, recipient, sent, sent_tx, delivered) VALUES "
                   "('0x' || printf('%064d', 1), 'e2x', '5', '0x45b4c5be8e96fa18e368e871b2592ef39424d668', 'So11111111111111111111111111111111111111112', 1000, "
                   "'0x8f4092399e6a30f2d5a1450d1eead01d0bc01bb6f422c4ae9171845eca06b87a', 1010)")
        db.commit(); db.close(); api._cache.clear()
        class Fake(api.Handler):
            def __init__(self, path): self.path = path; self.sent = None
            def send_json(self, code, obj, head=False): self.sent = (code, obj)
        self.Fake = Fake
    def get(self, path):
        h = self.Fake(path); h.handle_get(False); return h.sent

    def test_transactions_tab_every_filter_and_page(self):
        for d in ("all", "e2x", "x2e"):
            for b in ("all", "human", "bot"):
                for page in (1, 2):
                    code, obj = self.get(f"/api/transfers?page={page}&dir={d}&bot={b}")
                    self.assertEqual(code, 200, (d, b, page, obj))

    def test_search_every_query_kind(self):
        for q in ("0x45b4C5Be8E96Fa18E368E871b2592eF39424D668",                       # Ethereum address
                  "0x8f4092399e6a30f2d5a1450d1eead01d0bc01bb6f422c4ae9171845eca06b87a",  # tx hash / message ID
                  "So11111111111111111111111111111111111111112",                        # X1 address
                  "6YQ7zoYLaaC1GfL7V1Tn8cocZ3n2VcwtDdfYdGg2844sfHGv8rjGuUKGKn65qiY9EFk5p1fPFL6R4BNy797Gujk"):  # X1 signature
            code, obj = self.get("/api/search?q=" + q)
            self.assertEqual(code, 200, (q, obj))
        self.assertEqual(self.get("/api/search?q=0x45b4C5Be8E96Fa18E368E871b2592eF39424D668")[1]["items"][0]["dir"], "e2x")

    def test_statistics_tab_queries(self):
        for p in ("/api/stats/daily?days=30&bot=all", "/api/stats/daily?days=30&bot=human", "/api/stats/daily?days=30&bot=bot",
                  "/api/stats/daily?days=1&bot=all", "/api/stats/limits"):
            self.assertEqual(self.get(p)[0], 200, p)

    def test_unknown_parameters_still_rejected(self):
        for p in ("/api/transfers?page=1&dir=all&bot=all&x=1", "/api/search?q=0x00&t=1", "/api/stats/limits?days=1"):
            self.assertEqual(self.get(p)[0], 400, p)

if __name__ == "__main__":
    unittest.main()
