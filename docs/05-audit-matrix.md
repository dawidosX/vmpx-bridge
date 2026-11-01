# 05 — Macierz audytów, wersji i modyfikacji

> Protokół z audytem to nie to samo co audytowane wdrożenie. **Żaden element tego wdrożenia nie przeszedł audytu w dokładnie tej wersji.**

## Przypięte wersje (2026-10-28)

| Komponent | Wersja / commit | Licencja |
|---|---|---|
| `@hyperlane-xyz/core` (npm, kontrakty EVM) | **12.2.0** (zależności vendored: OZ 4.9.3, OZ-upgradeable 4.9.3, forge-std 1.9.2) | Apache-2.0 / MIT |
| hyperlane-monorepo (Sealevel, client, agenci) | main `a9b3e8705816eda0e4e84b03592cadf944d8ce43`; agenci: tag `agents-v3.0.0` → `f556e18c9da88ce3d51a24164f22a7f27eb539fd` | Apache-2.0 |
| hyperlane-registry | `05582adc443835a2f9e308c5697a69d51ef3eb88` | MIT |
| Toolchain Sealevel | Solana CLI 3.0.14, SBF tools v1.51, Rust 1.86.0 (`toolchain.env`) | — |
| X1 node | x1-labs/tachyon `91ebdaf8…` (Agave 4.0.3 fork) | Apache-2.0 |
| solc (nasze kontrakty) | 0.8.22 (`via_ir = true`, optimizer 200) | — |
| Nasze źródła | `VmpxCollateralRouter.sol` sha256 `bea0a643…277f`; `VmpxEthFeeHook.sol` sha256 `b26b3b3d…a5f399` | Apache-2.0 |

## Macierz

| Komponent użyty | Audyt | Wersja audytu | Pokrycie naszej wersji | Uwagi |
|---|---|---|---|---|
| Mailbox ETH (istniejący) | ToB (v3, 2023-09), ChainLight | v3.x | n/d: używamy wdrożonego kontraktu, nie naszego | — |
| `HypERC20Collateral` / `TokenRouter` | ChainLight (warp route w core 5.12.0), ToB v3 | ≤ 5.12.0 | **Nie**. 12.x dodaje `LpCollateralRouter` (ERC-4626), `MovableCollateralRouter`, fee hooks | Nowe funkcje, których nie obejmuje audyt, wyłączamy (patrz niżej) |
| `StaticMessageIdMultisigIsm` | ToB v3, Hacken | v3 | częściowo: logika ISM bez większych zmian (do potwierdzenia diffem) | — |
| `StaticAggregationIsm` | ToB v3 | v3 | częściowo | — |
| `PausableIsm` | ChainLight Hooks/ISM v3.1 | 2025 Q2 | częściowo | — |
| `RateLimitedIsm` / `RateLimited` | ChainLight Hooks/ISM v3.1 | 2025 Q2 | **niepewne**: `RateLimited` w 12.2.0 ma nowe hooki (`_RateLimited_*`) | do diffu |
| Sealevel: mailbox, multisig-ism-message-id, validator-announce, token (synthetic), igp | Sherlock (02/2025): 0 High, 0 Medium, 8 Low/Info; sec3 (wcześniejszy, commit nieustalony) | `84f886b7b611a845064822d7dbe6e70396c00523` | **Budować z `84f886b`**, jeśli klient i agenci są z nim zgodni. Inaczej robimy przegląd diffu `84f886b..a9b3e870` (m.in. `fee_config` w tokenie) | Klon płytki, diff niewykonany: **TODO** |
| Sealevel: composite-ism, hyperlane-sealevel-fee, token-cross-collateral | **brak** | — | **nie używamy** w pilotażu | — |
| Agenci Rust (validator, relayer) | **nie znaleziono audytu** | — | — | Relayer nie może sfałszować wiadomości. Validator trzyma klucz atestacji |
| `VmpxCollateralRouter` (nasz) | **brak** | — | — | 3 ograniczenia + opłata v2 w VMPX (pkt 10), ~130 linii, testy w `evm/test` |
| `VmpxEthFeeHook` (nasz) | **brak** (przegląd LLM runda 1: `docs/12`) | — | — | Nie dotyka kolaterału, ~290 linii |
| `EmergencyPauser` (nasz) | **brak** | — | — | Tylko pause/unpause |
| XDEX (Raydium CP-Swap fork) | Oshield (06/2025) | nieznana | n/d (LP skarbca, nie most) | — |
| Warp Bridge X1 Labs | nie znaleziono | — | n/d (nie używamy) | — |

