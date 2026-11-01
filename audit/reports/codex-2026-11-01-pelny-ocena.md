# Ocena pełnego audytu Codex (1 lis 2026, `1540e22..f464516` + robocze zmiany routera v3)

Raport: [`codex-2026-11-01-pelny.md`](codex-2026-11-01-pelny.md). Bezwzględne ścieżki lokalne zamieniono na odnośniki względne, tabele na Markdown, treść bez zmian. Codex nie potwierdził nowych znalezisk krytycznych ani wysokich. Wszystkie F-01…F-06 potwierdzone w kodzie.

Uwaga do zakresu: audyt widział robocze (niezacommitowane) zmiany routera v3. Są zacommitowane w `4555edb` (router v3 z `maxLocked`, niewdrożony); `forge test` w całości: 110 zaliczonych, 0 nieudanych, 2 pominięte (fork Sepolii bez RPC).

| ID | Waga | Ocena | Poprawka / termin |
|---|---|---|---|
| F-01 | Średnie | potwierdzone: `conditions()` ignoruje `vmpx_bridge_balance_alarm` (trwały niedobór pokrycia > 30 min) | przed upublicznieniem: alarm Telegram „niedobór pokrycia” z obsługą starych i nieczytelnych obserwacji (wstrzymanie, osobny alarm „saldo nieaktualne”), testy |
| F-02 | Średnie | potwierdzone: `check-roles.sh` sprawdza wskazane konta, nie cały zbiór posiadaczy; `getMinDelay()` tylko wypisywany | przed krokiem 2B (3 lis): zbiory ról odtwarzane z `RoleGranted`/`RoleRevoked` od wdrożenia, dokładne porównanie, `getMinDelay()` == oczekiwane, brak historii = FAIL |
| F-03 | Średnie | potwierdzone: `check-x1.mjs` nie sprawdza `max_protocol_fee`, bieżącej opłaty i beneficjenta outboxa ani genesis, domeny i `metadataPointer` | przed mainnetem (lista blokerów) |
| F-04 | Niskie | potwierdzone: walidacja odbiorcy X1 przyjmuje np. 32 × „2” (23 bajty) i dopełnia do innego klucza | strona v43: dokładnie 32 bajty, zera wiodące, ponowne kodowanie = wejście, zerowy klucz odrzucany; testy względem `solana-web3`. Ograniczenie: base58 nie ma sumy kontrolnej — adres skrócony o jeden znak może być innym poprawnym kluczem; domyślnym odbiorcą jest podłączony portfel |
| F-05 | Niskie | potwierdzone: odczyty RPC strony bez `AbortSignal` | przed mainnetem (lista blokerów) |
| F-06 | Niskie | potwierdzone: `run-all-tests.sh` uruchamia część zestawów, nie agreguje kodów wyjścia, nadpisuje raport | przed upublicznieniem: wszystkie zestawy offline, zbiorczy kod wyjścia, bez nadpisywania `audit/` |

## Blokery mainnetu z raportu (dopisane do listy operatora)
- F-03, F-05; działający nadzór uprawnień (monitor zmian X1); odbiór on-chain całego grafu zaufania; bezpieczny Squads; próby operacyjne (restart z tx w mempoolu, rotacja klucza, opóźnione RPC, utrata stanu, awaria alarmów, wznowienie po rozliczeniu nonce); polityka reorga po `done`; `maxLocked` wyrażony w tokenach z marginesem cenowym i zgodny z limitem dziennym; separacja kluczy i **zewnętrzny „dead man's switch”** (alarm, gdy serwer z monitorem milczy — heartbeat do usługi poza tym serwerem).
- Brakujące testy: stanowy test łączący limit TVL, opłaty, pauzę, darowizny i wiadomości w obu kierunkach; negatywne testy odbioru konfiguracji; test dostarczenia alarmu niedoboru; rzeczywisty test wielu kart / przeładowania / rozłączenia portfela; testy wdrożonego programu SVM.
- Rekomendacja Codexa: repo można upublicznić jako projekt testnetowy z jawną listą problemów; mainnetu jeszcze nie.
