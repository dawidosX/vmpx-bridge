#!/usr/bin/env bash
# Read-only. Records genesis hash, version, program presence. Exit !=0 on critical FAIL.
source "$(dirname "$0")/lib.sh"
node "$REPO/svm/compat/check-x1.mjs" --rpc "$X1_RPC"
