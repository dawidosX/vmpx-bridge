#!/usr/bin/env bash
# One-time: encrypts the agent keys from $WORK/secure/*.hex into Foundry keystores ($WORK/keystores-agents)
# under ONE password, then checks every keystore decrypts back to the same key. Prints names/addresses only.
# The X1 (ed25519) seeds are stored as raw 32-byte secrets; their "EVM address" in the keystore is meaningless.
# Note: cast receives key and password as arguments, so they are visible in `ps` for ~1 s per key (local Mac only).
source "$(dirname "$0")/lib.sh"
source "$HERE/agents-common.sh"
need cast
mkdir -p "$AGENT_KS"; chmod 700 "$AGENT_KS"; umask 077
read_agent_pw confirm
[ -n "$AGENT_PW" ] || { echo "puste haslo — przerywam"; exit 1; }
for n in $AGENT_KEYS; do
  [ -f "$SECURE/$n.hex" ] || { echo "brak $SECURE/$n.hex"; exit 1; }
  if [ ! -f "$AGENT_KS/$n" ]; then
    cast wallet import "$n" -k "$AGENT_KS" --private-key "0x$(cat "$SECURE/$n.hex")" --unsafe-password "$AGENT_PW" >/dev/null 2>&1 \
      || { echo "$n: import nieudany"; exit 1; }
  fi
  [ "$(agent_key "$n")" = "0x$(cat "$SECURE/$n.hex")" ] || { echo "$n: keystore NIE odszyfrowuje sie do tego samego klucza (inne haslo?)"; exit 1; }
  printf "%-20s OK  %s\n" "$n" "$(cat "$SECURE/$n.addr")"
done
unset AGENT_PW
echo
echo "Wszystkie klucze sa w $AGENT_KS. Jawne kopie mozesz usunac (nieodwracalne):"
echo "  rm -P $SECURE/*.hex $SECURE/*.json"
