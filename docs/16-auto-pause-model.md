# 16 — Model auto-pauzy (runda C, 31 paź 2026; runda D)

## Dlaczego zmiana

Przeglądy Codex (rundy 4–5: R4-02, R5-01, R5-03) pokazały, że porównanie sald dwóch łańcuchów (lockbox na Ethereum wobec podaży na X1 i transferów w drodze) nigdy nie jest jednym snapshotem.
- Zdrowy ruch (burn → unlock, deposit → mint) między odczytami daje pozorny niedobór.
- Pominięty burn daje pozorne pokrycie.
- `index.complete` jest **heurystyką** kompletności (monotoniczne sloty listy kont X1, podaż czytana po liście), a nie dowodem.

Dlatego saldo nie może uruchamiać automatycznej pauzy.

## Nowy model

### 1. Automatyczna pauza tylko na dowody jednoznaczne
Dowody są dopasowywane **po ID wiadomości** Hyperlane i nie zależą od tego, kiedy odczytano salda.

| Dowód | Co sprawdzamy | Kiedy wolno uznać za dowód |
|---|---|---|
| **a) mint bez lock** | wiadomość przetworzona na X1 (konto PROCESSD), której odbiorcą jest nasz program tokena; jej ID musi istnieć jako `Dispatch` naszego lockboxa na Ethereum (z nadawcą = lockbox) | ID nie ma w zdarzeniach `Dispatch` do **sfinalizowanego** bloku Ethereum, a ten blok jest późniejszy niż mint na X1 (z marginesem). Wcześniej: czekamy, nie pauzujemy |
| **b) unlock bez burn** | `Process` na Ethereum z odbiorcą = lockbox; jego ID musi istnieć jako wiadomość wysłana (DISPATCH) z naszego programu tokena na X1 | ID nie ma wśród sfinalizowanych DISPATCH na X1, a slot listy jest późniejszy niż blok z `Process` (z marginesem). Wcześniej: czekamy |
| **c) zmiana mintu** | mint authority, freeze authority, rozszerzenia Token-2022 | natychmiast |

Prawdziwa wiadomość zawsze powstaje przed swoim przetworzeniem: walidatory podpisują tylko sfinalizowane wiadomości. Gdy granica finalizacji drugiego łańcucha minie chwilę przetworzenia, brak ID nie jest już kwestią czasu odczytu.

Wiadomości do innych odbiorców (inne aplikacje na tej samej skrzynce X1) są pomijane. Odbiorcę odczytujemy z transakcji, która utworzyła konto PROCESSD.

### 2. Porównanie sald: tylko alarm dla człowieka
- Wzór bez zmian: lockbox wobec podaży X1 i kwot w drodze.
- Niedobór utrzymujący się **ponad 30 min** na kolejnych odczytach daje alarm (metryka `vmpx_bridge_balance_shortfall_seconds`, reguła `BalanceShortfallPersistent`). **Nigdy pauzę.**
- Indekser strony przechodzi w stan `insolvent` dopiero po 30 min ciągłego niedoboru; do tego czasu strona pokazuje „sprawdzanie”.

### 3. Monitor: jeden przebieg, limity czasu (R5-04)
- Następny przebieg startuje dopiero po zakończeniu poprzedniego.
- Każde zapytanie RPC ma limit czasu, cały przebieg również.
- Eksportowane są: czas zakończenia wyniku, czas ostatniego potwierdzonego CRITICAL (dowód), czas trwania bieżącego przebiegu.
- Auto-pauza działa tylko na **świeżo potwierdzonym** CRITICAL.
- Alarmy: przebieg trwa za długo, za stary `last_read_ok`.

### 4. Auto-pauza: najpierw pauza, potem diagnostyka (R5-07)
1. `pauseAll()` wysyłane od razu, z ponowieniami przy błędzie i z limitem czasu.
2. Dopiero potem diagnostyka, też z limitem czasu: czy oba kierunki są faktycznie wstrzymane.
3. Nieudana pauza daje wyraźny alarm.

### 5. Indekser (R5-05, R5-06, R5-02)
- Baza przebudowana od bloku i slotu wdrożenia, bez migracji starych rekordów (stara baza zostaje jako kopia). Każdy rekord ma hash bloku.
- Rekord bez hasha oznacza indeks niekompletny.
- Ponownie włączona transakcja: `Dispatch` dekodowany z receipt na nowo (ID i kwota), rekord zastąpiony.
- Strona traktuje brak pola `index` jako stan nieznany.

## Runda D (po przeglądzie Codex runda 6)

