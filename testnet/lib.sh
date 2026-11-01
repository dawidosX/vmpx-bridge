# shared helpers — sourced by every step
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# config: $VMPX_TESTNET_ENV if set (e.g. kept outside the checkout), else testnet/testnet.env
TESTNET_ENV="${VMPX_TESTNET_ENV:-$HERE/testnet.env}"
[ -f "$TESTNET_ENV" ] || { echo "missing $TESTNET_ENV (copy testnet/testnet.env.example or set VMPX_TESTNET_ENV)"; exit 1; }
set -a; source "$TESTNET_ENV"; set +a
mkdir -p "$WORK/logs" "$WORK/state"
STEP="$(basename "$0" .sh)"
LOG="$WORK/logs/$STEP.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== $STEP  $(date -u +%FT%TZ) ==="
MONO="$WORK/hyperlane-monorepo"
REG="$WORK/registry"
ENVDIR="$WORK/environments"
ENVNAME=testnet
SO_DIR="$MONO/rust/sealevel/target/deploy"
CLIENT="$MONO/rust/sealevel/target/release/hyperlane-sealevel-client"
state_set() { echo "$2" > "$WORK/state/$1"; echo "  state $1 = $2"; }
state_get() { cat "$WORK/state/$1" 2>/dev/null || { echo "missing state $1 — run previous steps" >&2; exit 1; }; }
need() { command -v "$1" >/dev/null || { echo "missing tool: $1"; exit 1; }; }
sl() { "$CLIENT" -u "$X1_RPC" -k "$X1_PAYER_KEYPAIR" "$@"; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
sedi() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }   # GNU vs BSD sed
b32() { python3 -c "import sys;print('0x'+sys.argv[1][2:].lower().rjust(64,'0'))" "$1"; }
