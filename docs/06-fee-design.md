# 06 — Projekt opłaty mostowej

## Założenie biznesowe

Opłata wynosi 3% wartości transferu i jest płacona **osobno w ETH**. Użytkownik deponuje N VMPX i dostaje N VMPXe. Nie ma żadnych potrąceń w tokenie.

## Problem wyceny

- Pula VMPX/WETH ma ok. 5,6 tys. USD TVL przy ok. 10 USD wolumenu dziennie, a oracle nie istnieje.
- **Cena spot** z tej puli jest bezużyteczna: przesunięcie jej o 50% kosztuje kilka tysięcy USD i da się je cofnąć w tej samej transakcji (flash loan).
- **TWAP z Uniswap V3** jest trudniejszy do zmanipulowania, ale przy takim wolumenie obserwacje są rzadkie. Przesunięcie TWAP na 30 min kosztuje tylko utrzymanie ceny przez kilka bloków przy niewielkim kapitale. Do tego `observationCardinality` puli jest nieznane.
- Nasza własna pula na X1 nie może być źródłem ceny (zastrzeżenie z briefu).
- Wnioski z możliwej manipulacji są asymetryczne:
  - Zaniżenie ceny obniża opłatę atakującego, więc zyskuje on najwyżej różnicę opłaty.
  - Zawyżenie ceny może być griefingiem wobec innych użytkowników.
  - **Żaden scenariusz nie dotyka kolaterału**: opłata nie wpływa na liczbę mintowanych tokenów.

## Rozwiązanie zaimplementowane: `VmpxEthFeeHook`

```
fee = clamp( N × refPrice × feeBps / 10 000 , minFeeWei , maxFeeWei )
if (now > priceUpdatedAt + maxPriceAge) fee = staleFallbackFeeWei
```

| Element | Wartość w testach / propozycja | Gdzie wymuszone |
|---|---|---|
| `MAX_FEE_BPS` (publiczny limit) | 300 (3%) | immutable |
| `MAX_FEE_CAP_WEI` (limit kwotowy) | 0,05 ETH | immutable |
| `PARAM_DELAY` | 3 dni na każdą zmianę parametrów i na reset ceny | immutable |
| `feeBps` | 300 | parametr ≤ MAX_FEE_BPS |
| `minFeeWei` | 0,0002 ETH (pokrywa ostatnią milę i odstrasza spam) | parametr |
| `maxFeeWei` | 0,02 ETH (przy dużych kwotach 3% byłoby absurdalne) | parametr ≤ MAX_FEE_CAP_WEI |
| `staleFallbackFeeWei` | 0,001 ETH (most działa dalej, nawet gdy bot cenowy padnie) | parametr ≤ maxFeeWei |
| Aktualizacja ceny | rola `priceUpdater`: maks. ±20% na krok, min. 1 h odstępu | `updatePrice` |
| Duża korekta ceny | owner → `announcePriceReset`, wykonanie po 3 dniach | `executePriceReset` |
| Nadpłata | zwracana w tej samej transakcji na `refundAddress` (= `msg.sender` routera) | `_refund` |
| Niedopłata | revert `InsufficientFee` | `_postDispatch` |
| Obejście | niemożliwe: hook jest `hook()` routera, a każde `transferRemote` go wywołuje | `test_underpaymentReverts` |
| Obce routery | `WrongSender` / `WrongOrigin` / `WrongDestination` | `_checkMessage` |
| Przychód | trzymany w hooku, wypłacany tylko do `beneficiary` (permissionless trigger) | `withdrawFees` |

**Skąd cena referencyjna.** Bot operatora liczy medianę z kilku niezależnych źródeł: TWAP 24 h z Uniswap V3, CoinGecko, DexPaprika. Odrzuca źródła z rozjazdem > 30% i publikuje wynik tylko wtedy, gdy zmiana przekracza 5%. Kontrakt i tak ogranicza każdy krok, więc przejęcie bota pozwala jedynie przesuwać opłatę o ≤20% na godzinę, w przedziale [min, max]. Bot nie jest częścią tego repo w wersji produkcyjnej (TODO). Klucz bota to osobny hot wallet bez innych uprawnień.

