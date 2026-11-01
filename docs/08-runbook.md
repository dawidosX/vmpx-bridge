# 08 — Wdrożenie, utrzymanie, zatrzymanie i wznowienie

> Ten dokument **nie** upoważnia do wdrożenia na mainnet, przenoszenia aktywów ani zmiany uprawnień. Każdy krok oznaczony 🔒 wymaga osobnej, wyraźnej decyzji właściciela projektu. Nigdy nie wklejaj seed phrase ani kluczy do czatu, repo ani ticketów.

## 0. Wymagania

- Foundry, Node ≥ 18, Rust 1.86, Solana CLI 3.0.14 (do budowy programów), `spl-token` CLI.
- Safe 3/5 na Ethereum, Squads 3/5 na X1 (najpierw zweryfikować wdrożenie Squads na X1).
- 10 kluczy atestacji X1 (secp256k1) w KMS u co najmniej 2 dostawców, **osobnych** od kluczy vote/identity X1.
- Uruchomione `svm/compat/check-x1.mjs` na testnecie i mainnecie: wszystkie krytyczne pozycje PASS.
- **Fork `spl-token` Hyperlane** (`hyperlane-xyz/solana-program-library`, rev `e101cca`, `spl-token-cli 4.0.1`) w `~/.cargo/bin/spl-token` na czas `warp-route deploy`. Klient Sealevel wywołuje tę ścieżkę na sztywno, żeby utworzyć mint w PDA. Zwykły `spl-token` zostawia program zainicjowany, ale mint nie (§1a). `testnet/05-deploy-x1-warp.sh` odmawia startu bez forka. Po deployu przywróć oryginalny `spl-token`.
- **Własne (albo płatne, dedykowane) RPC X1** dla deployu, relayera i atestatorów. Publiczne `rpc.*.x1.xyz` stoi za load balancerem. Na etapie A dawało `Max retries exceeded` przy deployu programów, czasem odpowiadało stroną HTML zamiast JSON-a, a węzły się rozjeżdżały (odczyt podaży 410 przy rzeczywistych 415). Odczyty kontrolne zawsze z commitment `finalized`.
- **Ethereum: RPC bez przycinania historii dla relayera.** Atestatory ETH nie są potrzebne, bo kierunek ETH→X1 podpisuje publiczny zbiór Hyperlane (`03-architecture.md`).

## 1. Testnet (Sepolia ↔ X1 testnet)

1. `svm/registry/chains/x1-testnet.metadata.yaml` → prywatny registry. Domena 1479626325.
2. Budowa programów Sealevel z audytowanego commita `84f886b` (albo z `a9b3e870` po przeglądzie diffu). Zapisz sha256 każdego `.so`.
3. `hyperlane-sealevel-client core deploy --local-domain 1479626325 ...` (mailbox, validator-announce, multisig-ism-message-id, igp). Zapisz `program-ids.json`.
4. Uruchom atestatory X1→ETH (`agents/validator.x1.env.example`) i sprawdź ogłoszenia w ValidatorAnnounce. Dla ETH→X1 ustaw w otwartym ISM X1 publiczny zbiór Hyperlane dla domeny źródłowej (`typescript/sdk/src/consts/multisigIsm.ts` z przypiętego commita) i sprawdź, że każdy walidator z listy ma ogłoszoną lokalizację w ValidatorAnnounce na Ethereum.
5. Sepolia: deploy `VmpxCollateralRouter(MockVMPX, mailboxSepolia, 1e9)`, ISM (multisig 5/7 + pausable + rateLimited), `VmpxEthFeeHook`, timelock.
6. `hyperlane-sealevel-client warp-route deploy` z `svm/warp-route/token-config.json` (wariant testnet).
7. Enroll routerów po obu stronach. Ustaw `destinationGas`.
8. **Natychmiast po kroku 6**, przed enrollem (§1a): `check-x1.mjs --post-deploy --mint … --program … --expect-upgrade-authority … --expect-metadata-authority …` musi dać **0 FAIL**.
9. Relayer z whitelistą tylko naszej trasy. Monitor (`monitoring/`).
10. Scenariusze manualne: pełny round-trip, pauza → wiadomość czeka → wznowienie, przekroczenie limitu, restart relayera z odtworzeniem stanu (usuń DB relayera, uruchom ponownie i sprawdź, że niedostarczone wiadomości są dostarczane, a dostarczone nie są duplikowane), wyłączenie 3 z 10 atestatorów (przy progu 7 nadal działa), wyłączenie 4 (most stoi, nic nie ginie).

