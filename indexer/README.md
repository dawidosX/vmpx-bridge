# Indexer and API

What runs behind https://bridge.x1watch.xyz:

- `activity.py`: indexer, run every minute by `bridge-activity.timer`. Reads Sepolia (lockbox dispatches, fee events) and X1 testnet (mailbox accounts, IGP payments, protocol fees, the XDEX pool) and writes a SQLite database plus a read-only snapshot and `activity.json` for the page. Stdlib Python only.
- `bridge-api.py`: read-only JSON API on 127.0.0.1 (`/api/transfers`, `/api/search`, `/api/stats/daily`, `/api/stats/limits`). Opens the snapshot read-only; no network access beyond localhost (systemd `DynamicUser`, `IPAddressDeny=any`, `IPAddressAllow=localhost`). Put a reverse proxy with TLS and rate limiting in front of it.
- `fee-report.py`: one-off report of fees vs relayer costs.
- `*.service`, `*.timer`: example systemd units with sandboxing. Adjust users and paths to your host.

Configuration is the `CFG` dict at the top of `activity.py` (contract addresses, RPC URLs, paths). Optional files: a list of bot addresses (`BRIDGE_BOTS_FILE`) and an operator status note (`BRIDGE_STATUS_NOTE`).

Local run: `python3 activity.py /tmp/activity.json` (first run backfills from `start_block`), then `python3 bridge-api.py --db /path/to/bridge-ro.db --dev-static ../frontend/www`.
