# 13 — Pauza i wprowadzanie zmian: „szybki stop, wolny start”

Wymaganie właściciela: most ma mieć klucze, a w razie wykrycia błędu musi istnieć możliwość pauzy i wprowadzenia zmian.

## Zasada

| Działanie | Kto | Jak szybko | Co może zepsuć w razie przejęcia klucza |
|---|---|---|---|
| **STOP** wszystkiego na Ethereum (depozyty + odblokowania) | **dowolny pojedynczy klucz z listy pauserów** (dyżurny, bot monitoringu) → `EmergencyPauser.pauseAll()` | 1 transakcja, ~12 s | tylko zatrzymanie mostu (griefing). Środków nie rusza |
| Wznowienie | guardian (Safe) → `EmergencyPauser.unpause(deposits, unlocks)` | 1 transakcja multisig | — |
| Weto zaplanowanej zmiany | guardian → `TimelockController.cancel(id)` (rola CANCELLER) | natychmiast, w oknie 48 h | — |
| Zmiana kodu lockboxa (bugfix) | admin Safe → Timelock (48 h) → `ProxyAdmin.upgrade` | ≥ 48 h | pełna kontrola nad kolaterałem, stąd 48 h, weto guardiana i alerty |
| Zmiana ISM / hooka / routerów / limitu | admin Safe → Timelock (48 h) | ≥ 48 h | jw. |
| Zmiana parametrów opłaty / reset ceny | admin Safe → Timelock → `announce*` + 3 dni wbudowane | ≥ 5 dni | tylko wysokość opłaty, w granicach immutable |
| STOP mintów na X1 | właściciel tokena X1 (Squads X1, `docs/15` §8) → `token set-interchain-security-module --ism <closed>` | z time-lockiem Squads: 48 h na mainnecie. Kolaterał chroni od razu pauza na Ethereum | patrz ryzyko poniżej |
| Upgrade programów X1 | ten sam Squads X1, time-lock 48 h | ≥ 48 h | pełna kontrola nad mintem |

Pauza **nigdy nie gubi środków ani wiadomości**:
- Depozyt w czasie pauzy revertuje atomowo, więc nic nie zostaje pobrane.
- Wiadomości wysłane przed pauzą albo w jej trakcie czekają i są dostarczane po wznowieniu (testy: `test_emergencyFullStop_thenResume`, `test_pauseBlocksUnlockAndResumeRecovers`, e2e kroki 4–6).
- **W czasie pauzy transfery X1→ETH spalone na X1 czekają i zostaną dostarczone po wznowieniu.** Spalenie na X1 następuje od razu, a VMPX wypłaca się dopiero po wznowieniu. Zaległe wypłaty przechodzą przez limit (zbiornik C): przy zaległościach większych niż dostępny limit część czeka na jego uzupełnienie. Relayer ponawia z rosnącym odstępem, więc po wznowieniu dostarczenie może potrwać kilka minut. W tym czasie wskaźnik pokrycia pokazuje nadwyżkę równą sumie wiadomości w drodze; to nie jest błąd.

## Typowy scenariusz błędu

1. Alarm, np. `CollateralUndercovered`, zmiana uprawnień na X1 albo zgłoszenie podatności. Bot (`monitoring/auto-pause.sh`) albo dyżurny wywołuje `pauseAll`.
2. Jeśli problem dotyczy mintu na X1: Squads X1 planuje przełączenie ISM tokena na „zamknięty” (`x1_closed_ism`, time-lock 48 h). Do tego czasu kolaterał chroni pauza odblokowań na Ethereum, a mint bez pokrycia nie wyjdzie z X1.
3. Analiza i poprawka. Nowa implementacja trafia przez testy, przegląd wieloma modelami (`audit/`) i testnet.
4. Admin Safe planuje upgrade w timelocku. Po 48 h wykonuje go (`test_upgradeThroughTimelockKeepsCollateralAndState`).
5. Guardian wznawia. Relayer dostarcza zaległe wiadomości. Monitor potwierdza 100% pokrycia.

