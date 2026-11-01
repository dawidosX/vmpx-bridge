Audyt rundy 8 — zakres bcb5318..80983ff
Poprawki istotnie wzmacniają monitor. Pozostają jednak luki w blokadzie operacji strony oraz możliwość zatrzymania publikacji CRITICAL przez zawieszony zapis cache.
Rekomendacja: przed próbą DRY_RUN=0 z rzeczywistym kolektorem usunąć R8-01. Izolowana próba samego wykonania pauzy według runbooka jest zasadna.
Na początku i na końcu:
- Commit: 80983ff7c8c8045cbe94dc11a39ae7c09873167a.
- Drzewo czyste; main wyprzedza origin/main o 14 commitów.
- Bez zmian w repozytorium, transakcji i operacji na kluczach. Zapisy testów ograniczyłem do usuwanych katalogów tymczasowych.
Przeczytałem raport rundy 7, jego ocenę, model auto-pauzy oraz podsumowanie testów społeczności.
Znaleziska
ID	Waga	Plik:linia	Opis	Scenariusz ataku lub awarii	Zalecana poprawka
R8-01	Średnie	[monitor.mjs (line 196)](../../monitoring/src/monitor.mjs:196), :202–205	Zapis cache nie ma budżetu czasu i poprzedza aktualizację znaczników świeżego wyniku oraz CRITICAL. Obsłużono wyjątek zapisu, ale nie jego zawieszenie.	tick() wykrywa naruszenie. open, zapis, fsync albo rename zawiesza się. Metryka severity może już wskazywać CRITICAL, lecz last_critical_timestamp pozostaje stary. Auto-pauza odrzuca wynik jako niepotwierdzony lub nieaktualny. Kolejne przebiegi nie startują.	Publikować wynik i jego znaczniki czasu przed pomocniczym zapisem cache. Zapis ograniczyć czasowo i odseparować tak, aby spóźnione zakończenie nie zastępowało nowszego stanu. Dodać test zapisu, który nigdy nie kończy się, obok istniejącego testu wyjątku.
R8-02	Średnie	[app.js (line 726)](../../frontend/www/app.js:726), :744, :1046, :1070, :1438	Blokada między kartami nie jest atomowa. Sprawdzenie rekordu następuje przed wieloma await, a rezerwacja dopiero przed podpisem. Zdarzenie storage nie unieważnia rozpoczętej operacji.	Dwie karty sprawdzają brak operacji i równolegle wykonują przygotowanie. Pierwsza zapisuje signing. Druga otrzymuje zdarzenie, lecz jej handler nadal działa i później nadpisuje rekord, otwierając drugi podpis. Heartbeat tego wyścigu nie rozwiązuje.	Zdobywać blokadę między kartami przed pierwszym przygotowaniem, np. przez Web Locks. Rekord powinien mieć unikalne ID operacji i właściciela. Utrata własności musi zatrzymywać handler przed podpisem i rozesłaniem.
R8-03	Średnie	[app.js (line 654)](../../frontend/www/app.js:654), :668–694; :634	Asynchroniczne uzgadnianie używa starego rekordu, ale usuwa lub zastępuje aktualny bez sprawdzenia jego tożsamości.	Uzgadnianie operacji A czeka na RPC. Tymczasem użytkownik lub druga karta rozpoczyna B. Odpowiedź dla A wskazuje revert albo innego nadawcę, więc clearOp() usuwa B. Potwierdziłem w pamięci usunięcie nowszego rekordu B przez wynik A.	Przed każdym zapisem lub usunięciem sprawdzać unikalne ID i wersję operacji. Serializować uzgadnianie; unieważniać stare wywołania po zmianie rekordu lub konta.
R8-04	Średnie	[app.js (line 633)](../../frontend/www/app.js:633), :744–746, :1070–1073	Błędy localStorage.setItem() są ignorowane. Wysyłka trwa dalej mimo braku trwałego rekordu.	Zapis jest zablokowany lub przekroczono limit pamięci. Transakcja zostaje wysłana, ale hash/podpis nie jest zachowany. F5 usuwa stan w pamięci i umożliwia ponowną wysyłkę bez uzgodnienia poprzedniej.	Sprawdzać powodzenie rezerwacji przed podpisem; przy braku możliwości zapisu blokować wysyłkę z komunikatem. Nie maskować błędu zapisu hasha; zachować widoczny stan nieznany i zapewnić użytkownikowi identyfikator transakcji.
R8-05	Niskie	[app.js (line 704)](../../frontend/www/app.js:704), :707–709	Migracja usuwa stary rekord przed uzyskaniem danych z łańcucha.	RPC chwilowo zwraca null albo błąd. Stary wpis znika, nowy nie powstaje. Śledzenia nie można wznowić po kolejnym odświeżeniu. Potwierdzone scenariuszem w pamięci.	Usuwać stary rekord dopiero po skutecznym zapisaniu i sprawdzeniu nowego albo po jednoznacznym odrzuceniu danych. Brak danych RPC powinien pozostawić migrację do ponowienia.
R8-06	Niskie	[app.js (line 659)](../../frontend/www/app.js:659), :709	Rekord tracking omija weryfikację nadawcy transakcji. Migracja sprawdza nadawcę, ale nie związek zapisanego ID z transakcją.	Rekord zawiera adres podłączonego portfela, lecz hash i ID innej operacji. Strona rozpoczyna śledzenie i może pokazać cudze dostarczenie jako zakończenie tej operacji. Potwierdziłem przejście do track() bez żadnego odczytu nadawcy. Nie daje to uprawnień do środków.	Po odczycie niezaufanego rekordu uzgodnić transakcję, nadawcę, trasę i ID wiadomości. Podczas migracji odtworzyć ID z transakcji zamiast ufać staremu polu.
R8-07	Niskie	[monitor-core.mjs (line 79)](../../monitoring/src/monitor-core.mjs:79), :105, :112–113	Świeżość sald oceniana jest czasem początku przebiegu, a nie publikacji wyniku.	Saldo zostaje odczytane szybko, lecz kolektor dowodów działa kolejne 180 sekund. Przy publikacji balanceStale=false, mimo przekroczenia progu 120 sekund. Potwierdziłem taki wynik wraz z aktywnym alarmem sald.	Zapisywać rzeczywisty czas zakończenia obserwacji sald. Świeżość obliczać przy publikacji i eksporcie metryk, używając bieżącego czasu.


