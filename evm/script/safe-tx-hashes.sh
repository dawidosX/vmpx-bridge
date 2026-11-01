#!/usr/bin/env bash
# Independent Safe transaction hashes (domain hash, message hash, safeTxHash) for a single CALL,
# cross-checked against the Safe contract itself. Optionally prints the hashes of the nested
# approval: a child Safe (owner of the parent) calling parent.approveHash(safeTxHash).
#
# usage: safe-tx-hashes.sh --rpc URL --safe SAFE --to TO --data 0x... [--value WEI] [--nonce N]
#                          [--nested CHILD_SAFE [--child-nonce M]]
# Only operation CALL (0) with no refund (safeTxGas = baseGas = gasPrice = 0, gasToken = refundReceiver = 0x0),
# which is what the Safe web app proposes for a single transaction.
set -euo pipefail

RPC="" SAFE="" TO="" DATA="" VALUE=0 NONCE="" CHILD="" CNONCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rpc) RPC="$2"; shift 2 ;;
    --safe) SAFE="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    --data) DATA="$2"; shift 2 ;;
    --value) VALUE="$2"; shift 2 ;;
    --nonce) NONCE="$2"; shift 2 ;;
    --nested) CHILD="$2"; shift 2 ;;
    --child-nonce) CNONCE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$RPC" ] && [ -n "$SAFE" ] && [ -n "$TO" ] && [ -n "$DATA" ] || { sed -n '5,6p' "$0" >&2; exit 2; }

ZERO=0x0000000000000000000000000000000000000000
# keccak256("EIP712Domain(uint256 chainId,address verifyingContract)")
DOMAIN_TYPEHASH=0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218
# keccak256("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)")
SAFE_TX_TYPEHASH=0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8

lc() { tr 'A-F' 'a-f'; }

# hashes SAFE TO VALUE DATA NONCE -> sets DOMAIN MSG SAFETX (computed locally, then checked on-chain)
hashes() {
  local safe="$1" to="$2" value="$3" data="$4" nonce="$5" chain onchain_dom onchain_tx
  chain=$(cast chain-id --rpc-url "$RPC")
  DOMAIN=$(cast keccak "$(cast abi-encode "f(bytes32,uint256,address)" "$DOMAIN_TYPEHASH" "$chain" "$safe")")
  MSG=$(cast keccak "$(cast abi-encode "f(bytes32,address,uint256,bytes32,uint8,uint256,uint256,uint256,address,address,uint256)" \
    "$SAFE_TX_TYPEHASH" "$to" "$value" "$(cast keccak "$data")" 0 0 0 0 "$ZERO" "$ZERO" "$nonce")")
  SAFETX=$(cast keccak "$(cast concat-hex 0x1901 "$DOMAIN" "$MSG")")
  onchain_dom=$(cast call "$safe" "domainSeparator()(bytes32)" --rpc-url "$RPC")
  onchain_tx=$(cast call "$safe" \
    "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)(bytes32)" \
    "$to" "$value" "$data" 0 0 0 0 "$ZERO" "$ZERO" "$nonce" --rpc-url "$RPC")
  [ "$(echo "$onchain_dom" | lc)" = "$(echo "$DOMAIN" | lc)" ] || { echo "MISMATCH domain: local $DOMAIN, Safe $onchain_dom" >&2; exit 1; }
  [ "$(echo "$onchain_tx" | lc)" = "$(echo "$SAFETX" | lc)" ] || { echo "MISMATCH safeTxHash: local $SAFETX, Safe $onchain_tx" >&2; exit 1; }
  echo "  chain id     : $chain"
  echo "  safe         : $safe (version $(cast call "$safe" "VERSION()(string)" --rpc-url "$RPC"), threshold $(cast call "$safe" "getThreshold()(uint256)" --rpc-url "$RPC"))"
  echo "  to           : $to"
  echo "  value        : $value"
  echo "  data         : $data"
  echo "  data keccak  : $(cast keccak "$data")"
  echo "  operation    : 0 (CALL)"
  echo "  nonce        : $nonce"
  echo "  domain hash  : $DOMAIN"
  echo "  message hash : $MSG"
  echo "  safeTxHash   : $SAFETX   (matches Safe.getTransactionHash)"
}

[ -n "$NONCE" ] || NONCE=$(cast call "$SAFE" "nonce()(uint256)" --rpc-url "$RPC")
echo "== Safe transaction"
hashes "$SAFE" "$TO" "$VALUE" "$DATA" "$NONCE"
PARENT_TX="$SAFETX"

if [ -n "$CHILD" ]; then
  owners=$(cast call "$SAFE" "getOwners()(address[])" --rpc-url "$RPC" | lc)
  case "$owners" in *"$(echo "$CHILD" | lc)"*) ;; *) echo "$CHILD is not an owner of $SAFE" >&2; exit 1 ;; esac
  [ -n "$CNONCE" ] || CNONCE=$(cast call "$CHILD" "nonce()(uint256)" --rpc-url "$RPC")
  echo
  echo "== Nested approval: $CHILD calls approveHash($PARENT_TX) on the parent"
  hashes "$CHILD" "$SAFE" 0 "$(cast calldata "approveHash(bytes32)" "$PARENT_TX")" "$CNONCE"
fi
