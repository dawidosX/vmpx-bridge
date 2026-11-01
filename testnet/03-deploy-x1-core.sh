#!/usr/bin/env bash
# Deploys Hyperlane core on X1 testnet: mailbox, multisig-ism-message-id (open), validator-announce, igp.
# Then a SECOND multisig-ism-message-id ("closed") used as the X1-side pause switch.
source "$(dirname "$0")/lib.sh"
# IGP gas oracle for Sepolia: X1 users pay the Sepolia delivery cost in XNT (review finding M-1)
python3 "$HERE/make-igp-config.py" --remote sepolia --eth-usd "$ETH_USD" --xnt-usd "$XNT_USD" \
   --gas-gwei "$SEPOLIA_GAS_GWEI" --overhead "$X1_TO_ETH_GAS" --out "$WORK/igp"
sl core deploy --local-domain "$X1_DOMAIN" --environment "$ENVNAME" --environments-dir "$ENVDIR" \
   --chain x1testnet --remote-domains "$SEPOLIA_DOMAIN" --built-so-dir "$SO_DIR"
CORE="$ENVDIR/$ENVNAME/x1testnet/core/program-ids.json"; cat "$CORE"
state_set x1_mailbox "$(jq -r .mailbox "$CORE")"
state_set x1_open_ism "$(jq -r .multisig_ism_message_id "$CORE")"
state_set x1_va "$(jq -r .validator_announce "$CORE")"
state_set x1_igp "$(jq -r .igp_program_id "$CORE")"
state_set x1_overhead_igp "$(jq -r .overhead_igp_account "$CORE")"
# agents need the IGP *account* (owned by the IGP program), not the program id: they resolve the program as its owner
state_set x1_igp_account "$(jq -r .igp_account "$CORE")"
sl igp configure --program-id "$(state_get x1_igp)" --chain x1testnet \
   --gas-oracle-config-file "$WORK/igp/gas-oracle-configs.json" --registry "$REG"

# Open ISM: attestors that watch Sepolia
sl multisig-ism-message-id set-validators-and-threshold --program-id "$(state_get x1_open_ism)" \
   --domain "$SEPOLIA_DOMAIN" --validators "$SEPOLIA_VALIDATORS" --threshold "$SEPOLIA_THRESHOLD"

# Closed ISM (pause): same audited program, validator nobody controls
mkdir -p "$WORK/closed-ism-keys"
solana program deploy -u "$X1_RPC" -k "$X1_PAYER_KEYPAIR" "$SO_DIR/hyperlane_sealevel_multisig_ism_message_id.so" \
   --program-id "$WORK/closed-ism-keys/program.json" 2>/dev/null || \
   { solana-keygen new --no-bip39-passphrase -s -o "$WORK/closed-ism-keys/program.json"; \
     solana program deploy -u "$X1_RPC" -k "$X1_PAYER_KEYPAIR" "$SO_DIR/hyperlane_sealevel_multisig_ism_message_id.so" --program-id "$WORK/closed-ism-keys/program.json"; }
CLOSED=$(solana address -k "$WORK/closed-ism-keys/program.json"); state_set x1_closed_ism "$CLOSED"
sl multisig-ism-message-id init --program-id "$CLOSED"
sl multisig-ism-message-id set-validators-and-threshold --program-id "$CLOSED" \
   --domain "$SEPOLIA_DOMAIN" --validators 0x000000000000000000000000000000000000dEaD --threshold 1
