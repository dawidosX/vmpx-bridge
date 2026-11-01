#!/usr/bin/env python3
"""
Reproducible economic simulation of the VMPX Bridge (Ethereum <-> X1), its fee and treasury-funded LP.
Pure Python (no deps). Deterministic: every scenario uses a fixed seed.

    python3 -I sim.py            # writes results.csv and results.md next to this file

MODEL (daily steps, 365 days)
- Ethereum VMPX/WETH pool: constant product, 1% fee (fee tier NIEPOTWIERDZONE), seeded with
  ETH_POOL_USD total liquidity at price P0 (checked 2026-10-28: ~5.6 kUSD, ~0.0011 USD/VMPX).
- X1 VMPXe/WXNT pool (XDEX = Raydium CP-Swap fork): constant product, DEX_FEE_X1, seeded with
  LP_INIT_USD supplied by the project owner (from the declared ~1.3% VMPX holding + bought XNT).
- Organic flow on X1: daily random trades; `sell_bias` > 0.5 means more VMPXe sold than bought.
- Organic flow on ETH: smaller random trades (current volume ~10 USD/day).
- XNT price: geometric random walk with drift `xnt_drift_yr` (start 0.2397 USD, x1report 2026-10-28).
- Arbitrage: when the X1 price deviates from ETH price by more than the round-trip cost
  (bridge fee + both DEX fees + fixed gas costs) an arbitrageur trades the gap, bridging tokens.
  Both directions modelled. The bridge fee applies to ETH->X1 only (X1->ETH pays only the
  delivery-gas pass-through, see docs/06-fee-design.md).
- Bridge fee revenue in ETH (USD-valued) accrues to treasury. Each month OPEX is paid first.
  When treasury >= LP_BATCH_USD the multisig adds LP on X1 (variant A or B), never per transfer.
- Variant A: buy VMPX on ETH (own slippage), bridge (fee waived for treasury? NO - treasury pays
  gas only, project fee to itself is circular and excluded), acquire XNT via multi-hop route
  (ROUTE_COST_PCT + ROUTE_FIXED_USD), add LP.
  Variant B: move USD value to X1 via route, buy BOTH VMPXe and WXNT on X1 (half of it buys VMPXe in
  our own pool -> moves our own price up -> arbitrage outflow). Shows the "loop" risk.
- Outputs: treasury, OPEX coverage, LP added, LP value, LP provider IL vs HODL, bridge volume,
  #arbitrage trades, collateral locked.

All dollar inputs below are ASSUMPTIONS unless noted. Change them, rerun, compare.
"""
import csv
import math
import os
import random
from dataclasses import dataclass, asdict, field

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------- verified-ish inputs (2026-10-28, see docs/01-feasibility.md) ----------------
P0_VMPX_USD = 0.0011        # DexPaprika/CoinGecko range 0.0010-0.0012 (POTWIERDZONE range)
ETH_POOL_USD = 5_600.0      # Uniswap V3 VMPX/WETH TVL (POTWIERDZONE, single source)
XNT0_USD = 0.2397           # x1report XNT/USDC.X (NIEPOTWIERDZONE, third party)
OWNER_VMPX = 0.013 * 108_624_000  # declared ~1.3% of supply (owner statement, not verified)

# ---------------- assumptions (NIEPOTWIERDZONE — sensitivity-tested) ----------------
ETH_USD = 3_000.0           # not verified for 2026-10-28; only affects gas-in-USD
GAS_GWEI = 1.0
ETH_TX_GAS_DEPOSIT = 180_000       # approve+transferRemote incl. hook (estimate)
ETH_TX_GAS_UNLOCK = 300_000        # relayer process() with aggregation ISM (estimate)
ETH_SWAP_GAS = 150_000
X1_TX_USD = 0.002                  # 1,500-15,000 lamports * XNT price, rounded up
DEX_FEE_ETH = 0.01
DEX_FEE_X1 = 0.0025                # XDEX/Raydium CP default tier (NIEPOTWIERDZONE)
ROUTE_COST_PCT = 0.01              # ETH->(Wormhole/CCTP)->Solana->Warp->X1 (NIEPOTWIERDZONE)
ROUTE_FIXED_USD = 8.0              # sum of bridge flat fees + gas on 3 chains (estimate)
WARP_USDC_FLAT_USD = 1.0           # X1 Warp bridge flat fee (third-party report)
OPEX_MONTH_USD = 60.0              # marginal: operator already runs X1 nodes; KMS, S3, ETH RPC, alerting
LP_BATCH_USD = 200.0
LP_SHARE_OF_NET = 0.6              # share of post-OPEX revenue that goes to LP (rest: reserve)


