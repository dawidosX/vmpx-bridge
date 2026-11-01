#!/usr/bin/env bash
# Generates agent-config.json + env files. Start commands are printed; run validators on EACH validator server.
source "$(dirname "$0")/lib.sh"
SEPOLIA_BLOCK=$(cast block-number --rpc-url "$SEPOLIA_RPC")
node "$HERE/make-agent-config.mjs" --registry "$REG" --x1-rpc "$X1_RPC" --sepolia-rpc "$SEPOLIA_RPC" \
  --x1-mailbox "$(state_get x1_mailbox)" --x1-igp "$(state_get x1_igp_account)" --x1-va "$(state_get x1_va)" \
  --sepolia-from "$SEPOLIA_BLOCK" > "$WORK/agent-config.json"
echo "wrote $WORK/agent-config.json"
cat <<TXT

Build agents (same commit):  cd $MONO/rust/main && cargo build --release --bin validator --bin relayer

Validator for X1-origin (on each of your validator servers; key from KMS or a local file readable only by the agent user):
  CONFIG_FILES=$WORK/agent-config.json HYP_ORIGINCHAINNAME=x1testnet HYP_DB=/var/lib/vmpx/val-x1 \\
  HYP_VALIDATOR_TYPE=hexKey HYP_VALIDATOR_KEY=\$(cat /secure/attestor.hex) \\
  HYP_CHAINS_X1TESTNET_SIGNER_TYPE=hexKey HYP_CHAINS_X1TESTNET_SIGNER_KEY=\$(cat /secure/x1-announce-payer.hex) \\
  # testnet only: hexKey via env is readable in /proc/<pid>/environ by root — mainnet uses HYP_VALIDATOR_TYPE=aws (KMS)
  HYP_CHECKPOINTSYNCER_TYPE=localStorage HYP_CHECKPOINTSYNCER_PATH=/var/lib/vmpx/checkpoints-x1 \\
  $MONO/rust/main/target/release/validator
  (localStorage only works when the relayer runs on the SAME machine; validators on several servers -> HYP_CHECKPOINTSYNCER_TYPE=s3 or gcs)

Validator for Sepolia-origin: same with HYP_ORIGINCHAINNAME=sepolia and HYP_CHAINS_SEPOLIA_SIGNER_* (Sepolia ETH for announce).

Relayer (one server):
  CONFIG_FILES=$WORK/agent-config.json HYP_RELAYCHAINS=sepolia,x1testnet HYP_DB=/var/lib/vmpx/relayer \\
  HYP_ALLOWLOCALCHECKPOINTSYNCERS=true HYP_GASPAYMENTENFORCEMENT='[{"type":"onChainFeeQuoting","gasFraction":"1/2","matchingList":[{"originDomain":$X1_DOMAIN}]},{"type":"none"}]' \\
  HYP_WHITELIST='[{"senderAddress":["$(b32 $(state_get sepolia_router))","$(state_get x1_token_program_hex)"]}]' \\
  HYP_CHAINS_SEPOLIA_SIGNER_TYPE=hexKey HYP_CHAINS_SEPOLIA_SIGNER_KEY=\$(cat /secure/relayer-eth.hex) \\
  HYP_CHAINS_X1TESTNET_SIGNER_TYPE=hexKey HYP_CHAINS_X1TESTNET_SIGNER_KEY=\$(cat /secure/relayer-x1.hex) \\
  $MONO/rust/main/target/release/relayer
TXT
