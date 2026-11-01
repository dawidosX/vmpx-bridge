Audyt runda 5 — zakres 72da87f..3ea31f4
Repozytorium: evmpx-x1-bridge (lokalna kopia; ścieżka lokalna usunięta przy archiwizacji)
Commit na początku i końcu: 3ea31f443d91cf2e6b4a6095f861b42d8adea064
Opis: audit: round 4 status table
Stan na początku i końcu: nothing to commit, working tree clean. Lokalny main wyprzedza origin/main o trzy commity.
Nie zmieniłem, nie utworzyłem ani nie usunąłem plików. Nie wykonywałem transakcji ani zapytań sieciowych. Pominąłem wskazane katalogi.
Wniosek: nie rekomenduję jeszcze przełączenia auto-pauzy na DRY_RUN=0. Poprawki zwiększają bezpieczeństwo, ale nadal możliwe są zarówno fałszywe OK, jak i CRITICAL na zdrowym moście.
Tabela znalezisk
Pewność poniższych ustaleń z kodu jest wysoka. Nie potwierdzono znalezisk Krytycznych ani Wysokich.
ID	Waga	Plik:linia	Opis	Scenariusz	Zalecana poprawka
R5-01	Średnie	[activity.py (line 639)](../../indexer/activity.py), :714–717; [monitor-core.mjs (line 73)](../../monitoring/src/monitor-core.mjs)	index.complete nie dowodzi kompletności względem sald. Akceptuje listę ze slotu S i podaż z późniejszego slotu T. Monitor ufa deklaracji, nie uzgadnia listy z własnymi punktami odczytu. Na Ethereum również nie wymaga się, aby skan obejmował blok odczytu salda.	Lista powstaje przed burnem 50, podaż po burnie wynosi 60, lockbox ma 100. Lista nie zawiera roszczenia 50, a warunki slotów przechodzą. Monitor zwraca OK, mimo zobowiązań 110. Stary backend może wielokrotnie zwracać tę samą listę: równość slotów jest dozwolona, a znacznik publikacji jest odnawiany.	Uzgadniać indeks do konkretnego punktu rozliczenia, z ciągłością sekwencji wiadomości i osobną kontrolą obu łańcuchów. Różnicę między punktem listy i sald rozliczać wiadomościami albo oznaczać jako nieznaną. Nie nazywać samych warunków monotoniczności dowodem kompletności.
R5-02	Niskie	[app.js (line 691)](../../frontend/www/app.js)	Strona nadal akceptuje brak index. Warunek `!S.act.index		...` pozostawia zgodność ze starym dokumentem kosztem działania przy nieznanej kompletności.
R5-03	Średnie	[monitor-core.mjs (line 61)](../../monitoring/src/monitor-core.mjs), :92–98; [monitor.mjs (line 43)](../../monitoring/src/monitor.mjs); [activity.py (line 661)](../../indexer/activity.py), :685–687	Nowa kolejność nadal pozwala potwierdzić fałszywy niedobór. Statusy dostarczeń nie są przypięte do bloku salda ani uzgodnionego slotu podaży. Ponowny odczyt i niemalejące numery nie rozwiązują tej zależności.	Zdrowy most: odczyt podaży 100; następnie burn i unlock 10; odczyt lockboxa 90. Monitor porównuje różne chwile. Powtórzenie ruchu podczas kolejnych obserwacji daje WARN, potem CRITICAL, mimo rzeczywistego pokrycia 1:1. Opóźniony backend statusów może dodatkowo ponownie doliczyć już wypłaconą wiadomość. Indekser może dwukrotnie doliczyć mint wykonany między skanem a odczytem podaży.	Budować rozliczenie na uzgodnionych punktach. Ethereum saldo i statusy czytać na tym samym bloku. Na X1 uzgodnić podaż, burny i minty z punktem indeksu; samo późniejsze sprawdzenie istnienia PDA nie wystarcza. Dodać testy burn→unlock pomiędzy czytnikami i powtarzających się wyścigów.
R5-04	Średnie	[monitor.mjs (line 19)](../../monitoring/src/monitor.mjs), :55–61,92–93; [auto-pause.sh (line 18)](../../monitoring/auto-pause.sh)	Świeża próba może uwierzytelniać stary wynik. attemptAt aktualizuje się przed zakończeniem ticka. setInterval dopuszcza nakładanie się przebiegów, a odczyty nie mają jawnych timeoutów. Auto-pauza ocenia wiek próby, nie ukończenia obserwacji CRITICAL.	Po wcześniejszym CRITICAL RPC zaczyna zawieszać odczyty. Kolejne próby odnawiają attemptAt, lecz last pozostaje stary. Automat nadal widzi „świeże CRITICAL” i może ponownie pauzować most po usunięciu przyczyny. Przy poprzednim OK alarm zatrzymania może być maskowany nowymi, niedokończonymi próbami.	Jeden aktywny przebieg, timeout całej obserwacji i poszczególnych RPC. Eksportować czas zakończenia wyniku oraz osobny czas potwierdzonego CRITICAL; ten czas powinien sprawdzać automat. Alarmować na przekroczenie czasu aktywnego przebiegu.
R5-05	Średnie	[activity.py (line 564)](../../indexer/activity.py), :579–580; [activity.py (line 245)](../../indexer/activity.py)	Rekordy migracyjne bez hashy pozostają poza kontrolą reorga. Nowe kolumny nie są uzupełniane dla starej historii. Zapytania reorg_check() wymagają niepustego hasha.	Stary rekord depozytu albo dostarczenia pochodzi z usuniętego bloku. Po migracji jest stale pomijany. Może zawyżać zobowiązania lub ukrywać nadal oczekującą wypłatę, mimo publikacji complete=true.	Wykonać kontrolowaną migrację: odtworzyć receipt, logi, ID wiadomości, numer i hash bloku. Do zakończenia oznaczać odpowiedni zakres indeksu jako niezweryfikowany.
R5-06	Średnie	[activity.py (line 569)](../../indexer/activity.py), :572–573,621–626	Ponowne włączenie transakcji nie oznacza zachowania ID wiadomości. Kod aktualizuje blok starego rekordu na podstawie udanego receipt, bez odczytania rzeczywistego Dispatch.	Po reorgu ta sama transakcja wykonuje się po innej liczbie dispatchów Mailboxa. Zmienia się nonce i ID wiadomości; może zmienić się też netto przy innej konfiguracji opłaty. Stary rekord pozostaje, a skan dopisuje nowy ID. Powstają podwójne albo nieprawidłowe zobowiązania.	Receipt traktować jako źródło logów do ponownego zdekodowania. Zastępować rekord rzeczywistym ID i kwotą, usuwać osierocony rekord albo zachowywać go jako jawny incydent, jeśli mint już nastąpił.
R5-07	Niskie	[auto-pause.sh (line 24)](../../monitoring/auto-pause.sh), :31–32	Diagnostyka nadal poprzedza krytyczną operację. Odczyty flag nie pomijają już pauzy i obsługują błąd, lecz skrypt czeka na ich zakończenie. Brakuje jawnego ograniczenia czasu całego etapu diagnostycznego.	Przy świeżym CRITICAL odczyt cast call jest bardzo wolny lub zawieszony. Wysłanie pauseAll() opóźnia się, chociaż wynik diagnostyczny nie jest potrzebny do decyzji.	Usunąć odczyty ze ścieżki przed wysyłką albo ograniczyć ich czas. Wysyłkę, receipt i niepowodzenie pauzy monitorować oddzielnie; zapewnić kontrolowane ponowienia.