Pauza obejmuje cały czas naprawy, więc 48 h timelocka nie opóźnia ochrony, tylko samą zmianę.

## Próba pauzy na testnecie (31 paź 2026)

Sepolia ⇄ X1 testnet, router v2 (opłata 3%). Bot ruchu testowego wstrzymany na czas próby. Czasy UTC z bloków (Sepolia) i z indeksera strony (X1).

| Czas | Krok | Wynik |
|---|---|---|
| 14:35:36 | przygotowanie: ETH→X1 700 VMPX (`0x6efc5407…`) | zmintowane po 45 s, saldo testowe 1095 VMPXe |
| **14:37:24** | `pauseAll("pause drill")` kluczem pausera (`0x9713b6d0…`) | PausableHook i PausableIsm wstrzymane; strona: „Wstrzymany”, wysyłka zablokowana |
| 14:37:53 | ETH→X1 1000 VMPX: symulacja | revert `Pausable: paused` |
| 14:39:00 | ETH→X1 1000 VMPX: transakcja on-chain (`0x0566c60b…`) | status 0 (revert); saldo lockboxa i użytkownika bez zmian |
| 14:39:07 | X1→ETH 1000 VMPXe przez CLI, wiadomość `0x6fa8e6ca…6852` | spalone na X1 od razu; na Ethereum nie wypłacone (ISM wstrzymany) |
| 14:40:10 | indekser strony | wiadomość jako „w drodze” (X1→ETH), wskaźnik pokrycia: nadwyżka 1000 VMPX (spalone, jeszcze nie wypłacone) |
| 14:40:14 | pierwsza próba `unpause` | nieudana: złe hasło do keystore'a strażnika; skrypt nie zatrzymał się na błędzie (poprawiony: sprawdza adres i status). Most pozostał wstrzymany |
| **14:44:48** | `unpause(true, true)` kluczem strażnika (`0x78e9900d…`) | most wznowiony |
| **14:47:24** | dostarczenie wiadomości na Sepolii (`0xb131c9b8…`) | **156 s po wznowieniu**, 497 s po spaleniu; +1000 VMPX dla odbiorcy |
| po 14:47 | indekser | pokrycie 0 (lockbox = podaż na X1), brak transferów w drodze; bot wznowiony |

Wnioski:
- Depozyt w pauzie revertuje atomowo, bez pobrania środków i opłaty.
- Wypłata X1→ETH spalona w czasie pauzy czeka i dochodzi sama po wznowieniu, bez ręcznego działania. Opóźnienie po wznowieniu (ok. 2,5 min) to odstęp ponowień relayera.
- W czasie pauzy wskaźnik pokrycia pokazuje nadwyżkę równą kwocie w drodze. Strona podawała przy tym zły kierunek („w drodze na X1”); poprawione w wersji 31 strony.
- Pauza trwała 7 min 24 s.

## Próba samego wykonania auto-pauzy (1 lis 2026, `docs/08` §3a)

Sprawdzona tylko ścieżka wykonania: klucz pausera → `pauseAll()` → oba kierunki wstrzymane → ręczne wznowienie przez strażnika. Izolowana kopia `monitoring/auto-pause.sh` (sha256 `0c230f550f7491dccaa9808bd5299969a3e4a9c4d229b1fb645a15a23fffe7dd`, commit `2d0462d`) na komputerze operatora, syntetyczne świeże metryki CRITICAL, `DRY_RUN=0` tylko w tym przebiegu. Auto-pauza na serwerze została w `DRY_RUN=1` (sprawdzone przed `pre` i przed `drill`).

