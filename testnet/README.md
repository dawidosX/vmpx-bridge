# Testnet: Sepolia ⇄ X1 testnet

Skrypty uruchamiasz **u siebie**, najlepiej na jednym z serwerów z węzłem X1 albo obok niego. Środowisko, w którym przygotowano repo, nie ma dostępu do RPC X1 ani Sepolii. Klucze zostają u Ciebie: skrypty odwołują się do **ścieżek** keypairów Solany i **nazw** keystore Foundry. Nigdzie nie wklejasz kluczy prywatnych.

## Przygotowanie (raz)

1. Narzędzia: Rust 1.86, Solana CLI **3.0.14** (wymóg budowy programów Hyperlane), `spl-token`, Foundry, Node ≥ 18, `jq`, Python 3.
2. Klucze testowe (tylko testnet, bez wartości):

   ```bash
   solana-keygen new -o ~/.config/solana/vmpx-testnet-deployer.json
   solana-keygen new -o ~/.config/solana/vmpx-testnet-user.json
   cast wallet import vmpx-testnet-deployer --interactive
   cast wallet import vmpx-testnet-user --interactive
   cast wallet import vmpx-testnet-guardian --interactive
   cast wallet import vmpx-testnet-pauser --interactive
   ```

3. Zasil konta: testnet XNT (deployer, user, relayer, każdy atestator na ogłoszenie) i Sepolia ETH (deployer, user, guardian, pauser, relayer, atestatory Sepolii).
4. Atestatory: na każdym serwerze wygeneruj **osobny** klucz secp256k1 (`cast wallet new`). Ich adresy wpisz do `X1_VALIDATORS` i `SEPOLIA_VALIDATORS`.
5. `cp testnet.env.example testnet.env` i uzupełnij (albo trzymaj plik poza repo i ustaw `VMPX_TESTNET_ENV=/ścieżka/testnet.env`).

## Kroki

| # | Skrypt | Co robi | Czas |
|---|---|---|---|
| 0 | `00-check-tools.sh` | wersje narzędzi, salda | 1 min |
| 1 | `01-x1-compat.sh` | genesis, wersja Tachyon, obecność programów (Token-2022, Squads, XDEX…) | 1 min |
| 2 | `02-build-hyperlane.sh` | monorepo + registry na przypiętych commitach, budowa programów Sealevel i klienta, sha256 | 20–60 min |
| 3 | `03-deploy-x1-core.sh` | mailbox, ISM (otwarty + „zamknięty” do pauzy), validator-announce, IGP z wyceną dostarczenia na Sepolię | 5–10 min |
| 4 | `04-deploy-sepolia.sh` | MockVMPX + lockbox (proxy), ISM 3/3, hooki (pauza → merkle → opłata), timelock, EmergencyPauser | 5 min |
| 5 | `05-deploy-x1-warp.sh` | token VMPXe (Token-2022, 9 dec), mint authority → PDA | 5 min |
| 6 | `06-enroll-sepolia.sh` | rejestracja routera X1 na Sepolii **przez timelock** (ta sama ścieżka co mainnet) | ~6 min |
| 7 | `07-agents.sh` | `agent-config.json` + polecenia startu atestatorów i relayera | — |
| 8 | `08-e2e.sh` | odrzucenie dust, transfer tam i z powrotem, STOP pojedynczym kluczem, wznowienie przez guardiana, pauza mintów na X1, niezmiennik pokrycia, sprawdzenie uprawnień na X1 | ~1 h |
| 9 | `09-collect.sh` | paczka logów i stanu (bez kluczy) do analizy | 1 min |

Każdy krok zapisuje log w `$WORK/logs/` i stan w `$WORK/state/`. Kroki można powtarzać.

## Ręczne scenariusze dodatkowe (runbook §1.10)

- Przy 5/7: wyłącz 2 z 7 atestatorów: transfery działają. Wyłącz 3: stoją, nic nie ginie, po włączeniu dochodzą.
- Zatrzymaj relayer na 1 h, potem uruchom: zaległe wiadomości dochodzą.
- Usuń bazę relayera (`HYP_DB`) i uruchom ponownie: dostarczone wiadomości nie są dublowane, niedostarczone dochodzą.

## Co mi odesłać

Plik z `09-collect.sh` (`vmpx-testnet-results-*.tar.gz`) oraz wynik `08-e2e.sh` (`RESULT: N PASS / M FAIL`). Na tej podstawie zaktualizuję raport wykonalności (statusy NIEPOTWIERDZONE → POTWIERDZONE) i poprawię, co nie zadziałało.

## Znane niepewności (sprawdza właśnie testnet)

- Zgodność programów Sealevel (toolchain 3.0.14) z Tachyon 4.0.3.
- Format argumentu odbiorcy w `token transfer-remote` (skrypt podaje hex 32 B).
- Parsowanie adresu mintu z `token query`. W razie błędu: `echo <MINT> > $WORK/state/x1_mint`.
- Checkpointy atestatorów: `localStorage` działa tylko wtedy, gdy relayer czyta ten sam dysk, więc nadaje się na pierwszy test z atestatorami i relayerem na jednym serwerze. Przy atestatorach na kilku serwerach użyj S3 albo GCS. Agenci Hyperlane obsługują `s3`, `gcs` i `localStorage`.