Stan poprzednich znalezisk
Znalezisko	Stan	Uzasadnienie
R4-01 — kompletność	Częściowo	Pole jest publikowane; monitor odrzuca brak pola i false. Jego definicja nie dowodzi jednak kompletności względem sald, a strona dopuszcza brak index. R5-01 i R5-02.
R4-02 — spójność	Częściowo	Dodano punkty odczytu, kolejność X1→ETH i potwierdzanie niedoboru. Nadal nie jest to wspólny snapshot; zdrowe burny mogą dać CRITICAL. R5-03.
R4-03 — obserwowalność	Częściowo	Oddzielono zegary; zwykłe błędy dają UNKNOWN, dodano alarmy. Pozostaje problem zawieszonych, nakładających się przebiegów i wieku eksportowanego wyniku. R5-04.
R4-04 — reorg	Częściowo	Dla rekordów z hashem naprawiono pomijanie ostatniej kontroli po awansie finalized. Nie rozwiązano starej historii ani zmiany wiadomości po ponownym wykonaniu transakcji. R5-05 i R5-06.
R4-10 — częściowa pauza	Usunięte w pierwotnym zakresie	Flagi obu kierunków służą tylko do logowania; częściowa pauza nie powoduje wcześniejszego wyjścia. Wysłanie nadal zależy od ukończenia diagnostyki i dostępności RPC — R5-07.