def gas_usd(gas):
    return gas * GAS_GWEI * 1e-9 * ETH_USD


@dataclass
class Pool:
    x: float  # token reserve (VMPX)
    y: float  # quote reserve in USD-equivalent (WETH or WXNT valued in USD at entry)
    fee: float
    quote_units: float = 1.0  # units of quote asset per USD (for XNT revaluation)

    def price(self):
        return self.y / self.x

    def sell_tokens(self, dx):
        dx_eff = dx * (1 - self.fee)
        dy = self.y * dx_eff / (self.x + dx_eff)
        self.x += dx
        self.y -= dy
        return dy

    def buy_tokens(self, dy):
        dy_eff = dy * (1 - self.fee)
        dx = self.x * dy_eff / (self.y + dy_eff)
        self.y += dy
        self.x -= dx
        return dx

    def add_liquidity(self, dx, dy):
        self.x += dx
        self.y += dy


@dataclass
class Scenario:
    name: str
    lp_init_usd: float
    fee_pct: float
    sell_bias: float
    xnt_drift_yr: float
    organic_x1_usd_day: float
    organic_eth_usd_day: float
    variant: str = "A"
    treasury_seed_usd: float = 0.0
    seed: int = 7


@dataclass
class Result:
    scenario: str
    lp_init_usd: float
    fee_pct: float
    sell_bias: float
    xnt_drift_yr: float
    variant: str
    bridge_vol_usd: float = 0.0
    fee_rev_usd: float = 0.0
    opex_usd: float = 0.0
    opex_covered_pct: float = 0.0
    treasury_end_usd: float = 0.0
    lp_added_usd: float = 0.0
    lp_value_end_usd: float = 0.0
    lp_provider_il_pct: float = 0.0
    arb_trades: int = 0
    max_price_gap_pct: float = 0.0
    collateral_locked_vmpx: float = 0.0
    x1_price_end_vs_eth_pct: float = 0.0
    notes: str = ""


