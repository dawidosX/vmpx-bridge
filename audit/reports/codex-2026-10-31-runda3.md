Raport niezależnego audytu VMPX Ethereum ⇄ X1
Data: 31 października 2026
Katalog: repozytorium evmpx-x1-bridge (lokalna kopia; ścieżka lokalna usunięta przy archiwizacji)
Commit: bde42dcdb8efcaa372ec57de7644d7cd22f02da3
Commit, stan drzewa i metoda
Wynik git log -1:
commit bde42dcdb8efcaa372ec57de7644d7cd22f02da3
Author: dawidosX <dawidosX@users.noreply.github.com>
Date:   Sat Oct 31 15:50:10 2026 +0100

    docs/13: testnet pause drill report (31 Oct 2026) with timings
git status na początku i na końcu przeglądu:
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
Nie zmieniłem, nie utworzyłem ani nie usunąłem żadnych plików.
Przejrzałem kod, poprzednie raporty, dokumentację, testy oraz istotne zależności Hyperlane. Pomocniczo odczytałem lokalne źródła programu Sealevel z commita f556e18c9da88ce3d51a24164f22a7f27eb539fd. Nie wykonywałem transakcji ani odczytów on-chain.
Wykonałem wyłącznie kontrole bez zapisu:
- testy czystej logiki monitora: 9/9 zaliczonych;
- kontrolę składni JS, Python przez AST i skryptów przez bash -n;
- odtworzenia w pamięci dotyczące starego limitu po błędzie RPC, parsera PROCESSD, niepełnego pokrycia i niespójnej finalności;
- niezależne przeliczenie slotu ERC-7201.
Nie uruchamiałem Foundry, kompilacji ani E2E zapisujących artefakty.
Nie potwierdziłem nowej podatności Critical/High w routerze v2. Najistotniejsze nowe problemy dotyczą indeksera, monitora i blokad przed wysyłką. Ten wynik nie stanowi potwierdzenia gotowości do mainnetu.
1. Weryfikacja poprzednich poprawek
„Usunięte” oznacza usunięcie przyczyny albo wdrożenie zaakceptowanej korekty opisu — rozróżniam to w uzasadnieniu.
ID	Status	Uzasadnienie z aktualnego kodu
M-01	Częściowo	frontend/www/app.js:631–657,691–696 sprawdza pojemność i poziom, odejmując indeksowane wypłaty w drodze. CLI nadal może spalić kwotę ponad pojemność. Dochodzi błąd zachowania starego limitu po nieudanym odczycie — R-05.
M-02	Częściowo	Brak oczekiwań daje FAIL w svm/compat/check-x1.mjs:129–134; E2E przekazuje je w testnet/08-e2e.sh:111–118. Kontrola obejmuje konfigurację tokena i dodatkowe role. Łańcuch weryfikacji nadal jest niepełny — R-06.
L-01	Usunięte w opisie	VmpxEthFeeHook.sol:56–60 prawidłowo opisuje stałe okna. Algorytm pozostał bez zmian. Przy poprawnie ustawionej stałej opłacie cena przestaje wpływać na zwykłą wycenę.
L-02	Usunięte	Konstruktor odrzuca cenę zero w VmpxEthFeeHook.sol:127; skrypt robi to również w DeployEth.s.sol:124. Dodano testy negatywne.
L-03	Usunięte dla przyjętego profilu ETH	DeployEth.s.sol:120–123 ogranicza długość do uint8 i na mainnecie wymusza dokładnie 5/7. Nie dowodzi to niezależności operatorów ani zgodności konfiguracji X1.
I-01	Częściowo	Testy poprawnie uwzględniają darowizny: BridgeBase.t.sol:261–266. donate() i zatrzymywanie przypadkowego ETH pozostają. Monitor i indeks nie sprawdzają pełnych zobowiązań w wykonaniu produkcyjnym — R-03. recoverEth() nie ma w aktualnym routerze.
I-02	Usunięte w opisie	Zbiornik C + C/dobę opisano na stronie i w runbooku. Mechanizm nadal dopuszcza prawie 2C w pierwszej dobie; to świadomie zachowana semantyka.
N-1	Częściowo	Dodano właścicieli konfiguracji ISM, outboxa, IGP oraz walidatorów i próg: check-x1.mjs:212–272. Dodano wykluczenie wskazanego deployera. Pozostały braki R-06.
N-2	Częściowo — plan	docs/15-key-custody.md:198–216 opisuje cudze upgrade authority Squads i proponuje własne wdrożenie. Repo nie dowodzi wykonania tego planu, zgodności binariów ani faktycznego time_lock.
N-3	Częściowo	Runbook prawidłowo opisuje natychmiastowy wzrost dostępnego poziomu po zmianie tempa. Nadal proponuje zbędne pozostawienie zwiększonego limitu przez kolejne 48 godzin — R-08.
N-4	Usunięte w opisie i teście	Komentarz opisuje wzrost +125% przez granicę okien; ReviewFixes.t.sol:197 i dalsze odtwarzają ten wariant.
N-5	Częściowo	activity.py:465–468 nadaje insolvent pierwszeństwo, a app.js:820 blokuje przycisk. Ocena nadal pomija zobowiązania w drodze i może korzystać z niespójnych/starych danych — R-03, R-07.
M-01, uzupełnienie	Częściowo	app.js:643–655 odejmuje niedostarczone X1→ETH. Dane mogą być stare, a błąd świeżego odczytu nie usuwa poprzedniego limitu — R-05.


