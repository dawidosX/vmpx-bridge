# 02 — Porównanie protokołów i decyzja

Stan na 2026-10-28. Szczegóły źródeł są w `01-feasibility.md`, wersje w `05-audit-matrix.md`.

## Nazwy, których nie wolno mylić

- **Hyperlane Warp Routes** to standard tokenów Hyperlane (`HypERC20Collateral`, `hyperlane-sealevel-token`).
- **„Warp Bridge” X1 Labs** (app.bridge.x1.xyz) to osobny most Solana↔X1 na „guardian multisig”. Nic nie wskazuje, że jest zbudowany na Hyperlane.
- **„XBridge” XenDEX** to ścieżka swapów przez pule, a nie most tokenów. **„XDEX Bridge”** jest na razie tylko w sekcji „Future” dokumentacji.

## Tabela

| Kryterium | Hyperlane Warp Route | Wormhole WTT / NTT | LayerZero OFT | Ekosystem X1 (Warp Bridge X1 Labs) | Dwa skoki: Wormhole ETH→Solana + Warp Solana→X1 |
|---|---|---|---|---|---|
| Wdrożenie na X1 bez zgody dostawcy | **Tak**: permissionless, CLI `core deploy` dla Sealevel | **Nie**: Guardianie nie obserwują X1. Skopiowanie programu nie daje ich podpisów | **Nie**: brak Endpointu, który wdraża LayerZero Labs | nie dotyczy | ETH→Solana: tak (WTT attestation jest permissionless). Solana→X1: tylko jeśli X1 Labs doda token |
| Zgody i współpraca | brak. Opcjonalnie Hyperlane: dopisanie do registry | governance Wormhole (dodanie X1) | LayerZero Labs (Endpoint) | X1 Labs | X1 Labs |
| Oba kierunki | tak | — | — | tylko Solana↔X1 | tak, ale przez Solanę: dwa mosty, dwa ryzyka |
| Weryfikacja | MultisigISM (ECDSA m-of-n) + opcjonalnie PausableIsm i RateLimitedIsm | 13/19 Guardianów | DVN | „guardian multisig” (szczegóły niepublikowane) | Guardianie + multisig X1 Labs |
| Kto obserwuje X1 | **nikt poza nami**: atestatory operatora (próg 5/7) | — | — | X1 Labs | X1 Labs |
| Audyty | EVM: wiele (ToB, ChainLight, Hacken, FYEO), żaden nie obejmuje core 12.2.0. SVM: Sherlock 02/2025 @84f886b (0 High/Med), sec3. Agenci: brak | NTT: Cyfrin, Cantina, OtterSec, Neodyme | nie badano (bloker) | nie znaleziono | Wormhole: wiele. Warp X1: brak |
| Licencja | Apache-2.0 | Apache-2.0 | MIT + LZBL-1.2 + BUSL-1.1 | nieznana | — |
| Utrzymanie kodu | aktywne (agents-v3.0.0 z 2026-10-23) | aktywne | aktywne | — | — |
| Modyfikacje | rejestr X1, własny ISM, 3 drobne ograniczenia lockboxa, hook opłaty w ETH | własny transceiver + atestacja ≈ własny most | niemożliwe bez LZ | brak (to nie nasz kod) | brak |
| Koszt jednorazowy (szac.) | ~0,05–0,15 ETH gas + ~15–30 XNT rent | — | — | 0 | ~0,01 ETH attestation |
| Koszt miesięczny (szac.) | marginalnie ~40–120 USD, bo operator ma już węzły X1 (KMS, S3, RPC ETH, gas relayera). Bez własnych węzłów 250–600 USD | — | — | 0 | 0 |
| Wykorzystanie istniejącej infrastruktury | Mailbox Hyperlane na Ethereum i (opcjonalnie) publiczni walidatorzy ETH do mintu | — | — | pełne | pełne |

## Decyzja

**Wybieram Hyperlane Warp Route: `VmpxCollateralRouter` (Ethereum) ↔ `hyperlane-sealevel-token` synthetic (X1).**

Uzasadnienie:
1. To jedyna opcja, którą operator może uruchomić sam, bez zgody Wormhole, LayerZero ani X1 Labs.
2. Operator ma własne węzły X1, więc odpada największy koszt Hyperlane, czyli utrzymanie atestatorów i relayera.
3. Kod jest otwarty, a audyty obejmują zarówno część EVM, jak i Sealevel. Zastrzeżenia co do wersji opisuje `05-audit-matrix.md`.
4. Hyperlane ma na Ethereum gotowe moduły (PausableIsm, RateLimitedIsm, AggregationIsm). Ograniczają one szkody przy przejęciu kluczy atestatorów.

**Wariant rezerwowy, jeśli X1 Labs się zgodzi:** dwa skoki przez Solanę (Wormhole WTT + Warp X1 Labs). Nie trzeba wtedy własnej infrastruktury, ale zaufanie leży u dwóch stron trzecich, a UX jest gorszy. Warto zapytać X1 Labs równolegle; to nic nie kosztuje.

**Główne ryzyko wybranego modelu.** X1→ETH (odblokowanie kolaterału) zależy wyłącznie od atestatorów operatora. Most jest więc **powierniczy** względem operatora. Środki zaradcze opisują `03-architecture.md` i `04-threat-model.md`: osobne klucze w KMS, próg 5/7, limit dzienny i pauza na Ethereum, jawna lista atestatorów i docelowo 2–3 niezależnych sygnatariuszy.

## Tańszy zakres pilotażu, jeśli pełny model nie ma sensu ekonomicznego

Pilotaż „bez publicznego ryzyka”:
- Testnet (Sepolia ↔ X1 testnet) z pełną konfiguracją, potem mainnet z **limitem 1 000 000 VMPX/dobę** (≈1,1 tys. USD przy dzisiejszej cenie) i wyłącznie z frontendu operatora.
- Brak automatyzacji skarbca. Ręczne operacje multisig.
- Jasna informacja w UI, że most jest powierniczy i pilotażowy.

Ograniczenia: brak niezależnych sygnatariuszy, brak audytu modyfikacji i brak IGP (relayer dopłaca gas). Szczegóły w `08-runbook.md` §7.