## 1a. Pułapki znalezione na etapie A testnetu (obowiązkowe przed mainnetem)

| Pułapka | Objaw | Co robić |
|---|---|---|
| Przerwany albo źle wykonany `warp-route deploy` (np. bez forka `spl-token`) | program tokena zainicjowany, ale **mint nie istnieje**. Ponowny deploy pomija tworzenie mintu, bo program już jest. Powstaje osierocony program | zweryfikuj mint od razu: `check-x1.mjs --post-deploy` oraz `token query` (mint authority = PDA, 9 dec, freeze brak). Jeśli mintu nie ma, **nowy program** (nowy keypair), a stary zamknij i **nigdy nie enrolluj** (testnet: `5AWG…7W7Z`) |
| `interchainGasPaymaster` w konfiguracji agentów X1 = ID **programu** IGP | relayer: `Could not find account data`, wiadomości X1→ETH stoją na `GasPaymentNotFound` | wpisz **konto** IGP (`igp_account` z `program-ids.json`, tak jak upstream). Agent wyznacza program jako właściciela tego konta (`testnet/03`, `07`) |
| `index.from: 1` dla X1 w konfiguracji agentów (skopiowane z upstreamowego `solanatestnet`) | w trybie `sequence` to **najniższa sekwencja**; płatność IGP nr 0 świeżego wdrożenia nigdy nie zostanie zaindeksowana | `index.from: 0` dla świeżych programów (`testnet/make-agent-config.mjs`) |
| Klient Sealevel ustawia limit **1,4 mln CU** na transakcję | transfer z X1 kosztuje ok. 0,014 XNT, choć zużywa 140–155 tys. CU | dla transakcji użytkownika (frontend) ustaw limit ok. **250 tys. CU** (pomiar: transfer-remote 142–155 tys., mint relayera 211–227 tys.). Opłata spada wtedy ok. 5,5× |
| Gas `process()` na Ethereum większy niż opłacony w IGP | unlock 395–405 tys. gas przy opłacie IGP za 368 tys. (overhead 300 tys. + `destination_gas` 68 tys.). Testnetowy relayer dostarczał tylko dlatego, że wymagał 1/2 płatności | `X1_TO_ETH_GAS` = **400 000** (razem z `destination_gas` ok. 468 tys.); po zmianie `igp configure`. Wartość mierzyć ponownie po każdej zmianie ISM |
| Własny walidator ETH→X1 | nie podpisuje, dopóki nie odbuduje całego drzewa merkle (~873 tys. liści na Sepolii) | wariant A: publiczny zbiór Hyperlane (`03-architecture.md`) |
| Opóźnienie ETH→X1 | relayer musi czekać na tyle bloków co walidatorzy (`reorgPeriod` z registry: Sepolia 2, Ethereum 15), nie na `"finalized"`. Inaczej użytkownik czeka ok. 13 min bez zysku dla bezpieczeństwa | testnet: mint ok. 1 min po depozycie; mainnet ok. 4–5 min. Alarmy opóźnienia od 15 min |
| RPC Sepolii za load balancerem zwraca stary nonce tuż po potwierdzeniu | `replacement transaction underpriced` przy kolejnej transakcji z tego samego konta | skrypty liczą nonce lokalnie; przed startem sprawdzają, czy latest == pending (`testnet/08-e2e.sh`) |

## 2. Mainnet 🔒

Kolejność ma znaczenie: **uprawnienia najpierw, płynność na końcu**.

