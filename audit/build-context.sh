#!/usr/bin/env bash
# Builds audit/context.txt: scope + all in-scope files + the upstream files our code inherits from.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/audit/context.txt"; H="$ROOT/evm/node_modules/@hyperlane-xyz/core/contracts"
{
  echo "### COMMIT $(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo n/a)"
  for f in audit/SCOPE.md evm/src/VmpxCollateralRouter.sol evm/src/VmpxEthFeeHook.sol evm/script/DeployEth.s.sol \
           evm/test/BridgeBase.t.sol evm/test/Bridge.t.sol evm/test/Governance.t.sol evm/test/ReviewFixes.t.sol evm/test/Invariant.t.sol \
           svm/warp-route/token-config.json agents/relayer.env.example agents/validator.x1.env.example testnet/07-agents.sh; do
    echo; echo "### FILE $f"; cat "$ROOT/$f"
  done
  for f in token/HypERC20Collateral.sol token/libs/TokenRouter.sol token/libs/LpCollateralRouter.sol token/libs/MovableCollateralRouter.sol \
           Mailbox.sol hooks/aggregation/StaticAggregationHook.sol hooks/PausableHook.sol hooks/MerkleTreeHook.sol \
           isms/warp-route/RateLimitedIsm.sol libs/RateLimited.sol isms/PausableIsm.sol isms/aggregation/AbstractAggregationIsm.sol; do
    echo; echo "### UPSTREAM @hyperlane-xyz/core@12.2.0 contracts/$f"; cat "$H/$f"
  done
} > "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT") bytes, ~$(( $(wc -c < "$OUT") / 4 )) tokens)"