### 6. Kandydat i potwierdzenie w dwóch źródłach (R6-01)
Brak odpowiednika w zbiorczym odczycie (lista logów, lista kont) to tylko **kandydat**. Kandydat staje się dowodem (CRITICAL) dopiero wtedy, gdy celowane odczyty tego jednego ID w **dwóch niezależnych źródłach na łańcuch** dają zgodny wynik:

| Kandydat | Ethereum (`LOGS_RPC` i `ETH_LOGS_RPC2`) | X1 (`X1_RPC` i `X1_RPC2`) |
|---|---|---|
| a) mint bez lock | `eth_getLogs` po temacie `DispatchId` = to ID, od `FROM_BLOCK` do bloku finalized: **brak** w obu | konto PDA `processed_message` tego ID odczytane bezpośrednio: **istnieje** w obu |
| b) unlock bez burn | `eth_getLogs` po temacie `ProcessId` = to ID: **jest** w obu | brak DISPATCH z tym ID na liście kont skrzynki z `X1_RPC2` |

- Brak drugiego źródła, błąd, niezgodność albo źródło opóźnione (finalized lub slot poniżej odczytu głównego) oznaczają **UNKNOWN z alarmem** (`EvidenceUnconfirmed`), nigdy CRITICAL.
- Konta DISPATCH na X1 mają PDA z losowego klucza (unikalnego dla wiadomości), a nie z ID. Nie da się więc wyprowadzić adresu z ID. Brak burnu potwierdza lista kont skrzynki z drugiego RPC X1.
- Drugi dostawca logów Ethereum musi przechowywać logi od `FROM_BLOCK` i być niezależny od `LOGS_RPC`. Na testnecie (sprawdzenie 31 paź 2026) większość bezkluczowych RPC Sepolii przycina historię, ogranicza zakres `eth_getLogs` (np. do 50 bloków) albo jest niedostępna. Warunki spełnia `https://rpc.sepolia.ethpandaops.io` (ethPandaOps, Ethereum Foundation): ten sam zbiór logów `DispatchId`/`ProcessId` co `LOGS_RPC` od `FROM_BLOCK`, zakres ponad 20 tys. bloków w jednym zapytaniu. Skrypt wdrożenia ustawia `ETH_LOGS_RPC2` tylko wtedy, gdy z serwera monitora oba źródła zwracają identyczne zbiory logów.
- Bez działającego drugiego źródła (nieustawione, błąd, niezgodność) każdy kandydat jest UNKNOWN. Na mainnecie drugi dostawca będzie wybrany osobno (prawdopodobnie z kluczem API, trzymanym tylko w konfiguracji serwera).

### 7. Czas i stan (R6-02, R6-04)
- Każdy czas (bloku Ethereum, slotu X1, `blockTime` transakcji X1) musi być skończoną liczbą w rozsądnym zakresie. W przeciwnym razie przebieg kończy się błędem albo wiadomość jest „nierozpoznana” (UNKNOWN), nigdy dowodem.
- `Process` na Ethereum trafia do stanu tylko z bloków finalized, więc reorg nie zostawia śladów.
- Kursor logów przy każdym przebiegu czyta ponownie okno `OVERLAP_BLOCKS` (256) poniżej siebie.
- Przebieg pracuje na **kopii** stanu. Kopia zastępuje stan (zapis atomowy: plik tymczasowy, `fsync`, `rename`) dopiero po zakończonym przebiegu. Błąd albo przerwanie oznacza powrót do starego kursora (naprawa).
- Jeden `AbortSignal` na przebieg: przekazywany do każdego RPC i sprawdzany między etapami. Następny przebieg startuje dopiero po faktycznym zakończeniu poprzedniego.
- Stan jest powiązany z konfiguracją (chain ID, genesis X1, adresy trasy, domeny, `FROM_BLOCK`). Inny odcisk oznacza odrzucenie stanu i pełne skanowanie. Przy starcie sprawdzamy, że `FROM_BLOCK` to blok wdrożenia lockboxa: kodu nie ma w `FROM_BLOCK − 1`, jest w `FROM_BLOCK`.

### 8. Rozpoznanie wiadomości X1 (R6-03)
Wiadomość jest szukana po ID we **wszystkich** instrukcjach skrzynki w transakcji, także wewnętrznych (CPI). Osobno liczymy: brak historii (przycięte RPC, niepełna lista podpisów), brak pasującej instrukcji i zły czas.

### 9. Mint, salda i dowody niezależnie (R6-05, R6-06)
- Kontrola mintu (authority, freeze, rozszerzenia) odbywa się zaraz po odczycie X1, niezależnie od Ethereum: zmiana oznacza CRITICAL od razu, nieudany odczyt oznacza UNKNOWN.
- Licznik 30 min niedoboru sald liczy tylko ciągłe, udane obserwacje. Przerwa dłuższa niż 2 min (monitor) lub 3 min (indekser, timer co 60 s) liczy od nowa.
- Stan dowodów (`vmpx_bridge_evidence_ok`, `..._unknown_seconds`, `..._unconfirmed`) i alarm sald (`vmpx_bridge_balance_alarm`) to osobne metryki z osobnymi alarmami. Jedno nie ukrywa drugiego.