1. Deploy kontraktów ETH. Owner tymczasowo deployer, potem `transferOwnership(timelock)` dla routera, hooka i RateLimitedIsm. Owner PausableIsm to Safe.
2. Deploy core i warp route na X1 (fork `spl-token`, własne RPC, §0).
   - **Skrzynka X1 z konfiguracją opłaty protokołu:** `core deploy … --protocol-fee-config-file x1-protocol-fee.json` z `{"maxProtocolFee": 10000000000, "fee": 1000000000, "beneficiary": "<skarbiec XNT, Squads>"}` (sufit 10 XNT, opłata 1 XNT; decyzja z 31 paź 2026, `14-fee-model-v2.md`). **Sufitu nie da się zmienić po inicjalizacji.** Bez pliku klient ustawi sufit 1 XNT i opłatę 0. Po deployu odczyt outboxa: sufit, opłata i beneficjent zgodne z plikiem, inaczej STOP.
   - Mint authority → PDA (robi to klient). **Od razu** `check-x1.mjs --post-deploy` i `token query`. Bez poprawnego mintu nie ma enrolla (§1a).
   - Upgrade, metadata i owner (także skrzynki, który zmienia opłatę) → Squads.
3. Weryfikacja po wdrożeniu (§1.8 i odczyty `owner()` na ETH). **Bez 0 FAIL nie ma kroku 4.**
4. Pierwszy transfer: 1 VMPX tam i z powrotem przez operatora.
5. Publikacja: adresy, lista atestatorów, próg, limity, hash frontendu.
6. LP (osobna decyzja, `07-treasury-lp.md`).

## 3. Zatrzymanie (pauza)

> Model uprawnień i pełna procedura: `13-pause-and-change.md`. Szybka ścieżka to jeden pauser → `EmergencyPauser.pauseAll("powód")`, który zatrzymuje depozyty **i** odblokowania.

**Kiedy:**
- alert `CollateralUndercovered`,
- podejrzenie przejęcia klucza atestatora albo ownera,
- ogłoszony restart, rollback lub hard fork X1,
- anomalia w metadanych lub mint authority na X1.

**Jak:**
1. Dowolny pauser (albo `monitoring/auto-pause.sh`) → `EmergencyPauser.pauseAll()`. Depozyty revertują bez pobierania środków, a odblokowania czekają. W czasie pauzy transfery X1→ETH spalone na X1 czekają i zostaną dostarczone po wznowieniu (z zastrzeżeniem limitu wypłat).
2. Na X1, jeśli skompromitowany jest kierunek ETH→X1: zatrzymaj relayer. Przez Squads możesz też ustawić ISM tokena na moduł odrzucający (`set_interchain_security_module`). Przetestuj to na testnecie.
3. Ogłoszenie dla użytkowników (frontend: baner „wstrzymane”).

Pauza nigdy nie przenosi środków i nie usuwa wiadomości.

## 3a. Próba samego wykonania auto-pauzy (testnet, runda D, przegląd w rundzie E)

Sprawdza **tylko ścieżkę wykonania**: klucz pausera, wysłanie `pauseAll()`, weryfikację obu kierunków i ręczne wznowienie. Nie sprawdza modelu dowodów (ten sprawdza przegląd kodu i testy). Monitor na serwerze nie bierze udziału i zostaje z `DRY_RUN=1`.

Zasady:
- tylko Sepolia, operator obecny przy każdym kroku, jeden krok na raz;
- izolowana kopia `monitoring/auto-pause.sh` uruchamiana na komputerze operatora, z czystym środowiskiem (`env -i`); skrypt zatrzymuje się, jeśli plik różni się od wersji z commita;
- `DRY_RUN=0` istnieje **tylko** w tym izolowanym przebiegu: kroki `pre` i `drill` sprawdzają (tylko odczyt), że auto-pauza na serwerze ma nadal `DRY_RUN=1`, inaczej stop;
- metryki są **syntetyczne**: świeży, potwierdzony CRITICAL (`severity 2`, `last_result` = `last_critical` = teraz) serwowany na losowym porcie `127.0.0.1`;
- hasło keystore'a tylko w pliku tymczasowym (`umask 077`), usuwanym zaraz po wysłaniu.

