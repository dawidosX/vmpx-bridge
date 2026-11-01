# Ocena przeglądu Codex, runda 11 (1 lis 2026, zakres `46565b5..58ad9bb`)

Raport: [`codex-2026-11-01-runda11.md`](codex-2026-11-01-runda11.md). Bezwzględne ścieżki lokalne zamieniono na odnośniki względne, tabele na Markdown, treść bez zmian. Wszystkie znaleziska R11 potwierdzone w kodzie `58ad9bb`. Auto-pauza na testnecie zostaje z `DRY_RUN=0` (decyzja właściciela).

| ID | Waga | Ocena (z kodu) | Poprawka (runda I) |
|---|---|---|---|
| R11-01 | Średnie | potwierdzone: zamiana podpisywana bieżącym kluczem bez porównania z `from` z `pending.json` | przed zamianą: adres bieżącego klucza, chain ID i adres pausera muszą zgadzać się z rekordem; niezgodność = STOP + ALERT, bez podpisu; rekord związany z pełną konfiguracją |
| R11-02 | Średnie, pilne operacyjnie | potwierdzone: „already paused” z jednego RPC, bez kontroli świeżości headu | pominięcie wysyłki tylko przy świeżym (≤ 30 s) i zgodnym headzie z ≥ 2 niezależnych RPC, oba z obiema flagami `true`; każda niepewność = wysyłka `pauseAll` (idempotentne) |
| R11-03 | Średnie | potwierdzone: brak `state.json` i `.bak` = pierwsze uruchomienie | jawny znacznik pierwszej instalacji; poza nim brak obu plików = ograniczone okno historyczne + alarm „utrata stanu” |
| R11-04 | Niskie | potwierdzone: `alarmed`/`lastSent` ustawiane mimo odrzucenia przez przepełnioną kolejkę | wynik `enqueue()` decyduje; odrzucony alarm wraca, gdy jest miejsce |
| R11-05 | Niskie | potwierdzone: surowa podpisana transakcja w argv (pomocnik Pythona, `cast keccak`, `cast publish`) | raw tylko przez stdin / plik 0600; hash liczony bez argv |
| R11-06 | Niskie | potwierdzone: okno czasowe może przypisać powód następnego przebiegu | korelacja po dokładnym identyfikatorze przebiegu monitora; brak = „powód nieustalony” |

## Uwagi
- Runda I bez osobnego audytu Codexa: wejdzie do audytu całościowego przed mainnetem.
- Z odpowiedzi Codexa przed mainnetem (poza rundą I): polityka reorgów po rozliczeniu receipt (ponowne sprawdzenie kanoniczności `done`), tożsamość procesu w metrykach (ID instancji, odrzucanie timestampów z przyszłości), zaufany endpoint Telegrama, jawna polityka deduplikacji zmian stanu UNKNOWN, ograniczenie pilnej kolejki, pomiar opóźnień alarmów.
- Nadzorowane scenariusze przed fazą 2 (Codex p. 13): restart z nierozstrzygniętą transakcją i zmianą keystore'a, opóźniony RPC przed wznowieniem, utrata obu plików alarmów, awaria kanału z przepełnieniem.
