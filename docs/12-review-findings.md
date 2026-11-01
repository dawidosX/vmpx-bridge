# 12 — Ustalenia przeglądów i status poprawek

Źródła rundy 1 (2026-10-28): niezależny przegląd Claude (`audit/reports/claude-independent-2026-10-28.md`) oraz Slither 0.11.6 (`audit/tools/slither.txt`). Przeglądy Grok, GPT i Kimi są do wykonania według `audit/README.md`; ich wyniki dopisujemy tutaj.

| ID | Sev | Status | Poprawka | Test regresyjny |
|---|---|---|---|---|
| H-1 | High | **naprawione** | Łańcuch hooków routera: `[PausableHook, MerkleTreeHook, VmpxEthFeeHook]`. `MERKLE_HOOK` jest wymagany w skrypcie | `test_H1_depositIsInsertedIntoMerkleTree`, `DeployScriptTest.test_scriptWiringOnRealMailbox` (prawdziwy `Mailbox` + `ProtocolFee` jako requiredHook) |
| M-1 | Medium | **naprawione (konfiguracja)** | Użytkownik X1 płaci koszt dostarczenia na Ethereum w XNT przez Sealevel IGP (`testnet/make-igp-config.py`, `igp configure`). Relayer: `onChainFeeQuoting` dla wiadomości z X1. Alert salda relayera | e2e testnet (krok 3 płaci IGP) |
| M-2 | Medium | **zaakceptowane + procedura** | Upstream nie ma opóźniania zamiast odrzucenia. Mitygacja: UI blokuje kwotę > limit, `RATE_CAP` wyraźnie ponad typowy ruch. Odzyskanie: timelock `setRefillRate` → wiadomość dochodzi | `test_M2_oversizedUnlockRecoverable` |
| M-3 | Medium | **zaakceptowane + mitygacja** | Koszt ataku rośnie przez IGP na X1→ETH (M-1) i opłatę ETH→X1. Pojemność dobierana z zapasem. Procedura: guardian pauzuje, timelock podnosi limit | — |
| M-4 | Medium | **częściowo naprawione** | Guardian ma `CANCELLER_ROLE` w timelocku (może zawetować złośliwy upgrade). Uprawnienia X1 przechodzą do Squads z time-lockiem (zob. `docs/13-pause-and-change.md`). Monitor zmian uprawnień X1 → automatyczny alert i pauza ETH. **Rezydualne:** właściciel X1 to nadal punkt zaufania. Szkodę ogranicza `RATE_CAP` i pauza ETH | `DeployScriptTest` (rola canceller) |
| L-1 | Low | **naprawione** | `feeRecipient()` zawsze zwraca 0, a `_transferRemote` revertuje, gdy ustawiony jest `feeHook` | `test_L1_feeRecipientHasNoEffect`, `test_L1_tokenFeeHookBlocksInsteadOfCharging` |
| L-2 | Low | **naprawione** | `RATE_CAP` musi być wielokrotnością 86400. Skrypt sprawdza `maxCapacity() == RATE_CAP` | `test_L2_exactCapDeliverable`, `test_scriptRejectsTruncatingRateCap` |
| L-3 | Low | **naprawione** | Timelock wdrażany jako pierwszy. Hook opłaty dostaje ownera = timelock w konstruktorze. Tymczasowy admin timelocka jest zrzekany | `test_scriptWiringOnRealMailbox` |
| L-4 | Low | **naprawione** | Walidacja: niezerowe role, admin ≠ guardian, walidatorzy posortowani i unikalni, próg ≥ 60%, timelock ≥ 48 h na mainnecie | `test_scriptRejects*` (4 testy) |
| L-5 | Low | **naprawione** | Wykonanie tylko przez ownera, okno 7 dni (`Expired`), `cancelPriceReset` | `test_L5_*` |
| L-6 | Low | **naprawione** | Limit skumulowanej zmiany ceny w 24 h (`MAX_DAILY_PRICE_CHANGE_BPS`). Fallback przy nieaktualnej cenie = `maxFeeWei` w skrypcie | `test_L6_cumulativeDailyBound` |
| L-7 | Low | **otwarte (UI/klient)** | Walidacja adresu EVM w UI i w skrypcie e2e. Upstream `_handle` bez zmian | — |
| I-1 | Info | zaakceptowane | `donate()` jest upstream i nie można go nadpisać. Nie tworzy roszczeń | `test_I1_donateCreatesNoClaim` |
| I-2 | Info | zaakceptowane | Jedna domena w enrollmencie. Dodanie kolejnej wymaga nowego ISM | — |
| I-3 | Info | **naprawione / udokumentowane** | Agenci Sealevel czytają `CommitmentConfig::finalized` (zweryfikowane w `rust/main/chains/hyperlane-sealevel`). Mocniejszy skan sekretów. Ostrzeżenie o `hexKey` w env (mainnet: KMS) | — |
| S-1 | Medium (Slither) | **naprawione** | `divide-before-multiply` w `feeFor` → jedno dzielenie | testy opłaty |
| S-2 | Low (Slither) | naprawione | zero-check `priceUpdater`, `indexed` w zdarzeniach | — |
| S-3 | Info (Slither) | zaakceptowane | `timestamp` (celowe), nazewnictwo immutables, „solc 0.8.22 known issues”. Lista błędów 0.8.22 do sprawdzenia pod kątem naszego kodu przed mainnetem | — |

