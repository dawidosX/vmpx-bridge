Audyt rundy 9 — zakres 1f7311a..2d0462d
Monitor usuwa poprzedni bloker próby auto-pauzy. Warunkowo rekomenduję kontrolowaną próbę z rzeczywistym kolektorem na testnecie, po udokumentowaniu próby wykonania pauzy i sprawdzeniu konfiguracji wdrożenia. Pozostałe potwierdzone znaleziska dotyczą strony v40.
Na początku i na końcu audytu:
- Commit: 2d0462db210ca1a4291f7e9d0fd60a3e1dbfc78d.
- git status: drzewo czyste; main wyprzedza origin/main o 2 commity.
- Bez zmian w repozytorium, transakcji i operacji na kluczach. Pliki testów powstawały wyłącznie w usuwanych katalogach tymczasowych.
Przeczytałem raport rundy 8, jego ocenę oraz §15–16 modelu auto-pauzy.
Znaleziska
ID	Waga	Plik:linia	Opis	Scenariusz	Zalecana poprawka
R9-01	Średnie	[app.js (line 770)](../../frontend/www/app.js:770), :772–775	Migracja sprawdza brak bieżącej operacji przed odczytem RPC, ale po jego zakończeniu zapisuje rekord bez ponownego sprawdzenia. Nie korzysta z blokady wysyłki.	Migracja starego transferu czeka na RPC. W tym czasie powstaje operacja B. Odpowiedź migracji nadpisuje B rekordem starego transferu w stanie tracking, który nie blokuje wysyłki. Potwierdzone wykonaniem rzeczywistej funkcji w pamięci.	Migrację serializować z rezerwacją wysyłki. Po każdym await ponownie sprawdzać warunki zapisu; nie zastępować istniejącej operacji. Samo dodatkowe sprawdzenie bez wspólnej blokady nie daje atomowości między kartami.
R9-02	Średnie	[app.js (line 658)](../../frontend/www/app.js:658), :663, :1534–1536	Ręczne odblokowanie nadal usuwa rekord bezwarunkowo. Pierwsze kliknięcie zapamiętuje wyłącznie czas, bez tożsamości operacji. clearOpIf() nie sprawdza rewizji.	Użytkownik uzbraja odblokowanie dla A. Przed drugim kliknięciem rekord zmienia się na B. Drugie kliknięcie usuwa B, choć decyzja dotyczyła A. Potwierdziłem usunięcie innej operacji.	Zapamiętać opId i rewizję przy pierwszym kliknięciu. Przy drugim sprawdzić tę samą operację i jej aktualny stan; po zmianie rekordu wyzerować potwierdzenie. Usuwanie serializować z innymi modyfikacjami.
R9-03	Niskie	[x1.js (line 267)](../../frontend/www/x1.js:267), :270–273	verifyX2E() nie dowodzi, że log dispatch pochodzi z naszej trasy. Wymaga tylko naszego programu w liście kont i pasującego tekstu logu.	Inny program otrzymuje adres naszego programu jako konto i emituje tekst Dispatched message to …, ID …. Transakcja użytkownika spełnia obecne warunki weryfikacji mimo braku wywołania naszego programu tokena. Może uwierzytelnić podrobiony rekord śledzenia. Nie daje to uprawnień do środków.	Weryfikować rzeczywistą instrukcję transferu i wywołania CPI; przypisać dispatch do właściwego Mailbox/programu. Odtworzyć wiadomość i sprawdzić jej nadawcę, domenę, odbiorcę oraz hash. Nie uwierzytelniać trasy samym tekstem logu.


