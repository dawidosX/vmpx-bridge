Audyt runda 4 — eVMPX Sepolia ⇄ X1
Zakres: bde42dc..d097e81 — potwierdzone 13 commitów, 32 pliki.
Commit końcowy: d097e81845bb8630a6cd9c1a7697c16452281977.
Drzewo: czyste; lokalny main wyprzedza origin/main o dwa commity.
Nie zmieniłem żadnych plików. Nie wykonywałem transakcji, operacji sieciowych na kluczach ani kontroli on-chain. Pominąłem wskazane katalogi build/cache.
Wykonałem testy bez zapisu: 14/14 testów indeksera i 17/17 testów logiki monitora. Dodatkowe odtworzenia w pamięci potwierdziły opisane poniżej braki. Nie uruchamiałem Foundry ani testów API tworzących pliki tymczasowe.
Nie potwierdziłem znalezisk Krytycznych ani Wysokich. Nie zalecam jeszcze włączania automatycznej pauzy jako jedynej ochrony: pozostają zarówno ścieżki fałszywego alarmu, jak i niewykrycia niedoboru.
Tabela znalezisk
Numery linii odnoszą się do d097e81. Pewność ustaleń z kodu jest wysoka; stan rzeczywistego wdrożenia oznaczam osobno.
ID	Waga	Plik:linia	Opis	Scenariusz ataku/awarii	Zalecana poprawka
R4-01	Średnie	[monitor-core.mjs (line 49)](../../monitoring/src/monitor-core.mjs), :55–67; [activity.py (line 620)](../../indexer/activity.py), :690	Świeży indeks jest traktowany jako kompletny. Indekser wykrywa niepełny odczyt X1 przez x1_complete=False, ale nie publikuje tego pola w activity.json. Monitor sprawdza wiek dokumentu, nie kompletność danych. Strona również wymaga tylko świeżego znacznika czasu.	Odczyt kont X1 pomija nowe burny; indeks publikuje świeży dokument. Dla lockboxa 100, podaży 60 i brakującego w indeksie burnu 50 monitor zwraca OK, choć brakuje 10. Przy DRY_RUN=0 pauza nie nastąpi.	Publikować kompletność i punkty odczytu indeksu. Monitor i blokada wysyłki powinny wymagać kompletności; jej brak oznacza UNKNOWN oraz alarm, nigdy potwierdzenie pokrycia. Samo porównanie liczby kont z poprzednią rundą również nie dowodzi kompletności.
R4-02	Średnie	[monitor-core.mjs (line 47)](../../monitoring/src/monitor-core.mjs), :59–65; [activity.py (line 513)](../../indexer/activity.py)	Dwa przebiegi nie zapewniają spójności snapshotów. Zmiana Ethereum na latest usuwa wcześniejszy konkretny problem finalności, ale równoległe odczyty dwóch łańcuchów nadal mogą przedstawiać różne momenty. Indekser dodatkowo odczytuje salda po skanowaniu dostarczeń.	Zdrowy most: saldo Ethereum zostaje odczytane przed nowym lockiem, a podaż X1 już po odpowiadającym mincie. Dwa takie przebiegi — wskutek ruchu lub opóźnionego backendu RPC — dają WARN, następnie CRITICAL. DRY_RUN=0 może zatrzymać zdrowy most.	Powiązać obserwacje z blokami/slotami i konkretnymi wiadomościami. Przed pauzą potwierdzić niedobór na ponownie uzgodnionych danych. Dodać testy zmian stanu pomiędzy wywołaniami czytników, nie tylko gotowych wartości na początku ticka.
R4-03	Średnie	[monitor.mjs (line 53)](../../monitoring/src/monitor.mjs), :57–58; [alerts.rules.yml (line 17)](../../monitoring/alerts.rules.yml); [auto-pause.sh (line 15)](../../monitoring/auto-pause.sh)	Utrata możliwości sprawdzania pokrycia może pozostać bez alarmu. Tick zwracający UNKNOWN aktualizuje last_ok_timestamp. Reguły nie alarmują na severity 3. Gdy odczyt salda rzuci wyjątek, eksportowany pozostaje poprzedni wynik.	Pada źródło activity.json lub odczyt dostarczeń. Monitor stale zwraca UNKNOWN, lecz wygląda na świeży; nie działa MonitorStale ani auto-pauza. Przy awarii głównego RPC poprzednie OK pozostaje do alarmu staleness, a automat po przekroczeniu 120 s jawnie nie podejmuje działania. Rzeczywisty niedobór może więc nie spowodować pauzy.	Oddzielić czas próby, udanego odczytu i kompletnego rozliczenia. Alarmować na trwałe UNKNOWN, błędy i brak metryk. Jawnie ustalić politykę awaryjną: alarm do człowieka albo pauza po określonej utracie obserwowalności. Nie oznaczać UNKNOWN jako ostatniego poprawnego sprawdzenia.
R4-04	Średnie	[activity.py (line 554)](../../indexer/activity.py), :565–566; [test_activity.py (line 105)](../../indexer/test_activity.py)	Reorg jest pomijany, gdy finalizacja zdąży przekroczyć zmieniony blok. reorg_check() sprawdza tylko rekordy z numerem większym niż aktualny fin. Nie rozróżnia rekordu już zweryfikowanego jako finalny od starego rekordu, który właśnie znalazł się poniżej tej granicy.	Indekser zapisuje blok 100 z hashem A. Podczas przerwy blok zostaje zastąpiony hashem B, a finalizacja dochodzi do 100. Kolejna runda pomija rekord. Usunięty depozyt lub cofnięte dostarczenie pozostaje w bazie.	Każdy rekord tymczasowy zweryfikować ostatni raz przed uznaniem za finalny; przechowywać jawny stan finalizacji. Dodać test awansu fin po reorgu. Obecny test test_finalized_rows_are_not_rechecked utrwala brak tej kontroli.
R4-05	Średnie	[invariant.mjs (line 38)](../../monitoring/src/invariant.mjs); [monitor.mjs (line 24)](../../monitoring/src/monitor.mjs)	R-02 nadal otwarte: monitor uprawnień nie został wdrożony w kodzie. Dokumentacja teraz uczciwie oznacza go jako plan. WATCHED_EVM_EVENTS nie jest wykonywane, a monitor pokrycia nie sprawdza zmian walidatorów ISM, właścicieli ani kodu programów.	Przejęty owner zmienia walidatorów w tym samym programie ISM. Mint authority pozostaje bez zmian. Nie ma obiecanej reakcji na zmianę konfiguracji; alarm pokrycia może nadejść dopiero po skutkach ataku.	Zrealizować oddzielny monitor przypiętej konfiguracji i kodu, wraz z alarmami oraz testem reakcji. Do tego czasu nie uznawać R-02 za zamknięte ani automatu pokrycia za jego zamiennik.
R4-06	Niskie	[index.html (line 9)](../../frontend/www/index.html), :10–11	Wymóg braku zewnętrznych zasobów nie jest spełniony. Header v33 pobiera CSS Google Fonts i inicjuje połączenia do Google. Nie jest to zewnętrzny JavaScript.	Przy restrykcyjnym style-src/font-src fonty zostaną zablokowane; przy ich dopuszczeniu strona zależy od zewnętrznego dostawcy i ujawnia mu połączenie użytkownika.	Usunąć odwołania albo serwować fonty lokalnie. Zachować script-src 'self'; nie poszerzać go z powodu fontów. Rzeczywiste nagłówki CSP: do weryfikacji, bo repo nie zawiera ich konfiguracji.
R4-07	Niskie	[DeployEth.s.sol (line 249)](../../evm/script/DeployEth.s.sol), :252–254; [docs/15-key-custody.md (line 177)](../../docs/15-key-custody.md)	Kontrola „deployer bez uprawnień” obejmuje tylko część ról. check() wyklucza cztery role Timelocka, lecz nie wyklucza deployera z pauserów ani jako priceUpdater. Krok 2B dotyczy Timelocka; przeniesienie guardiana i uprawnień X1 następuje później.	Po 2B odczyty Timelocka są poprawne, ale stary klucz nadal pauzuje most albo kontroluje EmergencyPauser/X1. Ogólny komunikat o pełnym odebraniu uprawnień byłby błędny.	Rozdzielić odbiór kroku 2B od odbioru całej migracji. Sprawdzić guardian/pendingGuardian, pauserów, price updater, wszystkie authority X1 i role wewnętrznych Safe. Dopuszczone wyjątki opisać jawnie. Stan faktyczny po 2B: do weryfikacji.
R4-08	Niskie	[bridge-api.py (line 111)](../../indexer/bridge-api.py), :124–133	Cache statystyk można omijać nieistotnymi parametrami. Klucz zawiera całe qs, ale endpoint ignoruje nieznane parametry. Semafor ogranicza obliczenia, nie liczbę oczekujących wątków HTTP.	Żądania ?days=90&x=1, x=2 itd. za każdym razem omijają cache i uruchamiają skan historii. Ochrona zależy wtedy od semafora, limitów systemd i reverse proxy.	Odrzucać nieznane parametry i budować klucz z unormowanych days/bot. Ograniczyć także oczekujące żądania. Rzeczywiste limity nginx: do weryfikacji.
R4-09	Niskie	[app.js (line 310)](../../frontend/www/app.js), :57,166	Panel pokrycia nadal używa uproszczonego wzoru i może przeczyć alarmowi. renderLedger() porównuje tylko lockbox z podażą. Komunikaty insolventMsg EN/PL również mówią wyłącznie o podaży, chociaż status obejmuje transfery w drodze.	Dla 100 lockbox / 60 podaż / 50 pending status może alarmować o niedoborze, a panel sald jednocześnie wyświetlać „Fully backed”. Darowizna może być opisana jako transfer w drodze.	Dla werdyktu pełnego pokrycia używać kompletnego rozliczenia zobowiązań. Proste porównanie sald oznaczyć jako takie. Poprawić oba tłumaczenia i rozdzielić nadwyżkę od kwot w drodze.
R4-10	Niskie	[auto-pause.sh (line 17)](../../monitoring/auto-pause.sh)	Sprawdzenie „już wstrzymany” dotyczy tylko unlocków. Gdy PAUSE_ISM jest wstrzymany, skrypt pomija pauseAll, nie sprawdzając hooka depozytów.	Guardian wcześniej wznowił wyłącznie depozyty przez unpause(true,false). Występuje realny niedobór, lecz automat uznaje most za już wstrzymany i pozostawia depozyty otwarte.	Sprawdzać oba kierunki albo wywoływać idempotentne pauseAll() przy każdym świeżym CRITICAL.
R4-11	Info	[docs/15-key-custody.md](../../docs/15-key-custody.md); audit/reports/codex-2026-10-31-runda3.md	Publiczne materiały ujawniały szczegóły topologii floty walidatorów. [Szczegóły usunięte przy publikacji.] To informacja zachowana z poprzedniej wersji, nie nowy wyciek klucza.	Dane ułatwiają rozpoznanie wspólnej domeny awarii i przygotowanie ataku organizacyjnego.	Publicznie opisać ryzyko korelacji bez szczegółów infrastruktury.


