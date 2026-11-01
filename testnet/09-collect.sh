#!/usr/bin/env bash
# Bundles logs + public state for review. Contains NO keys (keypairs live outside $WORK/logs and $WORK/state).
source "$(dirname "$0")/lib.sh"
OUT="$WORK/vmpx-testnet-results-$(date +%Y%m%d-%H%M).tar.gz"
# keypair JSON arrays, PEM, raw 32-byte hex keys (0x + 64 hex not preceded by tx/addr context is still flagged — review manually)
if grep -rlE "PRIVATE|BEGIN .*KEY|\[[0-9]{1,3}(,[0-9]{1,3}){63}\]|(KEY|key)[^\n]{0,20}(0x)?[0-9a-fA-F]{64}" "$WORK/logs" "$WORK/state"; then
  echo "possible secret found in the files above — remove it and rerun"; exit 1; fi
tar czf "$OUT" -C "$WORK" logs state agent-config.json warp/token-config.json environments/$ENVNAME/x1testnet/core/program-ids.json environments/$ENVNAME/warp-routes 2>/dev/null
echo "send this file back for analysis: $OUT"
