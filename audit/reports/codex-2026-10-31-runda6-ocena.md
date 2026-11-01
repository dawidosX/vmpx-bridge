# Ocena przeglądu Codex, runda 6 (31 paź 2026, zakres `9908c6c..b00e843`)

Raport: [`codex-2026-10-31-runda6.md`](codex-2026-10-31-runda6.md). Wszystkie znaleziska R6 potwierdzone w kodzie `b00e843`. Auto-pauza zostaje w trybie `DRY_RUN=1`.

| ID | Waga | Ocena (z kodu) | Poprawka (runda D, propozycja) |
|---|---|---|---|
| R6-01 | Średnie | potwierdzone: `evidence.mjs` traktuje brak logu (`ethDispatch`) albo konta (`x1Dispatch`) w odpowiedzi RPC jako brak operacji; kursor `ethDispatchTo` przesuwa się po każdej odpowiedzi bez błędu | **Dwa etapy.** (1) Kandydat: brak odpowiednika w zebranym zbiorze. (2) Zanim kandydat stanie się dowodem, **potwierdzenie celowanym zapytaniem**: (a) `eth_getLogs` po `DispatchId` z tematem = to ID, od `FROM_BLOCK` do `finalized`, przez **dwóch niezależnych dostawców RPC**; (b) lista kont DISPATCH z drugiego RPC X1 (węzeł RPC na serwerze operatora). Dowód dopiero, gdy oba źródła potwierdzą brak; inaczej UNKNOWN. Kursor tylko po pełnej porcji; okresowy pełny przegląd od `FROM_BLOCK`; sprawdzenie przy starcie, że oba RPC mają logi od `FROM_BLOCK` |
| R6-02 | Średnie | potwierdzone: `tx.blockTime` (i czasy bloków) bez walidacji, `null + 120 = 120` | czasy muszą być skończonymi liczbami w rozsądnym zakresie; inaczej wiadomość „nierozpoznana” (UNKNOWN), nigdy dowód; testy: `null`, brak pola, NaN, wartości ujemne i z przyszłości |
| R6-03 | Średnie | potwierdzone: `instructions.find(...)` bierze pierwszą instrukcję główną, bez wewnętrznych | wszystkie instrukcje główne **i wewnętrzne** (`meta.innerInstructions`) skrzynki X1 z tagiem `InboxProcess`, dopasowanie po hashu wiadomości = ID konta; osobne stany: „brak historii” i „brak pasującej instrukcji”; testy: dwie wiadomości w transakcji, CPI, przekroczony limit podpisów |
| R6-04 | Średnie | potwierdzone: `Promise.race` nie przerywa `tick()` | wspólny `AbortSignal` dla całego przebiegu, sprawdzany między etapami i przekazywany do każdego RPC; kolektor pracuje na **kopii** stanu i zapisuje ją dopiero po zakończonym, przyjętym przebiegu; następny przebieg czeka na faktyczne zakończenie poprzedniego; test z wieloma wolnymi (ale mieszczącymi się w limicie) zapytaniami |
| R6-05 | Średnie | potwierdzone: `classifyMintState` tylko gdy odczyt sald się udał | kontrola mintu zaraz po odczycie X1, niezależnie od Ethereum; test: zmieniony mint + niedostępne RPC Ethereum = CRITICAL |
| R6-06 | Niskie | potwierdzone | licznik 30 min tylko z kolejnych **udanych** obserwacji, przerwa > 5 min resetuje licznik (też w indekserze); stan dowodów eksportowany i alarmowany osobno (`vmpx_bridge_evidence_unknown_seconds`), niezależnie od WARN sald |
| R6-07 | Niskie | potwierdzone: pierwszy `Dispatch` z receipt, `INSERT OR REPLACE` gubi `delivered` | wszystkie `Dispatch` lockboxa z receipt; scalanie bez nadpisywania potwierdzonego dostarczenia (`INSERT ... ON CONFLICT DO UPDATE` tylko pól wysyłki); stary rekord: usunięty albo zachowany jako incydent; testy: dwa `Dispatch`, nowe ID już dostarczone |

## Uwagi do modelu (z odpowiedzi Codexa), do rundy D

- **Stan monitora związany z konfiguracją:** w pliku stanu zapisywany jest odcisk konfiguracji (chain ID, adresy trasy, `FROM_BLOCK`); niezgodność oznacza odrzucenie stanu i pełne skanowanie.
- **`ethProcess` z okna niefinalnego:** zapisywane wyłącznie po finalizacji (okno niefinalne tylko w pamięci, ponownie co przebieg).
- **Granica wdrożenia:** `FROM_BLOCK` sprawdzany przy starcie: kod lockboxa nie istnieje w bloku `FROM_BLOCK − 1`.
- **Auto-pauza przy `DRY_RUN=0`:** `PAUSE_ISM` i `PAUSE_HOOK` obowiązkowe; kod wyjścia ≠ 0 i linie `ALERT` muszą trafiać do alarmu (do sprawdzenia w konfiguracji serwera).
- **Granice modelu** (opisane w `docs/16`): mint przez zmieniony program bez PROCESSD albo zawyżony mint przy prawidłowym ID wykrywają inne kontrole (monitor uprawnień R4-05, porównanie sald dla człowieka).

## Kolejność proponowana

1. Runda D w kodzie: R6-02, R6-05, R6-04, R6-03, R6-01, R6-06, R6-07 (od najprostszych do najbardziej złożonych), z testami.
2. Osobno, wcześniej: **próba samego wykonania pauzy** na testnecie (syntetyczne metryki CRITICAL podane izolowanemu `auto-pause.sh`, operator obecny, ręczne wznowienie) — sprawdza klucz pausera, wysłanie i oba kierunki; nie weryfikuje modelu dowodów.
3. Runda 7 Codexa dla zakresu D, dopiero potem decyzja o próbie z rzeczywistym kolektorem.

**Uwaga o ID commitów:** przed publikacją dwa przeglądane commity zostały odtworzone bez danych floty (hook pre-push): `b00e843` → `6a00a17` (etykieta serwera w komunikacie testu i w opisie commita) oraz `802c48e` → `258cc01` (adres X1 z listy portfeli operatora w teście API zastąpiony publicznym adresem `So111…112`). Kod bez zmian; raport Codexa odnosi się do starych ID.