### 10. Indekser (R6-07) i auto-pauza
- Przy ponownym włączeniu transakcji dekodowane są **wszystkie** `Dispatch` lockboxa z receipt. Scalanie jest idempotentne (`ON CONFLICT DO UPDATE` tylko pól wysyłki) i nie gubi potwierdzonego dostarczenia.
- `auto-pause.sh`: `PAUSE_ISM` i `PAUSE_HOOK` są obowiązkowe; ich brak to błąd startu (kod 2).

## Runda E (po przeglądzie Codex runda 7)

### 11. Trzy niezależne zadania (R7-01)
Każdy przebieg monitora to trzy zadania z osobnymi budżetami czasu: **kontrola minta** (pierwsza, zawsze, 30 s), **dowody wiadomości** (180 s) i **salda** (60 s; dowody i salda równolegle). Przekroczenie budżetu albo błąd jednego zadania nie usuwa wyniku innego: zmiana minta wykryta przy zawieszonym kolektorze dowodów jest CRITICAL, potwierdzony dowód przy zawieszonym odczycie salda zostaje CRITICAL. Nieudany zapis pamięci podręcznej stanu jest raportowany (`vmpx_bridge_state_write_errors_total`), ale nie zmienia wyniku. Zadanie przerwane po budżecie nie może przekazać swojej kopii stanu.

### 12. Drugie źródło Ethereum skanuje samodzielnie (R7-02)
`ETH_LOGS_RPC2` czyta logi `Dispatch`/`DispatchId` i `Process`/`ProcessId` lockboxa niezależnie, z własnym kursorem i własnym blokiem finalized. Zbiory ID obu źródeł są porównywane do niższego z kursorów; każda różnica to **rozbieżność** (UNKNOWN, alarm `EvidenceSourcesDiverged`). Pełny przegląd obu źródeł od `FROM_BLOCK` rusza co godzinę i przesuwa się porcjami po 50 tys. bloków na przebieg, więc log pominięty przez jedno źródło zostaje znaleziony niezależnie od wieku (bez limitu 256 bloków). Brak drugiego źródła = UNKNOWN.

### 13. Obcy nadawca (R7-03)
Wiadomość przetworzona dla naszego programu z inną domeną źródłową albo innym nadawcą niż lockbox to osobna ścieżka: CRITICAL, gdy konto PDA istnieje w obu RPC X1, a drugie RPC X1 pokazuje tę samą wiadomość (to samo ID = te same bajty) z niezgodnym nadawcą lub domeną. Istnienie `DispatchId` z tym ID na Ethereum nie ma znaczenia.

### 14. Ciągłość obserwacji sald (R7-04)
Licznik 30 min liczy tylko czas **zaobserwowany** (do ostatniego udanego odczytu). Przerwa ponad 120 s, także gdy odczyty się nie udają, unieważnia licznik od razu (`vmpx_bridge_balance_stale`). W indekserze przebieg niekompletny przerywa ciągłość, a czas ostatniej kontroli zapisują tylko przebiegi kompletne.

## Runda F (po przeglądzie Codex runda 8)

### 15. Wynik przed zapisem pamięci podręcznej (R8-01)
Wynik przebiegu, `last_result_timestamp` i `last_critical_timestamp` są publikowane **zaraz po** zakończeniu zadań, przed jakimkolwiek zapisem na dysk. Stan dowodów z ukończonego kolektora jest od razu używany w pamięci; plik pamięci podręcznej zapisuje osobny moduł (`state-writer.mjs`) w tle: każdy zapis do własnego pliku tymczasowego, `fsync`, potem `rename`; zmiany nazw idą po kolei i wygrywa najnowsza generacja, więc spóźnione zakończenie starszego zapisu nie zastąpi nowszego stanu. Zapis ma limit czasu (`STATE_WRITE_TIMEOUT_S`, 10 s) i najwyżej dwa zapisy w toku; zawieszony dysk nie wstrzymuje kolejnych przebiegów (metryki `vmpx_bridge_state_write_timeouts_total`, `_skipped_total`, `_errors_total`, alarm `StateCacheWriteStalled`).

### 16. Świeżość sald w chwili publikacji (R8-07)
Czas obserwacji sald to chwila faktycznego zakończenia odczytu, nie początek przebiegu. `balanceStale` jest liczone w chwili publikacji wyniku, a metryki `vmpx_bridge_balance_stale`, `vmpx_bridge_balance_observed_age_seconds` i `vmpx_bridge_balance_alarm` — w chwili eksportu, z bieżącego czasu. Szybki odczyt sald przy kolektorze działającym 180 s jest więc przy publikacji nieaktualny (bez alarmu sald).

