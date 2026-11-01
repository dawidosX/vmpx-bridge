# Security policy

This is an **independent, testnet-only** bridge (Sepolia ⇄ X1 testnet), not affiliated with X1 Labs or the VMPX issuer, and reviewed **only with AI tools** (reports in [`audit/reports/`](audit/reports/)). Human reports are very welcome.

## Reporting a vulnerability

**Report privately only:** use GitHub **[Report a vulnerability](../../security/advisories/new)** (Security → Advisories → *Report a vulnerability*). The report is visible only to the maintainer until it is fixed and published.

- **Do not** open a public issue, pull request or discussion for a vulnerability, and do not post it on social media or chat before a fix.
- Include: affected component and version (commit or page version `vNN`), steps to reproduce, expected vs actual result, transaction hashes or signatures if any, impact.
- Testnet only: do not attack mainnet contracts, other users' funds, the operator's servers or third-party infrastructure (RPC providers, Hyperlane, Telegram). No denial of service, spam or social engineering.
- The maintainer never contacts you first in private messages and never asks for a seed phrase or private keys.

## Response times (best effort, one maintainer)

| Step | Target |
|---|---|
| Acknowledgement | 72 hours |
| First assessment (valid / not valid, severity) | 7 days |
| Fix or mitigation for Critical / High | as soon as possible; the bridge can be paused at once |
| Public advisory and credit (if you want it) | after the fix |

## Scope

| In scope | Where |
|---|---|
| EVM contracts: lockbox router (`VmpxCollateralRouter`), fee hook, `EmergencyPauser`, deploy and role scripts | `evm/` |
| X1 program configuration and client tooling (Hyperlane Sealevel token program as configured here) | `svm/` |
| Web page (wallet flows, transaction verification, stored operation records) | `frontend/` |
| Monitor, automatic pause and operator alerts | `monitoring/` |
| Indexer and public API | `indexer/` |
| Documented procedures that could lead to loss or a stuck bridge | `docs/` |

Out of scope: Hyperlane core contracts and agents themselves (report to [Hyperlane](https://github.com/hyperlane-xyz/hyperlane-monorepo/security)), X1 / Ethereum client bugs, wallet extensions, findings that require a compromised operator key or majority of validators (that is the documented trust model), missing best-practice headers without impact, issues already listed in `audit/reports/` as known or accepted.

## Rewards (testnet)

Rewards are paid in **testnet tokens** (tVMPX on Sepolia and XNT on X1 testnet), at the maintainer's discretion, for the first valid report of an issue:

| Severity | Example | Reward (testnet) |
|---|---|---|
| Critical | unbacked mint on X1, unlock without burn, draining the lockbox, bypassing the pause | 50 000 tVMPX + 20 XNT |
| High | permanent loss or lock of a user's transfer, fee above the cap, unauthorised role change | 20 000 tVMPX + 10 XNT |
| Medium | auto-pause or alert that does not fire, page signing a transaction different from what it shows | 5 000 tVMPX + 5 XNT |
| Low | other security-relevant bugs with limited impact | credit in the advisory |

Testnet tokens have no monetary value. A mainnet bounty, if any, will be announced separately.
