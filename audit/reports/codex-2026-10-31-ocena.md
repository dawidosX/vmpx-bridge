# Ocena przeglądu Codex z 31 paź 2026 (commit `11cd406`)

Raport: [`codex-2026-10-31.md`](codex-2026-10-31.md). Ocena i poprawki: 31 paź 2026. Każde znalezisko sprawdziłem w kodzie (ten commit i zależności `@hyperlane-xyz/core` 12.2.0) oraz, gdzie się dało, testem albo odczytem z testnetu.

## Podsumowanie

| ID | Ocena | Poprawka | Priorytet przed mainnetem | Test |
|---|---|---|---|---|
| M-01 | **potwierdzone** | strona blokuje X1→ETH ponad dostępny limit i ponad pojemność; procedura w runbooku §6a; limit w programie X1 opisany jako opcja z osobnym audytem | **wysoki** (blokada na stronie i runbook przed pilotażem) | `limitError` na żywych danych Sepolii; istniejący `test_M2_oversizedUnlockRecoverable` |
| M-02 | **potwierdzone** | `check-x1.mjs --post-deploy` działa fail-closed; sprawdza upgrade authority programu tokena, skrzynki i ISM, metadane, właściciela konfiguracji tokena, ISM i zarejestrowany router; `08-e2e.sh` przekazuje oczekiwania z `testnet.env` | **wysoki** (warunek akceptacji wdrożenia mainnet) | testnet: komplet oczekiwań → OK; brak oczekiwań → 4 FAIL; „none” → 3 FAIL; zły router → FAIL |
| L-01 | **potwierdzone** (zachowanie zgodne z kodem, opis w komentarzu był błędny) | komentarz i dokumentacja: stałe okno 24 h; po przejściu na stałą opłatę cena nie wpływa na opłatę | niski | `test_L1_fixedWindowBoundaryDocumented` (+80% w 3 h przez granicę okna, opłata nadal ≤ `maxFeeWei`) |
| L-02 | **potwierdzone** | konstruktor `VmpxEthFeeHook` i `DeployEth` odrzucają cenę 0 | niski | `test_L2_zeroInitialPriceRejected`, `test_scriptRejectsZeroPrice` |
| L-03 | **potwierdzone** | `DeployEth` na mainnecie przyjmuje tylko profil 5 z 7; jawne sprawdzenie zakresu `uint8`; dokumentacja 7/10 → 5/7 | **wysoki** (konfiguracja bezpieczeństwa) | `test_mainnetRejects6of10`, `test_mainnetRejects2of3and4of7`, `test_mainnetAccepts5of7` |
| I-01 | **potwierdzone, poprawka częściowa** | `donate()` **nie da się wyłączyć** bez forka upstream (ani `donate`, ani `HypERC20Collateral._transferFromSender` nie są `virtual`). Zamiast tego: wypłacalność jako lockbox ≥ zobowiązania, nadwyżka osobno (monitor, indekser, strona, testy) | średni (monitoring) | `test_I1_donateIsSurplusOnly`, `test_I1_directTransferIsSurplusOnly`, inwariant z handlerem bezpośrednich transferów, testy monitora |
| I-02 | **potwierdzone** | opis „zbiornik C + C/dobę” na stronie (ryzyka, Statystyki) i w docs; checklista: rezerwa na 2C | średni (dobór C) | — (opis) |

Nowych znalezisk przy ocenie nie było.

## M-01: zbyt duży burn X1 wymaga interwencji

**Ocena: potwierdzone.**
- Na Ethereum `RateLimitedIsm.verify` zużywa kwotę z zbiornika (`RateLimited.validateAndConsumeFilledLevel`) i odrzuca wiadomość, gdy kwota przekracza bieżący poziom.
- Wiadomość większa niż `maxCapacity()` nie przejdzie nigdy.
- Program tokena na X1 (upstream `hyperlane-sealevel-token`, `f556e18`) nie zna tego limitu i spala każdą kwotę.
- Repo zawiera test, który to odtwarza (`test_M2_oversizedUnlockRecoverable`: burn 2× C, odrzucenie, podniesienie limitu, dostarczenie).