Odpowiedzi na pytania
1–3. Kompletność i maksymalny zakres fałszywego OK
Nie, podane warunki nie stanowią dowodu kompletności.
Warunek:
slot listy ≥ slot listy z poprzedniego przebiegu
slot podaży ≥ slot listy
dopuszcza zdarzenia pomiędzy listą a podażą. Burn zmniejsza podaż, ale tworzy roszczenie do Ethereum. Jeśli roszczenia nie ma jeszcze na liście, zostaje ono pominięte w zobowiązaniach.
Komentarz activity.py:635–636 opisujący ten przypadek jako nieszkodliwą nadwyżkę nie uzasadnia potwierdzenia wypłacalności.
Kwota: błąd może objąć sumę wszystkich pominiętych burnów, nawet całą podaż istniejącą przed tymi burnami. Nie ogranicza go pojemność C: limiter ogranicza wykonanie wypłat, a nie powstawanie roszczeń na X1. Potencjalne zagrożenie dla istniejącego zabezpieczenia obejmuje cały lockbox.
Czas: kod nie zapewnia maksymalnego czasu. Normalnie problem może zniknąć po kolejnym kompletnym skanie. Jeśli jednak backend stale zwraca tę samą starą listę i slot, równość przechodzi, a świeże updated jest publikowane ponownie. Fałszywe OK może utrzymywać się bezterminowo.
- Monitor: brak index albo complete=false daje UNKNOWN, o ile niezależny warunek lockbox < podaż nie wywoła alarmu.
- Strona: complete=false jest odrzucane, ale brak index jest akceptowany.
4–5. Fałszywe alarmy i monotoniczne punkty odczytu
Tak, zdrowy most nadal może dać CRITICAL.
Odtworzyłem bez sieci następujący przebieg:
podaż odczytana: 100
burn i unlock:    10
lockbox odczytany: 90
Powtórzenie tego zdarzenia podczas kolejnego ticka i potwierdzenia dało:
WARN → CRITICAL
rzeczywiste końcowe saldo lockboxa = podaż = 70
Wszystkie numery bloków i slotów rosły. Nie było rzeczywistego niedoboru.
Statusy dostarczeń również wymagają spójności: saldo Ethereum jest przypięte do bloku, ale delivered() czytane jest z latest innego momentu/backendu.
Indekser także może zgłosić insolvent na zdrowym moście. Przykład: skan nie widzi jeszcze mintu i pozostawia wiadomość jako pending; późniejszy odczyt podaży już widzi mint. Wiadomość zostaje policzona dwukrotnie. Powtórzenie takiego wyścigu w dwóch rundach spełnia próg alarmu.
Monotoniczność może zatrzymać ocenę na długo. Dla poprawnego wcześniejszego punktu i tej samej, zdrowej, rosnącej sieci monitor odblokuje się po dogonieniu zapamiętanego maksimum. Nie ma jednak ograniczenia czasu ani procedury ponownego ustalenia punktu po rollbacku lub zmianie RPC. Numery są przechowywane w pamięci; restart je zeruje, ale sam restart nie dowodzi poprawności nowych danych.
6–7. Obserwowalność i last_ok
Poprawnie obsłużone przypadki:
Awaria	Reakcja wynikająca z kodu
Zakończony błędem odczyt salda	UNKNOWN, readOk=false, wzrost licznika błędów.
Trwale niekompletny/stary indeks	UNKNOWN; alarm po ponad 600 s ciągłego UNKNOWN.
Zatrzymany indeks	Po przekroczeniu wieku activity: UNKNOWN, następnie powyższy alarm.
Zatrzymany proces monitora / brak metryk	Reguła absent(...) lub wiek próby ponad 300 s.
Brak potwierdzonego OK	Ostrzeżenie po 1800 s.


