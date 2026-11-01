// Pure collateral-accounting logic. All amounts are BigInt in VMPX base units (18 dec).
//
//   locked       = VMPX.balanceOf(lockbox) on Ethereum
//   circulating  = X1 synthetic mint supply (9 dec) * 1e9
//   pendingE2X   = sum of ETH->X1 messages dispatched (SentTransferRemote) but not yet processed on X1
//   pendingX2E   = sum of X1->ETH messages dispatched (burned on X1) but not yet processed on ETH
//
// Solvency (Codex I-01): locked >= circulating + pendingE2X + pendingX2E. Exact equality is NOT expected: anyone can
// send VMPX straight to the lockbox (ERC-20 transfer or upstream donate()), which nobody can claim.
//  - locked <  circulating               -> CRITICAL: X1 supply not backed (mint without lock or unlock without burn)
//  - locked <  circulating + pending     -> CRITICAL: some in-flight burn can no longer be redeemed in full
//  - locked >  circulating + pending     -> OK, reported separately as `surplus` (donation / direct transfer / a
//                                           message the indexer has not seen yet); never a liability
// Coverage ratio is reported in units of the ORIGINAL token, never in USD.

export const SCALE = 10n ** 9n;

export function evaluate({ locked, supply9, pendingE2X = 0n, pendingX2E = 0n, toleranceBase = 0n }) {
  const circulating = supply9 * SCALE;
  const expected = circulating + pendingE2X + pendingX2E;
  const delta = locked - expected;
  const coverageBps = circulating === 0n ? null : Number((locked * 10_000n) / circulating);
  let severity = "OK";
  const reasons = [];
  if (locked < circulating) {
    severity = "CRITICAL";
    reasons.push("lockbox balance below circulating X1 supply");
  } else if (delta < -toleranceBase) {
    severity = "CRITICAL";
    reasons.push("lockbox balance below circulating + in-flight");
  }
  const surplus = delta > 0n ? delta : 0n;
  if (surplus > toleranceBase) reasons.push("surplus in lockbox (donation / direct transfer / unseen message), not a liability");
  return { severity, reasons, locked, circulating, pendingE2X, pendingX2E, expected, delta, surplus, coverageBps };
}

// Governance / authority watchlist. Any of these events is at least WARN and pages a human.
// NOT EXECUTED YET: this is a declaration for the authority monitor (Codex round 3, R-02, separate round; plan in
// audit/reports/codex-2026-10-31-runda3-ocena.md sec. 3). Nothing in monitor.mjs reads these logs today.
export const WATCHED_EVM_EVENTS = {
  "OwnershipTransferred(address,address)": "CRITICAL",
  "OwnershipTransferStarted(address,address)": "CRITICAL",
  "IsmSet(address)": "CRITICAL",
  "HookSet(address)": "CRITICAL",
  "RemoteRouterEnrolled(uint32,bytes32)": "CRITICAL",
  "FeeRecipientSet(address)": "CRITICAL",
  "FeeHookSet(address)": "CRITICAL",
  "Paused(address)": "WARN",
  "Unpaused(address)": "WARN",
  "FeeParamsAnnounced((uint16,uint256,uint256,uint256,uint256),uint256)": "WARN",
  "PriceResetAnnounced(uint256,uint256)": "WARN",
  "BeneficiarySet(address)": "WARN",
  "PriceUpdaterSet(address)": "WARN",
  "PausedAll(address,string)": "CRITICAL",
  "PauserSet(address,bool)": "WARN",
  "GuardianProposed(address)": "CRITICAL",
  "Upgraded(address)": "CRITICAL",
  "CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)": "CRITICAL",
  "Cancelled(bytes32)": "WARN",
};
// X1 side (poll): token owner, ISM, remote routers, multisig ISM validators/threshold, program upgrade authority,
// mint authority, metadata. ANY change -> CRITICAL and auto-pause on Ethereum (M-4 of review round 1).

export function classifyMintState({ mint, mintAuthority, freezeAuthority, decimals, extensions = [] }) {
  const issues = [];
  if (mintAuthority !== mint) issues.push(["CRITICAL", `mint authority changed: ${mintAuthority}`]);
  if (freezeAuthority != null) issues.push(["CRITICAL", `freeze authority set: ${freezeAuthority}`]);
  if (decimals !== 9) issues.push(["CRITICAL", `decimals ${decimals} != 9`]);
  const bad = extensions.filter((e) => !["metadataPointer", "tokenMetadata"].includes(e));
  if (bad.length) issues.push(["CRITICAL", `unexpected Token-2022 extensions: ${bad.join(",")}`]);
  return issues;
}

/** Stuck-message detector: messages older than `maxAgeSec` that are still pending. */
export function stuckMessages(pending, nowSec, maxAgeSec) {
  return pending.filter((m) => nowSec - m.dispatchedAt > maxAgeSec);
}
