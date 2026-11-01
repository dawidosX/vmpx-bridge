# 14 — Model opłat v2: VMPX + XNT do skarbca i LP (plan, 31 paź 2026)

Status: **propozycja, częściowo zdecydowana (31 paź 2026).**

**Decyzje właściciela (31 paź 2026):**
- **ETH→X1:**
  - opłata **3% w VMPX, potrącana z kwoty**, trafia do skarbca;
  - w routerze v2 `feeBps` jest zmienny przez Timelock, a **`MAX_FEE_BPS = 500` (5%) immutable**;
  - strona pokazuje wprost: „Wysyłasz N, opłata 3% = f VMPX, otrzymasz N − f”.
- **Opłata ETH na gaz relayera:** stała **0,0002 ETH** (`VmpxEthFeeHook` z `feeBps = 0`, `minFeeWei = maxFeeWei = 0,0002 ETH`).
- **X1→ETH:**
  - protocol fee na testnecie **0,01 XNT** (sufit testnetu 1 XNT, ustawiony przy inicjalizacji w etapie A);
  - **mainnet: opłata stała 1 XNT za transfer, `max_protocol_fee` = 10 XNT** (decyzja z 31 paź 2026; zastępuje wcześniejszy sufit 1 XNT). Sufit jest niezmienny po inicjalizacji skrzynki, więc ustawiamy go w `Init` (§2).
- **Kolejność:**
  1. protocol fee 0,01 XNT na X1 testnet + rozbicie kosztu X1→ETH na stronie;
  2. router v2 z opłatą VMPX na Sepolii + testy;
  3. tydzień obserwacji;
  4. audyt przed mainnetem.

Wdrożenia: na razie tylko krok 1, na testnecie. Zmienia założenie z `06-fee-design.md`, gdzie opłata projektu jest tylko w ETH. Zasada z `07-treasury-lp.md` zostaje: kolaterał w lockboxie nigdy nie finansuje LP. Weryfikacja na testnecie była tylko odczytem i symulacją (`simulateTransaction` bez podpisów); niczego nie wysłano.

## 1. Model w skrócie

| Kierunek | Opłata projektu | Gdzie trafia | Koszt dostarczenia (gas relayera) |
|---|---|---|---|
| ETH → X1 | **x% w VMPX, potrącane z kwoty** w routerze (`VmpxCollateralRouter`) | skarbiec VMPX (Safe na Ethereum) | mała stała opłata w ETH przez istniejący `VmpxEthFeeHook` (`feeBps = 0`, `min = max = np. 0,0002 ETH`), beneficjent: portfel gasowy relayera na X1 |
| X1 → ETH | **stała opłata w XNT** przez *protocol fee* skrzynki Hyperlane na X1 | skarbiec XNT (Squads na X1) | IGP na X1 w XNT, jak dziś (zwrot gasu relayera na Ethereum) |

Skarbce VMPX i XNT zasilają LP **VMPXe/WXNT na X1** (XDEX). VMPX ze skarbca przechodzi na X1 zwykłym transferem przez most, a proporcje wyrównuje mały swap na X1 (§5).

**Niezmiennik 1:1 zostaje.** Opłata VMPX odchodzi do skarbca **przed** zablokowaniem, więc lockbox trzyma dokładnie tyle, ile mintuje X1 (N − opłata).

## 2. X1 → ETH: protocol fee skrzynki na X1 (sprawdzone na testnecie)

**Kod (`f556e18`, `rust/sealevel/programs/mailbox`):**
- **Konfiguracja:** `Outbox.protocol_fee = { fee: u64, beneficiary: Pubkey }` oraz `Outbox.max_protocol_fee: u64`.
- **Zmiana:** `SetProtocolFeeConfig(ProtocolFee)` (indeks instrukcji 11). Konta: `[writable] outbox`, `[signer] owner`.
  - Zmienić może **tylko właściciel skrzynki** (`ensure_owner_signer`).
  - Opłata nie może przekroczyć `max_protocol_fee`. Tego limitu **nie da się zmienić**: jest ustawiany tylko przy `Init` i nie ma do niego instrukcji.
