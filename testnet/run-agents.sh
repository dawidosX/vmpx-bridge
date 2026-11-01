#!/usr/bin/env bash
# Starts 3 X1-origin validators and the relayer on THIS machine, in the background.
# Takes the agent keystore password from $WORK/.pass (or asks once); keys only ever live in the environment of
# the agent processes: never written to disk, echoed or logged. Testnet only — on mainnet keys come from KMS.
# Logs: $WORK/logs/agents/<name>.log   PIDs: $WORK/agents/pids   stop: testnet/stop-agents.sh
source "$(dirname "$0")/lib.sh"
source "$HERE/agents-common.sh"
need cast; need jq
[ -x "$AGENT_BIN/validator" ] && [ -x "$AGENT_BIN/relayer" ] || { echo "brak agentow — zbuduj: cd $MONO/rust/main && cargo build --release --bin validator --bin relayer"; exit 1; }
[ -f "$WORK/agent-config.json" ] || { echo "brak $WORK/agent-config.json — uruchom 07-agents.sh"; exit 1; }
if [ -f "$PIDFILE" ]; then
  while read -r _ pid; do kill -0 "$pid" 2>/dev/null && { echo "agenci juz dzialaja ($PIDFILE) — najpierw stop-agents.sh"; exit 1; }; done < "$PIDFILE"
  rm -f "$PIDFILE"
fi
mkdir -p "$AGENT_DIR" "$AGENT_LOGS" "$CHECKPOINTS"
# agents always read every *.json in ./config (cwd) before CONFIG_FILES; an empty one keeps
# agent-config.json the only source instead of the upstream mainnet/testnet chain configs
mkdir -p "$AGENT_DIR/config"; cd "$AGENT_DIR"

read_agent_pw
[ -n "$(agent_key relayer-eth)" ] || { unset AGENT_PW; echo "zle haslo albo brak keystore'ow ($AGENT_KS) — uruchom import-agent-keys.sh"; exit 1; }

# Each agent gets its variables via `export` (a builtin) in its own subshell, then exec — so keys never
# appear in any process's argv, only in that one agent's environment.
started() { echo "$1 $2" >> "$PIDFILE"; echo "  started $1 (pid $2) -> $AGENT_LOGS/$1.log"; }

while IFS='|' read -r name origin vkey skey port; do
  [ -n "$name" ] || continue
  upper=$(echo "$origin" | tr '[:lower:]' '[:upper:]')
  mkdir -p "$AGENT_DIR/$name" "$CHECKPOINTS/$name"
  (
    export CONFIG_FILES="$WORK/agent-config.json" HYP_TRACING_LEVEL=info
    export HYP_ORIGINCHAINNAME="$origin" HYP_DB="$AGENT_DIR/$name/db" HYP_METRICSPORT="$port"
    export HYP_VALIDATOR_TYPE=hexKey HYP_VALIDATOR_KEY="$(agent_key "$vkey")"
    export "HYP_CHAINS_${upper}_SIGNER_TYPE=hexKey" "HYP_CHAINS_${upper}_SIGNER_KEY=$(agent_key "$skey")"
    export HYP_CHECKPOINTSYNCER_TYPE=localStorage HYP_CHECKPOINTSYNCER_PATH="$CHECKPOINTS/$name"
    exec "$AGENT_BIN/validator"
  ) >> "$AGENT_LOGS/$name.log" 2>&1 < /dev/null &
  started "$name" $!
done <<EOF
$VALIDATORS
EOF

# relayer: only our route (Sepolia lockbox <-> X1 token program), X1-origin messages must have paid the IGP
ROUTER_B32=$(b32 "$(state_get sepolia_router)"); X1R=$(state_get x1_token_program_hex)
WHITELIST="[{\"senderAddress\":[\"$ROUTER_B32\",\"$X1R\"],\"recipientAddress\":[\"$ROUTER_B32\",\"$X1R\"]}]"
GASPOLICY="[{\"type\":\"onChainFeeQuoting\",\"gasFraction\":\"1/2\",\"matchingList\":[{\"originDomain\":$X1_DOMAIN}]},{\"type\":\"none\"}]"
mkdir -p "$AGENT_DIR/relayer"
(
  export CONFIG_FILES="$WORK/agent-config.json" HYP_TRACING_LEVEL=info
  export HYP_RELAYCHAINS=sepolia,x1testnet HYP_DB="$AGENT_DIR/relayer/db" HYP_METRICSPORT="$RELAYER_PORT"
  export HYP_ALLOWLOCALCHECKPOINTSYNCERS=true HYP_GASPAYMENTENFORCEMENT="$GASPOLICY" HYP_WHITELIST="$WHITELIST"
  export HYP_CHAINS_SEPOLIA_SIGNER_TYPE=hexKey HYP_CHAINS_SEPOLIA_SIGNER_KEY="$(agent_key relayer-eth)"
  export HYP_CHAINS_X1TESTNET_SIGNER_TYPE=hexKey HYP_CHAINS_X1TESTNET_SIGNER_KEY="$(agent_key relayer-x1)"
  exec "$AGENT_BIN/relayer"
) >> "$AGENT_LOGS/relayer.log" 2>&1 < /dev/null &
started relayer $!
unset AGENT_PW

# keep the Mac awake while the agents run (stopped by stop-agents.sh)
caffeinate -ims < /dev/null > /dev/null 2>&1 &
echo "caffeinate $!" >> "$PIDFILE"
echo "  caffeinate (pid $!)"
sleep 5
echo; echo "status after 5 s:"
while read -r name pid; do kill -0 "$pid" 2>/dev/null && echo "  $name running" || echo "  $name EXITED — see $AGENT_LOGS/$name.log"; done < "$PIDFILE"
echo "whitelist: lockbox $ROUTER_B32 + X1 program $X1R"