Kroki (skrypt operatora w prywatnym repozytorium operacyjnym, tryby `pre` / `drill` / `unpause`):
1. **`pre`** (tylko odczyt): flagi pauzy są `false`, guardian i pauser się zgadzają, wypisany sha256 `auto-pause.sh` i commit. Przebieg z `DRY_RUN=1` na syntetycznych metrykach musi wypisać `WOULD pauseAll` i niczego nie wysłać. Symulacja depozytu przechodzi, a `verify()` ISM strony odblokowań zwraca `true`.
2. **`drill`**: operator wpisuje `PAUZA` i hasło klucza pausera (sprawdzane z oczekiwanym adresem). `auto-pause.sh` z `DRY_RUN=0` wysyła `pauseAll()` i sam weryfikuje oba kierunki. Skrypt sprawdza to jeszcze raz **niezależnie**: hook (depozyty) i ISM (odblokowania) są `paused=true`, symulacja depozytu revertuje i `verify()` ISM revertuje (funkcjonalna kontrola kierunku odblokowań, nie tylko flaga). Wynik: kod wyjścia `auto-pause.sh`, czas od startu do potwierdzenia.
3. **`unpause`**: guardian → `EmergencyPauser.unpause(true, true)`. Obie flagi są `false`, symulacja depozytu przechodzi, a `verify()` ISM znów zwraca `true`.

Wynik próby (czasy, hashe transakcji, kody wyjścia) trafia do `13-pause-and-change.md`. Próba z rzeczywistym kolektorem (`DRY_RUN=0` na serwerze) jest możliwa dopiero po przeglądzie rundy E (Codex runda 8) i decyzji właściciela.

## 3b. Alarm auto-pauzy (gdy auto-pauza działa z `DRY_RUN=0`)

1. **Nie wznawiać od razu.** Most wstrzymany = środki bezpieczne, transfery w drodze czekają.
2. **Potwierdzić stan na bloku z receiptu `pauseAll`** (`cast call … --block <blok>`): flagi `paused()` obu kierunków i `PausableIsm.verify(0x,0x)` (w pauzie revert). Opóźnione, load-balancowane RPC może dawać sprzeczne odczyty (próba 1 lis 2026) — powtórzyć po 30 s lub na innym RPC.
3. **Przyczyna** z logu monitora: ID wiadomości (`mint-without-lock`, `unlock-without-burn`, `mint-from-foreign-sender`) albo zmiana minta; zweryfikować niezależnie w eksploratorach obu sieci.
4. **Fałszywy alarm:** zapisać dowody, przełączyć auto-pauzę na tryb alarmowy (`DRY_RUN=1`), dopiero potem wznowić (§4, strażnik). **Prawdziwe naruszenie:** most zostaje wstrzymany, postępowanie według §3–§4.
5. **Pauza nieudana / niepotwierdzona** (`ALERT`, kod 1): odczytać stan jak w p. 2; jeśli któryś kierunek nie jest wstrzymany — `pauseAll` ręcznie kluczem pausera; sprawdzić gaz i klucz pausera.
6. Zapis w `13-pause-and-change.md`: czas, tx `pauseAll`, przyczyna, odczyty, tx `unpause`.
7. **Przed KAŻDYM wznowieniem: nonce pausera** (Codex r10, R10-01). Próba `pauseAll`, której skrypt nie doczekał (timeout), może czekać w mempoolu i wykonać się po wznowieniu. Odczyt `cast nonce <pauser> --block latest` i `--block pending` na co najmniej trzech niezależnych RPC: wznawiamy tylko przy `latest == pending` wszędzie i `latest` równym liczbie znanych transakcji pausera. Transakcja w toku: poczekać na nią (most znów wstrzymany → p. 2) albo zastąpić ją tym samym nonce pustą transakcją z wyższą opłatą, potem ponowić odczyt. Brak odczytu = nie wznawiamy.
   Od rundy H auto-pauza sama rozlicza swoją transakcję (`pending.json` w katalogu stanu: ten sam podpis albo zamiana tego samego nonce co przebieg). Przed **ręczną** zamianą nonce zatrzymać timer auto-pauzy (inaczej skrypt dalej rozsyła i podbija swoją `pauseAll` z tym nonce), a po rozliczeniu nonce przenieść `pending.json` do `history/` — w przypadku „nonce użyty przez nieznaną transakcję” skrypt nie usuwa rekordu sam i alarmuje co przebieg. Potem timer z powrotem.

