Audyt — runda 6, zakres C
Rekomendacja: jeszcze nie włączać DRY_RUN=0 dla automatu korzystającego z rzeczywistych dowodów monitora. Potwierdziłem scenariusze fałszywego CRITICAL oraz przeoczenia naruszenia. Testy istniejące w repozytorium przechodzą, ale nie obejmują tych przypadków.
Audyt wykonałem tylko do odczytu, bez transakcji i operacji na kluczach. Przeczytałem model z docs/16-auto-pause-model.md, raport rundy 5 i jego ocenę.
- Początek: b00e84316035e63d1eb949c10dd7551602267d98; drzewo czyste.
- Koniec: 802c48ed44bb9f780abb35dc79d6024b1fbd9660; drzewo czyste.
- Podczas audytu repozytorium zostało zaktualizowane poza moimi działaniami. Dodatkowy commit zmienia filtry strony, index.html i testy API. Poniższe ustalenia dotyczą zakresu 9908c6c..b00e843.
Znaleziska
Ścieżki w tabeli odnoszą się do repozytorium evmpx-x1-bridge (lokalne ścieżki zastąpione względnymi przy archiwizacji).
ID	Waga	Plik:linia	Opis	Scenariusz ataku lub awarii	Zalecana poprawka
R6-01	Średnie	[evidence.mjs (line 68)](../../monitoring/src/evidence.mjs), :76, :125–132	Brak logu lub konta jest traktowany jako dowód braku operacji, mimo że kompletność odpowiedzi RPC nie jest udowodniona. Dla Ethereum kursor zostaje przesunięty również po poprawnej technicznie, lecz przyciętej odpowiedzi.	Zdrowy lock i mint istnieją. RPC zwraca pustą listę Dispatch, ale udostępnia PROCESSD. Monitor zgłasza mint-without-lock. Przywrócenie prawidłowego RPC nie naprawia już przeskanowanego zakresu; pominięcie pozostaje w zapisanym stanie. Analogicznie niekompletna lista kont X1 może spowodować unlock-without-burn.	Nie uznawać samej nieobecności w odpowiedzi za dowód. Przed CRITICAL uzyskać niezależne potwierdzenie kompletności właściwego zakresu albo dodatkowo zweryfikować brakujący odpowiednik. Zapewnić ponowne skanowanie i naprawę kursora. Weryfikować FROM_BLOCK względem wdrożenia i obsługiwanej historii.
R6-02	Średnie	[evidence.mjs (line 118)](../../monitoring/src/evidence.mjs), :126; [monitor.mjs (line 61)](../../monitoring/src/monitor.mjs)	tx.blockTime nie jest walidowany. W JavaScript null + 120 daje 120, więc brak czasu usuwa ochronę granicy finalizacji.	Zdrowy mint jest już widoczny na X1, ale jego lock nie wszedł jeszcze do odczytanego finalized Ethereum. X1 zwraca transakcję z blockTime: null. Monitor natychmiast zgłasza mint-without-lock, zamiast oczekiwać. Potwierdzone dodatkowym scenariuszem.	Wymagać prawidłowego, skończonego znacznika czasu; brak czasu oznaczać jako UNKNOWN. Walidować również wynik getBlockTime i czas bloków Ethereum. Testować null, brak pola i nieprawidłowe wartości na granicy finalizacji.
R6-03	Średnie	[evidence.mjs (line 112)](../../monitoring/src/evidence.mjs), :113–117; [monitor.mjs (line 51)](../../monitoring/src/monitor.mjs), :61	Resolver wybiera tylko pierwszą instrukcję InboxProcess z instrukcji głównych transakcji. Nie wyszukuje wiadomości po ID w całej transakcji i pomija instrukcje wewnętrzne.	Transakcja zawiera dwie operacje InboxProcess; naruszenie dotyczy drugiej. Resolver stale porównuje pierwszą wiadomość i pozostawia właściwą jako unresolved. Ten sam problem występuje przy wywołaniu przez CPI. Przycięta historia lub limit 5000 podpisów również mogą uniemożliwić znalezienie transakcji utworzenia konta.	Przeglądać wszystkie właściwe instrukcje główne i wewnętrzne, dopasowując hash wiadomości do ID konta PROCESSD. Rozróżnić brak historii od braku pasującej instrukcji. Dodać testy wielu wiadomości, CPI i przekroczenia limitu historii.
R6-04	Średnie	[monitor.mjs (line 104)](../../monitoring/src/monitor.mjs), :108–120; :73	Timeout całego przebiegu przez Promise.race nie przerywa tick(). Po timeoutcie poprzedni przebieg może nadal działać, gdy zacznie się następny.	Duża liczba kolejnych, powolnych wywołań RPC przekracza TICK_TIMEOUT, mimo że każde mieści się w swoim limicie. Monitor publikuje UNKNOWN, ustawia running=false, a stary przebieg dalej modyfikuje wspólny stan i może zapisać go równolegle z nowym.	Przekazać wspólny sygnał anulowania do wszystkich operacji i sprawdzać go między etapami. Nie rozpoczynać kolejnego przebiegu, dopóki poprzedni faktycznie się nie zakończy. Aktualizować stan dopiero po ukończeniu zaakceptowanej obserwacji.
R6-05	Średnie	[monitor-core.mjs (line 40)](../../monitoring/src/monitor-core.mjs), :41, :74–76	Kontrola parametrów minta zależy od powodzenia późniejszego odczytu lockboxa. Wynik readMint() przepada, jeżeli readLocked() rzuci wyjątek.	X1 zwraca zmienione mintAuthority, ale RPC Ethereum jest niedostępne. b pozostaje null, więc mintIssues=[]. Przy braku innych dowodów wynik może mieć severity=OK z readOk=false, zamiast CRITICAL dla wykrytej zmiany uprawnienia. Potwierdzone dodatkowym scenariuszem.	Oddzielić kontrolę minta od porównania sald. Klasyfikować otrzymane dane X1 natychmiast i zachowywać ten wynik niezależnie od dalszych błędów.
R6-06	Niskie	[monitor-core.mjs (line 70)](../../monitoring/src/monitor-core.mjs), :72, :79–82; [activity.py (line 163)](../../indexer/activity.py)	Licznik 30 minut nie wymaga ciągłości poprawnych obserwacji. Ponadto WARN sald ma pierwszeństwo przed UNKNOWN dowodów.	Jeden niedobór, następnie długa przerwa w odczytach i kolejny przebieg wystarczają do alarmu „trwałego” niedoboru. W monitorze alarm może powstać nawet podczas nieudanego odczytu sald. Utrzymujące się unresolved przy aktywnym WARN nie buduje licznika UNKNOWN.	Zdefiniować dopuszczalną przerwę między obserwacjami; po jej przekroczeniu resetować albo zawieszać licznik. Nie naliczać czasu z niekompletnych danych. Eksportować i alarmować stan dowodów niezależnie od stanu sald.
R6-07	Niskie	[activity.py (line 543)](../../indexer/activity.py), :547, :575–579	Odtworzenie po reorgu wybiera pierwszy Dispatch lockboxa z receipt. INSERT OR REPLACE może usunąć zapisane już informacje o dostarczeniu nowego ID.	Receipt zawiera wiele wiadomości albo nowy rekord istnieje już jako dostarczony. Ponowne sprawdzenie starego, wcześniej zmintowanego rekordu zachowuje go, a następnie zastępuje rekord nowego ID bez delivered i pozostałych niewymienionych kolumn. Potwierdziłem wyzerowanie dostarczenia istniejącego rekordu.	Dekodować wszystkie właściwe wiadomości i uzgadniać je z rekordami bez wybierania pierwszej. Zastąpić REPLACE idempotentnym scalaniem, zachowując niezależnie potwierdzone dostarczenie. Zapewnić stabilny stan starego, osieroconego depozytu.