- **Pobieranie przy `OutboxDispatch`:** `fee` lamportów z konta **płatnika wysyłki** (w `transfer_remote` to nadawca tokenów) na konto PDA outbox. Log: `Protocol fee of N paid from <payer> to <outbox>`. Kwota jest stała za wiadomość i nie zależy od wartości transferu.
- **Odbiór:** `ClaimProtocolFees` przenosi lamporty ponad czynsz z outboxa na `beneficiary`. Wywołać może każdy; środki trafiają tylko do beneficjenta.
- **Zakres:** opłata dotyczy **każdej wiadomości tej skrzynki**. Skrzynka X1 jest nasza (wdrożona w etapie A), więc w praktyce tylko mostu VMPX.

**Stan na X1 testnet** (outbox `BhMiDcPu…`, odczyt 31 paź):

| | |
|---|---|
| właściciel | `ASLb41hC…5Yg` (klucz deployera testnetu) |
| `max_protocol_fee` | **1 XNT** (na stałe) |
| `protocol_fee.fee` | 0 |
| beneficjent | `ASLb41hC…5Yg` |
| wiadomości | 15 |

**Symulacja:** jedna transakcja `[SetProtocolFeeConfig (podpis właściciela), ComputeBudget, transfer_remote 1 VMPXe (podpis portfela testowego)]`, `sigVerify:false`. Nic nie wysłano.

| Przypadek | Wynik | Koszt nadawcy (XNT) |
|---|---|---|
| opłata 0 | ok, log „Protocol fee of 0” | 0,05261486 (jak dziś) |
| opłata 0,01 XNT | ok, log „Protocol fee of 10000000 paid from <portfel testowy>” | **0,06261486** (+0,01) |
| opłata 0,5 XNT | ok | 0,55261486 |
| opłata 2 XNT (> max 1) | **odrzucone**: „Fee is greater than max protocol fee” | — |
| 0,01 XNT, podpis kogoś innego niż właściciel | **odrzucone** (`InvalidArgument`) | — |

Wniosek: mechanizm działa dokładnie tak, jak opisano. Nie wymaga nowego programu: to istniejąca funkcja skrzynki Hyperlane, objęta audytami Hyperlane.

**Konsekwencje dla mainnetu:**
- **`max_protocol_fee` wybieramy raz, przy inicjalizacji skrzynki X1.** To twardy limit, który chroni użytkowników przed zmianą opłaty bez ograniczeń. **Decyzja: 10 XNT sufit, opłata 1 XNT.**
  - Inicjalizacja: `hyperlane-sealevel-client core deploy … --protocol-fee-config-file x1-protocol-fee.json`, z plikiem `{"maxProtocolFee": 10000000000, "fee": 1000000000, "beneficiary": "<skarbiec XNT, Squads>"}` (lamporty: 10 XNT i 1 XNT; format pól camelCase jak w `client/src/core.rs`, `f556e18`). Bez tego pliku klient ustawia sufit 1 XNT i opłatę 0.
  - Weryfikacja po inicjalizacji: odczyt outboxa (np. `testnet/x1-set-protocol-fee.mjs` w trybie podglądu z `--rpc <mainnet> --mailbox <ID skrzynki mainnet>`; bez `--mailbox` skrypt odmawia działania poza testnetem): `max_protocol_fee = 10 XNT`, `fee = 1 XNT`, beneficjent = Squads.
  - Przy sufice 10 XNT właściciel skrzynki (Squads) może jednorazowo podnieść opłatę nawet 10× ponad decyzję. To ryzyko pokrywają multisig, jawna zmiana on-chain i podgląd kosztu na stronie tuż przed podpisem.
- **Właściciel skrzynki to multisig Squads** (nie klucz deployera). Zmiana opłaty działa natychmiast, bo na X1 nie ma timelocka. Ochroną są limit `max_protocol_fee` oraz to, że strona tuż przed podpisem pokazuje dokładny koszt z symulacji.
- **Beneficjent to skarbiec XNT** (Squads). Wywołanie `ClaimProtocolFees` może robić dowolny bot.

## 3. ETH → X1: opłata w VMPX potrącana z kwoty