Pewność: wysoka dla opisanych ścieżek kodu. Wszystkie trzy przypadki potwierdziłem dodatkowymi scenariuszami w pamięci, bez plików i sieci. Scenariusz R9-03 wymaga podrobionego rekordu lub transakcji innej aplikacji; nie wykazałem możliwości nieautoryzowanego transferu tokenów.
Stan R8-01…R8-07
ID	Stan	Uzasadnienie
R8-01	Usunięte	Wynik i znaczniki czasu publikowane są przed zapisem. Zapis działa w tle, ma limit oczekiwania i ograniczoną liczbę operacji w toku. Test FIFO potwierdza świeże CRITICAL i kolejne przebiegi przy zawieszonych zapisach.
R8-02	Częściowo	Zwykłe handlery wysyłki działają pod wyłączną blokadą Web Locks; brak obsługi blokuje wysyłkę. Własność jest kontrolowana przed podpisem i rozesłaniem. Migracja nadal może zastąpić rezerwację — R9-01.
R8-03	Częściowo	recGen, alive() i warunkowe zapisy chronią typowe spóźnione uzgadnianie. Migracja i ręczne usuwanie pozostają wyjątkami; clearOpIf() nie porównuje rewizji — R9-01, R9-02.
R8-04	Usunięte dla transferu mostowego	Rezerwacja musi zostać odczytana z powrotem. Nieudany zapis hasha EVM tworzy widoczny S.unsaved; X1 nie rozpoczyna rozsyłania bez zapisu podpisu. Ograniczenia po F5 opisuję poniżej.
R8-05	Usunięte dla utraty starego wpisu przy błędzie RPC	Brak danych pozostawia stary rekord do ponowienia. Jest usuwany po skutecznym zapisie nowego. Pozostaje osobny wyścig migracji — R9-01.
R8-06	Częściowo	Rekordy tracking są uzgadniane, a ID odtwarzane z transakcji. Ethereum sprawdza dispatch naszego routera. Weryfikacja trasy X1 pozostaje niewystarczająca — R9-03.
R8-07	Usunięte w sprawdzanym scenariuszu	Obserwacja ma własny czas, świeżość jest oceniana przy publikacji i ponownie przy eksporcie. Stare saldo nie utrzymuje aktywnej metryki balance_alarm.