## 4. Wznowienie

1. Przyczyna usunięta i opisana (postmortem).
2. Monitor: pokrycie = 100% (z uwzględnieniem wiadomości w drodze), mint authority i metadane bez zmian.
3. Po rollbacku X1 porównaj listę wiadomości X1→ETH dostarczonych na Ethereum z wiadomościami istniejącymi w kanonicznej historii X1 po rollbacku. Brak burnu dla dostarczonego unlocku oznacza **incydent kolateralu**: pokrycie z rezerwy operatora i publiczna informacja.
4. Nonce pausera rozliczone (§3b p. 7). Guardian → `EmergencyPauser.unpause(true, true)`. Na X1 przywróć ISM tokena na otwarty. Relayer dostarcza zaległe wiadomości, a limit dzienny ogranicza tempo.

## 5. Utrzymanie

| Co | Jak często | Kto |
|---|---|---|
| Saldo relayera ETH / XNT | alert `RelayerWalletLow` | operator |
| Aktualizacja ceny referencyjnej | bot, maks. co 1 h, zwykle co 24 h | bot (osobny klucz) |
| `withdrawFees()` → Safe | co miesiąc | dowolny |
| Raport pokrycia (locked, circulating, in-flight) | co tydzień, publicznie | operator |
| Rotacja klucza atestatora | co 12 mies. albo po incydencie: nowy klucz → nowy ISM (multisig jest statyczny, czyli nowy adres) → `setInterchainSecurityModule` przez timelock 48 h; na X1 zmiana validatorów w programie multisig-ism przez Squads | operator + multisig |
| Aktualizacja agentów | tylko po przeglądzie changeloga, przypięty digest | operator |
| Upgrade programów X1 | wyłącznie przez Squads, z publikacją hasha builda | multisig |
| Test odtworzenia stanu (DB relayera) | co kwartał na testnecie | operator |

## 6. Odzyskiwanie opóźnionych transferów

- Wiadomość niedostarczona (relayer padł, za mało podpisów, pauza, limit) czeka bez terminu ważności.
- Ręczne dostarczenie: `hyperlane` CLI lub `MockMailbox`-podobny skrypt z podpisami pobranymi z S3 atestatorów. Każdy może dostarczyć poprawnie podpisaną wiadomość, więc relayer nie jest punktem zaufania.
- Wiadomość ETH→X1 o kwocie, która nie przechodzi weryfikacji programu (np. konto odbiorcy niepoprawne), zostaje w kolejce. Kolaterał pozostaje zablokowany i liczony jako in-flight. Rozwiązanie wymaga decyzji multisig (brak automatycznego zwrotu w upstreamie). **Ryzyko do opisania w regulaminie.**

## 6a. Transfer X1 → Ethereum większy niż limit (przegląd Codex M-01)

Strona nie pozwala wysłać więcej, niż jest dostępne w limicie (`RateLimitedIsm`). Wiadomość może jednak utknąć, jeśli ktoś wyśle ją z CLI albo limit zostanie zużyty między podglądem a dostarczeniem. Tokeny są wtedy spalone na X1, a wiadomość czeka na Ethereum (`RateLimitExceeded`).

1. **Rozpoznanie:**
   - indekser pokazuje transfer X1→ETH „w drodze” dłużej niż 10 min;
   - relayer loguje `RateLimitExceeded` dla tego ID wiadomości;
   - porównaj kwotę z `maxCapacity()` i `calculateCurrentLevel()`.
