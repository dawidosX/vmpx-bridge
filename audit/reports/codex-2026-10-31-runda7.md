Audyt rundy 7 — zakres a5ea49b..fcc2acc
Rekomendacja: pozostawić rzeczywisty kolektor w DRY_RUN=1. Większość poprawek rundy 6 jest prawidłowa, ale nadal istnieją ścieżki przeoczenia naruszenia. Strona v38 poprawia obsługę portfeli i śledzenie, lecz nie zapewnia jeszcze deklarowanej ochrony przed zmianami przed podpisem ani ponownym wysłaniem po F5.
Stan repozytorium na początku i na końcu:
- Commit: fcc2accfe8f1630a3b8b19e037fa4116546be019.
- git status: drzewo czyste, main wyprzedza origin/main o 7 commitów.
- Nie zmieniałem, nie tworzyłem ani nie usuwałem plików. Bez transakcji, operacji na kluczach i zapytań do sieci.
Przeczytałem model auto-pauzy, raport rundy 6 i jego ocenę. Poniższe ścieżki prowadzą do wskazanego repozytorium.
Znaleziska
ID	Waga	Plik:linia	Opis	Scenariusz ataku lub awarii	Zalecana poprawka
R7-01	Średnie	[monitor-core.mjs (line 66)](../../monitoring/src/monitor-core.mjs:66), :70–75; [monitor.mjs (line 177)](../../monitoring/src/monitor.mjs:177)	Kontrola minta jest niezależna od błędu sald, ale nadal zależy od ukończenia wcześniejszego kolektora dowodów. Timeout późniejszego odczytu może również przekreślić już wykryty dowód.	Kolektor zużywa cały budżet przebiegu. check() przerywa wykonanie przed readMint() — zmiana authority pozostaje niesprawdzona. Odwrotnie: dowód jest już zebrany, lecz zawieszony odczyt salda powoduje abort i zastąpienie wyniku przez UNKNOWN. Potwierdziłem pierwszy przypadek: liczba wywołań readMint() wyniosła zero.	Rozdzielić kontrolę minta, dowody wiadomości i salda na niezależne zadania z osobnymi budżetami. Nie odrzucać już potwierdzonego naruszenia przez awarię pomocniczego odczytu lub zapisu cache.
R7-02	Średnie	[evidence.mjs (line 126)](../../monitoring/src/evidence.mjs:126), :139, :179	Drugie źródło jest używane dopiero dla znalezionego kandydata. Pominięty przez główne źródło Process może nigdy nie zostać kandydatem. Okno naprawcze obejmuje tylko 256 bloków.	RPC przez ponad 256 bloków pomija log rzeczywistego unlocka bez burna, zwracając poprawne odpowiedzi bez błędu. Kursor przechodzi dalej. Po naprawieniu RPC blok wypada poza okno, a drugie źródło nie zostaje zapytane o pominiętą wiadomość.	Zapewnić niezależną kontrolę kompletności skanu: okresowy pełny przegląd, uzgadnianie zbiorów obu źródeł lub równoległe skanowanie przez drugie źródło. Nie ograniczać naprawy do ostatnich 256 bloków.
R7-03	Średnie	[evidence.mjs (line 168)](../../monitoring/src/evidence.mjs:168), :187–189; [monitor.mjs (line 85)](../../monitoring/src/monitor.mjs:85)	mint-from-foreign-sender potwierdzany jest warunkiem braku jakiegokolwiek DispatchId. Istniejący dispatch obcego nadawcy blokuje potwierdzenie naruszenia.	Jeśli program tokena zaakceptuje wiadomość nieuprawnionego nadawcy, jej ID może prawidłowo istnieć w publicznym Mailbox Ethereum. Oba źródła zwracają true, więc monitor utrzymuje unconfirmed, chociaż problemem jest właśnie obcy nadawca. Potwierdzone scenariuszem w pamięci. Nie jest to dowód, że obecny program X1 pozwala na taki mint.	Dla tego rodzaju naruszenia potwierdzać treść wiadomości i niezgodność nadawcy/domeny, zamiast wymagać braku DispatchId. Oddzielić tę ścieżkę od mint-without-lock.
R7-04	Niskie	[monitor-core.mjs (line 83)](../../monitoring/src/monitor-core.mjs:83), :87–88; [activity.py (line 169)](../../indexer/activity.py:169), :513	Licznik sald resetuje się po przerwie dopiero przy następnym udanym odczycie. Podczas awarii nadal może wygenerować alarm. Indekser odświeża czas ostatniej kontroli również przy complete=false.	Po jednym niedoborze następuje 1801 sekund awarii. Monitor zwraca balanceAlarm=true, mimo braku kolejnych obserwacji. W indekserze seria niekompletnych przebiegów może zachować początek licznika i pozwolić na natychmiastowy alarm po odzyskaniu kompletności.	Oceniać przerwę także przy nieudanym odczycie; wygaszać bieżący alarm lub oznaczać go jako nieaktualny. Nie zaliczać niekompletnych obserwacji do ciągłości pełnego rozliczenia.
R7-05	Średnie	[app.js (line 616)](../../frontend/www/app.js:616), :623–625, :1256–1257; [x1.js (line 189)](../../frontend/www/x1.js:189), :198	Pomiędzy kontrolą przygotowanej operacji a podpisem pozostają operacje asynchroniczne bez ponownego sprawdzenia generacji. Zmiana kwoty, odbiorcy i kierunku nie zwiększa opGen. Testowany opKey() nie jest używany przez app.js.	Użytkownik zmienia konto podczas odczytu allowance albo podczas pobierania blockhasha X1. Kod nadal otwiera podpis. W EVM sendTx() korzysta z bieżącego S.account, a parametry transferu pochodzą ze wcześniejszego formularza. Zmiana formularza może także rozjechać aktualne podsumowanie z operacją oczekującą na podpis.	Utrwalić pełny zestaw parametrów operacji, użyć go również jako from i porównywać po ostatnim await przed wywołaniem portfela. Zmiany formularza mają unieważniać operację albo pola powinny być zablokowane. Powtórzyć kontrolę po otrzymaniu podpisu X1 przed wysłaniem.
R7-06	Średnie	[app.js (line 630)](../../frontend/www/app.js:630), :631, :946–948; [core.js (line 27)](../../frontend/www/core.js:27)	Trwały zapis operacji powstaje dopiero po potwierdzeniu transakcji i uzyskaniu ID. Blokada wysyłki istnieje tylko w pamięci karty.	Transakcja została wysłana, ale receipt lub ID nie są jeszcze dostępne. F5 usuwa blokadę i lokalny hash; rekord do wznowienia nie istnieje. Użytkownik może wykonać nowy transfer. Tak samo dzieje się, gdy operacja zakończy się komunikatem o nieznanym wyniku przed zapisem ID.	Zapisywać etap operacji od chwili uzyskania hasha/podpisu, także bez ID wiadomości. Po F5 najpierw uzgadniać wynik tej transakcji i odzyskiwać ID. Dla nieznanego wyniku wymagać świadomego rozstrzygnięcia przed ponowieniem tej samej operacji.
R7-07	Średnie	[x1.js (line 222)](../../frontend/www/x1.js:222), :223; [core.js (line 105)](../../frontend/www/core.js:105); [app.js (line 953)](../../frontend/www/app.js:953)	Wygaśnięcie blockhasha jest traktowane jako pewna porażka, chociaż transakcja mogła wcześniej zostać wykonana.	Jeden backend RPC nie pokazuje statusu, inny zwraca wysokość po wygaśnięciu blockhasha. Kod zgłasza expired, a strona usuwa kontekst wysłania przy klasyfikacji błędu. Wykonana transakcja może wyglądać na nieudaną, co sprzyja ponownemu transferowi.	Po wygaśnięciu przestać rozsyłać transakcję, ale uzgodnić podpis przez historię transakcji i odpowiedni commitment. Bez rozstrzygnięcia zachować UNKNOWN oraz podpis.
R7-08	Niskie	[app.js (line 900)](../../frontend/www/app.js:900), :926, :940–941	Podgląd opłat X1 jest używany bez limitu wieku i bez ponownego porównania kosztu przed podpisem.	Użytkownik pozostawia formularz otwarty. Parametry opłat zmieniają się, ale klucz podglądu pozostaje taki sam. Kontrola XNT porównuje saldo ze starym quote.total; podpisywana operacja może kosztować więcej niż pokazano.	Nadać podglądowi krótki okres ważności. Przed podpisem ponownie oszacować koszt i wymagać akceptacji istotnej zmiany. Jeżeli program obsługuje limit opłaty, umieścić go w transakcji.


