# 10 — Czynności wymagające stron zewnętrznych

| # | Czynność | Kto | Wymagane? | Status |
|---|---|---|---|---|
| 1 | Stanowisko wobec prywatnej reprezentacji VMPX na X1 (konflikt z ewentualnym oficjalnym tokenem lub TGE) | Fair Crypto Foundation / Jack Levin / X1 Labs | **Tak, przed publicznym pilotażem** | otwarte |
| 2 | Potwierdzenie ID programów: XDEX (dwa różne w dokumentacji), Squads v4, Token-2022 na mainnecie | odczyt on-chain (operator) + ewentualnie XDEX | Tak | otwarte (`check-x1.mjs`) |
| 3 | Użycie publicznego zbioru walidatorów Hyperlane dla Ethereum (6/9) w ISM na X1 | brak zgody potrzebnej (checkpointy są publiczne); warto poinformować Abacus Works | Opcjonalne (wariant A) | do testu |
| 4 | Dopisanie X1 do publicznego hyperlane-registry | PR do hyperlane-xyz/hyperlane-registry | Nie (prywatny registry wystarcza) | — |
| 5 | Niezależni sygnatariusze atestacji (2–3) | zaufane podmioty z ekosystemu X1 | Rekomendowane przed szerszym publicznym użyciem | — |
| 6 | Przegląd bezpieczeństwa kontraktów i konfiguracji | firma audytorska | Rekomendowane | — |
| 7 | Trasa ETH→XNT dla skarbca (Wormhole/CCTP → Solana → Warp X1 Labs → XDEX) | Wormhole, Circle, X1 Labs, XDEX | Tylko dla automatycznego zasilania LP | — |
| 8 | Alternatywa bez własnej infrastruktury: dodanie Wormhole-wrapped VMPX do Warp Bridge (Solana↔X1) | X1 Labs | Nie (plan B) | zapytać |
| 9 | Dostawca RPC Ethereum (relayer, monitor) | np. własny węzeł albo komercyjny | Tak | — |
| 10 | KMS / HSM dla kluczy atestacji | AWS / GCP / własny HSM | Tak | — |
| 11 | Listing metadanych (ikona, nazwa) w X1 Wallet i eksplorerze | X1 Labs (hard-coded rejestr w x1-explorer) | Nie | — |

Wszystkie pozostałe kroki operator może wykonać sam, na swoich węzłach X1.