Pewność ustaleń jest wysoka dla opisanych ścieżek kodu. R8-01 dotyczy zawieszenia operacji plikowej; zwykły błąd zapisu jest już obsłużony prawidłowo.
Stan R7-01…R7-08
ID	Stan	Uzasadnienie
R7-01	Częściowo	Mint jest pierwszym zadaniem, ma osobny budżet; timeout dowodów lub sald nie usuwa wyniku innego zadania. Wyjątek zapisu również nie zastępuje CRITICAL. Pozostaje zawieszony zapis — R8-01.
R7-02	Usunięte dla opisanego scenariusza	Drugie źródło skanuje samodzielnie, zbiory są porównywane, a pełny przegląd naprawia pominięcia starsze niż 256 bloków. Gwarancja zależy od dostępności historii, postępu przeglądu i co najmniej jednego kompletnego źródła.
R7-03	Usunięte	Obcy nadawca ma osobną ścieżkę potwierdzenia treści przez drugie RPC X1. Istnienie DispatchId nie blokuje już dowodu.
R7-04	Częściowo	Trwająca awaria unieważnia licznik; indekser przerywa ciągłość po niekompletnym przebiegu. Pozostaje niewłaściwa ocena wieku sald przy długim przebiegu — R8-07.
R7-05	Usunięte w zakresie wyścigów formularza	Parametry są zamrożone, formularz blokowany, guardOp() działa po ostatnim await przed portfelem. X1 sprawdza operację także po podpisie. EVM używa op.from.
R7-06	Częściowo	Hash/podpis zapisywany jest przed dalszym śledzeniem, a nieznany wynik blokuje wysyłkę po F5. Pozostają wyścigi między kartami, spóźnione uzgadnianie i ignorowane błędy zapisu — R8-02…R8-04.
R7-07	Usunięte w zakresie fałszywej porażki po wygaśnięciu	Po wygaśnięciu kod sprawdza historię; brak rozstrzygnięcia daje UNKNOWN, nie porażkę. Pozostaje ograniczenie używania confirmed, opisane poniżej.
R7-08	Usunięte	Podgląd ma ważność 60 sekund. Przed podpisem wykonywana jest nowa symulacja, a saldo XNT porównywane z jej fresh.total.


