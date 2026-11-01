# Prompt do przeglądu (identyczny dla każdego modelu)

Wklej ten prompt, a pod nim zawartość `audit/context.txt` (generuje ją `audit/build-context.sh`). Agentom z dostępem do plików, np. Claude Code, podaj ścieżkę do repo zamiast pliku.

---

You are a senior smart-contract and bridge security auditor. Review the code and configuration below for a lock-and-mint bridge of an existing immutable ERC-20 (VMPX, OZ ERC20Capped, 18 decimals) from Ethereum to X1 (an SVM/Solana-fork chain), built on Hyperlane (@hyperlane-xyz/core 12.2.0, Sealevel synthetic token program, 9 decimals on X1 with remoteDecimals 18).

Scope, trust model and invariants are in SCOPE.md (included). Upstream Hyperlane is out of scope EXCEPT where our usage or configuration creates risk.

Requirements:
1. Find concrete vulnerabilities, misconfigurations and liveness/DoS risks. For each finding give: ID, severity (Critical/High/Medium/Low/Info), title, file:line, description, step-by-step exploit scenario, impact, recommendation, confidence (high/medium/low).
2. For each High/Critical finding provide a Foundry PoC test (Solidity) that can be added to evm/test/ and that uses the existing BridgeBase test fixture where possible.
3. Explicitly check: unlock without burn; mint without lock; replay; fee bypass/griefing; ETH stuck or misrouted refunds; inherited admin paths that move collateral; what each role (attestors, admin Safe, guardian, price bot, X1 Squads owner, relayer, deployer) can do if compromised; timelock bypass; rate-limit semantics; decimals/dust; proxy/initializer issues; Mailbox hook ordering (merkle tree insertion); X1 rollback/finality assumptions; secrets handling in scripts.
4. List what you checked and found to be fine (so we can compare coverage between reviewers).
5. Do NOT invent line numbers or functions. If unsure, say so and lower confidence. No generic advice without a concrete location.

Output strictly in the format of FINDINGS_TEMPLATE.md.