**Rozróżnienie, które ma znaczenie:**
- kwota ≤ C, ale > bieżący poziom: wiadomość **czeka** najwyżej 24 h i dochodzi sama (bez interwencji);
- kwota > C: **utyka** do decyzji Timelocka.

**Poprawka (wg decyzji właściciela):**
- `frontend/www/app.js`: `refreshLimit()` czyta `calculateCurrentLevel()` i `maxCapacity()` z `RateLimitedIsm` na Sepolii. `limitError()` blokuje przycisk i pokazuje komunikat:
  - ponad C: „podziel na mniejsze transfery”;
  - ponad poziom: „dostępne teraz X, poczekaj ok. T”.
  
  Tuż przed podpisem limit jest czytany **ponownie**, bo mógł zostać zużyty w międzyczasie. Wersja strony 28.
- `docs/08-runbook.md` §6a: procedura dla wiadomości, która mimo to utknęła (np. wysłana z CLI):
  - weryfikacja burnu;
  - `setRefillRate(K ≥ kwota)` przez Timelock;
  - dostarczenie;
  - natychmiastowy powrót do C.
- `docs/03-architecture.md`: opis zachowania.

**Ograniczenie blokady na stronie:** chroni tylko użytkowników strony. CLI i inne klienty mogą nadal wysłać więcej, stąd runbook.

**Limit w programie X1, ocena wykonalności:**
- **Co da:** program zna tylko stałą wartość, nie bieżący poziom zbiornika na Ethereum. Może więc wymusić **„kwota ≤ C”**, czyli usunąć przypadek, który wymaga Timelocka. Opóźnień do 24 h (kwota > bieżący poziom) nie usunie.
- **Zmiana w kodzie:** fork `hyperlane-sealevel-token` (i `hyperlane-sealevel-token-lib`) z polem `max_transfer` w konfiguracji tokena, ustawianym przez właściciela (Squads), oraz sprawdzeniem w `transfer_remote` przed burnem. Zmienia to układ konta konfiguracji, więc potrzebna jest migracja (realloc) albo nowe wdrożenie trasy.
- **Koordynacja:** każde obniżenie C na Ethereum musi poprzedzać obniżenie `max_transfer` na X1. W przeciwnym razie powstaje to samo okno.
- **Koszt:** nowy kod Rust poza audytami Hyperlane, więc osobny przegląd programu SVM. Szacunek rzędu kilku do kilkunastu tysięcy USD i 1–3 tygodni, do potwierdzenia ofertą. Do tego utrzymanie forka przy aktualizacjach upstream.
- **Rekomendacja:** na pilotaż blokada na stronie i runbook. Decyzja o forku przed mainnetem, razem z wyborem audytora (audyt routera v2 i tak jest wymagany). Jeśli fork, to minimalny (jedno pole i jedno sprawdzenie) i w tym samym zleceniu audytu.

## M-02: weryfikacja uprawnień X1 mogła przejść bez sprawdzenia

**Ocena: potwierdzone.**
- `check-x1.mjs` wypisywał `WARN`, gdy brakowało `--expect-upgrade-authority` lub `--expect-metadata-authority`, a kod wyjścia zależał tylko od `FAIL`.
- `08-e2e.sh` nie przekazywał oczekiwań.
- Właściciel konfiguracji tokena (ustawia ISM i routery) nie był sprawdzany.

