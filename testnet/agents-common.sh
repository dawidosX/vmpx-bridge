# Shared definitions for import-agent-keys.sh / run-agents.sh / stop-agents.sh (sourced, not executed).
# Testnet stage A: every agent runs on this one machine. Never commit anything under $WORK.
SECURE="$WORK/secure"                    # plaintext *.hex from key generation (move into keystores, then delete)
AGENT_KS="$WORK/keystores-agents"        # encrypted Foundry keystores of the agent keys
AGENT_DIR="$WORK/agents"                 # per-agent databases + pid file
AGENT_LOGS="$WORK/logs/agents"
CHECKPOINTS="$WORK/checkpoints"
PIDFILE="$AGENT_DIR/pids"
AGENT_BIN="$MONO/rust/main/target/release"

# name | origin chain | validator (checkpoint) key | origin-chain signer key (pays the announce) | metrics port
VALIDATORS="
val-x1-1|x1testnet|x1-attestor-1|x1-announce-1|9101
val-x1-2|x1testnet|x1-attestor-2|x1-announce-2|9102
val-x1-3|x1testnet|x1-attestor-3|x1-announce-3|9103
"
RELAYER_PORT=9107
# No Sepolia-origin validators here: a validator must rebuild the WHOLE Sepolia merkle tree (~873k leaves since
# block 4517401) before signing, which needs an archive RPC. The X1 open ISM trusts Hyperlane's public Sepolia
# validator set instead (SEPOLIA_VALIDATORS in testnet.env), whose checkpoints the relayer reads from GCS.
# every key the agents need (names of $SECURE/<name>.hex and of the keystores)
AGENT_KEYS="x1-attestor-1 x1-attestor-2 x1-attestor-3 sepolia-attestor-1 sepolia-attestor-2 sepolia-attestor-3
x1-announce-1 x1-announce-2 x1-announce-3 relayer-eth relayer-x1"

# Password of the agent keystores: from $AGENT_PASS_FILE (default $WORK/.pass) when that file exists,
# otherwise a hidden prompt. Sets AGENT_PW (not exported); callers unset it when done.
read_agent_pw() {  # $1 = "confirm" to ask twice when prompting
  local f="${AGENT_PASS_FILE:-$WORK/.pass}" again
  if [ -f "$f" ]; then AGENT_PW=$(cat "$f"); echo "haslo agentow z pliku $f"; return; fi
  printf "Haslo do keystore'ow agentow: "; read -rs AGENT_PW; echo
  if [ "${1:-}" = confirm ]; then
    printf "Powtorz haslo: "; read -rs again; echo
    [ "$AGENT_PW" = "$again" ] || { unset AGENT_PW; echo "hasla rozne — przerywam"; exit 1; }
  fi
}

# decrypt one agent keystore; prints the 0x key on stdout — only ever call it inside $(...)
agent_key() { CAST_UNSAFE_PASSWORD="$AGENT_PW" cast wallet decrypt-keystore -k "$AGENT_KS" "$1" 2>/dev/null | sed -n 's/.*private key is: //p'; }