Czasy wymagają dodania interwałów scrape i oceny reguł. Załadowanie reguł, poprawny scrape i dostarczenie powiadomień do operatora pozostają do weryfikacji.
Nie każda utrata rozliczalności kończy się obecnie odpowiednio szybkim alarmem. R5-04 pozwala odnawiać czas próby bez ukończenia odczytów. last_read_ok_timestamp jest eksportowany, ale nie ma osobnej reguły sprawdzającej jego wiek.
last_ok aktualizuje się teraz wyłącznie przy severity OK — ta poprawka jest prawidłowa. Może jednak oznaczać świeże pozorne OK bez pełnego rozliczenia, ponieważ index.complete=true może być błędnym założeniem — R5-01.
8–9. Finalizacja, migracja i ponowne włączenie
Dla rekordów mających hash obecny kod:
1. sprawdza zgodność hasha;
2. dopiero potem ustawia flagę finalności, jeżeli blok jest na lub poniżej finalized;
3. dla ponownie włączonej transakcji również wymaga zgodnego hasha przed oznaczeniem jej jako finalnej.
Pierwotny błąd przeskoczenia rekordu przez fin został naprawiony. Dotyczy to jednak zaufania do prawidłowych, kanonicznych odpowiedzi RPC; sam numer bloku nie potwierdza gałęzi.
Rekordy bez hashy:
- nie są oznaczane jako finalne;
- ale też nie są w ogóle sprawdzane;
- ich brak weryfikacji nie blokuje index.complete.
Odtworzenie na bazie w pamięci pokazało zero odczytów RPC dla starego rekordu bez hasha.
Przy ponownym włączeniu transakcji kod przesuwa stary rekord do nowego bloku. Nie odtwarza jej wiadomości z logów — pozostaje R5-06.
10–11. Czy świeże CRITICAL zawsze prowadzi do pauzy?
Nie bezwarunkowo.
Przy świeżych metrykach, SEV=2, DRY_RUN=0 i zakończonej diagnostyce skrypt dochodzi do cast send pauseAll(). Częściowa ani pełna istniejąca pauza nie powoduje już pominięcia wywołania.
Nadal występują następujące ograniczenia:
- stare metryki powodują jawne wyjście bez pauzy;
- UNKNOWN powoduje log/alarm, ale nie pauzę;
- niedostępne metryki kończą się bez pauzy;
- wolny odczyt diagnostyczny może opóźnić wysyłkę;
- brak zmiennej środowiskowej, problem keystore’a lub błąd cast send przerywa skrypt;
- nie ma w tym skrypcie własnej pętli ponowień ani niezależnego sprawdzenia skutecznego zatrzymania obu kierunków.
To częściowo świadoma polityka dostępności. Log ALERT i kod wyjścia zero nie dowodzą dostarczenia alarmu człowiekowi. Konfiguracja timerów, odbiorców alarmów i reakcji na nieudaną pauzę jest do weryfikacji.
Wyniki testów i ocena ich zakresu
Uruchomione bez zapisu:
python3 -B -m unittest indexer/test_activity.py
16 testów — OK

node --test monitoring/test/*.mjs
21 testów — OK
Opcja -B zapobiegła tworzeniu __pycache__. Testy Python używają SQLite w pamięci.
Dodatkowe odtworzenia potwierdziły:
- OK → OK przy pominiętym burnie i deklarowanym complete=true;
- WARN → CRITICAL na zdrowym moście przy burnach między odczytami;
- całkowite pomijanie starego rekordu bez hasha.
Czy testy utrwalają błędne zachowanie?
- Dawny test_finalized_rows_are_not_rechecked został właściwie zastąpiony. Nowy test ostatniej kontroli przed finalizacją jest sensowny przy założeniu nieodwracalności finalizacji Ethereum.
- test_reincluded_deposit_moves sprawdza tylko przesunięcie numeru bloku. Nie sprawdza zmienionego ID ani zawartości Dispatch, więc nie wykrywa R5-06.
- Test monitora deklarujący, że ruch między czytnikami „nigdy” nie powoduje CRITICAL, obejmuje jeden wybrany układ depozytu. Nie obejmuje przeciwnego kierunku burn→unlock. Nie dowodzi ogólnej własności sugerowanej nazwą.
- Testy complete sprawdzają zachowanie po otrzymaniu flagi, a nie prawdziwość flagi wyliczanej przez pełny indeks.
- W podanych zestawach nie ma testu pełnej pętli poll() z zawieszonym odczytem i kolejnymi uruchomieniami interwału.
Rekomendacja dotycząca DRY_RUN=0
Nie przełączać jeszcze na automatyczną pauzę, również jako zwykły tryb pracy testnetu.
Przed przełączeniem należy:
1. Naprawić definicję kompletności i odrzucać brak index na stronie.
2. Usunąć fałszywe potwierdzenie niedoboru dla burn→unlock i przypiąć statusy wiadomości do rozliczanych obserwacji.
3. Wprowadzić pojedynczy przebieg monitora, jawne timeouty i czas zakończonego wyniku używany przez auto-pauzę.
4. Zweryfikować starą bazę bez hashy i poprawić odtwarzanie wiadomości po reorgu.
5. Oddzielić diagnostykę od wysłania pauzy oraz zapewnić alarm i ponowienia po nieudanym zatrzymaniu.
6. Przeprowadzić próbę end-to-end na testnecie: zdrowy ruch w obu kierunkach, opóźnione RPC, zatrzymany indeks, zawieszony odczyt, kontrolowany niedobór i częściowa pauza.
Kontrolowany drill DRY_RUN=0, z operatorem obecnym i ręczną ścieżką wznowienia, może być częścią tej weryfikacji. Nie zastępuje napraw powyższych problemów.
Końcowa kontrola Git: ten sam commit 3ea31f4, drzewo nadal czyste.