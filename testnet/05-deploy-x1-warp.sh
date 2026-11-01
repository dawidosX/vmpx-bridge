#!/usr/bin/env bash
# X1 testnet: synthetic VMPXe (Token-2022, 9 dec, remoteDecimals 18), enrolled to the Sepolia lockbox.
source "$(dirname "$0")/lib.sh"

# The client shells out to $HOME/.cargo/bin/spl-token (hard-coded) to create the synthetic mint at its PDA,
# which only Hyperlane's fork can do. Any other spl-token leaves the program initialized but the mint
# uninitialized, and the client then skips the mint on re-runs. So refuse to start without the fork.
SPL_FORK_REPO=https://github.com/hyperlane-xyz/solana-program-library
SPL_FORK_REV=e101ccabbd1e86ee72ea2d0b1320e93fd1a54729
spl_fork_ok() {
  local bin="$HOME/.cargo/bin/spl-token" real root src
  [ "$("$bin" --version 2>/dev/null)" = "spl-token-cli 4.0.1" ] || return 1
  # installed the way the client does it (cargo install --git ... --rev e101cca)
  grep -q "hyperlane-xyz/solana-program-library?branch=dan/create-token-for-mint&rev=e101cca#$SPL_FORK_REV" \
    "${CARGO_HOME:-$HOME/.cargo}/.crates2.json" 2>/dev/null && return 0
  # or a link to a `cargo install --path <checkout> --root <dir>` build of that exact commit
  real=$(readlink -f "$bin") || return 1
  root=$(dirname "$(dirname "$real")")
  src=$(jq -r '.installs | keys[] | select(startswith("spl-token-cli 4.0.1 (path+file://"))' "$root/.crates2.json" 2>/dev/null \
        | sed -E 's#.*\(path\+file://(.*)\)$#\1#' | head -1)
  [ -n "$src" ] && [ "$(git -C "$src" rev-parse HEAD 2>/dev/null)" = "$SPL_FORK_REV" ]
}
if ! spl_fork_ok; then
  cat <<TXT
ERROR: ~/.cargo/bin/spl-token is not Hyperlane's spl-token fork (spl-token-cli 4.0.1 @ ${SPL_FORK_REV:0:7}).
Found: $("$HOME/.cargo/bin/spl-token" --version 2>/dev/null || echo "nothing")
Nothing was sent. Install the fork into a separate root and link it in for this step only:
  rustup toolchain install 1.76.0
  git clone --branch dan/create-token-for-mint $SPL_FORK_REPO \$WORK/tools/spl
  git -C \$WORK/tools/spl checkout $SPL_FORK_REV
  cargo +1.76.0 install --path \$WORK/tools/spl/token/cli --locked --root \$WORK/tools
  mv ~/.cargo/bin/spl-token ~/.cargo/bin/spl-token.orig   # if you have one
  ln -s \$WORK/tools/bin/spl-token ~/.cargo/bin/spl-token
  # after this step: rm ~/.cargo/bin/spl-token && mv ~/.cargo/bin/spl-token.orig ~/.cargo/bin/spl-token
TXT
  exit 1
fi
echo "spl-token fork OK: $(readlink -f "$HOME/.cargo/bin/spl-token") @ ${SPL_FORK_REV:0:7}"

ROUTER=$(state_get sepolia_router)
mkdir -p "$WORK/warp"
# no "uri" on testnet: an empty string makes the client try to fetch it and panic; a missing uri skips
# validation on isTestnet chains. Mainnet needs a real https URL to metadata.json (svm/warp-route).
cat > "$WORK/warp/token-config.json" <<JSON
{
  "sepolia":   { "type": "collateral", "decimals": 18, "token": "$(state_get sepolia_token)", "foreignDeployment": "$ROUTER" },
  "x1testnet": { "type": "synthetic", "decimals": 9, "remoteDecimals": 18,
                 "name": "Bridged VMPX (Ethereum) - unofficial TESTNET", "symbol": "tVMPXe",
                 "interchainSecurityModule": "$(state_get x1_open_ism)",
                 "interchainGasPaymaster": "$(state_get x1_overhead_igp)" }
}
JSON
sl warp-route deploy --environment "$ENVNAME" --environments-dir "$ENVDIR" --built-so-dir "$SO_DIR" \
   --warp-route-name VMPX --token-config-file "$WORK/warp/token-config.json" --registry "$REG"
PIDS="$ENVDIR/$ENVNAME/warp-routes/VMPX/program-ids.json"; cat "$PIDS"
state_set x1_token_program "$(jq -r .x1testnet.base58 "$PIDS")"
state_set x1_token_program_hex "$(jq -r .x1testnet.hex "$PIDS")"
sl token query --program-id "$(state_get x1_token_program)" synthetic | tee "$WORK/state/x1-token-query.txt"