Dziś router celowo blokuje opłaty w tokenie (punkt 5 w nagłówku `VmpxCollateralRouter`). Upstreamowa ścieżka (`feeRecipient` + `ITokenFee`) pobiera opłatę **ponad** kwotę z istniejącej zgody (allowance), a to zostało uznane za ryzyko.

**Propozycja: własne, minimalne potrącenie w routerze.**
1. `transferRemote(dest, recipient, N)` pobiera od nadawcy **dokładnie N**, czyli tyle, ile użytkownik wpisał i zatwierdził.
2. `fee = min(maxFee, max(minFee, N × feeBps / 10 000))`, zaokrąglone w dół do `dustUnit` (1e9), bo X1 ma 9 miejsc po przecinku.
3. `fee` idzie do `treasury`. Wiadomość i lockbox dostają `N − fee`. Lockbox trzyma `N − fee`, X1 mintuje `N − fee`, więc niezmiennik zostaje.
4. Nowe zdarzenie `BridgeFeeTaken(messageId, payer, gross N, fee)`, potrzebne indekserowi i stronie.
5. ~~`quoteTransferRemote` zwraca opłatę jako dodatkową pozycję `Quote(token, fee)`~~ (projekt; **nie wdrożone**, zob. „Implementacja” niżej: `quoteTransferRemote` zostaje upstreamowe, opłatę podaje `quoteBridgeFee(N)`). Strona pokazuje opłatę przed podpisem. Uwaga (Codex runda 3): upstreamowe `quoteTransferRemote` wycenia ETH od kwoty brutto, a wiadomość niesie netto; przy stałej opłacie hooka (0,0002 ETH) nie ma to wpływu na kwotę ETH.

**Wdrożenie na Sepolii (31 paź 2026):** router v2 za proxy przez Timelock, implementacja `0xF2C78CB7D7B095Ab8CfFF9b61aA4ebD3CF931122`, `feeBps = 300`, skarbiec VMPX `0x3731cB932D3277f2C763D1f8bc8aADDe8B1c77B9`. Stała opłata hooka (0,0002 ETH) jest ogłoszona, eta `1793701188`.
**Do zrobienia 3 lis 2026 po 10:19 UTC (11:19 CET):** `~/vmpx-router-v2.sh hook-exec` (Timelock 300 s, potem `executeParams`). Okno wykonania (`EXECUTION_GRACE`) to 7 dni, do 10 lis.

**Implementacja (31 paź 2026, `evm/src/VmpxCollateralRouter.sol`):**
- `setBridgeFee(feeBps, treasury)` tylko przez właściciela, czyli Timelock (300 s na testnecie, 48 h na mainnecie). Bez osobnego announce + 3 dni: opóźnienie daje sam Timelock (decyzja właściciela: „feeBps zmienny przez Timelock”).
- Brak `minFee`/`maxFee`: przy 3% i zaokrągleniu w dół kwoty poniżej 34 × 1e-9 VMPX przechodzą bez opłaty; to pomijalne.
- `quoteTransferRemote` zostaje w upstreamowym kształcie (3 pozycje, pozycja 1 = N). Opłatę i kwotę netto podaje osobny widok `quoteBridgeFee(N)`; strona liczy ją tym samym wzorem z `bridgeFeeBps()`.

**Ograniczenia w kodzie (plan):**
- `MAX_FEE_BPS = 500` immutable (decyzja); `feeBps = 300` na start;
- zmiana `feeBps`, `minFee`, `maxFee`, `treasury` tylko przez announce + execute z opóźnieniem 3 dni, jak w `VmpxEthFeeHook`;
- revert, gdy `N ≤ fee`.

**Wdrożenie:**
- to upgrade implementacji routera za proxy, przez Timelock (48 h, alert);
- to kod spoza audytu upstream: dopisać do `05-audit-matrix.md`, testy Foundry (niezmiennik, zaokrąglenia, minimum, opóźnienie parametrów), potem audyt.

**Alternatywa (odrzucona):** upstreamowy `feeRecipient` z `LinearFee`. To kod audytowany, ale opłata jest **dodatkowo ponad** N. Wymaga też odblokowania ścieżki, którą świadomie wyłączyliśmy.