2. Nowe ustalenia
ID	Ważność	Tytuł	Pewność
R-01	Medium	Treść dowolnej wiadomości X1 może sfałszować status dostarczenia w indeksie	wysoka
R-02	Medium	Deklarowany monitor zmian uprawnień nie jest wykonywany	wysoka
R-03	Medium	Monitor i status pomijają zobowiązania z wiadomości w drodze	wysoka
R-04	Medium	Różne poziomy finalności mogą wywoływać fałszywe alarmy i pauzy	wysoka
R-05	Medium	Błąd RPC pozostawia stary limit i pozwala kontynuować burn	wysoka
R-06	Medium	Kontrola akceptacyjna X1 nie zamyka całego łańcucha zaufania	wysoka
R-07	Medium	Indekser nie wycofuje danych po reorganizacji Ethereum	wysoka
R-08	Low	Runbook niepotrzebnie przedłuża okres zwiększonego limitu	wysoka
R-09	Low	Błąd odczytu opłaty VMPX przedstawia ją jako zero	wysoka
R-10	Low	Ethereum wallet nie jest ponownie sprawdzany po zmianie sieci	wysoka
R-11	Low	Endpoint statystyk ma koszt zależny od całej historii i brak własnego ograniczenia współbieżności	wysoka


R-01 — Treść wiadomości może sfałszować dostarczenie
Lokalizacja: [indexer/activity.py (line 534)](../../indexer/activity.py), dalsze użycie: linie 550–553.
Opis: Indekser wyszukuje PROCESSD przez d.find(...) w całym koncie, zanim rozpozna DISPATCH. Treść wiadomości w koncie DISPATCH jest kontrolowana przez nadawcę i może zawierać taki ciąg.
Upstreamowy Mailbox pozwala wysłać wiadomość z własnym podpisującym nadawcą i dowolnym message_body. Atak nie wymaga podszycia się pod router VMPX.
Scenariusz ataku:
1. Atakujący wybiera ID rzeczywiście oczekującego transferu ETH→X1.
2. Wysyła przez Mailbox X1 dowolną wiadomość zawierającą:PROCESSD | 8 bajtów | wybrane messageId | slot
3. Indekser znajduje ten fragment w koncie DISPATCH i traktuje go jak prawdziwe konto przetworzenia.
4. Oznacza wybrany transfer jako dostarczony, mimo że mint nie nastąpił.
Wpływ: Fałszywa historia, ukrycie opóźnienia i zniekształcone statystyki. Sam błąd nie wykonuje mintu ani unlocku.
Rekomendacja: Rozpoznawać discriminator wyłącznie na właściwym, stałym przesunięciu. Sprawdzać inicjalizację, długość i strukturę konta, a dla potwierdzenia dostarczenia również właściwy PDA związany z ID wiadomości.
Weryfikacja: Odtworzenie w pamięci potwierdziło wybranie osadzonego PROCESSD z konta zaczynającego się prawidłowym DISPATCH. Nie wykonywałem ataku on-chain.
R-02 — Brak wykonywanego monitora zmian uprawnień
Lokalizacja: [monitoring/src/monitor.mjs (line 39)](../../monitoring/src/monitor.mjs), [monitoring/src/invariant.mjs (line 38)](../../monitoring/src/invariant.mjs), deklaracja ochrony: docs/15-key-custody.md:129.
Opis: WATCHED_EVM_EVENTS jest deklaracją danych. monitor.mjs jej nie importuje ani nie odpytuje logów. Nie odczytuje też właścicieli X1, routerów, walidatorów, progów, upgrade authority ani zmian kodu.
Sprawdzenie ISM w indeksie porównuje tylko adres programu; zmiana walidatorów wewnątrz tego samego ISM pozostaje niewidoczna.
Scenariusz ataku:
1. Przejęty właściciel ISM X1 zmienia walidatorów bez zmiany adresu programu.
2. Stan mint authority i rozszerzeń tokena pozostaje poprawny.
3. Monitor nie wykrywa zmiany i nie uruchamia deklarowanej pauzy.
4. Atakujący może autoryzować niepokryte minty, następnie spalać je na wypłatę.
Wpływ: Nie działa jedna z głównych deklarowanych warstw wykrywania incydentu. Nadal obowiązują rzeczywiste ograniczenia Ethereum: ISM, limit i ewentualna ręczna pauza.
Rekomendacja: Zaimplementować trwały monitoring konfiguracji i kodu X1 oraz logów governance Ethereum, z przypiętym stanem oczekiwanym, kursorem, obsługą restartu i integracją z alarmem/pauzą. Samo dodanie kolejnych nazw do mapy zdarzeń niczego nie monitoruje.
R-03 — Pominięcie zobowiązań w drodze ukrywa niedobór
Lokalizacja: [monitoring/src/monitor.mjs (line 42)](../../monitoring/src/monitor.mjs), [indexer/activity.py (line 458)](../../indexer/activity.py).
Opis: Funkcja evaluate() umie uwzględniać oba kierunki wiadomości, lecz uruchomiony monitor nie przekazuje tych kwot. Domyślnie wynoszą zero. Status indeksera również porównuje tylko lockbox z bieżącą podażą X1.
Scenariusz ataku lub awarii:
1. Lockbox ma 100 VMPX.
2. Na X1 pozostaje 60 VMPXe, a użytkownicy mają prawdziwe burny na 50 VMPX oczekujące na wypłatę.
3. Zobowiązania wynoszą 110 VMPX, więc brakuje 10.
4. Monitor ocenia 100 ≥ 60 i zwraca OK.
Taki stan może powstać wskutek innego incydentu, np. niepokrytego mintu i jego późniejszego burnu.
Wpływ: Fałszywy komunikat o pokryciu i brak automatycznej reakcji, mimo że część prawdziwych roszczeń nie jest zabezpieczona.
Rekomendacja: Liczyć:
lockbox ≥ podaż X1 × 1e9 + pending ETH→X1 + pending X1→ETH
Odczyty i statusy wiadomości muszą być spójne. Przy niekompletnym indeksie pokazywać „nieznane”, zamiast potwierdzać pełne pokrycie.
Weryfikacja: Odtworzenie w pamięci dało OK bez pendingX2E i CRITICAL po przekazaniu rzeczywistej kwoty 50. Istniejące testy sprawdzają funkcję matematyczną, ale nie jej podłączenie w tick().
R-04 — Niespójna finalność może zatrzymywać zdrowy most
Lokalizacja: [monitoring/src/monitor.mjs (line 27)](../../monitoring/src/monitor.mjs), linie 33–45; testnet/make-agent-config.mjs:15.
Opis: Monitor porównuje stan lockboxa z Ethereum finalized ze stanem X1 finalized. Według aktualnej konfiguracji i dokumentacji mint na X1 może nastąpić już po dwóch blokach Sepolii, zanim depozyt znajdzie się w sfinalizowanym stanie Ethereum.
Scenariusz:
1. Użytkownik wykonuje poprawny depozyt.
2. Walidator podpisuje go i następuje mint na X1.
3. Ethereum finalized nadal wskazuje stan sprzed depozytu.
4. Monitor widzi podaż bez odpowiadającego locka i zgłasza CRITICAL.
5. Podłączone auto-pause.sh zatrzymuje zdrowy most.
Wpływ: Fałszywe alarmy i powtarzalna utrata dostępności przy normalnych transferach. Ten problem jest niezależny od rzeczywistego ryzyka reorga przed finalizacją.
Rekomendacja: Rozdzielić rozliczenie końcowe od obserwacji transferów jeszcze niesfinalizowanych. Korelować mint z depozytem i jego stanem finalności; nie wyzwalać pauzy na podstawie mechanicznego porównania dwóch niesynchronizowanych snapshotów.
Weryfikacja: Logika monitora zwraca CRITICAL dla sfinalizowanego salda ETH sprzed depozytu i już zmintowanej podaży X1. Nie sprawdzałem, czy automat jest faktycznie aktywny na serwerze.
R-05 — Błąd odczytu nie unieważnia poprzedniego limitu
Lokalizacja: [frontend/www/app.js (line 631)](../../frontend/www/app.js), linie 639 i 691–696.
Opis: refreshLimit() przy błędzie zeruje S.limAt, lecz zostawia poprzednie S.lim. sendX2E() po „świeżym” odczycie sprawdza istnienie tego obiektu, a nie sukces i aktualność odczytu.
Scenariusz:
1. Strona odczytuje dostępną pojemność C.
2. Governance obniża pojemność albo inni użytkownicy zużywają poziom.
3. Odczyt tuż przed podpisem kończy się błędem RPC.
4. Strona wykorzystuje poprzedni limit i pozwala spalić tokeny.
5. Wiadomość czeka; jeśli kwota przekracza nową pojemność, wymaga governance.
Stare lub niedostępne activity.json dodatkowo nie zapewnia aktualnej sumy burnów w drodze.
Wpływ: Blokada będąca poprawką M-01 nie działa zgodnie z deklaracją przy błędzie danych.
Rekomendacja: Zwracać jawny wynik odczytu. Przy błędzie blokować wysyłkę i nie używać starego S.lim. Wymagać określonej świeżości danych o transferach w drodze. Nadal informować, że równoległe transfery mogą zużyć limit po sprawdzeniu.
Weryfikacja: Uruchomienie właściwej funkcji w izolacji potwierdziło, że po błędzie pozostają poprzednie level i cap.
R-06 — Niepełny łańcuch weryfikacji X1
Lokalizacja: [svm/compat/check-x1.mjs (line 166)](../../svm/compat/check-x1.mjs), linie 184–219 i 256–272.
Opis: Dwie istotne granice pozostają niesprawdzone:
1. Podany --mint jest sprawdzany oddzielnie od programu tokena. Skrypt nie dowodzi, że jest to mint właściwy dla tego programu.
2. Dla IGP sprawdzane są wybrane konta i właściciele, ale nie upgrade authority programu IGP. W wariancie overhead nie sprawdza się też właściciela konta wewnętrznego IGP.
Scenariusz:
1. W konfiguracji pozostaje IGP z upgrade authority deployera albo innej niezatwierdzonej osoby.
2. Właściciele kont IGP są poprawnie przekazani do Squads.
3. Kontrola akceptacyjna przechodzi.
4. Retained upgrade authority podmienia kod obsługujący opłaty i może zakłócić wysyłkę lub przejąć środki zależnie od uprawnień przekazanych do CPI.
Niezależnie od tego omyłkowy, niespowiązany mint może zostać zaakceptowany, jeśli sam spełnia lokalne warunki.
Wpływ: Wynik OK nie potwierdza pełnego przekazania kontroli ani poprawnego powiązania wszystkich elementów trasy.
Rekomendacja: Zweryfikować powiązanie mintu z programem według przypiętego upstreamu. Sprawdzać executable/loader, właścicieli i typy kont, inicjalizację oraz upgrade authority wszystkich wykonywanych programów trasy, w tym IGP. Wykluczenie deployera powinno objąć również te authority.
R-07 — Indekser nie obsługuje reorganizacji Ethereum
Lokalizacja: [indexer/activity.py (line 503)](../../indexer/activity.py), linie 505–518 i 550–561.
Opis: Indekser pobiera logi do bieżącego eth_blockNumber, przesuwa kursor i nie zapisuje hashy bloków do wykrywania reorga. Raz zapisane transfery i dostarczenia nie są ponownie sprawdzane w kanonicznej historii.
Scenariusz:
1. Indekser zapisuje depozyt lub dostarczenie z niesfinalizowanego bloku.
2. Następuje reorganizacja usuwająca ten blok.
3. Rekord pozostaje, a kursor nie wraca.
4. W przypadku usuniętego dostarczenia X1→ETH strona przestaje odejmować rzeczywiście oczekującą wypłatę od dostępnego limitu.
Wpływ: Fałszywe statusy, statystyki i kwoty w drodze. Błąd może utrzymywać się bezterminowo.
Rekomendacja: Oddzielić dane tymczasowe i sfinalizowane. Zapisywać hashe bloków, wykrywać zmianę kanonicznej historii i wycofywać zależne rekordy. Ponownie weryfikować niedawne dostarczenia.
R-08 — Podwyższony limit nie musi pozostawać przez kolejne 48 godzin
Lokalizacja: [docs/08-runbook.md (line 109)](../../docs/08-runbook.md), szczególnie linie 111–113.
Opis: Procedura zakłada podniesienie limitu, dostarczenie wiadomości, a dopiero potem zaplanowanie przywrócenia C. Przedstawia kolejne 48 godzin podwyższonego limitu jako przyjęte ryzyko.
Dostępny TimelockController.executeBatch pozwala zaplanować atomową sekwencję:
setRefillRate(K)
Mailbox.process(metadata, message)
setRefillRate(C)
Scenariusz:
1. Operator realizuje obecną procedurę.
2. Limit pozostaje podniesiony podczas kolejnego opóźnienia.
3. W tym czasie przejęty quorum atestatorów wykorzystuje większą pojemność i tempo.
Wpływ: Zbędne zwiększenie ekspozycji podczas recovery.
Rekomendacja: Opracować i przetestować atomowy batch dla konkretnej wiadomości. Jeśli jej przetworzenie się nie powiedzie, cała operacja powinna się cofnąć. Uwzględnić stan pauzy, wymagane metadata i gaz. Nie traktować wielodniowego podniesienia jako jedynej możliwości.
R-09 — Błąd RPC przedstawia opłatę VMPX jako zero
Lokalizacja: [frontend/www/app.js (line 372)](../../frontend/www/app.js), linie 394–397 i 448–465.
Opis: Każdy błąd bridgeFeeBps() ustawia S.feeBps = 0n. To miało obsługiwać router v1, ale obejmuje również awarię RPC dla routera v2.
Scenariusz:
1. Odczyt opłaty nie udaje się.
2. Strona ukrywa wiersz opłaty i pokazuje otrzymanie pełnej kwoty.
3. Użytkownik podpisuje transfer.
4. Router prawidłowo potrąca 3%, wbrew podglądowi.
Wpływ: Nieprawidłowa informacja finansowa przed podpisem; kontrakt nie pobiera więcej niż kwota brutto.
Rekomendacja: Rozróżnić obsługiwaną wersję routera od błędu odczytu. Dla v2 przy nieznanej opłacie blokować transfer. Przed wysłaniem ponownie odczytać stawkę i pokazać zmianę. Dla silniejszej ochrony użytkownika rozważyć kontraktowy parametr minimalnej kwoty netto lub maksymalnej opłaty.
R-10 — Brak ponownego sprawdzenia sieci portfela Ethereum
Lokalizacja: [frontend/www/app.js (line 325)](../../frontend/www/app.js), linie 424–426 i 1074–1075.
Opis: Sieć portfela jest sprawdzana podczas connect(). Brakuje obsługi chainChanged i sprawdzenia sieci przed eth_sendTransaction. Dane do wyceny i sald nadal pochodzą z przypiętego RPC Sepolii.
Scenariusz:
1. Użytkownik łączy się na Sepolii.
2. Zmienia sieć w portfelu.
3. Strona nadal pokazuje salda i wycenę Sepolii.
4. Zgoda lub transfer jest wysyłany na aktualnie wybranej sieci pod te same adresy.
Wpływ: Strata gazu, niezamierzona zgoda lub wywołanie innego kontraktu, jeśli adres ma kod na danej sieci.
Rekomendacja: Obsłużyć chainChanged, unieważniać stan i sprawdzać chain ID bezpośrednio przed każdą transakcją, również po zakończeniu osobnej operacji approve.
R-11 — Kosztowny endpoint statystyk może wyczerpać API
Lokalizacja: [indexer/bridge-api.py (line 99)](../../indexer/bridge-api.py), linie 107–128 i 207–208.
Opis: Każde żądanie statystyk wczytuje całą historię, a następnie wielokrotnie ją skanuje dla dni i godzin. Ograniczenie days ≤ 90 nie ogranicza liczby rekordów. ThreadingHTTPServer nie ma własnego limitu aktywnych pracowników.
Scenariusz:
1. Historia rośnie.
2. Atakujący wysyła równoległe żądania /api/stats/daily?days=90, również HEAD.
3. Każde żądanie wykonuje pełną pracę.
4. Proces dochodzi do limitów pamięci, CPU lub zadań.
Wpływ: Niedostępność API. Ograniczenia systemd zmniejszają wpływ na host, lecz nie chronią dostępności samej usługi. Rzeczywisty próg ataku zależy od konfiguracji reverse proxy, której repo nie zawiera.
Rekomendacja: Preagregować statystyki przy indeksowaniu, stosować cache po stronie serwera, ograniczyć współbieżność i czas zapytań. Zweryfikować rzeczywiste limity reverse proxy. Nagłówek Cache-Control sam nie wdraża cache ani rate limitu.
3. Router v2, hook i uprawnienia — wynik przeglądu
Router v2
W [VmpxCollateralRouter.sol (line 91)](../../evm/src/VmpxCollateralRouter.sol) przepływ opłaty jest spójny:
pobrane od użytkownika = gross
fee = floor(floor(gross × bps / 10000) / 1e9) × 1e9
lockbox i wiadomość = gross − fee
Potwierdzone właściwości:
- odrzucane są zero, dust i zerowy odbiorca;
- token jest pobierany dokładnie w kwocie brutto;
- opłata trafia do skarbca, a mint odpowiada kwocie netto;
- przy wejściu będącym wielokrotnością 1e9 opłata i netto też są reprezentowalne na X1;
- zaokrąglenie zawsze działa w dół; bardzo małe transfery mogą nie płacić opłaty VMPX, ale ponoszą opłatę ETH;
- setBridgeFee() wymaga właściciela, ogranicza stawkę do 500 bps i odrzuca zerowy skarbiec przy dodatniej opłacie oraz adres routera jako skarbiec;
- dla maksymalnej podaży istniejącego tokena mnożenie przez dopuszczalne bps nie przepełnia uint256;
- transfer tokena, przekazanie opłaty i dispatch są atomowe.
Storage: niezależnie przeliczyłem slot ERC-7201. Wynik odpowiada stałej:
0x877831e9fe6d41f86d33867c018b5318e4ea9ec1d3b41eca5fcc1a1a6c78a400
Nowa struktura nie dodaje zwykłych pól do odziedziczonego układu. Test BridgeFee.t.sol:214–250 sensownie sprawdza upgrade, zachowanie salda, konfiguracji i późniejszy round-trip. Nie uruchamiałem go.
Ważne ograniczenie: MAX_FEE_BPS ogranicza obecną implementację. Proxy może dostać nową implementację, więc nie jest to niezmienny limit wobec administratora mającego upgrade authority.
Dziedziczone funkcje i autoryzacja
Nie znalazłem nowej nieuprzywilejowanej ścieżki wyprowadzenia kolaterału:
- deposit() i mint() są wyłączone;
- brak udziałów LP uniemożliwia uzyskanie roszczenia przez withdraw()/redeem();
- addBridge() jest wyłączone; samo dodanie rebalancera nie tworzy dozwolonego mostu;
- nadpisane feeRecipient() wyłącza dodatkowe opłaty tej ścieżki;
- niezerowy feeHook() powoduje odrzucenie transferu;
- inicjalizator implementacji jest zablokowany, a proxy inicjalizowane w konstruktorze;
- odbiór wiadomości wymaga Mailboxa i zgodnego zarejestrowanego routera;
- Mailbox zapewnia ochronę przed ponownym przetworzeniem;
- nieudane przetworzenie cofa stan i umożliwia późniejszą próbę.
Brak mintu bez locka i unlocku bez burnu nadal zależy od uczciwości odpowiedniego quorum oraz kodu i konfiguracji X1.
Hook opłat i refundy
- Konfiguracja feeBps=0, min=max=stale=0.0002 ether daje stałą opłatę również przy starej cenie.
- Parametry są ograniczane i zmieniane przez mechanizm ogłoszenia, opóźnienia oraz wygaśnięcia.
- Metadane routera wskazują nadawcę jako adres zwrotu.
- Nadpłata w agregatorze wraca do nadawcy.
- Odrzucenie refundu przez portfel kontraktowy cofa transfer; nie znalazłem przejęcia refundu.
- withdrawFees() może wywołać każdy, lecz wypłata idzie wyłącznie do aktualnego beneficiary.
- Awaria wypłaty przychodów hooka nie blokuje kierunku X1→ETH.
- Kolejność required hook Mailboxa, następnie hook routera z pauzą, Merkle i opłatą zachowuje atomowość.
Nie znalazłem obejścia opłaty przez zwykły alternatywny publiczny punkt wejścia routera.
Timelock i guardian
DeployEth.s.sol:213–218 pozostawia administrację Timelocka przy nim samym i usuwa tymczasowego administratora. Mainnet wymaga opóźnienia co najmniej 48 godzin.
Guardian może pauzować, wznawiać, zarządzać pauserami i anulować operacje. Nie znalazłem jego bezpośredniej ścieżki transferu kolaterału ani upgrade’u. Przejęty guardian może jednak blokować naprawę, usuwać pauserów i wznawiać most podczas incydentu.
4. Znany problem skryptu — kompletność planu poprawki
Podany plan jest poprawny funkcjonalnie, ale do zamknięcia potrzebuje testów i kontroli wdrożenia.
Należy objąć nim:
1. feeBps=0, min=max=stale=0.0002 ether.
2. setBridgeFee(300, treasury) przed przekazaniem właściciela.
3. Osobną konfigurację skarbca VMPX — nie zakładać, że beneficjent kosztów hooka jest tym samym podmiotem.
4. Odrzucenie skarbca zero na mainnecie; obecny setter odrzuca też sam router.
5. Test faktycznego świeżego wdrożenia: z 1000 VMPX skarbiec otrzymuje 30, lockbox 970, wiadomość zawiera 970.
6. Test stałego ETH dla małych i dużych kwot oraz ceny świeżej i starej.
7. Kontrolę właścicieli po wdrożeniu i odrzucenia późniejszego setBridgeFee() przez deployera.
8. Weryfikację stanu po przerwanym broadcastcie — seria transakcji skryptu nie jest jedną atomową transakcją.
9. Dla upgrade’u istniejącego proxy: zachować atomowy batch upgrade + setBridgeFee, jak w obecnym teście.
quoteTransferRemote() nadal pochodzi z upstreamu i wycenia ETH według przekazanej kwoty brutto, podczas gdy dispatch niesie netto. Po przejściu na stały hook przestaje to zmieniać wymaganą opłatę ETH. Dokumentacja obiecująca osobną pozycję opłaty VMPX w Quote[] nie odpowiada implementacji; strona liczy ją osobno.
5. XNT, skarbiec LP, strona i pauza
Opłaty XNT i LP
W odczytanym upstreamie opłata protokołu trafia do outboxa, a ClaimProtocolFees wymaga zgodnego beneficjenta i wypłaca nadwyżkę ponad rent. To odpowiada opisanemu modelowi.
Zastrzeżenia:
- sufit ustawiony przy inicjalizacji nie chroni przed upgrade’em Mailboxa;
- frontend symuluje koszt, ale podpisana instrukcja nie zawiera własnego maksymalnego kosztu XNT;
- zmiana konfiguracji między podglądem a wykonaniem może zmienić koszt;
- odczyty cen LP są cenami spot i nadają się do informacji, nie do zabezpieczenia wyceny mostu;
- brak kodu automatycznego zarządzania LP oznacza, że zasady „tylko przychody, nigdy kolaterał” wymagają również kontroli operacyjnej.
testnet/x1-set-protocol-fee.mjs:20 ma na sztywno adresy testnetowego Mailboxa i outboxa. Samo podanie --rpc mainnetu nie czyni go poprawnym narzędziem mainnetowym. Przykład w docs/14 wymaga dostosowania adresów.
Portfele i transakcje X1
Pozytywne elementy:
- transakcja zawiera przypięte programy i konta;
- dane kwoty są budowane z BigInt;
- jednorazowy klucz wiadomości powstaje lokalnie;
- po podpisie portfela porównywana jest cała wiadomość transakcji;
- podmieniona wiadomość jest odrzucana;
- przed wysłaniem serializacja weryfikuje podpisy;
- powtórzenia używają tej samej podpisanej transakcji;
- dostarczenie X1→ETH jest sprawdzane po ID w Mailboxie.
Pozostałe ograniczenia:
- helpery instructionData()/buildTx() polegają na walidacji wywołującego;
- portfel X1 nie ma obsługi zmian konta przez standard:events;
- brak timeoutów może pozostawić interfejs w oczekiwaniu;
- śledzenie ETH→X1 przez wzrost salda odbiorcy nie dowodzi dostarczenia konkretnej wiadomości — inny transfer może spełnić warunek;
- blokada S.paused dotyczy przycisku i nie zastępuje walidacji w handlerze ani zabezpieczeń on-chain.
Pauza
Opis próby w docs/13:33–54 jest zgodny z konstrukcją kontraktów:
- ETH→X1 w pauzie: atomowy revert;
- X1→ETH w pauzie: burn może się udać, unlock czeka;
- wznowienie nie wymaga ponownego burnu;
- limit i odstępy retry mogą wydłużyć dostarczenie.
Nie zweryfikowałem wskazanych transakcji on-chain. Zapewnienia o dostarczeniu po wznowieniu muszą zachować zastrzeżenie M-01: kwota ponad pojemność sama nie przejdzie.
6. Model kluczy i ryzyka organizacyjne
Obszar	Ocena
Safe 2/2 z zespołowym Safe 1/2	Wymaga właściciela i jednej osoby z zespołu. To nie jest niezależny próg trzech ludzi; właściciel ma obowiązkowe weto i jest punktem awarii dostępności.
Utrata klucza właściciela	Bez działającego recovery nie można samymi pozostałymi podpisującymi zmienić właściciela Safe 2/2. Ogólna instrukcja „pozostali wymieniają podpisującego” nie działa w tym wariancie.
Zagnieżdżony approveHash	Powiązanie z konkretnym hashem jest sensowne. Trzeba niezależnie sprawdzić treść operacji nadrzędnej i podrzędnej; sam zgodny hash nie dowodzi, że treść jest właściwa.
Admin i guardian	Oddzielne urządzenia i osoby ograniczają wspólne przejęcie. Na testnecie opisane współdzielenie urządzenia nie zapewnia takiej separacji.
Squads z cudzym upgrade authority	Jeśli stan opisany w docs/15 jest prawdziwy, zewnętrzny klucz może podmienić kod Squads, omijając próg i timelock vaultu. To warunek blokujący użycie takiego wdrożenia na mainnecie.
Własny Squads	Plan ma właściwy kierunek, ale wymaga odtwarzalnego buildu, kontroli zmian ID/initializer, inicjalizacji konfiguracji, odbioru authority i testu rzeczywistego opóźnienia. Nie jest jeszcze dowodem wdrożonej ochrony.
Kolokacja walidatorów	Próg 5/7 nie daje pięciu niezależnych domen bezpieczeństwa, jeśli walidatory dzielą lokalizację, zarządzanie i administratorów. [Szczegóły infrastruktury usunięte przy publikacji, przegląd runda 4, R4-11.]
KMS	Utrudnia wyniesienie klucza, ale przejęte uprawnienia do podpisu mogą wystarczyć do tworzenia fałszywych checkpointów. Osobne klucze bez osobnych domen administracyjnych nie usuwają korelacji.
Podział 4/3 między chmury	Ogranicza przejęcie progu przez jednego dostawcę, ale awaria dowolnego z tych dostawców pozostawia mniej niż pięć aktywnych walidatorów. Nie zapewnia ciągłości 5/7 przy awarii całej chmury.
Relayer	Nie fałszuje wiadomości, ale może cenzurować i tracić saldo gazowe. Publiczna możliwość dostarczenia oznacza również, że samo zatrzymanie relayera nie jest pauzą bezpieczeństwa.
Skarbce	Powinny mieć odrębne uprawnienia od bridge ownera. Wydanie przychodów LP nie może oznaczać uprawnienia do kolaterału.


