# Pełny audyt Codex, 1 lis 2026 (1540e22..f464516 + zmiany robocze routera v3)

Krytyczne/Wysokie: nie potwierdziłem nowych znalezisk tych kategorii.
Repo można upublicznić jako projekt testnetowy, z jawną listą poniższych problemów; nie rekomenduję jeszcze uruchomienia mainnetu.
Zakres i stan repozytorium
Audyt przeprowadziłem w <repo>, bez zmian plików, transakcji, operacji na kluczach ani zapytań sieciowych.
- Początek: 1540e224c0f34aafe71c3894b9205d6d86083041; drzewo nie było czyste.
- Koniec: f4645164040b31809f5424fbe611ff35bb47cf46; drzewo nadal nie jest czyste.
- W trakcie audytu równolegle zmieniano repozytorium. Wnioski obejmują odczytany kod oraz zmiany robocze, ale nie stanowią odbioru jednego, niezmiennego commita.
Końcowy git status wykazał pięć zmodyfikowanych plików: DeployEth.s.sol, VmpxCollateralRouter.sol, BridgeBase.t.sol, ForkSepoliaV2.t.sol, ReviewFixes.t.sol, oraz dwa nieśledzone: MaxLocked.t.sol i legacy/VmpxCollateralRouterV2.sol.
Nowe znaleziska
Wagi dotyczą skutków opisanych scenariuszy. Problemy kontroli wdrożenia nie oznaczają, że takie błędne uprawnienia występują obecnie on-chain.
| ID | Waga | Plik:linia | Opis | Scenariusz ataku lub awarii | Zalecana poprawka |
|---|---|---|---|---|---|
| F-01 | Średnie | [alerts-core.mjs (line 80)](../../monitoring/src/alerts-core.mjs:80) | Telegram nie alarmuje o trwałym niedoborze pokrycia. conditions() obsługuje CRITICAL, UNKNOWN i rozbieżności źródeł, ale ignoruje vmpx_bridge_balance_alarm. Reguła istnieje osobno w pliku Prometheusa. | Dowody po ID pozostają poprawne, lecz monitor po 30 minutach niedoboru publikuje WARN i balance_alarm=1. Telegram nie tworzy alarmu. Potwierdziłem bezpośrednim wywołaniem: wynik []. Jeżeli osobny Prometheus/Alertmanager nie dostarcza tego alarmu, operator może go nie otrzymać. | Dodać niezależny warunek alarmowy sald do Telegrama wraz z obsługą nieczytelnych/starych obserwacji. Alternatywnie wymagać i sprawdzać dostarczenie tej reguły przez drugi kanał. Testować niedobór przy poprawnych dowodach oraz przy UNKNOWN. |
| F-02 | Średnie | [check-roles.sh (line 55)](../../evm/script/check-roles.sh:55), [check-roles.sh (line 64)](../../evm/script/check-roles.sh:64) | Odbiór migracji nie dowodzi wyłączności ról ani wymaganego opóźnienia. Sprawdza wskazane konta, ale nie cały zbiór posiadaczy ról. getMinDelay() jest tylko wypisywany. | Dodatkowy administrator/proposer pozostaje po wcześniejszej konfiguracji, albo kontrolowany Timelock ma opóźnienie zero. Oczekiwane konta przechodzą sprawdzenia i licznik błędów pozostaje zerowy. Potwierdziłem atrapą wywołań, bez RPC. | Odtworzyć kandydatów z RoleGranted/RoleRevoked od wdrożenia i sprawdzić dokładne dozwolone zbiory. Wymagać oczekiwanego minimalnego opóźnienia. Brak historii potrzebnej do odbioru powinien kończyć kontrolę błędem. |
| F-03 | Średnie | [check-x1.mjs (line 215)](../../svm/compat/check-x1.mjs:215) | Kontrola X1 pomija istotną konfigurację opłat skrzynki. Odczytuje właściciela outboxa, ale nie sprawdza max_protocol_fee, bieżącej opłaty ani beneficjenta. | Skrzynkę inicjalizuje się z błędnym, niezmiennym sufitem opłaty lub niewłaściwym beneficjentem. Kontrole właścicieli i upgrade authority mogą przejść, mimo niezgodności z profilem mainnetowym. | Dodać wymagane oczekiwania i porównania wszystkich trzech pól. Przy okazji odbioru jawnie sprawdzać genesis hash, lokalną domenę oraz authority i adres metadataPointer; samo sprawdzenie tokenMetadata.updateAuthority nie obejmuje wskaźnika. |
| F-04 | Niskie | [app.js (line 341)](../../frontend/www/app.js:341), [app.js (line 520)](../../frontend/www/app.js:520) | Walidator odbiorcy X1 akceptuje nieprawidłowe adresy base58 i dopełnia je do innego klucza. Sprawdza długość tekstu i rozmiar liczby, zamiast dokładnie 32 zdekodowanych bajtów. | Przykład: 32 znaki 2 przechodzą walidację, chociaż dekodują się do 23 bajtów. Wysłane bytes32 odpowiada innemu, dopełnionemu adresowi. Błędnie skrócony adres może więc otrzymać komunikat „poprawny”, a transfer trafić do niekontrolowanego odbiorcy. | Dekodować base58 z zachowaniem zer wiodących, wymagać dokładnie 32 bajtów i zgodności ponownego kodowania z wejściem. Odrzucać zerowego odbiorcę. Dodać testy skróconych i niekanonicznych adresów. |
| F-05 | Niskie | [app.js (line 319)](../../frontend/www/app.js:319), [x1.js (line 43)](../../frontend/www/x1.js:43) | Odczyty RPC strony nie mają limitu czasu aplikacji. Limity pętli oczekiwania nie przerywają zawieszonego fetch()/odczytu odpowiedzi. | RPC utrzymuje niedokończoną odpowiedź podczas przygotowania lub śledzenia transakcji. Handler i blokada operacji pozostają zajęte; deklarowany czas oczekiwania może nie zadziałać. Nie potwierdziłem możliwości kradzieży środków tą ścieżką. | Dodać AbortSignal i limity pojedynczego żądania oraz całej operacji. Po możliwym rozesłaniu zachować rekord i przechodzić do „wynik nieznany”, z możliwością ponownego sprawdzenia. |
| F-06 | Niskie | [run-all-tests.sh (line 3)](../../scripts/run-all-tests.sh:3), [run-all-tests.sh (line 28)](../../scripts/run-all-tests.sh:28) | Skrypt „wszystkich testów” nie uruchamia wszystkich zestawów i może zakończyć się sukcesem po błędzie. Uruchamia tylko starszy test monitora, pomija m.in. nowe alarmy, auto-pauzę, API i frontend. Nie agreguje błędów; kończy komunikatem written. | CI lub operator uznaje kod wyjścia zero za pomyślny pełny przegląd, mimo nieudanego wcześniejszego zestawu. Skrypt dodatkowo miesza testy offline z zapytaniem do X1 i nadpisuje raport. | Oddzielić zestaw offline od kontroli sieciowych, uruchamiać wszystkie aktualne zestawy i zachowywać ich kody wyjścia. Nie nadpisywać raportu audytowego przy zwykłym uruchomieniu testów. |