**Opłata ETH na gaz relayera (opcjonalna):** bez nowego kodu. Istniejący `VmpxEthFeeHook` z `feeBps = 0` i `minFeeWei = maxFeeWei = 0,0002 ETH` daje stałą opłatę, niezależną od ceny VMPX, więc bot cenowy przestaje być potrzebny. Zmiana parametrów to `announceFeeParams`, a po 3 dniach `executeFeeParams`. Beneficjent to portfel, z którego zasilamy relayera XNT.

## 3a. Limit TVL lockboxa: `maxLocked` (router v3, 1 lis 2026)

Status: **kod i testy lokalnie, niewdrożone.** Wartości są parametrami (skrypt, env, Timelock), nie stałymi w kontrakcie.

- **Co jest limitowane:** saldo VMPX lockboxa **po** wpłacie, czyli `balanceOf(router) + (N − opłata)`. Liczy się tylko część, która zostaje zablokowana. Opłata 3% w tej samej transakcji odchodzi do skarbca i nigdy nie leży w routerze. Przykład: limit 970, wpłata 1000 → 30 do skarbca, 970 zablokowane, przechodzi.
- **Przekroczenie:** wpłata (ETH→X1, `_transferRemote`) kończy się `MaxLockedExceeded(lockedAfter, maxLocked)`. Sprawdzenie jest przed pobraniem tokenów.
- **Odblokowania (X1→ETH) nigdy nie sprawdzają limitu.** Obniżenie limitu poniżej bieżącego salda jest dozwolone i blokuje tylko nowe wpłaty.
- **Zmiana:** `setMaxLocked(uint256)` tylko przez właściciela (Timelock: 300 s testnet, 48 h mainnet), zdarzenie `MaxLockedSet(old, new)`.
- **Znaczenie wartości:**
  - `0` = wpłaty **zamknięte** (fail closed);
  - `type(uint256).max` = brak limitu, ale tylko ustawiony jawnie.

  Po upgrade v2 → v3 slot jest pusty (0). Gdyby ktoś zapomniał `initializeV3`, wpłaty stoją, a odblokowania działają; naprawa to `setMaxLocked` przez Timelock. Router po upgrade nigdy nie staje się przypadkiem nielimitowany.
- **Upgrade v2 → v3:** jeden batch Timelocka: `ProxyAdmin.upgrade(proxy, implV3)` + `router.initializeV3(maxLocked)` (`onlyOwner` + `reinitializer(3)`, jednorazowe). `ProxyAdmin.upgradeAndCall` nie zadziała: wywołującym byłby ProxyAdmin, nie właściciel.
- **Pamięć:** `maxLocked` dopisany na końcu struktury ERC-7201 `vmpx.storage.BridgeFee` (slot + 1). Zwykły układ pamięci (`forge inspect … storage-layout`) jest identyczny jak w v2.
- **`balanceOf` zamiast licznika:**
  - Wybrany `balanceOf`: zero nowego stanu do uzgadniania przy upgrade (licznik trzeba by zasilić bieżącym saldem, a darowizn nie da się on-chain odróżnić) i zero zmian w ścieżce odblokowania (licznik musiałby być zmniejszany w `_handle` i nie mógłby się wywrócić, bo zablokowałby odblokowania).
  - Koszt: darowizna (zwykły transfer lub `donate()`) liczy się do limitu. Atakujący może nią zapełnić limit i zablokować wpłaty, ale traci 100% wysłanych tokenów (nikt nie może ich odebrać). Ten sam efekt da się osiągnąć zwykłą wpłatą za 3% opłaty z odzyskiem reszty, więc darowizna nie otwiera tańszego ataku. Limit z natury może zapełnić każdy.
  - Reakcja: właściciel podnosi limit o nadwyżkę (monitoring już raportuje nadwyżkę osobno).
- **Wartości:**

| | `maxLocked` | wei (18 dec) |
|---|---|---|
| testnet (Sepolia) | 5 000 000 VMPX | `5000000000000000000000000` |
| mainnet, start | ok. 700 000 VMPX (≈ 1000 USD na start) | `700000000000000000000000` |