Odpowiedzi dotyczące modelu dowodów
Zdrowy most może wygenerować fałszywy dowód. R6-01 i R6-02 są konkretnymi przykładami. Margines 120 sekund pomaga przy opóźnieniu finalizacji, ale nie dowodzi kompletności historii i nie zabezpiecza przed nieprawidłowym czasem.
Istotne są także następujące ograniczenia:
- Restart: zapisany kursor zachowuje wcześniej pominięte logi. Stan nie jest związany z identyfikatorem sieci, adresami trasy i FROM_BLOCK. Ponowne użycie STATE_FILE po zmianie konfiguracji wymaga odrzucenia lub jawnej migracji stanu.
- Wiadomości sprzed FROM_BLOCK: jeśli odpowiadające im konta X1 są nadal widoczne, brak historycznego Dispatch może zostać uznany za naruszenie. Poprawność granicy wdrożenia jest warunkiem działania modelu.
- Reorg Ethereum: Dispatch jest skanowany do finalized, ale Process także w oknie niefinalnym. Zapamiętane ethProcess nie są usuwane po osieroceniu bloku. Stan nie jest więc wyłącznie zbiorem kanonicznych, finalnych dowodów.
- Częściowy przebieg: kolektor modyfikuje wspólny obiekt przed ukończeniem całej obserwacji. Późniejszy błąd nie cofa tych zmian; R6-04 dodatkowo umożliwia równoległe modyfikacje.
Mechanizm może przeoczyć naruszenie. R6-03 pozwala pozostawić właściwą wiadomość jako unresolved bez końca. Ponadto model wykrywa określone niespójności wiadomości, a nie każdą możliwą zmianę ekonomiczną: mint wykonany przez zmieniony program bez odpowiedniego PROCESSD, zawyżony mint przy prawidłowym ID lub wypłata poza monitorowaną ścieżką wymagają innych kontroli.
Parowanie i identyfikatory
- Parowanie zdarzeń przez następny logIndex odpowiada kolejności emisji w sprawdzonej implementacji Mailbox: Dispatch → DispatchId oraz Process → ProcessId. Zgodność wdrożonego bytecode’u pozostaje do weryfikacji.
- Konto PROCESSD jest sprawdzane względem oczekiwanego PDA. Przypadkowe konto o podobnych danych poza PDA nie jest przyjmowane jako dowód.
- Wiadomość do innego odbiorcy jest pomijana po prawidłowym odtworzeniu treści. Problemy resolvera mogą jednak utrzymywać ją jako unresolved.
- DISPATCH z innym nadawcą nie trafia do zbioru burnów tej trasy. Nie powinien przykryć braku właściwego burna.
- Dopasowanie ID do prawidłowego Dispatch pozwala pominąć pobieranie starej transakcji X1: keccak obejmuje całą wiadomość. To poprawne przy zaufaniu do implementacji Mailbox i danych RPC. Ta sama wartość ID nie może odpowiadać innej treści bez kolizji hashującej lub naruszenia tych założeń.
Keccak i zależności
Sprawdzone bez uwag:
- używany jest keccak_256, nie SHA3-256;
- konwersja wejścia na bajty i wyniku na hex jest poprawna;
- @noble/hashes ma przypiętą wersję 2.4.0;
- lockfile zawiera integrity; jest to jedyna zależność;
- wektory obejmują krótkie wejścia, granicę bloku i rzeczywistą wiadomość Hyperlane.
Testy wystarczają do sprawdzenia użycia funkcji hashującej. Nie potwierdzają kompletności historii ani poprawności resolvera.
Stan R5-01…R5-07
ID	Stan	Uzasadnienie
R5-01	Częściowo	index.complete pozostaje heurystyką i nie dowodzi pełnego rozliczenia zobowiązań. Usunięto jego wpływ na automatyczną pauzę z powodu salda.
R5-02	Usunięte	[app.js (line 691)](../../frontend/www/app.js): actFresh wymaga obecnego index i complete === true. Brak pola prowadzi do stanu nieznanego. Sprawdzone teksty EN/PL odpowiadają nowemu modelowi.
R5-03	Usunięte w zakresie auto-pauzy	Sam niedobór salda nie prowadzi do CRITICAL; końcowa klasyfikacja nadpisuje wynik pomocniczego porównania. Wyścigi sald nadal mogą wpływać na alarm dla operatora.
R5-04	Częściowo	Dodano timeouty RPC, czas ukończenia wyniku i osobny czas CRITICAL. Automat sprawdza oba czasy. Timeout całego przebiegu nadal nie anuluje pracy — R6-04.
R5-05	Usunięte w kodzie dla nowej bazy	Start nie importuje starych rekordów; unhashed_rows blokuje deklarację kompletności indeksu. Faktyczne zastąpienie bazy produkcyjnej bazą przebudowaną od wdrożenia jest do weryfikacji.
R5-06	Częściowo	ID, kwota i odbiorca są odtwarzane z receipt. Pozostają błędy wielu Dispatch oraz zastępowania istniejącego rekordu — R6-07.
R5-07	Usunięte	pauseAll() jest wysyłane przed diagnostyką; są ponowienia, limity czasu i niezerowy kod wyjścia po niepowodzeniu wysłania lub potwierdzenia pauzy.

