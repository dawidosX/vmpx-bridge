#!/usr/bin/env python3
"""Unit tests for the pure parts of activity.py (stdlib only, no network): python3 -m unittest indexer/test_activity.py"""
import importlib.util, os, unittest

_spec = importlib.util.spec_from_file_location("activity", os.path.join(os.path.dirname(__file__), "activity.py"))
act = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(act)

MAILBOX = "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk"   # X1 testnet mailbox
# a real processed-message account on X1 testnet (read 31 Oct 2026): pubkey = PDA(hyperlane-processed_message-<id>)
REAL_PDA = "DB42a225pkz8jJhFkCNisqJppaf5Sm6aQoBuThB9VQfj"
REAL_ID = bytes.fromhex("65cae0b13c8559239a4965f70502b9fa0b4a0e17debee9e1ce87bfec1ade197e")

def processed(mid: bytes, slot=1234) -> bytes:
    return b"\x01" + b"PROCESSD" + (7).to_bytes(8, "little") + mid + slot.to_bytes(8, "little")

def dispatch(body: bytes, slot=99) -> bytes:
    return b"\x01" + b"DISPATCH" + (5).to_bytes(4, "little") + slot.to_bytes(8, "little") + b"\x22" * 32 + body

class MailboxAccounts(unittest.TestCase):
    def test_real_processed_pda(self):
        self.assertEqual(act.find_pda([b"hyperlane", b"-", b"processed_message", b"-", REAL_ID], MAILBOX), REAL_PDA)
        k = act.mailbox_account(REAL_PDA, processed(REAL_ID), MAILBOX)
        self.assertEqual(k, ("processed", "0x" + REAL_ID.hex(), 1234))

    def test_R01_processed_marker_inside_dispatch_body_is_ignored(self):
        # attacker's message body: PROCESSD | 8 bytes | id of a pending transfer | slot
        forged = b"PROCESSD" + b"\0" * 8 + REAL_ID + (1).to_bytes(8, "little")
        k = act.mailbox_account("AnyDispatchAccount1111111111111111111111111", dispatch(b"header" + forged), MAILBOX)
        self.assertEqual(k[0], "dispatch", "a DISPATCH account stays a dispatch, whatever its body contains")

    def test_R01_processed_layout_at_wrong_address_is_ignored(self):
        self.assertIsNone(act.mailbox_account("11111111111111111111111111111111", processed(REAL_ID), MAILBOX))
        other = bytes(32)
        self.assertIsNone(act.mailbox_account(REAL_PDA, processed(other), MAILBOX), "PDA of another id")

    def test_uninitialized_or_short_is_ignored(self):
        self.assertIsNone(act.mailbox_account(REAL_PDA, b"\x00" + processed(REAL_ID)[1:], MAILBOX))
        self.assertIsNone(act.mailbox_account(REAL_PDA, b"\x01PROCESSD", MAILBOX))

    def test_dispatch_offsets(self):
        k = act.mailbox_account("X", dispatch(b"MSG", slot=4242), MAILBOX)
        self.assertEqual(k, ("dispatch", 4242, b"MSG"))