| Krok (UTC) | Wynik |
|---|---|
| `pre` 10:36:47 | obie flagi `false`; symulacja depozytu `passes`, `verify(0x,0x)` ISM `passes`; przebieg `DRY_RUN=1`: `WOULD pauseAll`, nic nie wysłane — PASS |
| `drill` 10:37:16 | adres pausera `0xdA8337B25cd9951aa2033Ed1aF9e0172ea85495c` (z keystore'a); `pauseAll` tx `0xba672afa3c6ec700b7b34cdbaa81d36f1550b96899f8f381e9667a3f496f7856`, status 1, blok 12040453, gas 56 817; `auto-pause.sh` exit 0 po **15 s** od startu; kontrola własna skryptu: `unlocks_paused=true`, `deposits_paused=true` |
| kontrola niezależna 10:37:52 | depozyty `paused=true`, odblokowania `paused=true`, symulacja depozytu `reverts`, `verify` ISM `reverts` — PASS |
| `unpause` 10:38:21 | strażnik `0x3B3357bC2B1CC07545a7EB551Aaaf326950C60A8`; tx `0x7e498a14300d92479b3106bad0d70afca27cc806203295a22d2feb3d255f3c0d`, status `0x1`, blok 12040457 |
| kontrola po `unpause` 10:38:39 | **fałszywy FAIL**: odczyty sprzeczne (depozyty flaga `true`, a symulacja `passes`; odblokowania flaga `false`, a `verify` `reverts`) — publiczne RPC z load balancerem odpowiadało z węzłów po obu stronach transakcji, a błąd RPC był liczony jako revert |
| ponowny `pre` po ok. 30 s | most działa w obu kierunkach |
| niezależny odczyt, blok 12040466 | trzy RPC (publicnode, Tenderly, ethPandaOps) zgodnie: obie flagi `false`, `verify(0x,0x)` = `true`, symulacja depozytu przechodzi |

**Wniosek:** wykonanie pauzy działa w obu kierunkach w 15 s, wznowienie strażnikiem działa. Kontrola po pause/unpause była wrażliwa na opóźnione RPC.

**Poprawka (commit `1e11de0` i skrypt operatora):** `auto-pause.sh` wysyła `pauseAll` z `--json`, zapisuje tx, status i blok receiptu, a stan obu kierunków czyta `cast call --block <blok receiptu>`. Brak odpowiedzi węzła dla tego bloku albo sprzeczne odczyty powodują ponowienie co 5 s, do 120 s; potem ALERT („pauza mogła zadziałać, sprawdź ręcznie”). Skrypt próby odróżnia revert od błędu RPC, czyta flagi i symulacje na bloku receiptu i ponawia do zgodności; po limicie wynik AMBIGUOUS (osobny kod wyjścia), nigdy fałszywy FAIL/PASS.

## Dlaczego zmiana kodu nie może być natychmiastowa

Kto może natychmiast zmienić kod lockboxa, ten może natychmiast zabrać cały kolaterał. 48 h, weto guardiana i publiczne zdarzenie `CallScheduled` (alarm w monitoringu) dają czas na reakcję, jeśli klucze admina zostaną przejęte. Pauza działa od razu i nikomu nie daje dostępu do środków.

## Ryzyko po stronie X1 (z przeglądu, M-4)

- Właściciel tokena na X1 może natychmiast zmienić ISM, routery albo walidatorów, a przez to zmintować VMPXe bez pokrycia. Takie tokeny da się spalić na odblokowanie prawdziwych VMPX tylko w tempie `RATE_CAP` na dobę i tylko przy niezapauzowanym Ethereum.
- Rekomendacja (jedna wersja, `docs/15` §8, decyzja właściciela przed mainnetem):
  - **jeden Squads na X1** ze wszystkimi uprawnieniami (owner konfiguracji tokena, ISM, skrzynki, IGP, upgrade authority programów) i **time-lock 48 h**, jak Timelock na Ethereum. Wcześniejszy szkic z osobnym szybkim „X1-config” bez time-locka odrzucamy: po przejęciu pozwalałby od razu zmintować tokeny bez pokrycia;
  - **monitor uprawnień X1** (logi governance Ethereum + odczyt konfiguracji i kodu programów X1): każda zmiana właściciela, ISM, routerów, walidatorów albo upgrade authority wywołuje automatyczne `pauseAll` na Ethereum. **Jeszcze nie działa** (przegląd runda 3, R-02; plan w `audit/reports/codex-2026-10-31-runda3-ocena.md` §3).
- Ryzyko rezydualne: przejęcie Squads X1 (próg + 48 h na reakcję) pozwala zmintować tokeny bez pokrycia na X1 i zaszkodzić puli LP. Kolaterał na Ethereum chroni pauza i limit.

## Kierunek ETH → X1: publiczny zbiór walidatorów Hyperlane (wariant A)

- **Wniosek z etapu A testnetu:** mint na X1 weryfikuje publiczny zbiór walidatorów Hyperlane dla Ethereum, czyli 6/9 na mainnecie. Na testnecie był to Abacus Works z progiem 1/1. Własne atestatory operatora podpisują tylko X1 → ETH.
- **Uzasadnienie:** własny walidator po stronie Ethereum musiałby najpierw odbudować całe współdzielone drzewo merkle (na Sepolii ok. 873 tys. liści od bloku 4517401). Wymaga to archiwalnego RPC z pełną historią logów. Szczegóły: `03-architecture.md`, „Kto podpisuje który kierunek”.
- **Pauza tego kierunku:** bez zmian. Na Ethereum `pauseAll` zatrzymuje depozyty od razu; Squads X1 może dodatkowo przełączyć ISM tokena na zamknięty (time-lock 48 h). Przetestowano to w e2e (kroki 4–6).
- **Zmiana listy lub progu walidatorów ETH→X1:** `multisig-ism-message-id set-validators-and-threshold` na otwartym ISM X1, przez Squads X1 (time-lock 48 h). Monitor uprawnień X1 musi alarmować przy każdej zmianie tej listy, tak samo jak przy zmianie ISM.
- **Ryzyko:** zmowa 6 z 9 publicznych walidatorów pozwala zmintować VMPXe bez pokrycia na X1. Kolaterał na Ethereum pozostaje chroniony, bo unlock podpisują tylko nasze atestatory, pod limitem i pauzą. Wykrywa to monitor pokrycia (podaż X1 > lockbox).

## Klucze: kto ma co

| Klucz | Przechowywanie | Próg / liczba |
|---|---|---|
| Admin Safe (ETH) | sprzętowe portfele, różne osoby | decyzja otwarta: 2/2 (Ledger właściciela + Safe zespołu 1/2) albo 3/5 (`docs/15` §8) |
| Guardian (ETH) | testnet: Ledger właściciela; mainnet: Safe, inne osoby niż admin | 2/3 |
| Pauserzy (ETH) | dyżurni + bot monitoringu, osobne klucze | każdy pojedynczo, tylko `pauseAll` |
| Price bot (ETH) | hot wallet | 1, tylko `updatePrice` w limitach |
| Atestatory X1 (podpisują tylko X1 → ETH) | KMS/HSM, osobny klucz na każdym atestatorze, **osobne od kluczy walidatorów X1** | 5/7 |
| Walidatory ETH → X1 | **nie nasze klucze**: publiczny zbiór Hyperlane; listę i próg w ISM X1 ustawia Squads X1 | 6/9 (opcja: własne 5/7, `docs/15` §8) |
| Relayer | hot wallets ETH i XNT z małym saldem | nie może fałszować wiadomości |
| Squads X1 (wszystkie uprawnienia na X1, własne wdrożenie Squads v4) | sprzętowe portfele, time-lock 48 h | jak admin ETH (decyzja otwarta) |

Nigdy: seed phrase w czacie, repo, ticketach, zmiennych CI ani na serwerach walidatorów.
