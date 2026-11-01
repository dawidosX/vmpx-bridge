#!/usr/bin/env bash
# Clones hyperlane-monorepo + registry at pinned commits, builds Sealevel programs + client. Records sha256.
source "$(dirname "$0")/lib.sh"
need git; need cargo
[ -d "$MONO/.git" ] || git clone https://github.com/hyperlane-xyz/hyperlane-monorepo.git "$MONO"
git -C "$MONO" fetch --depth 1 origin "$HYPERLANE_REF" && git -C "$MONO" checkout -q "$HYPERLANE_REF"
echo "monorepo at $(git -C "$MONO" rev-parse HEAD)"
[ -d "$REG/.git" ] || git clone https://github.com/hyperlane-xyz/hyperlane-registry.git "$REG"
git -C "$REG" fetch --depth 1 origin "$REGISTRY_REF" && git -C "$REG" checkout -q "$REGISTRY_REF"
mkdir -p "$REG/chains/x1testnet" && cp "$REPO/svm/registry/chains/x1testnet/metadata.yaml" "$REG/chains/x1testnet/metadata.yaml"
sedi "s#https://rpc.testnet.x1.xyz#$X1_RPC#" "$REG/chains/x1testnet/metadata.yaml"
# the sealevel client reads only the aggregated chains/metadata.yaml, so add x1testnet there too
grep -q '^x1testnet:' "$REG/chains/metadata.yaml" || \
  { echo "x1testnet:"; grep -v '^#' "$REG/chains/x1testnet/metadata.yaml" | sed 's/^/  /'; } >> "$REG/chains/metadata.yaml"

source "$MONO/rust/sealevel/programs/toolchain.env"
echo "building with solana $SOLANA_CLI_VERSION_FOR_BUILDING_PROGRAMS / sbf $SBF_TOOLS_VERSION"
(cd "$MONO/rust/sealevel/programs" && ./build-programs.sh all)
(cd "$MONO/rust/sealevel" && cargo build --release -p hyperlane-sealevel-client)
sha256 "$SO_DIR"/*.so | tee "$WORK/state/program-sha256.txt"
