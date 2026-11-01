# Ocena przeglądu Codex, runda 10 (1 lis 2026, zakres `2d0462d..46565b5`)

Raport: [`codex-2026-11-01-runda10.md`](codex-2026-11-01-runda10.md). Bezwzględne ścieżki lokalne zamieniono na odnośniki względne, tabele na Markdown, treść bez zmian. Wszystkie znaleziska R10 potwierdzone w kodzie `46565b5`.

Auto-pauza na testnecie **zostaje z `DRY_RUN=0`** (decyzja właściciela): R10-01 grozi ponowną, spóźnioną pauzą, a to kierunek bezpieczny (most stoi, środki nie są zagrożone). Do czasu poprawki obowiązuje ręczna kontrola nonce pausera przed każdym wznowieniem (`docs/08` §3b p. 7).

| ID | Waga | Ocena (z kodu) | Poprawka (runda H) |
|---|---|---|---|
| R10-01 | Średnie, pilne | potwierdzone: `timeout cast send` traktuje brak receipt jak nieudaną próbę; kolejne próby bez trwałego hasha i nonce; status receipt tylko logowany; brak `blockNumber` → `latest` | hash i nonce zapisywane przed czekaniem na receipt; timeout = „wynik nieznany”, nie porażka; ponowienie = ta sama transakcja albo jawna zamiana tego samego nonce; receipt: wymagany status 1 i kanoniczność (hash bloku); osobno „pauza wykonana w bloku N” i „most nadal wstrzymany”; test z transakcją zostającą w mempoolu |
| R10-02 | Średnie | potwierdzone: `diverged` i `evidence_critical` porównywane z `=== 1`, a to liczniki | `> 0`; testy wartości 2, większych i przejścia 1 → 2 |
| R10-03 | Średnie | potwierdzone: `alarmed`/`lastSent` ustawiane przed decyzją limitera | stan „wysłano” dopiero po zapisie w trwałej kolejce; odrzucone przez limiter czekają; osobny budżet dla pilnych (pauza) |
| R10-04 | Średnie | potwierdzone: kolejka 50 usuwa najstarsze (także pauzy); utrata stanu = odczyt od bieżącego startu; kursor przesuwany przed zapisem kolejki | trwała kolejka z ID zdarzeń i priorytetami, alarmy pauzy nigdy nie usuwane; kursor zatwierdzany razem z kolejką; odzyskiwanie po utracie stanu (ograniczony odczyt wstecz + deduplikacja); alarm o utracie stanu i przepełnieniu |
| R10-05 | Niskie | potwierdzone: HTTP 200 z pustym lub niepełnym dokumentem traktowane jak brak problemów (fałszywe „wróciło do normy”) | walidacja wymaganych pól i liczb skończonych; niekompletny dokument = nieczytelne wejście, alarmy zachowane |
| R10-06 | Średnie | potwierdzone: `getAccountInfo` konta DISPATCH z backendu sprzed transakcji daje `null` → mismatch → rekord usunięty | odczyt z `minContextSlot` ≥ slot transakcji; brak konta bez właściwego punktu odczytu = pending; test z opóźnionym backendem |
| R10-07 | Niskie | potwierdzone: surowe `e.message` z `send()` (błąd budowy URL zawiera token) | sanityzacja wszystkich błędów `send()`, walidacja endpointu przy starcie, test z atrapą tokena |

## Uwagi
- Pytania 10–11: brak ID incydentu i deduplikacji po transakcji, „pauza niepotwierdzona (mogła zadziałać)” prezentowana jako „NIEUDANA”, `criticalReason` bez korelacji. W rundzie H: ID incydentu łączące CRITICAL, powód, tx pauzy i potwierdzenie; deduplikacja po tx; osobny komunikat dla wyniku nieznanego.
- Pytanie 7 (format wiadomości X1, wersja, długość) i ograniczenia z rundy 9 (jeden writer, wspólna pula I/O, niezależność RPC) — przed mainnetem; poza rundą H.
- Rekomendacja Codexa (pytanie 13): faza 2 dopiero po R10-01…R10-05 i R10-06; do tego czasu faza 1 pod bezpośrednim nadzorem i z odczytem metryk i journala niezależnym od Telegrama.
