# Ocena przeglądu Codex, runda 3 (31 paź 2026, commit `bde42dc`)

Raport: [`codex-2026-10-31-runda3.md`](codex-2026-10-31-runda3.md) (w archiwum lokalne ścieżki zastąpione względnymi, treść bez zmian). Każde znalezisko sprawdziłem w kodzie tego commita. Poprawki: po akceptacji właściciela, kolejność w sekcji 4.

Kontekst wdrożenia (odczyt 31 paź): **monitor pokrycia (`monitoring/src/monitor.mjs`) ani `auto-pause.sh` nie działają dziś na żadnym serwerze** testnetu. Pokrycie liczy tylko indekser strony (`indexer/activity.py`, stan `insolvent`). Ma to znaczenie dla R-02, R-03 i R-04: dziś nie ma fałszywych pauz, ale też nie ma automatycznego wykrywania.

## 1. Nowe ustalenia

| ID | Codex | Ocena | Uzasadnienie z kodu | Poprawka (plan) | Test |
|---|---|---|---|---|---|
| R-01 | Medium | **potwierdzone** | `activity.py:533–537`: `d.find(b"PROCESSD")` w całych danych każdego konta skrzynki, sprawdzane **przed** `DISPATCH`. Konto DISPATCH zawiera treść wiadomości od dowolnego nadawcy, więc ciąg `PROCESSD`+ID w treści oznacza cudzy transfer jako dostarczony. Nie daje mintu ani unlocku, tylko fałszuje stan „w drodze”, a przez to limit na stronie (M-01) i pokrycie (R-03). | Dyskryminator tylko na stałym przesunięciu (konto zaczyna się od flagi inicjalizacji i 8 bajtów dyskryminatora), sprawdzenie długości; dla PROCESSD dodatkowo adres konta = PDA `hyperlane - processed_message - <id>` skrzynki. | jednostkowy: konto DISPATCH z osadzonym `PROCESSD`+ID → transfer nadal „w drodze”; prawdziwe PROCESSD (PDA zgodne) → dostarczony |
| R-02 | Medium | **potwierdzone** | `invariant.mjs:38` `WATCHED_EVM_EVENTS` nie jest nigdzie importowane; `monitor.mjs` czyta tylko saldo lockboxa i mint. Indekser sprawdza adres ISM X1 (`activity.py:442–446`), nie walidatorów ani progu. `docs/15` opisuje monitor uprawnień jako działający — nieprawda. | Plan w sekcji 3 (osobny moduł, przypięty stan oczekiwany, kursor, alarm i pauza). Do czasu wdrożenia: docs/15 i docs/13 mówią wprost, że monitor uprawnień jest planem. | integracyjne z nagranymi odpowiedziami RPC: zmiana walidatorów w tym samym ISM → CRITICAL; zdarzenie `OwnershipTransferred` → CRITICAL |
| R-03 | Medium | **potwierdzone** | `monitor.mjs:42` woła `evaluate()` bez `pendingE2X/pendingX2E` (domyślnie 0). Indekser `activity.py:458`: `lockbox − supply × 1e9 ≥ 0`. Przykład Codexa (100 / 60 / 50 w drodze) daje OK, a brakuje 10. | Indekser: zobowiązania = podaż X1 + niedostarczone e2x + niedostarczone x2e; `solvent` = lockbox ≥ zobowiązania. Brak pełnych danych (np. odrzucona runda kont X1) → `ok: null` („nieznane”), nigdy OK. Monitor: pobiera kwoty w drodze z `activity.json` albo z własnego odczytu (sekcja 3). Strona: nadwyżka to wtedy tylko darowizny, a „w drodze” pokazywane osobno. | jednostkowy indeksera: 100/60/50 → `insolvent`; komplet → OK z nadwyżką 0; niepełne dane → `null`; monitor: `tick()` z atrapą źródła kwot w drodze |
| R-04 | Medium | **potwierdzone dla monitora** | `monitor.mjs:27–35`: ETH `finalized` vs X1 `finalized`, a walidatory ETH→X1 podpisują po 2 blokach (`make-agent-config.mjs:15`). Mint na X1 może być sfinalizowany, zanim depozyt jest w `finalized` Ethereum → fałszywe CRITICAL i auto-pauza. Indekser czyta lockbox z `latest`, więc ten błąd go nie dotyczy (różnica tagów daje tam nadwyżkę, nie niedobór). | Jedna spójna reguła: lockbox z `latest` (jak indekser) i kwoty w drodze z indeksu; alarm `insolvent`/CRITICAL dopiero, gdy niedobór utrzyma się w **2 kolejnych przebiegach** i nie da się go wyjaśnić znanymi wiadomościami. Reorg ETH (prawdziwe ryzyko) zostaje w R-07. | test: depozyt widoczny w `latest`, mint sfinalizowany, `finalized` ETH sprzed depozytu → OK; utrzymany niedobór 2 rundy → CRITICAL |
| R-05 | Medium | **potwierdzone** | `app.js:631–640`: błąd odczytu zeruje `S.limAt`, ale zostawia stare `S.lim`; `sendX2E` (`:691–696`) sprawdza tylko `!S.lim`. Stare `activity.json` daje nieaktualną sumę w drodze. | `refreshLimit()` zwraca wynik odczytu; przy błędzie `S.lim = null` i blokada; `sendX2E` wymaga świeżego odczytu (< 30 s) i `activity.json` nie starszego niż 5 min, inaczej komunikat i brak podpisu. | test przeglądarkowy (atrapa RPC): udany odczyt, potem błąd → wysyłka zablokowana; stare `activity.json` → zablokowana |
| R-06 | Medium | **potwierdzone** | `check-x1.mjs:162–172`: `--mint` sprawdzany tylko lokalnie (Token-2022, mint authority = sam mint), bez związku z programem tokena. IGP: brak `upgradeAuthority(igp_program)`; w wariancie overhead brak właściciela wewnętrznego konta IGP. | `--mint` musi być równe PDA mintu programu tokena według przypiętego upstreamu (`plugin.rs`: seeds `hyperlane_token`, `-`, `mint`); upgrade authority programu IGP (i każdego programu w trasie) objęte `--expect-upgrade-authority` i wykluczeniem deployera; właściciel wewnętrznego IGP w wariancie overhead. | X1 testnet: zły mint → FAIL; IGP z upgrade authority deployera przy `--mainnet --deployer` → FAIL |
| R-07 | Medium | **potwierdzone** | `activity.py:503–518`: logi do `eth_blockNumber` (tip), kursor przesuwany bez zapisu hashy bloków; dostarczenia x2e (`:550–561`) ustawiane z `latest` i nigdy nie sprawdzane ponownie. | Rekordy z bloków młodszych niż `finalized` zapisywane z hashem bloku i oznaczone jako tymczasowe; w każdym przebiegu ponowna weryfikacja (`eth_getBlockByNumber` → hash zgodny? receipt istnieje?) aż do finalizacji; przy niezgodności usunięcie depozytu albo cofnięcie `delivered`. Kursor bezpieczny: skan od `finalized − margines`. | jednostkowy z atrapą RPC: blok zastąpiony innym hashem → depozyt usunięty, dostarczenie cofnięte |
| R-08 | Low | **potwierdzone** | `docs/08-runbook.md:109–113`: podniesienie K, dostarczenie, dopiero potem plan powrotu do C (na mainnecie +48 h z K). | Jeden batch Timelocka: `setRefillRate(K)`, `Mailbox.process(metadata, message)`, `setRefillRate(C)`. `process` jest bez uprawnień; jeśli się nie uda (pauza, zła metadata, gaz), cały batch się cofa. Po N-3 poziom po powrocie do C mieści się w C. | test forge: batch dostarcza wiadomość > C, po batchu pojemność C i poziom ≤ C; z pauzą batch revertuje |
| R-09 | Low | **potwierdzone** | `app.js:373`: każdy błąd `bridgeFeeBps()` → `S.feeBps = 0n`; podgląd pokazuje pełną kwotę, a router v2 potrąca 3%. | Router v1 już nie istnieje na Sepolii: błąd odczytu = opłata nieznana = blokada wysyłki; ponowny odczyt tuż przed podpisem i komunikat przy zmianie stawki. Minimalna kwota netto w kontrakcie: nie (zmiana routera i audytu), opis w docs. | przeglądarkowy: błąd odczytu → przycisk zablokowany z komunikatem |
| R-10 | Low | **potwierdzone** | `app.js:325–333` sprawdza sieć tylko przy `connect()`; `:425` `eth_sendTransaction` bez sprawdzenia; brak `chainChanged`. | `chainChanged` → unieważnienie stanu i ponowne `validate()`; `eth_chainId` przed **każdym** `eth_sendTransaction` (approve i transfer osobno), przy niezgodności przerwanie. | przeglądarkowy z atrapą `window.ethereum`: zmiana sieci między approve a transferem → transfer nie wysłany |
| R-11 | Low | **potwierdzone** | `bridge-api.py:99–128`: każde żądanie czyta całą tabelę i skanuje ją dla każdego dnia i godziny; `ThreadingHTTPServer` bez limitu wątków. | Cache wyniku w procesie (klucz: parametry + mtime snapshotu bazy), semafor na równoległe obliczenia (np. 2, reszta 503), agregacja w SQL po dniu. Limity nginx (`limit_req`) sprawdzić w `-ops`. | jednostkowy: drugie żądanie z tym samym snapshotem nie liczy ponownie; równoległość > limit → 503 |