- **Skrypt `DeployEth` (L-4):** env `MAX_LOCKED`.
  - Mainnet: wymagany, ≤ 1 000 000 VMPX, chyba że `ALLOW_LARGE_MAX_LOCKED=true`.
  - Testnet: bez zmiennej domyślnie 5 000 000 VMPX.
  - Wartość 0 jest odrzucana zawsze. `check()` weryfikuje `maxLocked()`.
- **Strona:** może czytać `maxLocked()` i saldo lockboxa i zablokować wysyłkę, gdy `saldo + netto > maxLocked` (do zrobienia).

## 4. Skarbce

| | Skarbiec VMPX (Ethereum) | Skarbiec XNT (X1) |
|---|---|---|
| Wpływy | `BridgeFeeTaken` z routera | `ClaimProtocolFees` z outboxa |
| Adres | Safe (3/5) | Squads (3/5) |
| Wypływy | przeniesienie VMPX na X1 przez most na LP (§5); ewentualnie OPEX | LP; OPEX (gas relayera na X1) |
| Zmiana adresu | announce + 3 dni w routerze | `SetProtocolFeeConfig` przez Squads (natychmiast, beneficjent ≠ kwota) |

Przeniesienie VMPX ze skarbca na X1 też płaci opłatę VMPX, ale ta wraca do tego samego skarbca. Netto to tylko zaokrąglenie i gas, więc nie potrzeba listy wyjątków (mniej kodu).

## 5. LP VMPXe/WXNT na X1 i wyrównanie proporcji

1. Co miesiąc albo po przekroczeniu progu (np. równowartość 200 USD), zgodnie z kolejnością z `07-treasury-lp.md` (OPEX → rezerwa → LP):
   - skarbiec VMPX przenosi partię VMPX na X1, na adres Squads;
   - skarbiec XNT odbiera opłaty i zamienia część XNT na WXNT (wrap).
2. **Dodanie płynności w proporcji puli:** `deposit` z ilością ograniczoną przez rzadsze aktywo.
3. **Nadmiar drugiego aktywa:** zostaje na następną partię albo jest wyrównywany swapem w naszej puli, ale **tylko połowa nadmiaru i najwyżej ok. 0,5–1% głębokości puli na transakcję**.
   - Zakup VMPXe w naszej puli podnosi jego cenę na X1 i otwiera arbitraż wycofujący kolaterał na ETH (`07-treasury-lp.md`).
   - Dlatego swap robimy małymi krokami, ze slippage ≤ 0,5%, po symulacji i z podpisem multisig.
4. LP trafia na Squads. Blokada i spalanie zgodnie z `07`.

## 6. Wpływ na stronę i indekser

**Koszt przed podpisem:**
- **ETH → X1:** pozycje:
  - „Wysyłasz N VMPX”;
  - „Opłata za most x% → −f VMPX” (z `bridgeFeeBps()` / `quoteBridgeFee(N)`, odczyt ponowiony tuż przed podpisem; przy błędzie odczytu wysyłka zablokowana);
  - „Otrzymasz N − f VMPXe”;
  - „Opłata za gaz relayera 0,0002 ETH”;
  - „Opłata sieci Ethereum (pokaże portfel)”.

  Przycisk MAX używa salda, bo potrącenie jest wewnątrz kwoty. Minimalna kwota musi być większa od minimalnej opłaty.
- **X1 → ETH:** dziś koszt = spadek salda w symulacji. Rozbijamy go na:
  - „Opłata za most” = N z logu `Protocol fee of N`;
  - „Opłata za dostarczenie (IGP)” = spadek − opłata za most − opłata sieci;
  - „Opłata sieci X1”.

  Symulacja jest robiona tuż przed podpisem, więc nawet natychmiastowa zmiana opłaty przez właściciela skrzynki jest widoczna w podglądzie.

