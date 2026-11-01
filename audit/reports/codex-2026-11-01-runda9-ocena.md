# Ocena przeglądu Codex, runda 9 (1 lis 2026, zakres `1f7311a..2d0462d`)

Raport: [`codex-2026-11-01-runda9.md`](codex-2026-11-01-runda9.md). Bezwzględne ścieżki lokalne zamieniono na odnośniki względne, treść bez zmian. Wszystkie znaleziska R9 potwierdzone w kodzie `2d0462d`. Auto-pauza zostaje w trybie `DRY_RUN=1` do decyzji właściciela.

| ID | Waga | Ocena (z kodu) | Poprawka (runda G, strona v41) |
|---|---|---|---|
| R9-01 | Średnie | potwierdzone: `migrateOldPending` sprawdza brak operacji przed `await`, a po nim zapisuje bezwarunkowo (`writeOp`) i poza blokadą wysyłki | migracja pod tą samą blokadą Web Locks co wysyłka; po każdym `await` ponowne sprawdzenie; nigdy nie nadpisuje istniejącej operacji |
| R9-02 | Średnie | potwierdzone: ręczne odblokowanie pamięta tylko czas pierwszego kliknięcia i usuwa bezwarunkowo (`clearOp`); `clearOpIf` nie porównuje rewizji | pierwsze kliknięcie zapamiętuje `opId` + `rev`, drugie sprawdza tę samą operację; zmiana rekordu zeruje potwierdzenie; `clearOpIf` porównuje `opId` i `rev`; usuwanie pod tą samą blokadą |
| R9-03 | Niskie | potwierdzone: `verifyX2E` uznaje trasę po obecności programu w kontach i tekście logu | weryfikacja przez rzeczywistą instrukcję naszego programu (także CPI) i odtworzenie wiadomości (nadawca, domena, odbiorca, hash), nie tekst logu |

## Uwagi
- Rekomendacja Codexa (pytanie 13): po udokumentowanej próbie samego wykonania pauzy (§3a — wykonana 1 lis 2026, `docs/13`) kontrolowana próba `DRY_RUN=0` z rzeczywistym kolektorem jest dopuszczalna pod warunkami: jedna instancja monitora na `STATE_FILE`, niezależne RPC z pełną historią i zakończonym pełnym skanem, działające alarmy utraty obserwowalności, operator obecny z przygotowanym wznowieniem, ograniczony czas i zapis wyników. Przełączenie `DRY_RUN` wyłącznie decyzją właściciela.
- Monitor: jeden writer na `STATE_FILE` musi zapewnić wdrożenie (systemd: jedna jednostka, `Restart=` bez nakładania); do sprawdzenia na serwerze.
- Testy wskazane jako deklaratywne (Web Locks w tekście źródła, `sameOp` bez pokrycia ścieżek) dostają w rundzie G testy negatywne na prawdziwych handlerach w dwóch kartach.
