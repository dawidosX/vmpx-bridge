#!/usr/bin/env bash
# Enroll the X1 token program on the Sepolia lockbox THROUGH THE TIMELOCK (same path as mainnet).
source "$(dirname "$0")/lib.sh"
TL=$(state_get sepolia_timelock); R=$(state_get sepolia_router); X1R=$(state_get x1_token_program_hex)
DATA=$(cast calldata "enrollRemoteRouter(uint32,bytes32)" "$X1_DOMAIN" "$X1R")
SALT=$(cast keccak "enroll-$(date +%s)"); state_set enroll_salt "$SALT"
cast send "$TL" "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" "$R" 0 "$DATA" 0x$(printf '0%.0s' {1..64}) "$SALT" "$TIMELOCK_DELAY" \
  --rpc-url "$SEPOLIA_RPC" --account "$ETH_ACCOUNT"
echo "waiting $TIMELOCK_DELAY s for timelock..."; sleep $((TIMELOCK_DELAY + 15))
cast send "$TL" "execute(address,uint256,bytes,bytes32,bytes32)" "$R" 0 "$DATA" 0x$(printf '0%.0s' {1..64}) "$SALT" \
  --rpc-url "$SEPOLIA_RPC" --account "$ETH_ACCOUNT"
echo "enrolled: $(cast call "$R" "routers(uint32)(bytes32)" "$X1_DOMAIN" --rpc-url "$SEPOLIA_RPC")"
# fee hook is owned by the timelock from construction (no acceptOwnership step needed)
echo "feeHook owner: $(cast call "$(state_get sepolia_fee_hook)" "owner()(address)" --rpc-url "$SEPOLIA_RPC")"
