#!/usr/bin/env python3
"""Generates gas-oracle-configs.json + overhead-configs.json for `hyperlane-sealevel-client core deploy`.
Semantics from hyperlane-sealevel-igp accounts.rs: token_exchange_rate is scaled by 1e19 and expresses
the value of ONE remote token in local tokens (remote=ETH, local=XNT). Format mirrors
rust/sealevel/environments/mainnet3/gas-oracle-configs.json."""
import argparse, json, os
from decimal import Decimal
p = argparse.ArgumentParser()
p.add_argument("--local", default="x1testnet"); p.add_argument("--remote", required=True); p.add_argument("--eth-usd", required=True); p.add_argument("--xnt-usd", required=True)
p.add_argument("--gas-gwei", required=True); p.add_argument("--overhead", type=int, default=400000); p.add_argument("--out", required=True)
a = p.parse_args()
rate = int(Decimal(a.eth_usd) / Decimal(a.xnt_usd) * Decimal(10) ** 19)
gas_price = int(Decimal(a.gas_gwei) * Decimal(10) ** 9)
os.makedirs(a.out, exist_ok=True)
# nested {local_chain: {remote_chain: {...}}} as read by `igp configure` (client/src/igp.rs configure_igp_and_overhead_igp)
cfg = {a.local: {a.remote: {"oracleConfig": {"tokenExchangeRate": str(rate), "gasPrice": str(gas_price), "tokenDecimals": 18}, "overhead": a.overhead}}}
json.dump(cfg, open(f"{a.out}/gas-oracle-configs.json", "w"), indent=2)
cost_eth = Decimal(a.overhead) * Decimal(gas_price) / Decimal(10) ** 18
print(f"X1->{a.remote}: ~{cost_eth} ETH per message = ~{cost_eth*Decimal(a.eth_usd)/Decimal(a.xnt_usd):.2f} XNT (exchange rate {rate})")
