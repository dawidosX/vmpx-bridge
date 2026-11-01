# Zakres przeglądu bezpieczeństwa

## W zakresie (nasz kod i konfiguracja)

| Plik | Opis |
|---|---|
| `evm/src/VmpxCollateralRouter.sol` | lockbox VMPX. Dziedziczy po `HypERC20Collateral` (@hyperlane-xyz/core 12.2.0) i działa za TransparentUpgradeableProxy |
| `evm/src/VmpxEthFeeHook.sol` | opłata w ETH (post-dispatch hook) |
| `evm/script/DeployEth.s.sol` | wdrożenie: graf uprawnień, ISM, hooki |
| `svm/warp-route/token-config.json`, `svm/registry/**` | konfiguracja X1 |
| `agents/*`, `testnet/*` | konfiguracja i operacje (klucze, polityki relayera) |
| `evm/test/*` | czy testy dowodzą tego, co deklarują |

## Poza zakresem, ale istotne interakcje

Kod upstream Hyperlane, w tym:
- `TokenRouter`
- `LpCollateralRouter` i `MovableCollateralRouter`: odziedziczone funkcje, które nadal da się wywołać
- `Mailbox`: kolejność hooków (requiredHook, potem hook nadawcy)
- `StaticAggregationHook` / `StaticAggregationIsm`
- `RateLimitedIsm`, `PausableIsm`, `PausableHook`
- program Sealevel `hyperlane-sealevel-token` (synthetic)

## Model zaufania (założenia)

| Rola | Kontrola | Uprawnienia |
|---|---|---|
| Atestatory X1 | operator, 5 z 7 | podpisują wiadomości X1→ETH (odblokowanie kolaterału) |
| Atestatory ETH | publiczny zbiór Hyperlane 6/9 albo operator | podpisują ETH→X1 (mint) |
| Admin | Safe → Timelock 48 h | upgrade, ISM, hook, enroll, parametry opłat |
| Guardian | osobny Safe | pauza depozytów i odblokowań, anulowanie operacji w timelocku |
| Price bot | hot key | cena referencyjna w granicach on-chain |
| Właściciel X1 (Squads) | — | ISM tokena, routery, upgrade programów |

## Niezmienniki do weryfikacji

1. `VMPX.balanceOf(lockbox)` == podaż VMPXe × 1e9 + wiadomości w drodze (oba kierunki).
2. Brak odblokowania bez spalenia i brak mintu bez blokady.
3. Każda wiadomość jest przetwarzana najwyżej raz.
4. Opłata nie zmienia liczby tokenów użytkownika i nie da się jej obejść.
5. Pauza nie powoduje utraty środków ani wiadomości.
6. Guardian nie może przenieść środków ani zmienić kodu.