2. **Kwota ≤ C (zabrakło tylko bieżącego poziomu):** nic nie robić. Relayer dostarczy ją sam, gdy zbiornik się uzupełni (najwyżej 24 h). Poinformuj użytkownika o przewidywanym czasie.
3. **Kwota > C (nigdy nie przejdzie sama):**
   1. Sprawdź, że wiadomość jest prawdziwa: burn na X1 w kanonicznej, sfinalizowanej historii, podpisy atestatorów, brak alarmów monitora. **Bez tego nie podnosimy limitu.**
   2. **Jedna operacja Timelocka (batch), atomowo** (przegląd Codex runda 3, R-08):
      `RateLimitedIsm.setRefillRate(K)` → `Mailbox.process(metadata, message)` dla tej jednej wiadomości → `RateLimitedIsm.setRefillRate(C)`.
      K ≥ kwota (zaokrąglone w górę do wielokrotności 86 400). `metadata` to podpisy atestatorów tej wiadomości (z relayera albo z checkpointów walidatorów; podpisy nie wygasają). Na mainnecie batch czeka 48 h, na testnecie 300 s. W tym czasie guardian może anulować.
   3. Skutek: podniesiony limit obowiązuje **tylko wewnątrz jednej transakcji**. Nikt inny nie może go użyć, a po batchu pojemność wraca do C. Upstreamowe `setRefillRate` nie rozlicza poziomu przed zmianą tempa (przegląd N-3), więc wewnątrz batcha poziom od razu sięga K i wiadomość przechodzi; po powrocie do C poziom mieści się w C.
   4. Jeśli `process` się nie uda (pauza, zła metadata, za mało gazu, wiadomość już dostarczona), **cały batch się cofa** i limit nie zostaje podniesiony. Wtedy poprawić przyczynę i zaplanować batch od nowa. Gaz: `executeBatch` z zapasem (wiadomość + 2 × `setRefillRate`).
   5. Zapisz incydent: ID wiadomości, kwota, transakcje Timelocka, czasy.
   Test: `test_R08_atomicRaiseDeliverRestore`, `test_R08_batchRevertsWholeWhenProcessFails` (`evm/test/ReviewFixes.t.sol`).
4. **Ryzyko:** w czasie oczekiwania batcha (48 h) limit jest nadal C; podniesienie istnieje tylko w transakcji wykonującej batch i dotyczy wyłącznie wskazanej wiadomości. Krok 3.1 (weryfikacja wiadomości) nadal obowiązkowy.
5. **Alternatywa na mainnet** (ocena w `audit/reports/codex-2026-10-31-ocena.md`): limit maksymalnej kwoty w programie X1 (fork `hyperlane-sealevel-token`) to nowy kod Rust poza audytem upstream, więc osobny audyt. Na start zostaje blokada na stronie i ta procedura.

## 7. Warunki przed publicznym pilotażem (checklista)

- [ ] Odpowiedź emitenta VMPX / X1 Labs w sprawie prywatnej reprezentacji. Nazwa i symbol bez sugestii oficjalności.
- [ ] Testnet: wszystkie scenariusze z §1.10 przeszły, wyniki w `docs/11-test-report.md`.
- [ ] Kompatybilność Sealevel ↔ Tachyon potwierdzona. ID programów XDEX i Squads potwierdzone on-chain.
- [ ] Diff audytowanych wersji i przegląd naszych dwóch kontraktów (§ `05-audit-matrix.md`).
- [ ] Klucze atestacji w KMS, osobne od kluczy walidatorów X1. Próg 5/7 (każdy atestator na osobnej maszynie; `DeployEth` na mainnecie przyjmuje tylko ten profil). Lista publiczna.
- [ ] Rate limit ustawiony na wartość, którą operator jest w stanie pokryć z własnych środków w razie incydentu. Uwaga: zbiornik C + C/dobę oznacza do ok. **2C** w pierwszej dobie incydentu (Codex I-02).
- [ ] Monitor + alerty dochodzą do co najmniej 2 osób (telefon).
- [ ] Frontend: komunikaty o modelu powierniczym, opłatach, limitach.
- [ ] Regulamin: brak gwarancji ceny, sposób postępowania przy incydencie.