Pewność ustaleń: wysoka dla opisanych ścieżek kodu. R7-03 zakłada wcześniejsze naruszenie kontroli nadawcy po stronie programu tokena; nie stwierdzam takiego naruszenia w programie X1.
Stan poprawek R6-01…R6-07
ID	Stan	Uzasadnienie
R6-01	Częściowo	Kandydaci wymagają dodatkowych odczytów; brak źródła, błąd lub niezgodność dają unconfirmed. Nadal nie ma pełnej kontroli kompletności zbioru kandydatów — R7-02. Dwa puste odczyty pozostają założeniem zaufania do RPC.
R6-02	Usunięte	validTime() odrzuca null, brak wartości, NaN, nieprawidłowy typ i czasy poza zakresem. Nieprawidłowy czas prowadzi do błędu lub unresolved, nie do dowodu.
R6-03	Usunięte	Resolver przegląda instrukcje główne i CPI, dopasowuje wiadomość po hashu oraz rozróżnia noHistory, noMatch i badTime.
R6-04	Usunięte dla nakładania przebiegów RPC	Jest wspólny AbortSignal, kontrola przerwania między etapami i oczekiwanie na rzeczywisty koniec przebiegu. Kolektor pracuje na kopii, zapis używa pliku tymczasowego, fsync i rename. Pozostaje problem niezależności wyników — R7-01.
R6-05	Częściowo	Błąd odczytu lockboxa nie usuwa już wyniku klasyfikacji minta. Kolektor nadal może uniemożliwić samo wykonanie tej kontroli — R7-01.
R6-06	Częściowo	Metryki dowodów i sald są rozdzielone; UNKNOWN nie jest maskowany przez WARN. Licznik nadal ma nieprawidłowe zachowanie podczas awarii i niekompletności — R7-04.
R6-07	Usunięte w sprawdzanym zakresie	Receipt jest dekodowany do wszystkich Dispatch. ON CONFLICT DO UPDATE zmienia pola wysyłki i zachowuje delivered, dane dostarczenia i opłaty. Testy obejmują wiele wiadomości i istniejące dostarczenie.