Rzeczy sprawdzone bez uwag oraz status regresji
Poprawki R-01–R-11 i DeployEth v2
- R-01 — poprawione. Discriminator jest sprawdzany na stałym przesunięciu, wymagana inicjalizacja i minimalna długość; dla PROCESSD sprawdzany jest PDA powiązany z ID. Test z markerem osadzonym w DISPATCH przechodzi.
- R-02 — nadal otwarte. Poprawiono opis stanu wdrożenia; samego monitora uprawnień jeszcze nie ma — R4-05.
- R-03 — częściowo poprawione. Wzór uwzględnia oba kierunki i monitor pobiera pending. Pozostaje problem kompletności — R4-01.
- R-04 — częściowo poprawione. Usunięto porównanie starego finalized Ethereum z szybkim mintem X1. Nie rozwiązano ogólnej spójności obserwacji — R4-02.
- R-05 — poprawione w obsłudze błędu RPC. Nieudany odczyt usuwa S.lim; przed podpisem wymagany jest sukces wymuszonego odczytu i świeżość indeksu. Kompletność indeksu pozostaje oddzielnym problemem.
- R-06 — wskazane braki poprawione. Mint jest powiązany z PDA programu tokena, sprawdzany jest właściciel wewnętrznego konta IGP oraz upgrade authority programu IGP.
- R-07 — częściowo poprawione. Dodano hashe bloków, ponowne skanowanie i cofanie dostarczeń. Pozostaje luka przy awansie finalizacji — R4-04.
- R-08 — poprawione. Runbook i testy opisują atomowy batch: zwiększenie limitu → konkretne process() → przywrócenie limitu; błąd powoduje rollback całego batcha. Testów Foundry nie uruchamiałem.
- R-09 — poprawione dla błędu odczytu. Nieznana opłata blokuje wysyłkę; ponowny odczyt i zmiana stawki przerywają operację przed approve. Nadal nie ma kontraktowego ograniczenia minimalnego netto — to wcześniej przyjęte ograniczenie.
- R-10 — poprawione. Dodano chainChanged i sprawdzenie eth_chainId przed każdym eth_sendTransaction, osobno dla zgody i transferu.
- R-11 — częściowo poprawione. Cache i semafor ograniczają koszt. Pozostaje możliwość omijania cache i zależność od reverse proxy — R4-08.
DeployEth v2: poprawka jest obecna i spójna z modelem:
- hook ma feeBps=0, min=max=stale=0.0002 ether;
- setBridgeFee() jest wywoływane przed przekazaniem właściciela;
- mainnet wymusza 300 bps i profil atestatorów 5/7;
- skarbiec jest wymagany i oddzielony od beneficjenta hooka;
- właściciele routera, ProxyAdmin, hooka i limitera są sprawdzani;
- dodano testy 1000 → 30/970/970, stałej opłaty i niedokończonego wdrożenia.
Nie stwierdziłem regresji w samym potrącaniu opłaty VMPX. Źródło routera nie zostało zmienione w audytowanym zakresie.
Frontend, SVG, CSP i EN/PL
- W index.html jest lokalny <script src="app.js?v=33" defer>.
- Nie znalazłem inline JavaScriptu ani atrybutów zdarzeń HTML.
- favicon.svg zawiera geometrię i gradient; bez skryptów, foreignObject, event handlerów i odwołań zewnętrznych.
- Biblioteka portfela Solana jest ładowana lokalnie z kontrolą SRI.
- Klucze słowników EN i PL są zgodne; zgodne są również klucze bChk.
- W standardowych odpowiedziach API nie potwierdziłem ścieżki XSS przez adres, tx lub kwotę: używane są escapowanie, textContent, formatowanie liczb i kontrola URL.
- Nie potwierdzam odporności na dowolnie sfałszowany JSON: np. tabela statystyk interpoluje niektóre pola bez escapowania. Aktualne API generuje je jako daty i liczby, więc nie znalazłem źródła sterowanego przez publiczne wejście użytkownika.
- CSP script-src 'self' — do weryfikacji. W repo nie ma definicji nagłówka ani odpowiedniej polityki w <meta>. Komentarz w JS nie potwierdza polityki serwera.
- Brak zewnętrznych fontów nie jest spełniony — R4-06.
- Wygląd headera przy konkretnych szerokościach nie był weryfikowany w przeglądarce.
Indexer/API i stany
- Wyszukiwanie używa fullmatch, ograniczenia długości i parametrów SQL.
- Fragmenty zapytań są wybierane ze stałych wariantów; nie znalazłem SQL injection.
- Limity: 25 rekordów strony, maksymalnie 1000 stron, 50 wyników wyszukiwania, 1–90 dni statystyk i maksymalnie 10 pól query.
- API otwiera snapshot tylko do odczytu; publikacja snapshotu i JSON jest atomowa.
- Wzór matematyczny jest prawidłowy:lockbox − (podaż X1 × 1e9 + pending ETH→X1 + pending X1→ETH)
- Pierwszeństwo stanów jest prawidłowe: potwierdzony insolvent → paused → delays → live. Nazwa implementacyjna to delays, nie delayed.
- Niekompletne dane indeksera dają nieznaną ocenę pokrycia zamiast True. Problem polega na nieprzekazaniu tej informacji odbiorcom — R4-01.
Monitor i DRY_RUN=0
Z kodu wynika następujące zachowanie:
Sytuacja	Wynik
Prawidłowo rozpoznany niedobór w dwóch tickach	CRITICAL; świeże metryki i DRY_RUN=0 prowadzą do próby pauseAll.
Nieprawidłowa mint authority, freeze authority lub rozszerzenia	Natychmiast CRITICAL.
Brak/stare dane activity, ale aktualne salda	UNKNOWN, chyba że sam lockbox jest poniżej podaży; brak automatycznej pauzy na UNKNOWN.
Błąd RPC salda	Poprzedni wynik pozostaje; po przekroczeniu wieku metryk automat nie działa.
Niespójne odczyty powtórzone dwa razy	Możliwa fałszywa pauza — R4-02.
Niepełny, ale świeży indeks	Możliwe fałszywe OK — R4-01.
Nieudana transakcja pauzy	set -e kończy skrypt błędem; rzeczywiste ponowienia zależą od konfiguracji uruchamiania — do weryfikacji.