## Modyfikacje względem upstreamu (poza audytem)

1. `VmpxCollateralRouter._transferRemote`: revert dla `amount == 0`, `amount % 1e9 != 0` i `recipient == 0`.
2. `deposit`, `mint`, `maxDeposit`, `maxMint`: wyłączony vault LP (ERC-4626).
3. `addBridge`, `setRecipient`: wyłączony rebalancing kolaterału.
4. `VmpxEthFeeHook`: nowy kontrakt (hook typu `PROTOCOL_FEE`).
5. Konfiguracja: skala routera 1/1, konwersję decimals robi program Sealevel (`remoteDecimals: 18`). To ten sam wzór co trasa TONY base↔solanamainnet w monorepo.
6. `feeRecipient()` zawsze zwraca 0, a transfer revertuje, gdy ustawiony jest `feeHook` (L-1). `_disableInitializers()` w konstruktorze (proxy).
7. `EmergencyPauser` (nowy, ~90 linii): właściciel PausableHook i PausableIsm.
8. `VmpxEthFeeHook` po rundzie 1: dzienny limit zmian ceny, wygasanie ogłoszeń, execute tylko przez ownera, `cancelPriceReset`.
10. **Router v2 (31 paź 2026, niewdrożony na mainnecie):** `_transferRemote` napisane od nowa zamiast `super`, bo opłata w VMPX jest **potrącana z kwoty**: pobranie dokładnie N, `fee = floor(N × feeBps / 10 000)` zaokrąglone w dół do 1e-9 idzie do `treasury`, a wiadomość i lockbox dostają N − fee. `MAX_FEE_BPS = 500` (stała), `setBridgeFee(bps, treasury)` tylko dla właściciela (Timelock), stan w przestrzeni ERC-7201 (`vmpx.storage.BridgeFee`). Zdarzenie `BridgeFeeTaken`, widok `quoteBridgeFee`. Testy: `evm/test/BridgeFee.t.sol` (w tym upgrade z zamrożonej kopii v1 i inwarianty), `evm/test/ForkSepoliaV2.t.sol` (fork Sepolii). Wymaga audytu przed mainnetem.
9. Kompilacja z `via_ir = true`. Bez tego core 12.2.0 nie kompiluje się w tej konfiguracji („stack too deep”), więc bytecode różni się od buildów Hyperlane. **TODO:** sprawdzić ustawienia buildu Hyperlane i dopasować, jeśli się da.

## Niewyjaśnione / do zrobienia przed publicznym pilotażem

- [ ] Diff `84f886b..a9b3e870` dla programów Sealevel, których używamy.
- [ ] Diff `RateLimited.sol` i `HypERC20Collateral` 12.2.0 względem wersji audytowanej przez ChainLight.
- [ ] Przegląd bezpieczeństwa (niezależny) dwóch naszych kontraktów i konfiguracji ISM. Szacunkowo 2–5 dni pracy audytora, ~3–10 tys. USD (szacunek, nie wycena).
- [ ] Findings Low/Info z raportu Sherlock: sprawdzić, czy którekolwiek dotyczą naszej konfiguracji.
- [ ] Odtwarzalne buildy programów SVM i publikacja hashy (brak rejestru verified builds na X1).

## Następna wersja routera (lista zmian)

- `recoverEth(address to)` tylko dla właściciela (Timelock): odzyskanie ETH wysłanego przez upstreamowe `donate()` (`payable`, nie da się go wyłączyć; przegląd Codex I-01, decyzja właściciela z 31 paź 2026). Funkcja przenosi wyłącznie ETH z routera, nigdy VMPX; testy: brak dostępu dla innych, saldo kolaterału bez zmian.