Odpowiedzi 1–5 — monitor
1. Czy cache może nadal zatrzymać publikację?
Nie znalazłem poprzedniej ścieżki. poll() publikuje wynik oraz last_result i last_critical, następnie aktualizuje stan w pamięci i uruchamia zapis bez oczekiwania. Błąd, timeout lub pominięcie zapisu nie zastępują wyniku.
Timeout ogranicza oczekiwanie na operację, nie przerywa zawieszonego wywołania systemu plików. Jest ono nadal liczone jako inFlight, co zapobiega nieograniczonemu tworzeniu zapisów.
2. Kolejność rename i restart
W obrębie jednej instancji writera:
- rename są serializowane;
- starszy zapis kończący się po zatwierdzeniu nowszego jest odrzucany;
- błąd rename nie zatrzymuje następnych zapisów.
Po pełnym zatrzymaniu procesu reset numeracji do 1 sam w sobie nie powoduje cofnięcia: stara instancja nie wykonuje już kodu.
Nie ma jednak gwarancji między równolegle działającymi instancjami monitora. Generacje i kolejka są wyłącznie w pamięci, a nazwy plików tymczasowych są wspólne. Wdrożenie musi zapewnić jednego writera dla danego STATE_FILE, również podczas restartów. Testy nie obejmują nakładających się instancji.
3. Stan w pamięci przed zapisem
To właściwe zachowanie dla cache będącego optymalizacją. Restart ze starszego pliku powoduje ponowny skan; nie przenosi środków ani nie wykonuje wiadomości ponownie.
Pozostają założenia wcześniejszego modelu: poprawny fingerprint konfiguracji, dostępna historia RPC oraz postęp skanowania. Starszy cache może wydłużyć uruchomienie i okres UNKNOWN. Atomowy rename chroni czytelników przed częściowym JSON-em, ale nie dowodzi najnowszego checkpointu po awarii całego systemu.
4. Dwa zapisy a pula I/O
Dwa zawieszone zapisy mogą zająć dwa wątki robocze. Przy domyślnej puli czterech wątków nie wyczerpują jej samodzielnie.
Limit nie izoluje całego I/O. Dalsze zawieszone odczyty activity.json lub inne operacje mogą zużyć pozostałe wątki. Budżet zadania nie oznacza anulowania zablokowanego wywołania systemowego. Test FIFO potwierdza konkretny przypadek dwóch zapisów, nie odporność na całkowitą awarię systemu plików.
Do wdrożenia: lokalny, sprawny filesystem, jedna instancja monitora oraz sprawne alarmy cache i świeżości. Jeżeli wymagana jest odporność na całkowicie zawieszony dysk, I/O cache trzeba izolować procesowo.
5. Świeżość sald
Poprawiona w sprawdzanych miejscach:
- balanceObservedAt pochodzi z zakończonej obserwacji;
- tick() ocenia świeżość w chwili publikacji;
- endpoint metryk ponownie liczy wiek;
- balance_alarm jest wygaszany po przekroczeniu wieku obserwacji.
severity=WARN pozostaje wynikiem ostatniego przebiegu i nie jest przeliczane przy każdym odczycie metryk. Może więc chwilowo współistnieć z balance_alarm=0 i balance_stale=1. Nie wywołuje pauzy; alarm sald korzysta z osobnej metryki.
Odpowiedzi 6–11 — strona v40
6. Dwie karty, wyjątki i odświeżenie
Zwykła wysyłka jest poprawnie serializowana:
- Web Lock zdobywany jest przed przygotowaniem;
- ifAvailable odrzuca konkurujące żądanie zamiast kolejkować drugi podpis;
- S.lock blokuje ponowne wejście w tej samej karcie;
- wyjątek zwalnia Web Lock;
- brak Web Locks blokuje wysyłkę;
- zamknięcie karty zwalnia lock, ale pozostawiona rezerwacja ma blokować kolejną operację.
Nie jest to jeszcze pełna gwarancja wobec wszystkich ścieżek modyfikujących rekord — R9-01 i R9-02.
7. Własność w guardOp()
Dla zarezerwowanego transferu kontrolowane są opId oraz owner === TAB_ID. Kontrola działa przed podpisem EVM, przed podpisem X1 i po podpisie X1 przed rozesłaniem.
Approve EVM następuje wcześniej, zanim op.reserved zostanie ustawione. Chronią je Web Lock i zamrożone parametry, ale nie kontrola własności trwałego rekordu.
8. Czy wszystkie modyfikacje są warunkowe?
Nie:
- migracja po RPC używa bezwarunkowego writeOp();
- ręczne odblokowanie wywołuje bezwarunkowe clearOp();
- clearOpIf() porównuje ID, lecz nie rewizję.
Pozostałe główne ścieżki — heartbeat, uzgadnianie, obsługa błędów wysyłki i zakończenie track() — sprawdzają tożsamość operacji. Operacje odczyt–sprawdzenie–zapis localStorage nie są jednak transakcją między kartami; wszystkie konkurujące modyfikacje powinny stosować wspólną serializację.
9. Błąd zapisu i F5
Transfer mostowy nie otwiera podpisu bez odczytanej rezerwacji. Wyjątkiem w literalnym pytaniu o „każdy podpis” jest wcześniejsze approve.
Dla EVM:
- hash niezapisany do storage pozostaje widoczny i kopiowalny;
- S.unsaved blokuje kolejną wysyłkę w tej karcie;
- po F5 S.unsaved znika, ale poprawnie zachowany wcześniejszy rekord signing przechodzi w stan nieznany i nadal blokuje wysyłkę.
Nie można zagwarantować odzyskania hasha po F5, jeśli jego trwały zapis zawiódł. Użytkownik powinien go skopiować. Przy całkowitej utracie lub usunięciu storage strona nie ma trwałego dowodu operacji.
Dla X1 nieudany zapis podpisu w onSigned zatrzymuje wykonanie przed pierwszym rozesłaniem.
10. Migracja i weryfikacja trasy
Ethereum sprawdza nadawcę receipt, wynik transakcji, dispatch Mailbox od naszego routera oraz sąsiedni DispatchId. ID jest odtwarzane z transakcji.
Brak danych RPC podczas migracji pozostawia dane do ponowienia. Nadal istnieje wyścig z nową operacją — R9-01.
X1 sprawdza płatnika i pobiera finalną transakcję, ale obecność programu w kontach i tekst logu nie uwierzytelniają trasy — R9-03.
11. Finalizacja X1
Sprawdzone ścieżki send() i reconcile() uznają sukces albo porażkę dopiero przy confirmationStatus === "finalized".
- Błąd przy confirmed pozostaje oczekujący.
- Sukces przy confirmed również pozostaje oczekujący.
- Limit dwóch minut po zobaczeniu niesfinalizowanej transakcji kończy się unknown.
- Wygaśnięcie blockhasha bez rozstrzygnięcia historii nie oznacza porażki.
To prawidłowa poprawka.
Testy — pytanie 12
Testy uruchomiono z Pythonem -B, bez zapisów poza usuwanym katalogiem tymczasowym. Testy sieciowe używały lokalnych atrap; auto-pauza używała atrapy cast.
Polecenie	Wynik
python3 -B -m unittest indexer/test_activity.py indexer/test_api.py	33 testy, OK
node --test monitoring/test/*.mjs	72 zaliczone, 0 błędów, 1 pominięty
bash monitoring/test/auto-pause.test.sh	11 zaliczonych, 0 błędów
node --test frontend/tests/core.test.mjs	28 zaliczonych, 0 błędów
git diff --check 1f7311a..2d0462d	Bez uwag


Pominięty test wymaga cast.
Ograniczenia deklaracji testów:
- Test Web Locks sprawdza tekst źródła, a nie rzeczywiste wykonanie dwóch kart.
- Test sameOp() nie dowodzi, że każda ścieżka zapisu i usunięcia go stosuje.
- Testy writera dowodzą kolejności w jednej instancji, nie między restartującymi się, nakładającymi procesami.
- Test FIFO obejmuje dwa zawieszone zapisy; nie dowodzi odporności całej puli I/O.
- Brakuje publicznych testów negatywnych dla logu podszywającego się pod dispatch X1 oraz potwierdzonych tu wyścigów migracji i ręcznego odblokowania.
Prywatnych testów przeglądarkowych nie miałem w tym zakresie do odczytu; ich wyniki pozostają do weryfikacji.
Rekomendacja — pytanie 13
Tak — po udokumentowanej próbie wykonania pauzy według §3a można przeprowadzić kontrolowaną próbę DRY_RUN=0 z rzeczywistym kolektorem na testnecie.
Warunki przed próbą:
1. Jedna instancja monitora korzystająca z danego STATE_FILE.
2. Potwierdzone niezależne RPC, zgodna sieć, pełna historia i zakończony pełny skan.
3. Świeże wyniki zadań oraz działające alarmy utraty obserwowalności.
4. Operator obecny, potwierdzone adresy obu kierunków pauzy i przygotowane ręczne wznowienie.
5. Ograniczony czas próby i zapis wyników: wykryte ID lub zmiana minta, metryki, receipt pauzy oraz stan obu kierunków.
Próba powinna objąć zdrowy ruch bez fałszywej pauzy, a następnie kontrolowany przypadek naruszenia na wydzielonej trasie testowej. Nie należy osłabiać walidacji współdzielonej trasy z cudzymi środkami.
Znaleziska R9-01…R9-03 wymagają poprawy strony, ale nie blokują izolowanej próby monitora i wykonania pauzy. Ta rekomendacja dotyczy nadzorowanej próby testnetowej, nie bezobsługowego wdrożenia produkcyjnego.