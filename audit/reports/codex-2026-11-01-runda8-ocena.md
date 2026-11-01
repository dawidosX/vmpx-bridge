# Ocena przeglądu Codex, runda 8 (1 lis 2026, zakres `bcb5318..80983ff`)

Raport: [`codex-2026-11-01-runda8.md`](codex-2026-11-01-runda8.md). Bezwzględne ścieżki lokalne zamieniono na odnośniki względne, treść bez zmian. Wszystkie znaleziska R8 potwierdzone w kodzie `80983ff`. Auto-pauza zostaje w trybie `DRY_RUN=1`.

| ID | Waga | Ocena (z kodu) | Poprawka (runda F) |
|---|---|---|---|
| R8-01 | Średnie | potwierdzone: `poll()` czeka na zapis cache (open/write/fsync/rename bez limitu czasu) przed aktualizacją `last_result` i `last_critical` | wynik i znaczniki publikowane PRZED zapisem cache; zapis z limitem czasu, odseparowany, spóźnione zakończenie nie nadpisuje nowszego stanu; test zapisu, który nigdy się nie kończy, przy wykrytym CRITICAL |
| R8-02 | Średnie | potwierdzone: sprawdzenie rekordu przed wieloma `await`, rezerwacja dopiero przed podpisem; zdarzenie `storage` nie zatrzymuje rozpoczętego handlera | Web Locks (`navigator.locks.request`, exclusive) zdobywane przed pierwszym przygotowaniem; rekord z unikalnym `opId` i właścicielem (`tabId`); utrata własności zatrzymuje handler przed podpisem i rozesłaniem; bez Web Locks wysyłka zablokowana z komunikatem |
| R8-03 | Średnie | potwierdzone: `reconcileOp` po `await` usuwa/zastępuje aktualny rekord bez sprawdzenia tożsamości | każde uzgadnianie, zapis i usunięcie sprawdza `opId` i wersję rekordu; stare wywołania są unieważniane |
| R8-04 | Średnie | potwierdzone: błędy `localStorage.setItem` ignorowane | nieudany zapis przed podpisem blokuje wysyłkę z komunikatem; nieudany zapis hasha po wysłaniu daje widoczny stan nieznany z hashem/podpisem do skopiowania |
| R8-05 | Niskie | potwierdzone: migracja usuwa stary rekord przed odczytem z łańcucha | stary rekord usuwany dopiero po zapisaniu i sprawdzeniu nowego; brak danych RPC = ponów później |
| R8-06 | Niskie | potwierdzone: rekord `tracking` omija weryfikację nadawcy; migracja ufa staremu ID | każdy rekord z `localStorage` (także `tracking`) uzgadniany z transakcją: nadawca, trasa i ID wiadomości odtworzone z tx |
| R8-07 | Niskie | potwierdzone: świeżość sald liczona od początku przebiegu | świeżość z rzeczywistego czasu odczytu sald w chwili publikacji |

Dodatkowo z odpowiedzi Codexa (pytania 10–12): na X1 sukces lub porażka tylko przy `finalized` (`confirmed` = nadal w toku); `allowanceReaches` ponawia także po wyjątku RPC do końca okresu; opłata X1 opisana w UI jako szacunek.

## Uwagi
- Rekomendacja Codexa (pytanie 15): przed próbą z rzeczywistym kolektorem usunąć R8-01, dodać test zawieszonego zapisu, potwierdzić niezależność i postęp pełnego skanowania na wdrożeniu oraz wykonać izolowaną próbę samego `pauseAll()` według `docs/08` §3a. R8-02…R8-06 nie blokują próby samej pauzy.
- Ograniczenia testów wskazane przez Codexa (dwie konkurujące karty z prawdziwymi handlerami, awaria `localStorage`, spóźnione `reconcileOp`, utrata rekordu przy migracji, zawieszony zapis cache) dostają w rundzie F testy na właściwym poziomie.