Saldo, obserwowalność i wykonanie pauzy
Saldo nie wywołuje już automatycznej pauzy w sprawdzonym kodzie. Po 30 minutach generuje WARN. Reguła alarmowa sald nie ma działania pauzującego. Faktyczna konfiguracja odbiorców alertów poza repozytorium jest do weryfikacji.
b00e843 prawidłowo zachowuje przyczynę błędu dowodów: wynik sald nie nadpisuje już wcześniej zgromadzonych powodów błędu.
Auto-pauza:
- odrzuca stare wyniki i CRITICAL nieodpowiadające ostatniemu ukończonemu wynikowi;
- przy DRY_RUN=0 próbuje wysłać pauseAll() przed odczytami diagnostycznymi;
- ponawia nieudane wysłanie;
- po wyczerpaniu prób kończy się kodem 1;
- wykrywa niepotwierdzoną lub częściową pauzę, jeśli skonfigurowano oba adresy diagnostyczne.
Nie gwarantuje to wysłania transakcji: niedostępne RPC, błędne konto, hasło, brak środków lub brak działającego polecenia timeout mogą zatrzymać wykonanie. Wdrożenie musi zapewnić alarmowanie o kodzie wyjścia i komunikacie ALERT.
Dodatkowo PAUSE_ISM i PAUSE_HOOK są opcjonalne: pominięcie adresu pomija kontrolę, mimo końcowego komunikatu o obu kierunkach. Dla próby wymagającej potwierdzenia pełnej pauzy oba powinny być obowiązkowe.
Testy i ich ograniczenia
Uruchomienie odbyło się bez zapisu do repozytorium; Python z -B. Pliki tymczasowe testów zostały usunięte.
Polecenie	Wynik
python3 -B -m unittest indexer/test_activity.py indexer/test_api.py	23 testy, OK — przed zewnętrznym commitem dodającym kolejne testy API
node --test monitoring/test/*.mjs	29 zaliczonych, 0 błędów, 1 pominięty — opcjonalne porównanie z cast
bash monitoring/test/auto-pause.test.sh	9 zaliczonych, 0 błędów — atrapa cast, bez transakcji

Testy wymagające lokalnego gniazda uruchomiłem ponownie po ograniczeniu środowiska blokującym nasłuch. Końcowe wyniki są podane powyżej.
Testy deklarują szerszą ochronę, niż faktycznie wykazują:
- test zawieszonego RPC nie dowodzi anulowania długiego przebiegu z wieloma kolejnymi żądaniami;
- test przyciętej historii nie obejmuje trwałego pominięcia logów Ethereum po przesunięciu kursora;
- testy resolvera nie obejmują wielu InboxProcess ani CPI;
- test reorga ze zmienionym nonce nie obejmuje istniejącego już, dostarczonego rekordu nowego ID;
- testy auto-pauzy sprawdzają kolejność i ponowienia, ale atrapa timeout nie dowodzi rzeczywistego przerywania zawieszonego procesu.
Dodatkowe scenariusze potwierdziły R6-01, R6-02, R6-03, R6-05, naliczanie czasu przez przerwę w R6-06 oraz utratę delivered w R6-07.
Rekomendacja dotycząca kontrolowanej próby DRY_RUN=0
Nie rekomenduję jeszcze próby opartej na celowym fałszywym mincie i rzeczywistym kolektorze dowodów. Przed nią należy:
1. Usunąć fałszywe CRITICAL opisane w R6-01 i R6-02.
2. Dopasowywać wszystkie instrukcje po ID, także wewnętrzne — R6-03.
3. Zapewnić faktyczny brak nakładania przebiegów — R6-04.
4. Oddzielić kontrolę uprawnień minta od odczytu sald — R6-05.
5. Potwierdzić konfigurację trasy, historię od wdrożenia, świeży stan monitora oraz oba adresy diagnostyczne.
Można wcześniej wykonać oddzielną próbę samego wykonania pauzy: podać izolowanemu automatowi syntetyczne, świeże metryki CRITICAL, przy obecnym operatorze i przygotowanym ręcznym wznowieniu. Taka próba sprawdzi uprawnienia, wysłanie transakcji i oba kierunki pauzy; nie będzie potwierdzeniem bezpieczeństwa modelu dowodów.
Do weryfikacji poza kodem pozostają: kompletność i retencja RPC, wdrożone programy i Mailbox, uprawnienia konta pauzującego, rzeczywiste odtworzenie bazy, konfiguracja alarmów oraz działanie pauzy i wznowienia on-chain.
