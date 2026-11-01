# Off-chain agents (Hyperlane validator + relayer)

Pinned upstream: hyperlane-monorepo release **agents-v3.0.0** → commit `f556e18c9da88ce3d51a24164f22a7f27eb539fd` (2026-10-23).
Build from source at that commit (`rust/main`, `cargo build --release --bin validator --bin relayer`)
or use the official image **pinned by digest** (look up the digest for that commit; never use `:latest`).
No public audit of the Rust agents was found (docs/05-audit-matrix.md).

## Roles on the operator's own X1 nodes

| Process | Where | Watches | Signs / sends | Key |
|---|---|---|---|---|
| `validator --originChainName x1` | 7–10 of your X1 servers (one per server) | X1 Mailbox merkle tree (finalized) | checkpoint signatures for X1→ETH (= unlock of collateral) | **dedicated** secp256k1 key per server, in KMS/HSM — never the X1 vote/identity key |
| `validator --originChainName ethereum` (option B) | same servers | Ethereum Mailbox (finalized) | checkpoints for ETH→X1 (= mint) | dedicated key |
| `relayer` | 1 primary + 1 standby | both chains | submits `process` txs | hot wallet with small ETH + XNT balance; **cannot** forge messages |

### ETH → X1 (mint) — two options
- **A (preferred, NIEPOTWIERDZONE):** X1 multisig ISM for origin `ethereum` uses Hyperlane's public Ethereum validator set
  (6/9 in `typescript/sdk/src/consts/multisigIsm.ts`). Independent from the operator, zero cost. Must verify on testnet
  that their checkpoints are publicly readable by our relayer.
- **B:** your own validators also watch Ethereum (needs Ethereum RPC on each node or a paid RPC).

### X1 → ETH (unlock) — only your validators
No third-party validator watches X1. Threshold: **5-of-7** (each on its own machine; `DeployEth` enforces this profile on mainnet), keys on different machines/providers,
plus EVM-side PausableIsm + RateLimitedIsm (see evm/). Whoever controls 7 keys controls the collateral:
publish the validator set and say so in the UI.

Checkpoint storage: each validator writes to its own S3 (or GCS) bucket, public-read, announced in X1 ValidatorAnnounce.