def run(sc: Scenario) -> Result:
    rnd = random.Random(sc.seed)
    eth = Pool(x=(ETH_POOL_USD / 2) / P0_VMPX_USD, y=ETH_POOL_USD / 2, fee=DEX_FEE_ETH)
    x1 = Pool(x=(sc.lp_init_usd / 2) / P0_VMPX_USD, y=sc.lp_init_usd / 2, fee=DEX_FEE_X1)
    lp_tokens_x0, lp_quote_xnt0 = x1.x, (sc.lp_init_usd / 2) / XNT0_USD
    xnt = XNT0_USD
    xnt_vol_day = 0.05
    res = Result(sc.name, sc.lp_init_usd, sc.fee_pct, sc.sell_bias, sc.xnt_drift_yr, sc.variant)
    collateral = x1.x  # initial X1 LP tokens were bridged too
    treasury = sc.treasury_seed_usd
    lp_added = 0.0
    holdings = 0.0  # VMPXe held by X1 users outside the pool
    month_rev = 0.0

    for day in range(365):
        # XNT price move: X1 pool quote side is WXNT -> revalue in USD
        shock = math.exp(sc.xnt_drift_yr / 365 - 0.5 * xnt_vol_day ** 2 + xnt_vol_day * rnd.gauss(0, 1))
        xnt_new = xnt * shock
        x1.y *= xnt_new / xnt
        xnt = xnt_new

        # organic trades
        for _ in range(rnd.randint(0, 6)):
            usd = rnd.expovariate(1 / max(sc.organic_x1_usd_day / 3, 1e-9))
            if rnd.random() < sc.sell_bias:
                toks = min(usd / eth.price(), x1.x * 0.2)  # seller dumps a fixed USD-at-fair-value amount
                if toks > holdings:  # seller first bridges the missing tokens in from Ethereum
                    bridged = toks - holdings
                    holdings = 0.0
                    collateral += bridged
                    f_ = bridged * eth.price() * sc.fee_pct
                    res.fee_rev_usd += f_
                    month_rev += f_
                    res.bridge_vol_usd += bridged * eth.price()
                else:
                    holdings -= toks
                x1.sell_tokens(toks)
            else:
                holdings += x1.buy_tokens(min(usd, x1.y * 0.2))
        for _ in range(rnd.randint(0, 2)):
            usd = rnd.expovariate(1 / max(sc.organic_eth_usd_day / 1.5, 1e-9))
            if rnd.random() < 0.5:
                eth.sell_tokens(min(usd / eth.price(), eth.x * 0.2))
            else:
                eth.buy_tokens(min(usd, eth.y * 0.2))

        # arbitrage (one optimal-ish chunk per day, each direction checked)
        pe, px = eth.price(), x1.price()
        gap = (px - pe) / pe
        res.max_price_gap_pct = max(res.max_price_gap_pct, abs(gap) * 100)
        fixed_e2x = gas_usd(ETH_SWAP_GAS + ETH_TX_GAS_DEPOSIT) + X1_TX_USD
        fixed_x2e = gas_usd(ETH_SWAP_GAS) + gas_usd(ETH_TX_GAS_UNLOCK) + X1_TX_USD  # unlock gas passed through
        if gap > sc.fee_pct + DEX_FEE_ETH + DEX_FEE_X1:
            # buy on ETH, bridge to X1, sell on X1
            best = None
            for usd in (25, 50, 100, 200, 400, 800, 1600):
                if usd > eth.y * 0.5:
                    break
                e2 = Pool(eth.x, eth.y, eth.fee); x2 = Pool(x1.x, x1.y, x1.fee)
                toks = e2.buy_tokens(usd)
                fee = toks * pe * sc.fee_pct
                out = x2.sell_tokens(toks)
                profit = out - usd - fee - fixed_e2x
                if best is None or profit > best[0]:
                    best = (profit, usd)
            if best and best[0] > 0:
                usd = best[1]
                toks = eth.buy_tokens(usd)
                fee = toks * pe * sc.fee_pct
                x1.sell_tokens(toks)
                collateral += toks
                res.bridge_vol_usd += toks * pe
                res.fee_rev_usd += fee
                month_rev += fee
                res.arb_trades += 1
        elif gap < -(DEX_FEE_ETH + DEX_FEE_X1):
            # buy on X1, bridge back, sell on ETH (no project fee on this leg)
            best = None
            for usd in (25, 50, 100, 200, 400, 800, 1600):
                if usd > x1.y * 0.5:
                    break
                e2 = Pool(eth.x, eth.y, eth.fee); x2 = Pool(x1.x, x1.y, x1.fee)
                toks = x2.buy_tokens(usd)
                out = e2.sell_tokens(toks)
                profit = out - usd - fixed_x2e
                if best is None or profit > best[0]:
                    best = (profit, usd)
            if best and best[0] > 0:
                toks = x1.buy_tokens(best[1])
                eth.sell_tokens(toks)
                collateral -= toks
                res.bridge_vol_usd += toks * pe
                res.arb_trades += 1

        assert abs(collateral - (x1.x + holdings)) <= 1e-6 * max(collateral, 1), (collateral, x1.x + holdings)

        # month end: pay OPEX, then LP batch
        if day % 30 == 29:
            treasury += month_rev
            month_rev = 0.0
            pay = min(OPEX_MONTH_USD, treasury)
            treasury -= pay
            res.opex_usd += OPEX_MONTH_USD
            res.opex_covered_pct += pay
            lp_budget = treasury * LP_SHARE_OF_NET
            if lp_budget >= LP_BATCH_USD:
                treasury -= lp_budget
                if sc.variant == "A":
                    half = lp_budget / 2
                    spend = min(half - gas_usd(ETH_SWAP_GAS + ETH_TX_GAS_DEPOSIT), eth.y * 0.3)
                    toks = eth.buy_tokens(spend) if spend > 0 else 0.0
                    collateral += toks
                    xnt_usd = half * (1 - ROUTE_COST_PCT) - ROUTE_FIXED_USD - WARP_USDC_FLAT_USD
                    if xnt_usd > 0:
                        # add at current X1 price ratio; excess token side kept in treasury (ignored)
                        p = x1.price()
                        tok_side = min(toks, xnt_usd / p)
                        x1.add_liquidity(tok_side, tok_side * p)
                        collateral += tok_side - toks  # only tok_side is bridged; rest stays on ETH
                        lp_added += tok_side * p * 2
                else:  # B
                    usd_on_x1 = lp_budget * (1 - ROUTE_COST_PCT) - ROUTE_FIXED_USD - WARP_USDC_FLAT_USD
                    if usd_on_x1 > 0:
                        toks = x1.buy_tokens(usd_on_x1 / 2)  # moves OUR pool price up -> invites arb outflow
                        p = x1.price()
                        x1.add_liquidity(toks, toks * p)
                        lp_added += toks * p * 2

    res.treasury_end_usd = treasury + month_rev
    res.opex_covered_pct = 100.0 * res.opex_covered_pct / max(res.opex_usd, 1e-9)
    res.lp_added_usd = lp_added
    res.lp_value_end_usd = x1.x * x1.price() + x1.y
    # IL for the initial LP provider (tokens vs HODL), valued at end prices
    share = 1.0 if lp_added == 0 else (sc.lp_init_usd) / (sc.lp_init_usd + lp_added)
    lp_now = share * (x1.x * x1.price() + x1.y)
    hodl = lp_tokens_x0 * eth.price() + lp_quote_xnt0 * xnt
    res.lp_provider_il_pct = 100.0 * (lp_now - hodl) / hodl
    res.collateral_locked_vmpx = collateral
    res.x1_price_end_vs_eth_pct = 100.0 * (x1.price() - eth.price()) / eth.price()
    if res.opex_covered_pct < 100:
        res.notes = "fee revenue does not cover OPEX"
    if collateral < 0:
        res.notes += " | ERROR negative collateral"
    return res


