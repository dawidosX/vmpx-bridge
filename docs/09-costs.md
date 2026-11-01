# 09 — Kosztorys

Oznaczenia: **[F]** fakt (pomiar albo źródło), **[S]** szacunek. Ceny ETH i gas nie zostały zweryfikowane na 2026-10-28, dlatego podaję przedziały. Cena XNT to 0,2397 USD [F, jedno źródło trzecie].

## Jednorazowe

| Pozycja | Ilość | Koszt | Uwagi |
|---|---|---|---|
| Deploy `VmpxCollateralRouter` | 3 773 524 gas [F, forge gas-report] | 0,004–0,04 ETH przy 1–10 gwei | — |
| Deploy `VmpxEthFeeHook` | 1 619 959 gas [F] | 0,0016–0,016 ETH | — |
| `PausableIsm` | 364 766 gas [F] | — | — |
| `RateLimitedIsm` | ~0,9 mln gas [S] | — | — |
| MultisigISM + AggregationISM przez istniejące fabryki Hyperlane | 2 × ~115 501 gas [F, `deploy` przez fabrykę] | — | — |
| TimelockController (OZ) | ~1,5 mln gas [S] | — | — |
| Initialize, enroll, transferOwnership ×4 | ~0,6 mln gas [S] | — | — |
| **Razem Ethereum** | ~~~9 mln gas~~ **74 159 635 gas [F, Sepolia]** | **0,074–1,48 ETH** przy 1–20 gwei | szacunek ~9 mln był zaniżony ok. 8×; pomiar i przeliczenie niżej |
| X1: rent programów (mailbox, validator-announce, multisig-ism, igp, token) | 5 programów, ~200–500 KB każdy | **~15–30 XNT** [S] (≈ 4–7 USD) | rent ≈ 6,96 XNT/MB, jeśli parametry rent jak w Solanie (gates obniżające rent są nieaktywne) |
| X1: konta (mint, PDA, ATA) | — | < 0,1 XNT [S] | — |
| Przegląd bezpieczeństwa 2 kontraktów + konfiguracji | — | 3–10 tys. USD [S] | rekomendowane przed publicznym pilotażem |
| LP startowe | decyzja właściciela | — | **nie z kolaterału** |

## Miesięczne (marginalne: operator ma już własne węzły X1)

| Pozycja | Koszt / mies. | Uwagi |
|---|---|---|
| Atestatory na istniejących serwerach | ~0 USD [S] | proces < 100 MB RAM, znikome CPU |
| KMS (10 kluczy atestacji + relayer) | ~11 USD [S] | AWS KMS ~1 USD/klucz + wywołania |
| S3 checkpointy (10 bucketów) | ~1–5 USD [S] | mały wolumen |
| RPC Ethereum (relayer, monitor, opcja B atestatorów) | 0–50 USD [S] | własny węzeł lub darmowe plany są ryzykowne. Na produkcję płatny plan |
| Gas relayera na Ethereum (X1→ETH) | **~400 tys. gas/wiadomość [F, testnet: 394 713–404 955]** → 1,20–24 USD/wiadomość przy 1–20 gwei | pokrywa IGP na X1 (`X1_TO_ETH_GAS` = 400 000 + `destination_gas` 68 000) |
| Gas relayera na X1 (ETH→X1) | ~0,00002 XNT/wiadomość [S] | znikome |
| Bot ceny (`updatePrice` ~28 tys. gas) | 1×/dzień → ~0,03–0,3 USD/dzień | albo stała opłata kwotowa bez bota |
| Monitoring / alerting | 0–20 USD [S] | Grafana Cloud free / własny |
| **Razem marginalnie** | **~40–120 USD + gas wiadomości** | model w `economics/` przyjmuje 60 USD |
| Bez własnych węzłów (dla porównania) | 250–600 USD [S] | wg docs Hyperlane ~75 USD/validator |

## Koszt na transakcję dla użytkownika (ETH→X1)

| Pozycja | Wartość |
|---|---|
| `approve` | 20 319 gas przy kolejnym, 128 239 przy pierwszym [F, testnet, MockVMPX]. Na VMPX zmierzyć osobno |
| `transferRemote` z hookiem | **279–291 tys. gas typowo, 478 175 przy pierwszym** (zimny storage) [F, Sepolia, prawdziwy Mailbox] |
| Opłata projektu | 3% wg ceny referencyjnej, min. 0,0002 ETH, max. 0,02 ETH (wartości z testów, do decyzji) |

## Pomiary z testnetu (etap A, 29–30 paź 2026) [F]