Nie uruchamiałem auto-pause.sh, także w trybie DRY_RUN.
Role po kroku 2B
Plan 2A → 2B jest logicznie poprawny: Safe najpierw uzyskuje role, następnie sam planuje i wykonuje odebranie ról deployerowi. TIMELOCK_ADMIN_ROLE powinien pozostać wyłącznie przy Timelocku.
Sam krok 2B nie kończy migracji wszystkich uprawnień. Guardian jest przenoszony w kroku 3, uprawnienia X1 w kroku 5, a skarbce w kroku 6. Do potwierdzenia po migracji pozostają:
- wszystkie cztery role Timelocka dla deployera i starego guardiana;
- brak niezamierzonego otwartego executora;
- właściciele kontraktów, guardian/pendingGuardian i pauserzy;
- moduły i właściciele obu Safe;
- wcześniej zaplanowane operacje Timelocka;
- wszystkie owner/upgrade authority X1.
Brak payloadu i odczytów faktycznej operacji 2B uniemożliwia potwierdzenie wykonania.
Wycieki
- W sprawdzonych śledzonych plikach nie znalazłem potwierdzonych rzeczywistych kluczy prywatnych, seedów, PEM ani identyfikatorów dostępu AWS.
- Nie znalazłem śledzonych plików .env, keypairów ani keystore’ów.
- Zachowano ujawnienie szczegółów topologii — R4-11 (usunięte przy publikacji).
- Poza audytowanym diffem pozostają stare ścieżki środowiska wykonawczego: audit/tools/slither.json:15, audit/tools/slither.txt:1 oraz scripts/run-all-tests.sh:6. To ścieżki typu „historyczna ścieżka środowiska testowego”, nie potwierdzone dane produkcyjnej floty.
- Pełna historia Git i pliki ignorowane nie zostały objęte pełnym skanem sekretów. Brak znaleziska w bieżących plikach nie potwierdza ich braku w historii.
- Stan uruchomionych usług, polityki CSP/nginx, role on-chain i poprawność wdrożonego programu X1 pozostają do weryfikacji.