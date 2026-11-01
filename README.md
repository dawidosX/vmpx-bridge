# VMPX Bridge (Ethereum ⇄ X1)

A two-way bridge for the original **VMPX** ERC-20 on Ethereum (`0xb48Eb8368c9C6e9b0734de1Ef4ceB9f484B80b9C`) to **X1** (an SVM chain, Agave fork "Tachyon"), built on a [Hyperlane](https://hyperlane.xyz) Warp Route (collateral → synthetic).

> [!WARNING]
> **Testnet only (Sepolia ⇄ X1 testnet).** Test tokens have no value. Do not send mainnet funds.
>
> **Independent project.** This bridge is not affiliated with, endorsed by or supported by X1 Labs or the VMPX issuer. The X1 token (VMPXe) is an **unofficial** representation.
>
> **Reviewed only with AI tools.** No audit by a security firm. The code was reviewed in repeated rounds by AI models (OpenAI Codex and Anthropic Claude); every report and our assessment of each finding are public in [`audit/reports/`](audit/reports/). AI review can miss bugs.
>
> **Use at your own risk.** Releases from Ethereum depend on the operator's validator set (see [Trust model](#trust-model)). A planned mainnet launch starts with a small cap on the value locked.

Web page (testnet): https://bridge.x1watch.xyz · Report a vulnerability **privately**: [SECURITY.md](SECURITY.md) · Bugs and ideas: [issues](../../issues/new/choose), [CONTRIBUTING.md](CONTRIBUTING.md)

## How it works

- **Ethereum → X1:** VMPX is locked in the lockbox `VmpxCollateralRouter` (a `HypERC20Collateral` behind a proxy). A Hyperlane message mints **VMPXe** on X1 (Token-2022, 9 decimals) through the `hyperlane-sealevel-token` program.
- **X1 → Ethereum:** VMPXe is burned on X1; the message unlocks the same amount of VMPX from the lockbox.
- **Invariant:** VMPX in the lockbox = VMPXe supply on X1 (plus messages in flight). Amounts must be multiples of 1e-9 (X1 has 9 decimals); the router reverts otherwise instead of losing dust.
- **Fees (router v2, testnet):**
  - Ethereum → X1: a bridge fee of `feeBps` (3%) in VMPX, **deducted from the amount** (you send N, you receive N − fee); hard cap `MAX_FEE_BPS = 500` (5%), changes only through the Timelock. Plus a fixed ETH fee for relayer gas (`VmpxEthFeeHook`).
  - X1 → Ethereum: the X1 mailbox protocol fee in XNT (capped on-chain by `max_protocol_fee`) plus the Hyperlane IGP payment for delivery gas.

## Trust model

- **Ethereum → X1** is verified on X1 by the ISM of the X1 token program: the public Hyperlane validator set for Ethereum (6-of-9 on mainnet, 1-of-1 on Sepolia), not the operator's keys.
- **X1 → Ethereum** is verified on Ethereum by an aggregation ISM: **multisig of the operator's Hyperlane validators AND a pause switch AND a daily rate limit** (all three must pass).
  - Testnet: 2-of-3 validators. Planned mainnet: 5-of-7, each validator on its own machine, keys in KMS.
- **Administration:** a `TimelockController` (48 h on mainnet, 300 s on testnet) owns the router, the proxy admin and the fee hook; a guardian can cancel. An `EmergencyPauser` stops deposits and releases at once; only the guardian resumes.
- The bridge is **custodial in the sense that releases depend on the operator's validator set.** Read `docs/03-architecture.md` and `docs/04-threat-model.md` before trusting it with value.

## Repository layout

| Path | What |
|---|---|
| `evm/` | Foundry project: `VmpxCollateralRouter`, `VmpxEthFeeHook`, `EmergencyPauser`, deploy script, tests (unit, fuzz, invariants, upgrade from v1, optional Sepolia fork test) |
| `svm/` | X1 side: compatibility checks, decimals check, Warp Route config, registry entries |
| `testnet/` | Step-by-step testnet deployment scripts (00–09) and helpers |
| `agents/` | Example configuration for Hyperlane validator and relayer (no keys) |
| `frontend/www/` | Static web page (no build step; vendored `@solana/web3.js`) |
| `frontend/tests/` | Read-only checks of the page's X1 transaction builder against the CLI |
| `indexer/` | Indexer (`activity.py`) and read-only HTTP API (`bridge-api.py`) behind the page, with example systemd units |
| `monitoring/` | Alert rules and an auto-pause script |
| `economics/` | Fee and liquidity simulations |
| `audit/` | Multi-model review pack, scope, reports, Slither output |
| `docs/` | Design documents (in Polish): feasibility, architecture, threat model, audit matrix, fees, treasury/LP, runbook, costs, test report, review findings, pause and change process |

## Build and test

Requirements: Foundry (solc 0.8.22, `via_ir`), Node.js 20+.

```bash
cd evm
npm ci
forge test
```

`evm/foundry.toml` pins `solc = "0.8.22"`; remove the line or point it at your own solc 0.8.22 if needed. The Sepolia fork test runs only when `SEPOLIA_FORK_RPC` is set (`--evm-version cancun`).

Everything at once: `scripts/run-all-tests.sh`.

## Security

Please report vulnerabilities **privately**: GitHub **Private vulnerability reporting** (Security tab) or Telegram **[@dawidosX](https://t.me/dawidosX)** (this exact handle only). **I never DM first and will never ask for your seed phrase or private keys.** See [SECURITY.md](SECURITY.md).

## License

Apache License 2.0, see [LICENSE](LICENSE). Third-party code and attributions (Hyperlane, @solana/web3.js, OpenZeppelin) are listed in [NOTICE](NOTICE).