**Kafelki i statystyki:**
- „Zebrane opłaty” pokazuje **przychód projektu**: VMPX (z `BridgeFeeTaken`) i XNT (protocol fee).
- IGP (XNT) i opłata gasowa (ETH) to **zwrot kosztów relayera**, nie przychód. Pokazujemy je osobno jako „Pokrycie kosztów dostarczenia”, razem z kosztem relayera z raportu opłat.
- Wykresy opłat na dzień: VMPX, XNT i koszty, każde na osobnym wykresie (różne jednostki).
- Przepływy: „napływ” = kwota zablokowana (N − f); opłata VMPX osobno.

**Indekser:**
- nowe pola `fee_vmpx` (zdarzenie `BridgeFeeTaken`) i `protocol_lamports` (log `Protocol fee of …` z transakcji X1, którą indekser i tak pobiera przy ustalaniu nadawcy);
- `stats.fees` rozbite na przychód i pokrycie kosztów.

**Bot 24 h:** przy ETH→X1 sprawdza dotarcie `N − f`, nie N. Kwoty z kursu muszą przekraczać minimalną opłatę.

**Teksty strony:** „Opłata 3% w ETH” → „Opłata x% w VMPX (potrącana z kwoty) + stała opłata gasowa w ETH”. Kierunek X1→ETH: „Opłata za most N XNT + dostarczenie”.

## 7. Plan (każdy krok po decyzji właściciela, najpierw testnet)

1. **Decyzje:**
   - stawka VMPX (bps, min, max);
   - stała opłata gasowa w ETH;
   - opłata XNT za X1→ETH;
   - `max_protocol_fee` dla skrzynki mainnetu;
   - adresy skarbców (Safe, Squads).
2. **Testnet, X1:** `SetProtocolFeeConfig` (np. 0,01 XNT, beneficjent: testowy skarbiec). Podpisuje właściciel skrzynki (`ASLb…`) skryptem na Macu; hasło wpisuje właściciel.
   - **Strona:** rozbicie kosztu X1→ETH (opłata za most, IGP, sieć);
   - **indekser:** pole `protocol_lamports`;
   - **test:** 1 transfer z portfela przez stronę i jeden z bota.
3. **Testnet, Ethereum:**
   - router v2 z potrąceniem VMPX: kod, testy Foundry, upgrade przez Timelock (300 s na testnecie);
   - zmiana parametrów `VmpxEthFeeHook` (opłata stała);
   - strona, indekser i bot (§6).
4. **Raport po tygodniu na testnecie:**
   - przychody w VMPX i XNT;
   - pokrycie kosztów relayera;
   - dowód niezmiennika lockbox = podaż X1.
5. **Mainnet (po audycie routera v2):** skrzynka X1 inicjalizowana z `max_protocol_fee = 10 XNT` i opłatą 1 XNT (plik konfiguracji opłaty, §2), właściciel Squads, beneficjent skarbiec XNT; router v2 przez Timelock 48 h. Zmiana skrzynki X1 jest nieodwracalna co do sufitu, więc plik konfiguracji przechodzi przegląd przed deployem.
6. **LP:** pierwsza partia według §5 po zebraniu progu, z symulacją i podpisem multisig.

## 8. Ryzyka

- **Router v2 to nowy kod** w najbardziej wrażliwym kontrakcie (lockbox). Ma być minimalny, z testami niezmiennika i audytem przed mainnetem.
- **Opłata XNT na X1 zmienia się natychmiast** (bez timelocka), w granicach `max_protocol_fee` (mainnet: do 10 XNT). Musimy jawnie opisać to na stronie i w dokumentach.
- **1 XNT stałej opłaty** to dużo przy małych transferach X1→ETH. Strona powinna pokazać ją przed podpisem razem z dostarczeniem (IGP), a przy kwotach, gdzie opłata przekracza np. 10% wartości, dodać ostrzeżenie.
- **Kurs VMPX/XNT w puli** może się rozjechać z ceną na Ethereum. Zasilanie LP może zasilać arbitraż (`07`), więc swapy robimy małymi partiami.
- **Opłata VMPX zmniejsza kwotę, którą dostaje użytkownik.** Strona musi wyraźnie pokazać „Otrzymasz N − f” przed podpisem. Portfel pokaże tylko N.