## 2. Status poprzednich poprawek wg Codexa

Zgadzam się z oceną „częściowo” dla M-01, M-02, I-01, N-1, N-2, N-3, N-5: przyczyny resztkowe to R-03, R-05, R-06, R-08 i niewykonany jeszcze plan Squads. L-01, L-02, L-03, N-4, I-02 zamknięte.

Dodatkowo potwierdzam:
- **DeployEth** (sekcja 4 raportu): hook z `feeBps 300 / min 0,0002 / max 0,02 / stale 0,02 ETH`, a `setBridgeFee` nie jest wywoływane wcale: świeże wdrożenie miałoby 0% w routerze i opłatę ETH zależną od ceny.
- **Safe 2 z 2** (sekcja 6): przy utracie Ledgera właściciela pozostali nie wymienią podpisującego. Ogólne zdanie w docs/15 §3 („pozostali od razu wymieniają…”) jest w tym wariancie fałszywe; do poprawienia razem z decyzją otwartą 2 z 2 / 3 z 5.
- **Testy**: `08-e2e.sh:71–77` oczekuje mintu 100 po depozycie 100 (bez 3%); `test_mainnetRejects2of3and4of7` sprawdza 3/2 i 7/6, nie 7/4; testy forkowe bez `SEPOLIA_FORK_RPC` kończą się sukcesem bez scenariusza (powinny być oznaczone jako pominięte).
- **Dokumentacja**: `Quote[]` nie ma osobnej pozycji opłaty VMPX (strona liczy ją sama); `testnet/x1-set-protocol-fee.mjs` ma na sztywno adresy testnetu; walidatory ETH→X1 opisane sprzecznie (6/9 publiczne vs 5/7 własne).