**Granice zmian ceny (przegląd Codex L-01).** `MAX_PRICE_CHANGE_BPS` ogranicza pojedynczą aktualizację (20%), a `MAX_DAILY_PRICE_CHANGE_BPS` łączną zmianę w **stałym oknie 24 h**: punkt odniesienia resetuje się, gdy okno minie. To nie jest okno kroczące, więc tuż przed i tuż po granicy okna zmiany liczą się osobno. Przejęty bot może wokół granicy okna przesunąć cenę o (1 + 50%)² − 1 = **+125% w ok. 6 godzin**: +50% w 3 krokach przed końcem okna i kolejne +50% w 3 krokach po nim (test `test_L1_fixedWindowBoundaryDocumented`). Opłatę nadal ogranicza `maxFeeWei`, a kolaterału to nie dotyczy. **Od przejścia na stałą opłatę 0,0002 ETH (`feeBps = 0`, `minFeeWei = maxFeeWei`, testnet: `hook-exec` 3 lis 2026) cena referencyjna nie wpływa na opłatę**, więc to okno ma znaczenie tylko historyczne. Konstruktor odrzuca cenę początkową 0 (Codex L-02).

**Alternatywa: stała opłata kwotowa.** Wystarczy ustawić `feeBps = 0` i `minFeeWei = X`. Dostajemy stałą opłatę za transfer bez żadnej zależności od ceny. Przy obecnej ekonomii jest to **rozsądniejsze na start**: opłata procentowa od wartości 0,001 USD/token i tak prawie zawsze trafia w `minFeeWei`. Dla 1 mln VMPX (~1100 USD) 3% to ok. 33 USD.

**Podpisane oferty (EIP-712).** Odrzucone na pilotaż. Wymagałyby wrappera (który da się obejść), serwera ofert i nonce. Nie dają przewagi nad ograniczoną ceną referencyjną.

## Kierunek X1 → Ethereum

- Użytkownik na X1 zwykle nie ma ETH na Ethereum. Nie każemy mu płacić w ETH.
- **Pilotaż:** brak opłaty projektu na tym kierunku. Koszt dostarczenia na Ethereum (gas relayera, ok. 300 tys. gas) pokrywa:
  - (a) operator, który uwzględnia go w opłacie ETH→X1, albo
  - (b) IGP Hyperlane na X1 (program audytowany) w XNT, z oracle `XNT/ETH` i gas price ustawianymi przez operatora.

  Rekomenduję (b) po testach. Pokazujemy wtedy osobną pozycję „koszt dostarczenia” w XNT, oddzieloną od opłaty projektu.
- Opłata projektu w tokenie na X1 wymagałaby programu `hyperlane-sealevel-fee`, który jest **nieaudytowany**. Nie w pilotażu.
- Opłata „pobierana przy odbiorze na Ethereum” jest niemożliwa bez zmiany `_handle` (więcej kodu poza audytem) i blokowałaby wypłaty. Odrzucone.

## Uczciwe zastrzeżenia

- 3% to parametr, a nie gwarancja opłacalności (patrz `economics/results.md`).
- Opłata **ogranicza** drobny arbitraż: w symulacji przy LP 5 tys. USD liczba transakcji arbitrażowych spada ze 132 do 102 rocznie. Nie eliminuje go i nie gwarantuje ceny.
- Zmiana parametrów jest jawna: zdarzenie `FeeParamsAnnounced`, 3 dni zwłoki i alert w monitoringu. Limit `MAX_FEE_BPS` jest niezmienny. Podniesienie go wymaga nowego hooka, a podmiana hooka przechodzi przez timelock routera (48 h, alert `HookSet`).
