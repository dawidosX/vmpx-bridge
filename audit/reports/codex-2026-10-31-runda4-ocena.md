# Ocena przeglądu Codex, runda 4 (31 paź 2026, zakres `bde42dc..d097e81`)

Raport: [`codex-2026-10-31-runda4.md`](codex-2026-10-31-runda4.md) (lokalne ścieżki zastąpione względnymi; szczegóły topologii z R4-11 zastąpione opisem ogólnym). Wszystkie znaleziska potwierdzone w kodzie `d097e81`.

Plan (decyzja właściciela, 31 paź): **A** = teraz, publiczne repo i strona; **B** = przed przełączeniem auto-pauzy na `DRY_RUN=0` (do tego czasu monitor tylko alarmuje); **R4-05** = osobna runda przed mainnetem.

| ID | Waga | Ocena | Runda | Poprawka |
|---|---|---|---|---|
| R4-01 | Średnie | potwierdzone: `x1_complete` liczone w indekserze, ale nie publikowane; monitor sprawdza tylko wiek dokumentu | B | indekser publikuje kompletność i punkty odczytu; monitor bez kompletności = UNKNOWN + alarm |
| R4-02 | Średnie | potwierdzone: odczyty dwóch łańcuchów nie są powiązane z blokiem/slotem, 2 przebiegi nie dowodzą spójności | B | obserwacje z numerem bloku/slotu; przed CRITICAL ponowne potwierdzenie na świeżo uzgodnionych danych; testy zmian stanu między odczytami |
| R4-03 | Średnie | potwierdzone: UNKNOWN aktualizuje `last_ok_timestamp`, brak alarmu na trwałe UNKNOWN | B | osobno: czas próby, udanego odczytu, pełnego rozliczenia; `last_ok` tylko przy OK; alarm na UNKNOWN > 10 min i błędy |
| R4-04 | Średnie | potwierdzone: rekord przeskoczony przez `fin` nie jest sprawdzany ostatni raz | B | jawny stan finalizacji rekordu, ostatnia weryfikacja hasha przed uznaniem za finalny, test awansu `fin` po reorgu |
| R4-05 | Średnie | potwierdzone (R-02 otwarte) | osobna runda przed mainnetem | monitor uprawnień według planu z oceny rundy 3, §3 |
| R4-06 | Niskie | potwierdzone: Google Fonts w nagłówku v33 | A | Chakra Petch i Archivo serwowane lokalnie (woff2 + OFL), bez odwołań do Google |
| R4-07 | Niskie | potwierdzone: `check()` obejmuje tylko 4 role Timelocka | A | osobne odbiory: krok 2B i pełna migracja (skrypt tylko do odczytu) |
| R4-08 | Niskie | potwierdzone: klucz cache z całego query | A | nieznane parametry → 400; klucz z unormowanych `days`/`bot` |
| R4-09 | Niskie | potwierdzone: panel sald porównuje tylko lockbox z podażą | A | werdykt panelu z pełnego rozliczenia (indekser), nadwyżka oddzielona od kwot w drodze, poprawione `insolventMsg` EN/PL |
| R4-10 | Niskie | potwierdzone: „już wstrzymany” sprawdza tylko ISM odblokowań | B | przy świeżym CRITICAL zawsze idempotentne `pauseAll()` (sprawdzenie obu kierunków tylko do logu) |
| R4-11 | Info | potwierdzone | A | publiczne docs i raporty bez liczby maszyn i lokalizacji; ryzyko korelacji opisane ogólnie; usunięte stare ścieżki (historyczna ścieżka środowiska testowego) |

## Status (31 paź 2026)

| Punkt | Commit | Testy / weryfikacja |
|---|---|---|
| R4-06 | `72da87f` | strona pod CSP `style-src 'self'; font-src 'self'` lokalnie: brak naruszeń, brak zapytań do Google; zmiana nagłówka nginx czeka na sudo |
| R4-07 | `c0ec1dc` | `check-roles.sh 2b` / `full` na Sepolii (tylko odczyt): przed krokiem 2B pokazuje 4 role do zabrania; `full` pokazuje beneficjenta hooka = deployer, strażnika, uprawnienia X1; błędy RPC przy listowaniu logów = FAIL |
| R4-08 | `e59a782` | testy API: równoważne zapytania = jeden wpis cache, nieznany parametr 400 bez liczenia |
| R4-09 | `72da87f` | przeglądarka: przykład 100/60/50 = „Alarm” (wcześniej „Pełne pokrycie”), nadwyżka osobno od kwot w drodze, EN/PL |
| R4-11 | `5ef6092` | publiczne docs i raporty bez szczegółów infrastruktury; stare ścieżki usunięte |
| R4-01, R4-04 | `0db20cd` | indekser: kompletność na podstawie slotów, punkty odczytu w `activity.json`; testy reorga po awansie `fin` (zastąpiony test, który utrwalał lukę) |
| R4-02, R4-03, R4-10 | `eb0dc08` | monitor 21 testów: zmiany stanu między odczytami, opóźniony backend, błędy odczytu, potwierdzające ponowne odczyty; `auto-pause.sh` na fałszywych metrykach (CRITICAL przy starym `last_ok`, monitor zawieszony, długie UNKNOWN) |

Auto-pauza pozostaje w trybie `DRY_RUN=1`. R4-05 (monitor uprawnień) to osobna runda przed mainnetem.