def scenarios():
    out = []
    for lp in (1_000, 5_000, 20_000):
        for fee in (0.0, 0.01, 0.03):
            for bias in (0.5, 0.65):
                for drift in (-0.5, 0.0, 0.5):
                    for v in ("A", "B"):
                        out.append(Scenario(
                            name=f"lp{lp}_fee{int(fee*100)}_sell{int(bias*100)}_xnt{int(drift*100)}_{v}",
                            lp_init_usd=lp, fee_pct=fee, sell_bias=bias, xnt_drift_yr=drift,
                            organic_x1_usd_day=lp * 0.02, organic_eth_usd_day=10.0, variant=v))
    for v in ("A", "B"):
        out.append(Scenario(name=f"ABtest_seed1000_{v}", lp_init_usd=5_000, fee_pct=0.03, sell_bias=0.5,
                            xnt_drift_yr=0.0, organic_x1_usd_day=100.0, organic_eth_usd_day=10.0,
                            variant=v, treasury_seed_usd=1_000.0))
    return out


def main():
    rows = [run(s) for s in scenarios()]
    with open(os.path.join(HERE, "results.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(asdict(rows[0]).keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in asdict(r).items()})

    # compact markdown summary: neutral XNT drift, variant A, both sell biases
    lines = ["| LP init USD | fee | sell bias | bridge vol USD/yr | fee rev USD/yr | OPEX covered | LP added USD | arb trades | max gap % | LP IL vs HODL % |",
             "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in rows:
        if r.xnt_drift_yr == 0.0 and r.variant == "A" and not r.scenario.startswith("ABtest"):
            lines.append(f"| {r.lp_init_usd:,.0f} | {r.fee_pct*100:.0f}% | {r.sell_bias:.2f} | {r.bridge_vol_usd:,.0f} | {r.fee_rev_usd:,.0f} | {r.opex_covered_pct:.0f}% | {r.lp_added_usd:,.0f} | {r.arb_trades} | {r.max_price_gap_pct:.1f} | {r.lp_provider_il_pct:.1f} |")
    ab = ["", "Variant A vs B (lp=5000, fee=3%, sell=0.5, XNT flat, treasury seeded with 1,000 USD to exercise the LP path):", "",
          "| variant | LP added USD | x1 price vs ETH at end % | arb trades | collateral VMPX |", "|---|---:|---:|---:|---:|"]
    for r in rows:
        if r.scenario.startswith("ABtest"):
            ab.append(f"| {r.variant} | {r.lp_added_usd:,.0f} | {r.x1_price_end_vs_eth_pct:.1f} | {r.arb_trades} | {r.collateral_locked_vmpx:,.0f} |")
    breakeven_fee_vol = OPEX_MONTH_USD * 12 / 0.03
    hdr = [
        "# Economic simulation results", "",
        f"Generated by `economics/sim.py` (deterministic seeds). Inputs: P0={P0_VMPX_USD} USD/VMPX, ETH pool {ETH_POOL_USD:,.0f} USD, "
        f"XNT {XNT0_USD} USD, OPEX {OPEX_MONTH_USD} USD/month (marginal, operator already runs X1 nodes), ETH {ETH_USD} USD & {GAS_GWEI} gwei (assumed).", "",
        f"Break-even at 3% fee needs ≈ {breakeven_fee_vol:,.0f} USD/year of ETH→X1 volume "
        f"(≈ {breakeven_fee_vol/12:,.0f} USD/month). Current ETH-side DEX volume: ~10 USD/day.", "",
        "Neutral XNT, variant A:", "",
    ]
    with open(os.path.join(HERE, "results.md"), "w") as f:
        f.write("\n".join(hdr + lines + ab) + "\n")
    print("\n".join(hdr + lines + ab))
    neg = [r for r in rows if r.collateral_locked_vmpx < 0]
    assert not neg, "model error: negative collateral"


if __name__ == "__main__":
    main()