Dokumentacja nadal podaje sprzeczne modele: własne 5/7 dla Ethereum→X1 w docs/15 wobec publicznego 6/9 w docs/03, docs/13 i na stronie; różne progi Safe/Squads; konfigurację X1 z timelockiem i bez niego. Trzeba wybrać jedną wersję przed przygotowaniem transakcji przekazania ról.
7. Indekser/API — sprawdzone zabezpieczenia
Nie znalazłem potwierdzonego SQL injection ani zdalnego wykonania poleceń przez publiczne parametry API:
- wartości użytkownika trafiają do parametrów SQL;
- fragmenty SQL wybierane są ze stałych wariantów;
- wyszukiwanie ma ograniczenie długości i formatów;
- page, days, dir, bot mają walidację;
- ograniczono liczbę parametrów query;
- API otwiera snapshot tylko do odczytu;
- snapshot publikowany jest atomowo;
- API nasłuchuje na localhost, a unit ogranicza uprawnienia i zasoby;
- tryb statyczny sprawdza realpath względem dozwolonego katalogu;
- główne widoki strony używają textContent albo escapowania, a linki z API ograniczają schemat.
Nie oznacza to odporności na złośliwy RPC, przejęcie serwera statycznego ani podmianę JavaScriptu. Podpisujący użytkownik ufa również dostarczonemu frontendowi.
8. Luki w testach
Najważniejsze brakujące przypadki:
- fałszywy PROCESSD w treści rzeczywistego DISPATCH;
- test integracyjny tick(), który dowodzi pobierania pełnych zobowiązań;
- wykrywanie zmian walidatorów bez zmiany adresu ISM;
- zwykły szybki mint przed finalizacją depozytu Ethereum;
- nieudany odczyt limitu po wcześniejszym poprawnym odczycie;
- reorganizacja cofająca depozyt albo dostarczenie;
- IGP z prawidłowym właścicielem konta, ale niewłaściwym upgrade authority;
- niespowiązany mint przekazany do kontroli akceptacyjnej;
- świeże wdrożenie z obiema opłatami v2;
- zmiana sieci portfela pomiędzy approve i transferem.
Dodatkowo:
- testnet/08-e2e.sh nadal oczekuje mintu 100 po depozycie 100 i używa dokładnej równości na końcu. Nie jest dostosowany do aktywnej opłaty 3% i legalnych nadwyżek.
- Test test_mainnetRejects2of3and4of7 faktycznie sprawdza m.in. 6/7, a nie nazwane 4/7.
- Testy forkowe bez SEPOLIA_FORK_RPC wracają bez wykonywania scenariusza. Ich wynik nie może być przedstawiany jako przeprowadzony test forka.
- EVM HypERC20 w fixture nie zastępuje audytu programu Sealevel.
9. Czego nie da się potwierdzić z samego kodu
Do odrębnej weryfikacji pozostają:
1. Faktyczne implementacje proxy i ich zgodność z opublikowanym kodem.
2. Aktualne role Timelocka, opóźnienie, proposerzy, executorzy i cancellerzy.
3. Skład Safe, moduły, guard, fallback handler i zagnieżdżone uprawnienia.
4. Faktyczne parametry opłat, skarbce oraz wykonanie hook-exec planowanego na 3 listopada.
5. Adresy, właściciele, konfiguracja i binaria wszystkich programów X1.
6. Zgodność wdrożonego programu syntetycznego z przypiętym upstreamem.
7. Powiązanie mintu, konfiguracji tokena, Mailboxa, ISM i IGP.
8. Squads: źródło binarium, authority, członkowie, próg, config_authority, timelock i ścieżki recovery.
9. Rzeczywista lista atestatorów Ethereum→X1, dostępność checkpointów i polityka finalności.
10. IAM/KMS, możliwość uzyskania uprawnień podpisu, separacja zarządzania, backupy i rotacja.
11. Czy monitor, alarmy i auto-pauza faktycznie działają oraz docierają do niezależnych dyżurnych.
12. Konfiguracja nginx/TLS/CSP, limity API i integralność publikowanego frontendu.
13. Pełność archiwalnego RPC i indeksu, obsługa rollbacku X1 oraz zachowanie wdrożonych agentów przy restartach.
14. Faktyczne salda, pokrycie wraz ze wszystkimi wiadomościami w drodze i stan LP.
15. Transakcje i czasy z próby pauzy opisanej w docs/13.
Najpilniejsze przed mainnetem: usunąć fałszowanie indeksu R-01, podłączyć rzeczywisty monitoring uprawnień i zobowiązań, rozwiązać niespójność finalności, zamknąć błędną ścieżkę odczytu limitu oraz zakończyć weryfikację całego łańcucha uprawnień X1.