Źródło: `08-e2e.sh` (6 przebiegów, 33 transakcje), zestawienie w `11-test-report.md`. Sepolia, prawdziwy Mailbox Hyperlane, AggregationIsm 3/3 [multisig, pausable, rateLimited].

| Operacja (Sepolia) | Liczba | Gas min | Gas max | Średnio |
|---|---|---|---|---|
| `transferRemote` (lock, z hookiem) | 6 | 279 327 | 478 175 (pierwszy) | 315 472 (typowo 279–291 tys.) |
| `process` / unlock (relayer) | 3 | 394 713 | 404 955 | 401 533 |
| `approve` (MockVMPX) | 5 | 20 319 | 128 239 (pierwszy) | 41 903 |
| `mintTo` (MockVMPX, nie występuje na mainnecie) | 6 | 42 514 | 238 354 (pierwszy) | 75 154 |
| `pauseAll` (pojedynczy pauser) | 1 | 56 127 | | |
| `unpause` (guardian) | 1 | 53 661 | | |
| **Deploy (krok 04)** | 21 tx | | | **74 159 635**, zapłacono 0,0556 ETH |

Największe pozycje deployu: implementacja routera 25,76 mln, timelock 12,93 mln, fee hook 11,95 mln, RateLimitedIsm 5,72 mln. W sumie nie ma MockVMPX (`forge create`).

**Uwaga, Amsterdam:** Sepolia działa na hardforku Amsterdam i deploy był symulowany z `forge script --hardfork amsterdam`. Ceny gasu operacji, zwłaszcza deployu kodu i dostępu do storage'u, mogą się różnić od mainnetu, dopóki mainnet nie przejdzie na ten sam hardfork. Przed mainnetem trzeba zmierzyć deploy i transakcje na forku mainnetu (`anvil --fork-url` z hardforkiem mainnetu).

### Przeliczenie przy ETH = 3000 USD (założenie)

| Operacja | Gas | 1 gwei | 5 gwei | 20 gwei |
|---|---|---|---|---|
| Deploy kontraktów (krok 04) | 74 159 635 | 222,48 USD | 1 112,39 USD | 4 449,58 USD |
| `approve` (kolejny) | 20 319 | 0,06 USD | 0,30 USD | 1,22 USD |
| `transferRemote` typowo | 285 000 | 0,86 USD | 4,28 USD | 17,10 USD |
| `transferRemote` pierwszy | 478 175 | 1,43 USD | 7,17 USD | 28,69 USD |
| `process` / unlock (relayer) | 401 533 | 1,20 USD | 6,02 USD | 24,09 USD |
| `pauseAll` | 56 127 | 0,17 USD | 0,84 USD | 3,37 USD |
| `unpause` | 53 661 | 0,16 USD | 0,80 USD | 3,22 USD |
| Opłata IGP X1→ETH, którą płaci użytkownik w XNT | 468 000 (400 tys. overhead + 68 tys. `destination_gas`) | 1,40 USD = 5,85 XNT | 7,02 USD = 29,25 XNT | 28,08 USD = 117 XNT |

XNT przeliczone po 0,24 USD. Gas `process()` (395–405 tys.) był większy niż opłacony na testnecie IGP (368 tys.), stąd nowa wartość `X1_TO_ETH_GAS` = 400 000.

### X1 (testnet)

| Operacja | Compute units | Opłata |
|---|---|---|
| `transfer-remote` (burn, X1→ETH) | 141 864–154 859 CU | 0,014002 XNT, bo klient ustawia limit 1,4 mln CU. Przy limicie ok. 250 tys. CU byłoby ok. 0,0025 XNT |
| `process` / mint (relayer) | 211 276–227 173 CU | 0,0023–0,0025 XNT |
| `set-interchain-security-module` (pauza i wznowienie mintów) | 5 416 CU | 0,014002 XNT (ten sam limit 1,4 mln CU) |

Opłata IGP za dostarczenie na Ethereum jest osobnym przelewem XNT w tej samej transakcji, poza opłatą sieci.

## Fakty a szacunki: co jeszcze trzeba zmierzyć

- ~~Rzeczywisty gas `process` z AggregationIsm 3/3~~: zmierzone na Sepolii (wyżej). Na mainnecie trzeba powtórzyć pomiar na forku, z publicznym ISM i mainnetowym Mailboxem.
- Deploy i operacje na forku mainnetu (hardfork mainnetu zamiast Amsterdam).
- `approve` na prawdziwym VMPX (testnet używał MockVMPX).
- Rozmiary `.so` programów Sealevel z wybranego commita, a z nich dokładny rent.
- ~~Koszt CU `transfer_remote` i `handle` na X1~~: zmierzone (wyżej). Zostaje ustawienie limitu CU we frontendzie i ponowny pomiar opłaty.