class Solvency(unittest.TestCase):
    E = 10 ** 18
    def test_R03_codex_example_is_a_shortfall(self):
        # lockbox 100, X1 supply 60, real burns of 50 waiting for unlock -> liabilities 110, 10 missing
        self.assertEqual(act.solvency(100 * self.E, 60 * 10 ** 9, 0, 50 * self.E), -10 * self.E)

    def test_in_flight_both_directions_is_exactly_covered(self):
        self.assertEqual(act.solvency(170 * self.E, 100 * 10 ** 9, 30 * self.E, 40 * self.E), 0)

    def test_donation_is_surplus(self):
        self.assertEqual(act.solvency(101 * self.E, 100 * 10 ** 9, 0, 0), self.E)

    def test_roundC_shortfall_is_a_human_alarm_after_30_min(self):
        ok, since = act.solvent_check(0, -1, True, 1000)
        self.assertEqual((ok, since), (None, 1000), "first shortfall: checking, not an alarm")
        ok, since = act.solvent_check(since, -1, True, 1000 + act.SHORTFALL_ALARM_S - 1)
        self.assertIsNone(ok, "29 min 59 s: still checking")
        ok, since = act.solvent_check(since, -1, True, 1000 + act.SHORTFALL_ALARM_S)
        self.assertIs(ok, False, "30 min on consecutive runs: alarm")
        ok, since = act.solvent_check(since, 0, True, 5000)
        self.assertEqual((ok, since), (True, 0), "covered again resets the timer")

    def test_R606_gap_between_runs_restarts_the_timer(self):
        ok, since = act.solvent_check(0, -1, True, 1000)
        last = 1000
        for t in range(1060, 1000 + 1500, 60): ok, since = act.solvent_check(since, -1, True, t, last); last = t
        self.assertEqual(since, 1000, "consecutive runs keep the start")
        ok, since = act.solvent_check(since, -1, True, last + act.SHORTFALL_MAX_GAP_S + 1, last)
        self.assertEqual(since, last + act.SHORTFALL_MAX_GAP_S + 1, "gap too long: the 30 min start again")
        self.assertIsNone(ok)

    def test_incomplete_data_is_never_covered(self):
        self.assertEqual(act.solvent_check(0, 5, False, 100), (None, 0))
        self.assertEqual(act.solvent_check(50, -5, False, 100), (None, 0), "R7-04: an incomplete run breaks the continuity")

    def test_R704_incomplete_runs_do_not_count_for_continuity(self):
        # 20 min shortfall on complete runs, then 15 min of incomplete runs, then complete again: no instant alarm
        ok, since = act.solvent_check(0, -1, True, 1000); last = 1000
        for t in range(1060, 2200, 60): ok, since = act.solvent_check(since, -1, True, t, last); last = t
        self.assertEqual(since, 1000)
        for t in range(2260, 3160, 60): ok, since = act.solvent_check(since, -1, False, t, last)   # `last` not advanced (caller)
        self.assertEqual((ok, since), (None, 0))
        ok, since = act.solvent_check(since, -1, True, 3160, last)
        self.assertIsNone(ok, "after the incomplete stretch the 30 min start again, no alarm at once")
        self.assertEqual(since, 3160)

    def test_R704_caller_keeps_last_only_from_complete_runs(self):
        src = open(act.__file__).read()
        self.assertIn('if complete: meta_set(db, "shortfall_last", now)', src)