## 3. Plan: monitor uprawnień i pełna kontrola X1 (R-02, R-06)

**Zasada:** jeden proces `monitoring/src/authority.mjs`, bez zależności, uruchamiany co 60 s (systemd timer albo pętla), stan oczekiwany przypięty w pliku JSON w `-ops` (wersjonowany), wynik do Prometheus i do tego samego kanału alarmów co indekser; CRITICAL → `auto-pause.sh` (pauser gorący), WARN → człowiek.

**Ethereum (logi i odczyty):**
- kursor bloku z marginesem reorga, logi wszystkich kontraktów mostu (router proxy, ProxyAdmin, Timelock, FeeHook, RateLimitedIsm, PausableIsm/Hook, EmergencyPauser, Mailbox Hyperlane, domyślny ISM i hook Mailboxa) według `WATCHED_EVM_EVENTS`, dekodowanie i alarm;
- co przebieg dodatkowo odczyt stanu (nie tylko zdarzeń): implementacja proxy (slot EIP-1967), właściciele, ISM i hook routera, router zdalny, `bridgeFeeBps`/skarbiec, parametry hooka, role Timelocka (`hasRole` dla listy oczekiwanej), `getMinDelay`, guardian/pauserzy, właściciele i próg Safe; różnica od oczekiwanego = CRITICAL, nawet bez zdarzenia (odporność na pominięty log).

**X1 (odczyty kont i kodu):**
- konfiguracja tokena (owner, ISM, IGP, routery zdalne, decimals), PDA mintu powiązane z programem, mint authority, freeze authority, rozszerzenia, metadane;
- multisig ISM: owner, **zbiór walidatorów i próg dla domeny Ethereum** (zmiana bez zmiany adresu = CRITICAL);
- skrzynka: owner, outbox owner, opłata protokołu i beneficjent; IGP: owner overhead i wewnętrznego, beneficjent, gas oracle dla domeny Ethereum;
- **upgrade authority i sha256 kodu (programdata) każdego programu trasy:** token, skrzynka, ISM (otwarty i zamknięty), IGP, Squads; zmiana hasha = CRITICAL;
- wspólny kod z `check-x1.mjs` (parsery i PDA wydzielone do `svm/compat/x1-accounts.mjs`), żeby kontrola akceptacyjna i monitor nie rozjechały się.