## Rundy G–I i pełny audyt (1 lis 2026)
- **G** (Codex r9): próba samej pauzy (`docs/13`), kontrola po pauzie na bloku z receipt.
- **H** (Codex r10): auto-pauza podpisuje bez rozsyłania i zapisuje hash/nonce w `pending.json` przed `eth_sendRawTransaction`; timeout = wynik nieznany; każdy przebieg najpierw rozlicza oczekującą transakcję (ten sam podpis albo zamiana tego samego nonce); receipt wymaga statusu, potwierdzeń i kanonicznego hasha bloku. Alarmy: trwała kolejka z priorytetami, odzyskiwanie stanu, walidacja metryk.
- **I** (Codex r11): pominięcie pauzy tylko przy świeżym (≤ 30 s), zgodnym headzie z dwóch niezależnych RPC (`ETH_RPC2`), każda wątpliwość = `pauseAll`; rekord związany z nadawcą, chain ID, pauserem i calldata; podpisana transakcja nigdy w argv; monitor emituje `tick=<T>`, a alarm wiąże powód dokładnie z incydentem `crit-<T>`; znacznik instalacji usługi alarmów.
- **Pełny audyt** (F-01): alarm „niedobór pokrycia” z `vmpx_bridge_balance_alarm`, wstrzymywany przy nieaktualnych obserwacjach.

## Stan wdrożenia na testnecie (1 lis 2026, wieczór)
| Element | Wersja | sha256 (początek) |
|---|---|---|
| monitor (`monitoring/src/monitor.mjs`, reszta bez zmian od rundy F) | runda I | `3cef19b4` |
| auto-pauza (`monitoring/auto-pause.sh`) | runda I | `bea44e00` |
| alarmy (`alerts.mjs` / `alerts-core.mjs`) | runda I + F-01 | `29afb11a` / `bc6a0e63` |

- Auto-pauza działa z **`DRY_RUN=0`** od 1 lis 2026 16:08 UTC (faza 1, decyzja właściciela); drugie RPC Ethereum do decyzji „już wstrzymany” ustawione; stan auto-pauzy w trwałym katalogu usługi (`StateDirectory`), klucz pausera jako keystore z hasłem w credentialu systemd.
- Alarmy: Telegram do operatora (jeden kanał; „≥ 2 osoby” to bloker mainnetu), znacznik instalacji obecny.
- Strona: v43 (walidacja adresu X1 F-04). v44 (widok white paper `#/wp`) — niewdrożona.

## Testy (wymagane)
- Fałszywy mint (ID bez `Dispatch`) daje CRITICAL po minięciu granicy finalizacji; przed nią: czekanie.
- Unlock bez burn daje CRITICAL.
- Zdrowy ruch burn → unlock i deposit → mint w dowolnej kolejności odczytów nigdy nie daje CRITICAL.
- Wiadomość do obcego odbiorcy jest pomijana.
- Zawieszone RPC: przebieg kończy się po limicie czasu, bez nakładania przebiegów.
- Nieudane `pauseAll()`: ponowienia i alarm.

- Runda D: kandydat bez zgodnego potwierdzenia, błąd i brak drugiego źródła dają UNKNOWN; zły czas (`null`, NaN, ujemny, z przyszłości); kilka `InboxProcess` w jednej transakcji, CPI, brak historii wobec braku instrukcji; okno nakładania kursora; niefinalny `Process` poza stanem; przerwany przebieg nie zapisuje stanu; odcisk konfiguracji i `FROM_BLOCK`; zmiana mintu przy niedostępnym Ethereum; przerwa w liczniku sald; dwa `Dispatch` w receipt i zachowanie dostarczenia; brak `PAUSE_ISM`/`PAUSE_HOOK`.

- Runda E: kolektor wyczerpuje budżet przed kontrolą minta (mint i tak sprawdzony, zmiana = CRITICAL); dowód zebrany przy zawieszonym odczycie salda; zawieszony odczyt minta; nieudany zapis pamięci podręcznej przy CRITICAL; ciche pominięcie logu przez jedno źródło (także starsze niż 256 bloków, naprawa pełnym przeglądem); obcy nadawca przy istniejącym `DispatchId`; trwająca awaria odczytu salda dłużej niż przerwa; niekompletne przebiegi indeksera.

`DRY_RUN=1` do czasu przeglądu rundy E (Codex runda 8) i próby na testnecie. Próba samego wykonania pauzy: `08-runbook.md` §3a.