**Poprawka:**
- `svm/compat/check-x1.mjs --post-deploy` jest teraz **testem akceptacyjnym, który działa fail-closed**: brak oczekiwania albo wartość, której nie da się odczytać, daje `FAIL`.
- **Sprawdzane:**
  - upgrade authority programu tokena, skrzynki (`--mailbox`) i programu ISM;
  - właściciel aktualizacji metadanych;
  - konfiguracja tokena (`--token-pda`), odczytana z konta wg układu `HyperlaneToken` (`f556e18`): inicjalizacja, 9/18 decimals, skrzynka, **właściciel** (`--expect-owner`), **ISM** (`--expect-ism`), **jedyny zarejestrowany router** (`--expect-router domena:0x…`).
- „none” oznacza oczekiwany brak upgrade authority (program niezmienny).
- `testnet/08-e2e.sh` przekazuje oczekiwania:
  - uprawnienia: ze zmiennych `X1_EXPECT_*` w `testnet.env`, wymaganych (`${…:?}`);
  - ISM, router i skrzynka: ze stanu wdrożenia.

**Weryfikacja na X1 testnet (odczyt):**
- z kompletem oczekiwań wszystkie testy dają `PASS`. Na testnecie deployer `ASLb…5Yg` ma wszystkie uprawnienia, co teraz musi być **zadeklarowane wprost**;
- bez oczekiwań: 4 `FAIL`;
- z `--expect-upgrade-authority none`: 3 `FAIL` (token, ISM, skrzynka);
- ze złym routerem: `FAIL`.

**Przed mainnetem:** w `testnet.env` mainnetu wszystkie `X1_EXPECT_*` = vault Squads. Akceptacja wdrożenia to wynik `OK` tego skryptu.

## L-01: stałe okna ceny zamiast kroczącego okna 24 h

**Ocena: potwierdzone.**
- `updatePrice` resetuje `windowStart` i `windowAnchorPrice`, gdy minie doba od początku okna, więc granica jest stała.
- Komentarz „rolling 24h” był błędny.
- Sekwencja z raportu przechodzi: +20%, +44%, +50% do końca okna, potem +20% od nowej kotwicy, czyli +80% w 3 h. Test to potwierdza.

**Poprawka (wg decyzji właściciela, bez zmiany kodu wykonawczego):**
- komentarz przy `MAX_DAILY_PRICE_CHANGE_BPS` opisuje stałe okno i efekt na granicy;
- `docs/06-fee-design.md`: akapit „Granice zmian ceny”;
- test `test_L1_fixedWindowBoundaryDocumented`.

**Wpływ:** od przejścia na stałą opłatę (`feeBps = 0`, `minFeeWei = maxFeeWei = 0,0002 ETH`; na testnecie `hook-exec` 3 lis 2026) cena referencyjna nie wpływa na opłatę. Przedtem opłatę ograniczał `maxFeeWei`, a kolaterału to nie dotyczyło.

## L-02: zerowa cena początkowa

**Ocena: potwierdzone.** Przy `refPriceWeiPerToken = 0` warunek `diff * 10_000 > old * MAX_PRICE_CHANGE_BPS` odrzuca każdą dodatnią cenę.

**Poprawka:**
- `VmpxEthFeeHook` konstruktor: `require(_initialPriceWeiPerToken > 0, "price=0")`;
- `DeployEth`: `require(c.initialPriceWei > 0, "INITIAL_PRICE_WEI=0")`.

Hook na Sepolii ma cenę 4e11, więc zmiana dotyczy tylko nowych wdrożeń.

## L-03: walidacja zbioru walidatorów słabsza niż model

**Ocena: potwierdzone.** `thr * 10 >= n * 6` przyjmuje 1/1 i 6/10, a `uint8(thr)` nie miał jawnej granicy (w praktyce chroniło go `thr <= n` i rozmiar tablicy, ale nie było to wyrażone).