Liczba testów EVM po rundzie 1: **57** (wcześniej 34), wszystkie PASS.

## Runda 2: przegląd zewnętrzny testnetu (2026-10-30)

Źródło: `audit/reports/external-review-2026-10-30.md`. Zawiera oryginalny tekst i weryfikację każdej tezy na żywo (Sepolia + X1 testnet, tylko odczyt).

| ID | Sev | Status | Ustalenie | Co zrobić przed mainnetem |
|---|---|---|---|---|
| E-1 | Medium | **potwierdzone (testnet), do zrobienia** | Na X1 jeden keypair (`ASLb…N5Yg`) jest upgrade authority wszystkich programów (token, mailbox, ISM ×2, IGP, VA), ownerem tokena i ISM oraz metadata authority. Mint authority to PDA, nie ten klucz | Przenieść owner tokena i ISM oraz upgrade authority do jednego Squads X1 z time-lockiem 48 h (`15-key-custody.md` §8; wcześniejszy podział na „X1-config”/„X1-upgrade” odrzucony w rundzie 3). `check-x1.mjs --post-deploy --expect-upgrade-authority --expect-metadata-authority` musi dać 0 FAIL. Monitor zmian uprawnień (M-4) |
| E-2 | Medium | **potwierdzone (testnet), do zrobienia** | Timelock na Sepolii: proposer/executor/canceller = EOA `0x0468…` (`SAFE` w `testnet.env`), `minDelay` = 300 s. Upgrade lockboxa jest więc w praktyce jednoosobowy z 5-min opóźnieniem. **Nie przez „owner implementacji”**: ta teza recenzenta jest obalona, bo upgrade idzie wyłącznie przez ProxyAdmin → Timelock, a initializer implementacji jest zablokowany | Mainnet: `SAFE` = Safe 3/5, `TIMELOCK_DELAY` = 172 800, guardian (Safe 2/4) jako CANCELLER. Skrypt już to wymusza (L-4). Po deployu sprawdzić `getMinDelay()`, `hasRole()` oraz `owner()` ProxyAdmina |
| E-3 | Low | **naprawione (dokumentacja/UI)** | Komunikacja czasu transferu: ETH→X1 trwało 13–19 min, bo relayer czekał na finalizację; od 30 paź 2026 relayer czeka tyle bloków co walidatorzy: testnet ok. 1 min (52 s), mainnet ok. 4–5 min. X1→ETH 27 s. Nie jest „natychmiastowy” | `frontend/README.md` (wymagania), `frontend/index.html` (wiersz „Czas dostarczenia”, komunikat „minuty, nie sekundy”). Regulamin i ogłoszenia: to samo |
| E-4 | Info | **otwarte (pomiar)** | Czas X1→ETH zmierzony tylko raz w warunkach normalnych (n = 1, 27 s) | Etap B (24 h+): zebrać rozkład opóźnień w obu kierunkach, ustawić progi alarmów monitoringu |
| E-5 | Info | **świadoma decyzja** | Lockbox sam nie jest pauzowalny. Pauza działa przez PausableHook (depozyty) i PausableIsm (odblokowania), których ownerem jest EmergencyPauser | Bez zmian; opisane w `docs/13`. Frontend i dokumentacja mają mówić „pauza mostu”, a nie „pauza lockboxa” |

**Tezy obalone** (dowody w raporcie):
- ISM routera jest znany: AggregationIsm 3/3 [MessageIdMultisig 2/3, PausableIsm, RateLimitedIsm], statyczny klon z fabryki.
- Owner lockboxa (Timelock) ≠ owner Mailboxa (Hyperlane).
- Implementacji nie da się podmienić przez jej „ownera”.
- Obcinania 18→9 nie ma: `AmountNotMultipleOfDustUnit`, test `test_dustAmountReverts` i 08.
- Depozyt w pauzie był testowany: 08 „deposit blocked while paused” i „no tokens taken”. Revert następuje w symulacji, więc na łańcuchu nie ma tx.