class Reorg(unittest.TestCase):
    """Codex round 3, R-07: rows from non-final Sepolia blocks are re-checked against the canonical chain."""
    def setUp(self):
        import sqlite3
        self.db = sqlite3.connect(":memory:"); self.db.row_factory = sqlite3.Row
        act.init_schema(self.db)
        self.chain = {100: "0xaaa", 101: "0xbbb"}; self.receipts = {}
        def fake_erpc(method, params):
            if method == "eth_getBlockByNumber": return {"hash": self.chain.get(int(params[0], 16)), "timestamp": hex(1700000000 + int(params[0], 16))}
            if method == "eth_getTransactionReceipt": return self.receipts.get(params[0])
            raise AssertionError(method)
        self._orig, act.erpc = act.erpc, fake_erpc
        ins = "INSERT INTO transfers(id, dir, amount, sent, sent_tx, sent_block, sent_blockhash, delivered, delivered_block, delivered_blockhash) VALUES (?,?,?,?,?,?,?,?,?,?)"
        self.db.execute(ins, ("0xd1", "e2x", "5", 1, "0xt1", 100, "0xaaa", None, None, None))
        self.db.execute(ins, ("0xd2", "e2x", "6", 1, "0xt2", 101, "0xbbb", None, None, None))
        self.db.execute(ins, ("0xx1", "x2e", "7", 1, None, None, None, 2, 101, "0xbbb"))
    def tearDown(self): act.erpc = self._orig
    def ids(self): return {r[0]: r for r in self.db.execute("SELECT id, delivered, sent_block FROM transfers")}

    def test_no_reorg_keeps_everything(self):
        act.reorg_check(self.db, 99)
        self.assertEqual(set(self.ids()), {"0xd1", "0xd2", "0xx1"})
        self.assertEqual(self.ids()["0xx1"][1], 2)

    def test_dropped_deposit_removed_and_delivery_reset(self):
        self.chain[101] = "0xccc"                       # block 101 replaced
        act.reorg_check(self.db, 99)
        rows = self.ids()
        self.assertNotIn("0xd2", rows, "deposit not in the canonical chain any more")
        self.assertIn("0xd1", rows)
        self.assertIsNone(rows["0xx1"][1], "X1->ETH delivery back to pending")

    def _receipt(self, nonce, amount, block, bhash, from_="0xuser", extra=()):
        msg, rc = self._receipt1(nonce, amount, block, bhash, from_)
        for n, a in extra: rc["logs"] += self._receipt1(n, a, block, bhash, from_)[1]["logs"]
        return msg, rc

    def _receipt1(self, nonce, amount, block, bhash, from_="0xuser"):
        rcpt = bytes(32)
        body = rcpt + amount.to_bytes(32, "big")
        msg = bytes([3]) + nonce.to_bytes(4, "big") + (11155111).to_bytes(4, "big") + bytes.fromhex(act.CFG["lockbox"][2:].rjust(64, "0")) + \
              (1479626325).to_bytes(4, "big") + bytes(32) + body
        data = (32).to_bytes(32, "big") + len(msg).to_bytes(32, "big") + msg + bytes((32 - len(msg) % 32) % 32)
        self.chain[block] = bhash
        return msg, {"status": "0x1", "blockNumber": hex(block), "blockHash": bhash, "from": from_, "logs": [
            {"address": act.CFG["eth_mailbox"], "topics": [act.TOPIC_DISPATCH, "0x" + act.CFG["lockbox"][2:].lower().rjust(64, "0")], "data": "0x" + data.hex()}]}

    def test_reincluded_deposit_same_message_moves(self):
        msg, rc = self._receipt(7, 6, 102, "0xddd")
        mid = "0x" + act.keccak256(msg).hex()
        self.db.execute("UPDATE transfers SET id=? WHERE id='0xd2'", (mid,))
        self.chain[101] = "0xccc"; self.receipts["0xt2"] = rc
        act.reorg_check(self.db, 99)
        self.assertEqual(self.ids()[mid][2], 102)

    def test_R506_reincluded_with_another_nonce_replaces_the_row(self):
        # after the reorg the same transaction ran after another dispatch: new nonce -> new ID, another amount
        msg, rc = self._receipt(8, 9 * 10**18, 102, "0xddd")
        new_id = "0x" + act.keccak256(msg).hex()
        self.chain[101] = "0xccc"; self.receipts["0xt2"] = rc
        act.reorg_check(self.db, 99)
        rows = {r[0]: r for r in self.db.execute("SELECT id, amount, sent_block, sent_tx FROM transfers WHERE dir='e2x'")}
        self.assertNotIn("0xd2", rows, "the old ID (not minted) is gone")
        self.assertIn(new_id, rows); self.assertEqual(rows[new_id][1], str(9 * 10**18)); self.assertEqual(rows[new_id][2], 102)
        self.assertEqual(rows[new_id][3], "0xt2")

    def test_R607_two_dispatches_in_one_receipt_both_rows(self):
        m1, rc = self._receipt(8, 3, 102, "0xddd", extra=[(9, 4)])
        m2 = self._receipt1(9, 4, 102, "0xddd")[0]
        self.chain[101] = "0xccc"; self.receipts["0xt2"] = rc
        self.assertEqual(len(act.dispatches_from_receipt(rc)), 2)
        act.reorg_check(self.db, 99)
        rows = {r[0]: r for r in self.db.execute("SELECT id, amount, sent_block FROM transfers WHERE dir='e2x'")}
        for m, a in ((m1, "3"), (m2, "4")):
            mid = "0x" + act.keccak256(m).hex()
            self.assertIn(mid, rows); self.assertEqual(rows[mid][1], a); self.assertEqual(rows[mid][2], 102)
        self.assertNotIn("0xd2", rows)

    def test_R607_new_id_already_delivered_keeps_delivery(self):
        msg, rc = self._receipt(8, 6, 102, "0xddd")
        new_id = "0x" + act.keccak256(msg).hex()
        # the new ID is already known and minted on X1 (seen earlier by the X1 side)
        self.db.execute("INSERT INTO transfers(id, dir, amount, sender, sent, delivered, delivered_tx) VALUES (?,?,?,?,?,?,?)",
                        (new_id, "e2x", "6", "0xorig", 5, 777, "x1tx"))
        self.chain[101] = "0xccc"; self.receipts["0xt2"] = rc
        act.reorg_check(self.db, 99); act.reorg_check(self.db, 99)      # idempotent
        r = self.db.execute("SELECT delivered, delivered_tx, sent_block, sender, sent_tx FROM transfers WHERE id=?", (new_id,)).fetchone()
        self.assertEqual((r[0], r[1]), (777, "x1tx"), "delivery kept (no INSERT OR REPLACE)")
        self.assertEqual(r[2], 102); self.assertEqual(r[3], "0xorig"); self.assertEqual(r[4], "0xt2")

    def test_R607_minted_old_id_is_kept_when_tx_dispatched_another(self):
        msg, rc = self._receipt(8, 6, 102, "0xddd")
        self.db.execute("UPDATE transfers SET delivered=55 WHERE id='0xd2'")
        self.chain[101] = "0xccc"; self.receipts["0xt2"] = rc
        act.reorg_check(self.db, 99)
        ids = set(self.ids())
        self.assertIn("0xd2", ids, "a minted row stays (incident for the solvency check)")
        self.assertIn("0x" + act.keccak256(msg).hex(), ids)

    def test_R505_unhashed_rows_make_the_index_incomplete(self):
        self.assertEqual(act.unhashed_rows(self.db), 0)
        self.db.execute("INSERT INTO transfers(id, dir, amount, sent) VALUES ('0xold', 'e2x', '1', 1)")
        self.assertEqual(act.unhashed_rows(self.db), 1)

    def test_R404_reorg_caught_when_fin_has_passed_the_block(self):
        # the indexer was down while block 101 was replaced AND the finalized head moved past it: the row is not
        # final yet, so it is still checked once more (the old code skipped it and kept the dropped deposit)
        self.chain[101] = "0xccc"
        act.reorg_check(self.db, 105)
        rows = self.ids()
        self.assertNotIn("0xd2", rows, "dropped deposit removed although fin > its block")
        self.assertIsNone(rows["0xx1"][1], "dropped delivery back to pending although fin > its block")

    def test_rows_marked_final_after_last_check_then_never_rechecked(self):
        act.reorg_check(self.db, 105)                   # canonical: d1, d2 and the delivery become final
        fin = {r[0]: (r[1], r[2]) for r in self.db.execute("SELECT id, sent_final, delivered_final FROM transfers")}
        self.assertEqual(fin["0xd1"][0], 1); self.assertEqual(fin["0xd2"][0], 1); self.assertEqual(fin["0xx1"][1], 1)
        calls = []
        orig = act.erpc
        act.erpc = lambda m, p: calls.append(m) or orig(m, p)
        self.chain[101] = "0xccc"                       # a change below finality is not looked at any more
        act.reorg_check(self.db, 106)
        self.assertEqual(calls, [], "final rows are not queried")
        self.assertEqual(set(self.ids()), {"0xd1", "0xd2", "0xx1"})

    def test_not_final_while_above_fin(self):
        act.reorg_check(self.db, 100)                   # block 101 above fin: checked, not final yet
        f = dict(self.db.execute("SELECT id, sent_final FROM transfers WHERE dir='e2x'").fetchall())
        self.assertEqual(f["0xd1"], 1); self.assertIsNone(f["0xd2"])

if __name__ == "__main__":
    unittest.main()