**Poprawka (wg decyzji właściciela):**
- `DeployEth.MAINNET_VALIDATORS = 7`, `MAINNET_THRESHOLD = 5`; na chainid 1 deploy przyjmuje **wyłącznie** 5 z 7;
- `require(n <= type(uint8).max)`;
- testnet zostaje elastyczny (≥ 60%), bo testnet działa dziś na 2/3;
- dokumentacja: 7/10 → 5/7 (`docs/02`, `03`, `08`, `09`, `10`, `13`, `agents/README.md`, `frontend/README.md`, `audit/SCOPE.md`, `testnet/README.md`), zgodnie z planem rozmieszczenia (każdy walidator Hyperlane na osobnej maszynie).

## I-01: donacje psują dokładną równość

**Ocena: potwierdzone.** Bezpośredni transfer ERC-20 i upstreamowe `donate()` zwiększają saldo lockboxa bez podaży na X1. `donate()` jest `payable`, a ETH wysłane razem z nim zostaje w routerze bez ścieżki odzyskania.

**Decyzja właściciela „override `donate()` z revert” jest niewykonalna bez forka upstream.** W `@hyperlane-xyz/core` 12.2.0:
- `LpCollateralRouter.donate(uint256)` jest `public payable` **bez `virtual`**;
- `HypERC20Collateral._transferFromSender` jest `internal override` **bez `virtual`**.

Kompilator odrzuca nadpisanie obu (sprawdzone). Zostają trzy drogi:
1. **(wdrożone)** traktować donację jak nadwyżkę: nikt nie może jej wypłacić (brak udziałów LP, `deposit`/`mint` wyłączone, `redeem`/`withdraw` bez udziałów odrzucają);
2. **(decyzja właściciela 31 paź 2026: w następnej wersji routera)** `recoverEth(address to)` tylko dla właściciela (Timelock) na przypadkowe ETH, bez forka upstream. Dotyczy tylko ETH w routerze, nigdy tokena kolaterału;
3. fork upstreamowego kontraktu: odradzam (kod poza audytem Hyperlane dla marginalnego zysku).

**Poprawka:**
- **wypłacalność = lockbox ≥ zobowiązania, nadwyżka osobno:**
  - `monitoring/src/invariant.mjs`: nadwyżka nie jest już `WARN`; pole `surplus`, a `CRITICAL` zostaje tylko dla niedoboru;
  - `indexer/activity.py`: nowy wskaźnik stanu `solvent` (lockbox ≥ podaż X1, wartość = nadwyżka razem z transferami w drodze);
  - strona: wiersz w panelu stanu mostu;
  - testy EVM: `_assertCollateralInvariant` sprawdza `locked >= backed` i `locked - backed == donated`; inwariant ma handler bezpośrednich transferów;
- komentarz w routerze opisuje, że `donate()` nie da się wyłączyć i że ETH wysłane z nim przepada (nie wywoływać).

## I-02: zbiornik pozwala na prawie 2C w ciągu doby

**Ocena: potwierdzone.** `RateLimited` uzupełnia poziom w sposób ciągły (`refillRate = C / 86 400`) do pojemności C, startując od pełnego zbiornika. W oknie t ≤ 24 h może wyjść C + C × t / 86 400.

**Poprawka (opis, wg decyzji właściciela):**
- strona: ryzyko „Limit wypłat… zbiornik C, uzupełniany o C na 24 h” oraz zdanie w karcie limitów w Statystykach;
- `docs/03-architecture.md`: opis zbiornika i maksymalnej straty;
- `docs/08-runbook.md`: checklista rezerwy na 2C.

## Odpowiedź na „luki w testach”