**Pokrycie:** do tego samego procesu przechodzi poprawiona reguła R-03/R-04 (zobowiązania z kwotami w drodze z indeksu, 2 przebiegi potwierdzenia). Stary `monitor.mjs` zostaje zastąpiony.

**Wdrożenie:** serwer operatora testnetu (nie walidator), test: celowa zmiana walidatorów ISM na testnecie przez ownera → alarm i auto-pauza w ≤ 2 min. Mainnet: warunek checklisty §7 runbooka.

## 4. Kolejność poprawek (po akceptacji)

1. **DeployEth v2** + testy świeżego wdrożenia (pkt 4 raportu: 1000 VMPX → skarbiec 30, lockbox 970, wiadomość 970; stała opłata ETH dla małych/dużych kwot i ceny świeżej/starej; skarbiec VMPX osobny od beneficjenta hooka, zero odrzucane na mainnecie; deployer po wdrożeniu nie ma `setBridgeFee`; skrypt weryfikacji stanu po przerwanym broadcaście).
2. **R-01, R-03, R-04, R-05** z testami (indekser, monitor, strona), potem wdrożenie indeksera i strony na testnet po „tak”.
3. **R-02, R-06**: implementacja według sekcji 3 (osobna runda, większa praca), w tej rundzie od razu: R-06 w `check-x1.mjs` (mint z PDA, upgrade authority IGP, owner wewnętrznego IGP).
4. **R-07–R-11**, `08-e2e.sh` pod opłatę 3% (oczekiwany mint = netto, nierówność dla nadwyżek), nazwa i zakres testu 4/7, testy forkowe jako `vm.skip`.
5. **Dokumenty:** walidatory ETH→X1 = publiczny zbiór Hyperlane 6/9, własne 5/7 tylko jako opcja; progi Safe/Squads jako jedna otwarta decyzja (2 z 2 / 3 z 5) z poprawnym opisem odzyskiwania; `Quote[]`; `x1-set-protocol-fee.mjs` z adresami z argumentów.

## 5. Status poprawek (31 paź 2026)

| Punkt | Commit | Testy |
|---|---|---|
| DeployEth v2 (sekcja 4 raportu) | `821b3cb` | forge `DeployScriptTest` 15/15: 1000 → 30/970/970, stała opłata ETH (świeża i stara cena, małe i duże kwoty), zasady skarbca, deployer bez `setBridgeFee`, `check()` wykrywa niedokończone wdrożenie; 4/7 pod właściwą nazwą |
| R-01, R-03, R-04, R-05 | `7294ee9` | indekser (unittest, prawdziwy PDA z X1), monitor `tick()` z atrapami, strona (atrapa RPC); parser sprawdzony na wszystkich kontach skrzynki X1 testnet (69 PROCESSD, 46 DISPATCH) |
| R-06 | `83598c7` | X1 testnet: stan prawdziwy OK, obcy mint FAIL, `--mainnet --deployer` obejmuje upgrade authority IGP. Uwaga: właściciel wewnętrznego IGP był już sprawdzany; dodano właściciela konta (program IGP) |
| R-07 | `8613c17` | 4 przypadki z atrapą RPC (brak reorga, usunięty depozyt i cofnięte dostarczenie, ponowne włączenie, bloki sfinalizowane) |
| R-08 | `75b20a5` | forge: batch dostarcza i przywraca C; przy pauzie cały batch się cofa |
| R-09, R-10 | `d494fb1` | przeglądarka z atrapą portfela: zmiana sieci blokuje przycisk i transakcję; nieznana opłata blokuje; zmiana opłaty przerywa przed `approve` |
| R-11 | `553d410` | cache na snapshot bazy, limit 2 obliczeń, 503 przy przeciążeniu; nginx ma już `limit_req` 5 r/s na IP dla API |
| Sekcja 8 (e2e 3%, testy forkowe, skrypt opłaty X1) | `b31bb4b` | `bash -n`; kwota netto sprawdzona na routerze Sepolii (100 → 97); testy forkowe bez RPC = SKIP |
| Dokumenty (sekcja 6) | `9129f75` | — |
| Monitor: weryfikacja dostarczeń on-chain | (ten commit) | pierwsze uruchomienie na żywych danych pokazało fałszywy niedobór: `activity.json` sprzed minuty liczył zmintowany transfer jako „w drodze”. Teraz każdy transfer z listy jest sprawdzany on-chain po odczycie sald; test odtwarza ten przypadek |

Do zrobienia: R-02 (monitor uprawnień, osobna runda według sekcji 3), wdrożenie monitora pokrycia na serwerze operatora testnetu w trybie tylko-alarm na 24 h, potem prawdziwa pauza po zgodzie właściciela.