Odpowiedzi na pytania 1–6 — monitor
1. Niezależność wyników
Kontrola minta rzeczywiście wykonywana jest jako pierwsza, z własnym budżetem. Dowody i salda działają następnie równolegle. Sprawdzone timeouty i błędy tych zadań nie nadpisują potwierdzonego naruszenia.
Wynik publikowany jest jednak dopiero po zakończeniu obu zadań, więc wykryta zmiana minta może czekać na budżet kolektora. Zawieszony zapis cache nadal blokuje świeże znaczniki CRITICAL — R8-01.
2. Zadanie „zombie”
Nie znalazłem ścieżki, w której spóźniony kolektor zatwierdza swoją kopię stanu:
- kontekst RPC jest przenoszony przez AsyncLocalStorage;
- przerwanie dotyczy właściwego zadania;
- kolektor pracuje na kopii;
- przed przekazaniem pendingState wykonuje tctx.check().
Zadanie ignorujące sygnał może istnieć po zakończeniu budżetu, ale jego spóźniony wynik nie zastępuje wyniku runTask(). Nie jest to ogólna gwarancja dla dowolnych przyszłych efektów ubocznych dodanych do zadania.
3. Kompletność skanowania
Dla prawidłowych, dostępnych źródeł poprawka usuwa poprzednią lukę: drugie źródło wykrywa różnicę samodzielnie, a pełny przegląd wraca do starych zakresów.
Nie można obiecać wykrycia każdego pominięcia bez założeń:
- oba źródła mogą pomijać ten sam log;
- źródło może nie udostępniać wymaganej historii;
- kolejne timeouty mogą uniemożliwić postęp pełnego przeglądu;
- stale opóźniony drugi kursor ogranicza zakres porównania.
Przy pustym stanie oba skany wykonują odczyty od FROM_BLOCK; uznanie ich za pierwszy pełny przegląd jest prawidłowe w normalnym przypadku, gdy oba finalizowane heady obejmują wdrożenie. Warunek zapisania doneAt nie sprawdza tego ostatniego jawnie — tuż przed finalizacją wdrożenia znacznik może więc być mylący dla pustego zakresu.
4. Obcy nadawca
Potwierdzenie obejmuje:
- PDA obecne w obu źródłach X1;
- wiadomość odtworzoną przez drugie źródło;
- zgodne ID;
- odbiorcę równą naszemu programowi;
- niezgodną domenę źródłową lub nadawcę.
Wiadomość do innego odbiorcy nie spełnia warunku. Inna domena źródłowa jest celowo uznawana za naruszenie modelu jednej dozwolonej trasy. Założeniem pozostaje wiarygodność RPC i konfiguracji programu.
5. Licznik sald
Pierwotny problem został poprawiony: czas nie rośnie już bez końca podczas awarii, a niekompletne przebiegi indeksera zerują początek ciągłości i nie odnawiają czasu kompletnej kontroli.
Pozostaje R8-07: wynik może być opublikowany ze starym odczytem sald oznaczonym jako świeży. Nie prowadzi to do auto-pauzy.
6. Próba samej pauzy
Runbook ma właściwe zabezpieczenia: izolowane środowisko, syntetyczne metryki, kontrola wersji skryptu, operator obecny, serwer pozostający w DRY_RUN=1 i ręczne wznowienie.
Sprawdzenie verify() przed pauzą, podczas niej i po wznowieniu jest wartościowsze niż same flagi, pod warunkiem użycia tych samych, wcześniej poprawnych danych wejściowych. W przeciwnym razie revert może mieć inną przyczynę.
Do potwierdzenia poza publicznym repozytorium pozostają: prywatny skrypt operatora, egzekwowanie Sepolii i adresów, uprawnienia guardiana, rzeczywiste receipt oraz przyczyny revertów. Próba wykonania nie sprawdza detekcji kolektora ani odporności na awarie RPC.
Odpowiedzi na pytania 7–13 — strona v39
7. Ostatnia kontrola przed podpisem
Poprawka jest prawidłowa dla parametrów formularza i stanu aplikacji. Po ostatnim await EVM synchronicznie sprawdza operację, a następnie wywołuje portfel z zamrożonym from. X1 sprawdza operację przed podpisem i po jego otrzymaniu, przed rozesłaniem.
Pozostaje naturalna granica: strona nie kontroluje zmian wewnątrz portfela po przekazaniu mu żądania. Nie znalazłem jednak poprzedniej ścieżki użycia bieżącego S.account zamiast zamrożonego nadawcy.
8. F5, druga karta i heartbeat
Po skutecznym zapisie rekordu sent F5 nie usuwa blokady. Nie jest to jednak pełna ochrona między kartami — R8-02. Sam heartbeat informuje o aktywności, nie zapewnia wyłączności.
Dwa kliknięcia przy odblokowaniu są świadomą decyzją użytkownika, ale nie dowodem, że nic nie wysłano. Nie anulują też starego żądania portfela w innej karcie. Potrzebna jest tożsamość operacji i unieważnianie starego wykonania.
9. Uzgadnianie wyników
Dla niezmienionego rekordu:
- receipt EVM od innego nadawcy jest odrzucany;
- revert usuwa blokadę i pokazuje porażkę;
- transakcja w mempoolu pozostaje sent;
- nieznany hash pozostaje unknown;
- podpis X1 bez statusu pozostaje unknown.
Nie jest jednak bezpieczne globalne usuwanie rekordu po spóźnionej odpowiedzi — R8-03. Rekord tracking pomija ponadto weryfikację nadawcy — R8-06.
10. Wygaśnięcie blockhasha
Brak statusu po wygaśnięciu nie jest już porażką. searchTransactionHistory: true pozwala szukać starszych podpisów; opóźnione RPC może dać none, co zachowuje stan nieznany.
Kod akceptuje również confirmed, nie tylko finalized. Jest to słabsze niż finalne rozstrzygnięcie historii: dla trwałego uznawania sukcesu lub porażki warto wymagać finalized, szczególnie po rozbieżnościach backendów. Obecne testy nie dowodzą odporności na rollback potwierdzonej transakcji.
11. Wycena X1
60 sekund i próg wymagający jednocześnie wzrostu ponad 10% oraz ponad 0,001 XNT są spójną polityką UX. Kontrola salda używa świeżej wyceny.
Nie jest to limit on-chain: koszt może zmienić się po symulacji, zwłaszcza podczas długiego podpisywania. Warto jasno odróżniać szacunek od gwarantowanej maksymalnej opłaty.
12. Poprawki 80983ff
allowanceReaches() nie wysyła dodatkowej transakcji; oczekiwanie nie otwiera lokalnej blokady, a końcowy guardOp() nadal chroni podpis. Wyjątek RPC przerywa sprawdzanie zamiast wykorzystać cały okres ponowień — może powodować niepotrzebne zatrzymanie, ale nie dodatkowy transfer.
Brak transakcji w X1 nie usuwa już rekordu. To prawidłowa poprawka. Sam inny płatnik uzasadnia odrzucenie podanego rekordu, lecz usuwanie musi dotyczyć tego samego rekordu, którego wynik sprawdzono — R8-03.
13. Dane localStorage i migracja
Nie są zawsze odrzucane:
- readOp() dopuszcza tolerancję czasu z przyszłości do 60 sekund;
- rekord obcego portfela jest ignorowany przy blokowaniu, a nie zawsze usuwany;
- tracking omija sprawdzenie nadawcy transakcji;
- migracja nie odtwarza ID z transakcji i za wcześnie usuwa stare dane.
Formaty ID i hashów ograniczają wstrzyknięcia do linków, ale poprawny format nie dowodzi prawdziwości związku między transakcją, portfelem i ID.
Zmiany CSS odpowiadają deklarowanemu ograniczeniu przepełniania kolumn. Nie wykonywałem wizualnego testu widoku 375 px.
Testy i pytanie 14
Polecenie	Wynik końcowy
python3 -B -m unittest indexer/test_activity.py indexer/test_api.py	33 testy, OK
node --test monitoring/test/*.mjs	65 zaliczonych, 0 błędów, 1 pominięty
bash monitoring/test/auto-pause.test.sh	11 zaliczonych, 0 błędów
node --test frontend/tests/core.test.mjs	23 zaliczone, 0 błędów
git diff --check bcb5318..80983ff	Bez uwag


Pierwsze uruchomienie testów serwerowych zablokował sandbox (listen EPERM). Po dopuszczeniu lokalnego nasłuchu testy przeszły. Używano atrap RPC i cast, bez rzeczywistych transakcji. Pominięty test wymaga zainstalowanego cast.
Ograniczenia pokrycia:
- Test błędu cache sprawdza wyjątek, nie zapis zawieszony bez końca.
- Testy blokady i heartbeat nie uruchamiają dwóch konkurujących handlerów aplikacji.
- Test zamrożonego from częściowo opiera się na dopasowaniu tekstu źródła.
- Brakuje testów spóźnionego reconcileOp(), awarii localStorage oraz utraty rekordu podczas migracji.
- Testy pełnego skanowania używają atrap; nie dowodzą retencji i niezależności wdrożonych RPC.
- Test auto-pauzy zastępuje timeout atrapą, więc nie sprawdza rzeczywistego przerywania zawieszonego cast.
Dodatkowe scenariusze w pamięci potwierdziły R8-03, R8-05, R8-06 i R8-07.
Rekomendacja — pytanie 15
Jeszcze nie rekomenduję próby z rzeczywistym kolektorem jako potwierdzenia gotowości auto-pauzy. Najpierw:
1. Usunąć blokowanie publikacji wyniku przez zapis cache — R8-01.
2. Dodać test zawieszonego zapisu przy już wykrytym CRITICAL.
3. Potwierdzić niezależność źródeł, zgodność historii i postęp pełnego skanowania na wdrożeniu.
4. Wykonać i udokumentować izolowaną próbę samego pauseAll() oraz wznowienia według §3a.
Po tych krokach kontrolowana próba z rzeczywistym kolektorem na testnecie, z operatorem i przygotowanym wznowieniem, będzie uzasadniona. Znaleziska strony R8-02…R8-06 wymagają osobnego zamknięcia; nie blokują izolowanej próby wykonania pauzy.