- **Testy nie były uruchamiane przez Codex:** teraz `forge test` daje 84/84 (77 wcześniej i 7 nowych), monitor 9/9.
- **`HypERC20` zamiast programu Sealevel:** zostaje ograniczeniem testów EVM. Program na X1 sprawdzają testnet (08-e2e), `check-x1.mjs` (teraz fail-closed) i porównanie transakcji strony z CLI (`frontend/tests/x1-compare.mjs`).
- **Granica okna ceny i cena 0:** dodane testy.
- **Donacje w inwariancie:** dodany handler.
- **Rollback X1 i przejęty próg atestatorów:** to założenia zaufania (`docs/04-threat-model.md`, T9). Ograniczają je limit (zbiornik), pauza i monitor pokrycia. Testem tego nie da się udowodnić.
- **`import-agent-keys.sh` przekazuje klucz w argumentach:** znane i opisane w skrypcie. Dotyczy tylko testnetu na Macu; na mainnecie klucze są w KMS.

## Druga runda (przegląd poprawek, 31 paź 2026)

Przegląd poprawek z commita `aef58d6` znalazł luki N-1 do N-5. Stan po poprawkach:

| ID | Problem | Poprawka | Test |
|---|---|---|---|
| N-1 | `check-x1.mjs` sprawdzał upgrade authority, ale nie właścicieli kont konfiguracyjnych | sprawdza też: właściciela multisig ISM (`access_control`) oraz zbiór walidatorów i próg dla domeny źródłowej (`domain_data`), właściciela skrzynki (outbox), właściciela overhead IGP i IGP oraz beneficjenta IGP. PDA konfiguracji tokena i outboxa liczone z seedów (z kontrolą, że punkt nie leży na krzywej ed25519). Tryb `--mainnet --deployer <klucz>` daje FAIL, gdy deployer ma jakikolwiek authority albo jest użyty jako oczekiwanie. `08-e2e.sh` przekazuje walidatorów i próg z tych samych zmiennych, których użył `03-deploy-x1-core.sh` | X1 testnet: komplet oczekiwań → 23 PASS / OK; brak walidatorów i progu → FAIL; zły próg → FAIL; `--mainnet --deployer <deployer>` → FAIL; `--mainnet` bez `--deployer` → FAIL; zły `--token-pda` → FAIL |
| N-2 | Squads na X1: upgrade authority to pojedyncze konta systemowe (`45bQ…` testnet, `2sXr…` mainnet), kod różny od niezmiennego buildu na Solanie | `docs/15` §7: rekomendacja własnego wdrożenia Squads v4 z audytowanego tagu (verifiable build, upgrade authority = brak, `time_lock` 48 h na mainnecie); poprawiony skutek przejęcia właściciela X1, ryzyko strażnika, brakujące role, kolokacja walidatorów, rotacja kluczy, Ledger i EIP-712 | odczyty on-chain (sha256 programów, authority, historia wdrożeń) |
| N-3 | runbook §6a: `setRefillRate` nie rozlicza poziomu przed zmianą tempa | opis: poziom może od razu skoczyć do K; ryzyko natychmiastowe, K blisko kwoty | — (opis, kod upstream) |
| N-4 | efekt granicy okna ceny zaniżony (+80%) | komentarz, docs i test: (1 + 50%)² − 1 = +125% w ok. 6 h | `test_L1_fixedWindowBoundaryDocumented` (+125% przechodzi, kolejne +10% odrzucone) |
| N-5 | brak pokrycia wyświetlał się jako „opóźnienia” | indekser: stan `insolvent` ma pierwszeństwo przed pauzą; strona: czerwony alarm „brak pełnego pokrycia”, wiersz „niedobór X VMPX”, wysyłka na stronie wyłączona | test indeksera (równe → ok, nadwyżka → ok, −1 wei → `insolvent`); strona z podstawionym stanem (EN/PL) |
| M-01 (uzup.) | strona nie odejmowała transferów X1→ETH w drodze; niejasny komunikat przy braku odczytu limitu | dostępny limit = poziom − suma niedostarczonych X1→ETH (z `activity.json`), dopisek o kwocie w drodze; osobny komunikat „nie udało się odczytać limitu, nic nie wysłano” | strona: 1 mln poziomu − 400 tys. w drodze → 700 tys. odrzucone z komunikatem, 500 tys. przyjęte |
