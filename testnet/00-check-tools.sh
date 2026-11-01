#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
for t in git cargo rustc solana spl-token forge cast node python3 jq; do
  printf "%-10s " "$t"; command -v $t >/dev/null && ($t --version 2>/dev/null | head -1) || echo "MISSING"
done
echo "platform: $(uname -sm)"; echo; echo "Expected: solana-cli 3.0.14 for building programs (rust/sealevel/programs/toolchain.env), rust 1.86, node>=18"
solana address -k "$X1_PAYER_KEYPAIR" && solana balance -u "$X1_RPC" -k "$X1_PAYER_KEYPAIR" || true
cast wallet address --account "$ETH_ACCOUNT" && cast balance --rpc-url "$SEPOLIA_RPC" "$(cast wallet address --account "$ETH_ACCOUNT")" --ether || true