F-01–F-04 mają bezpośrednie uzasadnienie w kodzie; F-01, F-02 i F-04 dodatkowo odtworzyłem bez sieci i bez plików.
Sprawdzone obszary bez nowych uwag
Kontrakty EVM
- Opłata routera jest odejmowana od pobranej kwoty; zaokrąglenie opłaty w dół do 1e9 pozostawia również kwotę netto reprezentowalną na X1.
- setBridgeFee() ogranicza stawkę do 500 bps i kontroluje skarbiec. Zmiana wymaga właściciela.
- Własne pola opłat korzystają z przestrzeni ERC-7201. Robocze maxLocked dopisano po istniejących polach.
- Roboczy limit TVL sprawdza saldo po wpłacie netto. Zero zamyka depozyty; wypłaty nie podlegają limitowi.
- Własne ścieżki deposit, mint, addBridge i setRecipient są zablokowane. Nie znalazłem nowej, nieuprzywilejowanej ścieżki wypłaty kolaterału w analizowanym kodzie.
- DeployEth ustawia stałe 0,0002 ETH, opłatę routera przed przekazaniem właściciela oraz mainnetowy profil 5/7 i co najmniej 48 godzin.
- EmergencyPauser oddziela prawo pauzowania od wznowienia. Klucz pausera sam nie otrzymuje prawa zmiany konfiguracji ani przeniesienia tokenów.
Monitor i regresje wcześniejszych rund
Statycznie potwierdziłem mechanizmy poprawek R11: związanie oczekującej transakcji z podpisującym i konfiguracją, dwa świeże źródła dla pominięcia pauzy, znacznik instalacji alarmów, uwzględnianie wyniku kolejki, usunięcie raw transakcji z argumentów procesów oraz korelację po dokładnym tick.
Zachowano także oddzielne budżety zadań, kopiowanie stanu dowodów, publikację wyniku przed zapisem cache, niezależne skanowanie drugiego źródła ETH i potwierdzanie kandydatów po ID.
Nie wynika z tego gwarancja „każde naruszenie zawsze spowoduje pauzę”. Brak dostępnych dowodów, awaria RPC, brak gazu lub niedostępność Ethereum mogą zatrzymać automat. Samo saldo celowo nie uruchamia pauzy. To wymaga działającego alarmowania i reakcji operatora.
Frontend i API
- Nie znalazłem nowego XSS w sprawdzonych ścieżkach renderowania danych API i rekordów operacji.
- Nowe zgody approve są dokładnie na kwotę; istniejące większe allowance nie jest automatycznie zmniejszane.
- Są kontrole konta/sieci przed wywołaniem portfela, kontrola niezmienności podpisanej wiadomości X1, Web Locks i wersjonowane rekordy operacji.
- Zachowano minContextSlot przy weryfikacji konta DISPATCH.
- Zapytania API używają parametrów SQL, dozwolonych formatów wejścia i limitów odpowiedzi.
- Niekompletny indeks nie stanowi potwierdzenia wypłacalności. complete pozostaje uczciwie opisane jako heurystyka.
- Obie wersje językowe mają po 272 klucze, bez brakujących odpowiedników.
- Skrypty, style i fonty strony są lokalne; nie znalazłem inline JS. favicon.svg nie zawiera sprawdzonych aktywnych elementów.
- Suma SHA-256 lokalnego vendora odpowiada plikowi SHA256SUMS.
Nagłówki CSP wdrożonej strony pozostają do weryfikacji. Bez zapytań sieciowych i konfiguracji serwera nie potwierdzam script-src/style-src/font-src 'self' na publicznej domenie.
Sekrety i historia Git
Przeskanowałem historię wszystkich dostępnych referencji: 76 commitów i 385 unikalnych blobów, a także aktualne pliki poza wyłączeniami.
Nie potwierdziłem kluczy prywatnych, rzeczywistych tokenów dostępu ani prywatnych adresów infrastruktury. Kandydaci przypominający tokeny Telegrama występują w testach jako atrapy. Stare ścieżki (historyczna ścieżka środowiska testowego) dotyczą środowiska testowego i były już omawiane we wcześniejszych raportach — nie zgłaszam ich ponownie.
Publiczne adresy kontraktów, role i identyfikatory transakcji są danymi identyfikującymi trasę, nie sekretami. Nie należy jednak traktować skanowania wzorcami jako dowodu nieistnienia każdego możliwego sekretu.
README.md i SECURITY.md jasno opisują testnet, brak wartości tokenów testowych, niezależność projektu oraz przeglądy wyłącznie narzędziami AI. Działanie prywatnego kanału zgłoszeń GitHub wymaga sprawdzenia po stronie ustawień repozytorium.
Wyniki testów i ograniczenia pokrycia
| Sprawdzenie | Wynik |
|---|---|
| python3 -B -m unittest indexer/test_activity.py | 24/24 OK; ostrzeżenia o niezamkniętych zasobach testowych |
| Wybrane zestawy Node wykonywane w pamięci: dowody, rdzeń monitora, alarmy, zapis stanu, niezmienniki, keccak, frontend | 131 zaliczonych, 0 błędów, 1 pominięty |
| Ponowne uruchomienie keccak.test.mjs z dostępnym cast | 3/3 OK, wcześniejsze pominięcie usunięte |
| Kontrola składni wskazanych skryptów Bash, parsowanie Python AST | OK |

