#!/usr/bin/env bash
# Sepolia: MockVMPX (stand-in for VMPX, same ERC20Capped behaviour) + lockbox proxy, ISMs, hooks, timelock.
source "$(dirname "$0")/lib.sh"
cd "$REPO/evm"; [ -d node_modules ] || npm ci
REGA="$REG/chains/sepolia/addresses.yaml"; y() { grep "^$1:" "$REGA" | awk '{print $2}' | tr -d '"'; }
MAILBOX=$(y mailbox); echo "sepolia mailbox $MAILBOX"
# reuse the mock from a previous (partial) run instead of deploying a second one
TOKEN=$(cat "$WORK/state/sepolia_token" 2>/dev/null || true)
if [ -n "$TOKEN" ] && [ "$(cast code "$TOKEN" --rpc-url "$SEPOLIA_RPC")" != "0x" ]; then
  echo "reusing MockVMPX $TOKEN"
else
  TOKEN=$(forge create test/BridgeBase.t.sol:MockVMPX --rpc-url "$SEPOLIA_RPC" --account "$ETH_ACCOUNT" --broadcast | awk '/Deployed to/{print $3}')
  [ -n "$TOKEN" ] || { echo "MockVMPX deploy failed"; exit 1; }
  state_set sepolia_token "$TOKEN"
fi
# --hardfork: contracts compile for paris (foundry.toml), but the simulation must match the chain:
# the Hyperlane factories on Sepolia use PUSH0, and Sepolia runs Amsterdam, which reprices contract
# creation ~6.5x — simulating on prague underestimates gas and every CREATE runs out of gas.
# --hardfork only selects the EVM forge simulates/estimates on; it does not touch the compiler
# (bytecode stays evm_version=paris: on-chain code hashes match the paris artifacts).
TOKEN=$TOKEN MAILBOX=$MAILBOX MERKLE_HOOK=$(y merkleTreeHook) X1_DOMAIN=$X1_DOMAIN X1_VALIDATORS=$X1_VALIDATORS X1_THRESHOLD=$X1_THRESHOLD \
RATE_CAP=$RATE_CAP SAFE=$SAFE GUARDIAN=$GUARDIAN PAUSERS=$PAUSERS PRICE_BOT=$PRICE_BOT BENEFICIARY=$BENEFICIARY TREASURY=${TREASURY:?set TREASURY (VMPX fee recipient) in testnet.env} BRIDGE_FEE_BPS=${BRIDGE_FEE_BPS:-300} \
INITIAL_PRICE_WEI=400000000000 TIMELOCK_DELAY=$TIMELOCK_DELAY \
MSIG_FACTORY=$(y staticMessageIdMultisigIsmFactory) AGG_FACTORY=$(y staticAggregationIsmFactory) AGG_HOOK_FACTORY=$(y staticAggregationHookFactory) \
forge script script/DeployEth.s.sol --rpc-url "$SEPOLIA_RPC" --account "$ETH_ACCOUNT" --hardfork amsterdam --broadcast | tee "$WORK/state/deploy-sepolia.txt"
g() { grep -E "^\s+$1 0x" "$WORK/state/deploy-sepolia.txt" | awk '{print $2}'; }
state_set sepolia_router "$(g 'router\(proxy\)')"
state_set sepolia_timelock "$(g timelock)"
state_set sepolia_pause_ism "$(g 'pausableIsm\(unlocks\)')"
state_set sepolia_pause_hook "$(g 'pausableHook\(deposits\)')"
state_set sepolia_fee_hook "$(g feeHook)"
state_set sepolia_proxy_admin "$(g proxyAdmin)"
state_set sepolia_pauser "$(g emergencyPauser)"
