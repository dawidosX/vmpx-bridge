# 07 — Skarbiec i budowa LP VMPXe/WXNT

## Para docelowa

**VMPXe / WXNT** na XDEX. XDEX to fork Raydium CP-Swap: pula constant-product, LP jako fungible SPL token. WXNT = `So111…112` (9 dec), a XDEX opakowuje XNT tak samo jak wSOL w Raydium. Do potwierdzenia na testnecie, podobnie jak ID programu XDEX (dokumentacja podaje dwa różne).

## Zasada nadrzędna

Kolaterał w lockboxie **nigdy** nie finansuje LP ani kosztów. Skarbiec dostaje wyłącznie opłaty z `VmpxEthFeeHook` przez `withdrawFees()`. Awaria skarbca nie wpływa na most (`test_unlockWorksWhenTreasuryBroken`).

## Proponowany podział przychodu (jawny, konfigurowany w polityce Safe, nie w kontrakcie)

1. Co miesiąc najpierw **OPEX**: gas relayera (ETH i XNT), KMS, S3, RPC, monitoring.
2. Z nadwyżki **40% trafia do rezerwy** (bufor na gas przy skokach cen, przyszły audyt), a **60% do LP**.
3. LP dodajemy partiami, gdy budżet ≥ 200 USD. Każda partia wymaga podpisu multisig i wcześniejszej symulacji (Tenderly / `simulateTransaction`).

Dlaczego nie 100% do LP: w żadnym realistycznym scenariuszu przychód nie pokrywa nawet OPEX (patrz niżej). Przeznaczenie wszystkiego na LP oznaczałoby dopłacanie do gasu z kieszeni operatora.

## Warianty

| | A: VMPX kupiony na Ethereum + osobno XNT | B: wartość przeniesiona na X1, oba aktywa kupione na X1 |
|---|---|---|
| Kroki | ETH → swap na VMPX (Uniswap V3, 1%) → most (gas ~180k) → osobno ETH → USDC → Wormhole/CCTP → Solana → Warp X1 (1 USDC flat) → USDC.x → XDEX → WXNT → `deposit` | ETH → USDC → … → USDC.x na X1 → połowa na WXNT, połowa na VMPXe **w naszej puli** → `deposit` |
| Koszty stałe (szac.) | gas ETH swap + depozyt (~0,5–1 USD przy 1 gwei) + trasa XNT (~8 USD + 1%) | tylko trasa (~8 USD + 1%) |
| Slippage | na puli ETH (5,6 tys. USD TVL): 200 USD daje ~7%! | na naszej puli X1 |
| MEV | zakup na Ethereum widoczny w mempoolu → użyć prywatnego RPC (Flashbots Protect) | X1: brak publicznego mempoola w stylu ETH. Ryzyko leży w leaderach i botach |
| Wpływ na własną pulę | brak bezpośredniego | **zakup VMPXe w naszej puli podnosi cenę → arbitrażyści sprzedają VMPXe na X1 i wycofują kolaterał na ETH**: pętla, w której część wartości odpływa do arbitrażystów |
| Zależności | Uniswap + trasa Wormhole/CCTP→Solana→Warp X1 (Warp X1 Labs jest strażnikiem) | ta sama trasa |
| Symulacja (LP 5 tys. USD, zasilenie 1 tys. USD) | +728 USD LP, cena X1 na koniec −2,2% vs ETH | +807 USD LP, −2,2% vs ETH, +2 transakcje arbitrażowe |

**Rekomendacja.** Na pilotaż wybieram **A dla części VMPX**, ale z tokenów właściciela, a nie z rynku: właściciel deklaruje ok. 1,3% podaży, czyli ok. 1,41 mln VMPX. Do tego **XNT kupione na X1** (część B). Zakup VMPX z rynku ETH przy 5,6 tys. USD TVL to głównie płacenie slippage. Wariant B oddaje część wartości arbitrażystom. Przewaga B w symulacji (+79 USD) mieści się w szumie modelu.

**Nie zakładamy taniej trasy ETH → XNT.** Bezpośredniej nie ma (BLOKER). Wielohopowa trasa przez Solanę to 3 łańcuchy, 2 mosty strony trzeciej i ok. 8 USD + 1% (szacunek). Partie poniżej ~200 USD tracą więc >5% na samej trasie.

## Blokada LP

- XDEX: brak natywnego narzędzia do blokady LP (POTWIERDZONE w dokumentacji XDEX), ale LP tokeny da się spalić.
- **Domyślnie LP nie jest ani spalany, ani blokowany.** Zostaje na adresie Squads (3/5). Jeśli rynek wymaga dowodu zobowiązania, rozwiązaniem jest **vault Squads z time-lockiem** (Squads v4 ma `time_lock` dla transakcji, do potwierdzenia na X1) albo prosty program vestingowy po audycie.
- **Uwaga:** blokada tokenów LP nie chroni rezerwy WXNT przed handlem. Każdy może sprzedać VMPXe do puli i wyciągnąć WXNT. Blokada chroni tylko przed wycofaniem płynności przez właściciela.
- CLMM / pozycje NFT: XDEX ich nie ma. Gdyby LP trafiał na inny DEX z CLMM, pozycja byłaby NFT z innym ryzykiem (zakres cen, brak fungibility).

## Ryzyko dostawcy płynności (z symulacji)

- Przy zrównoważonym rynku (sell bias 0,5) IL wobec HODL wynosi −5% do −18% rocznie, głównie przez zmienność XNT (model: 5% dziennie).
- **Przy przewadze sprzedaży (0,65) LP traci 56–100% wartości.** Most łączy presję sprzedaży z X1 z maleńką pulą na Ethereum, więc obie pule się wyczerpują. To najważniejszy wniosek ekonomiczny: **LP na X1 nie obroni ceny VMPX**, jeśli posiadacze chcą sprzedawać.

## Wyniki modelu (skrót z `economics/results.md`)

- Próg rentowności przy 3% i OPEX 60 USD/mies. to ok. **2000 USD/mies.** wolumenu ETH→X1. Dziś wolumen DEX na Ethereum to ok. 300 USD/mies.
- Przy LP 5 tys. USD i opłacie 3%: przychód 186–306 USD rocznie, czyli 25–42% OPEX. **LP z opłat: 0 USD** (batch nigdy nie osiąga progu).
- Przy LP 20 tys. USD i opłacie 3%: przychód 434–785 USD rocznie (55–100% OPEX). LP z opłat: ok. 0.
- Wniosek: płynność musi być zasilona kapitałem właściciela. Opłata 3% to w praktyce mechanizm „most się częściowo sam opłaca”, a nie źródło LP.