Nie uruchomiłem Forge/Rust ani zestawów tworzących pliki, w tym pełnego API i testów powłoki. Zestawy integracyjne Node korzystają też z lokalnych połączeń HTTP. Bez zgody na odstępstwo pozostawiłem w mocy zakaz tworzenia plików i zapytań sieciowych. Nie deklaruję przejścia pełnego zestawu testów.
Istnieją już fuzzing opłat i stanowe niezmienniki z opłatą włączoną. Nadal potrzebne są:
- stanowy test łączący zmianę limitu TVL, opłat, pauzę, darowizny i wiadomości w obu kierunkach;
- testy negatywne odbioru konfiguracji z dodatkową rolą, błędnym opóźnieniem i błędnymi polami outboxa;
- test dostarczenia alarmu niedoboru do operatora;
- rzeczywisty test wielokartowy/reload/rozłączenie portfela;
- testy rzeczywistego programu SVM — EVM HypERC20 jest tylko jego zastępstwem.
Część testów frontendu sprawdza obecność fragmentów kodu wyrażeniami regularnymi. Potwierdzają konstrukcję źródła, ale nie dowodzą braku wyścigów w przeglądarce. Testy Rust dowodzą arytmetyki, nie zachowania wdrożonego programu X1.
Blokery mainnetu z sufitem około 1000 USD
Musi być przed uruchomieniem:
1. Zamrożony commit i komplet testów końcowego kodu. Roboczy router v3 i migracja wymagają kompilacji oraz wykonania testów; sam odczyt dopisanych testów nie wystarcza.
2. Domknięcie F-01–F-03. Alarm niedoboru musi docierać do człowieka, a odbiór wdrożenia musi odrzucać błędne role, opóźnienie i opłaty X1.
3. Rzeczywiście działający nadzór uprawnień. Znany z poprzednich rund monitor konfiguracji nadal nie jest wykonywany przez samą deklarację ADMIN_EVENT_SEVERITY. Upgrade programu X1 może zachować mint authority, a następnie tworzyć tokeny, których prawdziwe burny przejdą normalną ścieżką.
4. Odbiór on-chain całego grafu zaufania: implementacje i zależności, właściciele, role Timelocka, Safe i jego moduły, guardian, pauserzy, konfiguracja ISM, walidatorzy, mint/freeze/metadata authority, IGP i upgrade authority wszystkich programów X1. Stan bieżący jest do weryfikacji.
5. Bezpieczny Squads. Nie opierać głównych uprawnień na programie, którego cudzy pojedynczy upgrade authority może przejąć vault. Zrealizować i zweryfikować opisany własny model oraz opóźnienie.
6. Próby operacyjne: restart z transakcją w mempoolu, rotacja klucza, opóźnione RPC, utrata stanu, awaria alarmów, pauza i ręczne wznowienie po rozliczeniu nonce. Rozstrzygnąć także znaną politykę reorga po zapisaniu done.
7. Limit ryzyka wyrażony poprawnie. maxLocked ogranicza tokeny, nie USD i nie maksymalną stratę po przejęciu administracji. Ustalić konkretny limit tokenów z marginesem cenowym, zgodną pojemność rate limitera i warunki jego zmiany.
8. Separacja kluczy i nadzoru. Udokumentowany próg nie daje niezależności, jeżeli wspólne konto administracyjne może użyć większości kluczy. Alarm awarii całego hosta musi działać poza tym hostem.
Może poczekać do późniejszego etapu:
- rozbudowa statystyk i ergonomii strony;
- optymalizacja indeksowania przy większej historii;
- dodatkowe kanały powiadomień ponad działający kanał podstawowy i niezależny nadzór;
- zwiększenie limitu TVL — dopiero po ponownym przeglądzie i doświadczeniu operacyjnym.
F-04–F-06 warto poprawić przed publicznym pilotem mainnetowym: są ograniczone zakresowo i nie wymagają zmiany modelu mostu. Żadnych poprawek nie wprowadzałem.