Odpowiedzi na pytania 1–10 — monitor i auto-pauza
1. Potwierdzenie w dwóch źródłach
Dla kandydatów wiadomości kod wymaga zgodnych dodatkowych odczytów:
- mint bez locka: obecność PDA w obu źródłach X1 i brak DispatchId w obu źródłach Ethereum;
- unlock bez burna: obecność ProcessId w obu źródłach Ethereum oraz brak burna w głównej i dodatkowej liście X1.
Nie wszystkie odczyty są celowane: brak DISPATCH na X1 nadal sprawdzany jest przez zbiorczą listę kont.
Pusty wynik drugiego źródła Ethereum:
- dla DispatchId jest traktowany jako potwierdzenie braku; sam nie wystarczy do fałszywego CRITICAL, jeżeli pierwsze źródło zwraca istniejący dispatch;
- jeśli oba źródła pomijają istniejący dispatch, fałszywy CRITICAL pozostaje możliwy;
- dla ProcessId pusty wynik blokuje potwierdzenie rzeczywistego unlocka i daje unconfirmed.
Kod sprawdza sieć i wysokość finalizacji, ale nie dowodzi niezależności operatorów ani kompletności historii. Pozwala również skonfigurować te same źródła. Deklaracja z fcc2acc o sprawdzeniu ethPandaOps jest dokumentacją operacyjną; aktualne działanie i niezależność źródeł są do weryfikacji, bez wykonywania sieci w tym audycie.
2. Nieprawidłowe czasy
Tak — sprawdzone przypadki prowadzą do nieznanego stanu lub odrzucenia przebiegu, nie do CRITICAL wynikającego z błędnego czasu.
3. Kursor i reorg
Jest ponowny skan 256 bloków. Błąd nie zatwierdza kopii stanu. Fingerprint obejmuje chain ID, genesis X1, adresy trasy, domeny i FROM_BLOCK; granica wdrożenia jest sprawdzana przez eth_getCode. ethProcess zbierany jest tylko do finalized.
Nie ma okresowego pełnego uzgodnienia historii. Ciche pominięcie starsze niż okno może pozostać trwałe — R7-02.
4. Resolver X1
Poprawiony: wszystkie instrukcje, CPI, dopasowanie po ID i osobne przyczyny nierozpoznania. Limit historii skutkuje noHistory. RPC, które po cichu zwraca niepełną historię, nadal nie daje dowodu jej kompletności.
5. Anulowanie, nakładanie i zapis
Poprawione dla wywołań RPC. Nie ma już Promise.race pozostawiającego aktywny tick() w tle. Zapis cache jest atomowy względem czytelników.
Operacje plikowe nie są przerywane sygnałem; zablokowany odczyt lub zapis pliku może zatrzymać przebieg. Powinien wtedy zadziałać alarm braku świeżego wyniku.
6. Kontrola minta
Niezależna od błędu sald, ale nie od czasu wykonania całego kolektora — R7-01.
7. Ciągłość 30 minut i osobne metryki
Osobne metryki i alarmy są prawidłowe. Pełna ciągłość poprawnych obserwacji nadal nie jest zapewniona — R7-04. Saldo nie generuje auto-pauzy.
8. Indekser
W sprawdzanym zakresie poprawiony: wszystkie wiadomości z receipt, idempotentne scalanie i zachowanie dostarczenia.
9. auto-pause.sh
Sprawdzone w kodzie:
- PAUSE_ISM i PAUSE_HOOK są obowiązkowe; brak oznacza kod 2;
- pauseAll() poprzedza diagnostykę;
- wysłanie jest ponawiane i ograniczone czasowo;
- oba kierunki muszą zwrócić paused=true;
- nieudane wysłanie lub potwierdzenie kończy się kodem 1;
- stare CRITICAL nie wystarcza do działania.
Rzeczywiste uprawnienia, dostępność polecenia timeout, środki na gas i dostarczanie alarmów są do weryfikacji wdrożeniowej.
10. Próba DRY_RUN=0
Tak dla izolowanej próby wykonania pauzy z syntetycznymi metrykami. Nie rekomenduję jeszcze próby akceptacyjnej całego mechanizmu z rzeczywistym kolektorem.
Próbę wykonania można przeprowadzić z operatorem obecnym, zatwierdzonymi adresami testnetu, świeżymi syntetycznymi metrykami i przygotowanym ręcznym wznowieniem. Należy potwierdzić receipt oraz pauzę obu kierunków.
Przed próbą rzeczywistego kolektora trzeba przede wszystkim zamknąć R7-01 i R7-02, poprawić potwierdzanie obcego nadawcy oraz wykazać niezależność i kompletność obu źródeł.
Odpowiedzi na pytania 11–18 — strona v38
11. Approve
Nowe approve ustawia dokładnie kwotę transferu. Nie znalazłem generowania max uint. Przy wystarczającym istniejącym allowance kod pomija approve.
Nie oznacza to, że istniejące allowance zostaje zmniejszone do kwoty transferu — wcześniej udzielone większe uprawnienie pozostaje.
12. Kontrole przed każdym podpisem
Nie w pełni. Są kontrole chain ID, konta, salda, allowance i opłaty VMPX, ale pozostają wyścigi między nimi a wywołaniem portfela — R7-05. X1 nie odświeża kosztu przed podpisem — R7-08.
Zdarzenia EVM i zmiana adresu Wallet Standard zwiększają generację. Zmiana właściwości konta Wallet Standard bez zmiany adresu nie musi jej unieważnić. Zmiany formularza również nie korzystają z deklarowanego opKey().
13. Portfel i sieć X1
Kod wymaga konta deklarującego solana:* i 32-bajtowego klucza. Wysyłka używa stałego RPC X1, sprawdza genesis, właściciela wskazanego minta i wykonywalność wskazanego programu. Kontrola jest cache’owana przez minutę.
Nie można podmienić minta przez formularz lub URL. Sam portfel nie dowodzi sieci; x1SignChain() wybiera etykietę Solana testnet/devnet, natomiast rzeczywistą sieć rozsyłania określa aplikacja. Zachowanie i opis podpisu w konkretnych portfelach są do weryfikacji.
14. Śledzenie i localStorage
PDA strony jest zgodne z monitorem — test przeszedł. Śledzenie używa ID; po 20 minutach zmienia komunikat i kontynuuje sprawdzanie.
Walidacja odrzuca nieprawidłowe ID i niebezpieczne formaty hashów/podpisów. Nie znalazłem XSS z tych zapisów. Nie potwierdza jednak związku poprawnie sformatowanego ID z podaną transakcją ani użytkownikiem; przyszły timestamp również jest akceptowany. Podmieniony lokalny zapis może więc pokazywać stan cudzej wiadomości.
Wznowienie działa dopiero po zapisie rekordu z ID — R7-06.
15. Podwójna wysyłka
Blokada działa synchronicznie dla podwójnego kliknięcia i Enter w tej samej karcie. Nie obejmuje F5 ani drugiej karty. Nie gwarantuje jednej transakcji w całym wskazanym scenariuszu.
16. Wynik nieznany
Zwykły błąd po wysłaniu jest traktowany ostrożniej niż wcześniej. Wyjątkiem jest expired — R7-07. Ponadto hash nie jest trwale zapisywany na tym etapie, a blokada po błędzie zostaje zwolniona — R7-06.
17. Domyślny odbiorca
Ręcznie wpisany inny odbiorca jest zachowywany. Domyślny odbiorca zmienia się wraz z portfelem docelowym; pojawia się komunikat o zmianie portfela.
Nie ma jednak obowiązkowego ponownego zatwierdzenia odbiorcy, a wyścigi R7-05 mogą pozostawić różnicę między aktualnym formularzem a wcześniej uchwyconymi parametrami.
18. CSP i XSS
W index.html nie znalazłem inline JS, inline CSS ani atrybutów obsługi zdarzeń. Skrypty, biblioteka i fonty są lokalne. Nowe komunikaty używają tekstu lub escapowania; nie potwierdziłem XSS przez nowe parametry URL lub zapis śledzenia.
Nie mogę potwierdzić aktywnych script-src/style-src/font-src 'self': sprawdzany kod strony nie ustanawia tych nagłówków, a konfiguracja odpowiedzi serwera nie została tu potwierdzona. To pozostaje do weryfikacji.
Testy
Wykonałem wyłącznie testy niewymagające zapisu i połączeń sieciowych.
Zakres	Wynik
python3 -B -m unittest indexer/test_activity.py	22/22 OK
Monitoring: evidence, monitor-core, invariant, keccak	46 zaliczonych, 1 pominięty, bez błędów
node --test frontend/tests/core.test.mjs	15/15 OK
indexer/test_api.py	Nie uruchomiono: tworzy katalogi i pliki bazy, zmienia timestamp pliku
monitoring/test/hang.test.mjs, state.test.mjs	Nie uruchomiono: zapisują pliki tymczasowe i uruchamiają serwery
bash monitoring/test/auto-pause.test.sh	Nie uruchomiono: tworzy i usuwa pliki oraz uruchamia lokalny serwer
git diff --check a5ea49b..HEAD	Bez uwag


Pominięty test keccak wymaga cast. Nie raportuję pełnych zestawów jako wykonanych.
Testy deklarujące więcej, niż sprawdzają:
- Test unieważniania przy zmianie kwoty i odbiorcy sprawdza opKey(), którego aplikacja nie używa.
- Test „przed każdym podpisem” sprawdza funkcję pomocniczą, nie wyścigi rzeczywistych handlerów.
- Test blokady wysyłki obejmuje pojedynczy obiekt w pamięci, nie F5 ani wiele kart.
- Test kontroli zmienionego minta modeluje błąd kolektora, nie wyczerpanie przez niego budżetu czasu.
- Test przerwy w saldach obejmuje kolejny udany odczyt, nie alarmowanie podczas trwającej awarii.
- Atrapy potwierdzeń w testach dowodów nie sprawdzają rzeczywistej niezależności, retencji ani cichego przycinania RPC.
- Test auto-pauzy zastępuje timeout atrapą, więc nie dowodzi rzeczywistego przerywania zawieszonego cast.
Najważniejszy warunek dalszych prac: potwierdzone naruszenie nie może ginąć przez awarię pomocniczego odczytu, a kompletność wykrywania nie może zależeć wyłącznie od 256-blokowego okna jednego źródła.