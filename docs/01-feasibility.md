# 01 — Raport wykonalności

Data sprawdzenia wszystkich pozycji: **2026-10-28**. Statusy:
- **POTWIERDZONE** — źródło pierwotne: kod, dokumentacja projektu albo odczyt z eksplorera.
- **NIEPOTWIERDZONE** — źródło wtórne, sprzeczne dane albo brak odczytu on-chain.
- **BLOKER** — potwierdzony brak albo coś, co blokuje dany wariant.

Ograniczenie środowiska: z sandboxa nie było dostępu do RPC X1 (`rpc.*.x1.xyz`) ani do publicznych RPC Ethereum. Odpowiedzi to 403 / „fetch failed”. Żadna wartość poniżej nie pochodzi z bezpośredniego `eth_call` ani z wywołania RPC X1. Skrypt `svm/compat/check-x1.mjs` należy uruchomić z węzła operatora.

## 1. Token źródłowy VMPX

| Pozycja | Ustalenie | Źródło | Status |
|---|---|---|---|
| Adres | `0xb48Eb8368c9C6e9b0734de1Ef4ceB9f484B80b9C`, etykieta Etherscan „VMPX: VMPX Token 2”, deployer `0xe776…a0d5` | etherscan.io/address/… | POTWIERDZONE |
| Nazwa / symbol / decimals | `VMPX` / `VMPX` / 18. W projekcie token na Ethereum nazywamy VMPX | kod źródłowy (`ERC20("VMPX","VMPX")`) | POTWIERDZONE |
| Cap | 108 624 000 × 1e18 (`ERC20Capped`) | kod | POTWIERDZONE |
| totalSupply | = cap (mint wyczerpany) | Etherscan, CoinGecko, Bitquery | POTWIERDZONE pośrednio. Brak `eth_call` |
| Proxy / upgrade | brak | kod, ABI | POTWIERDZONE |
| Owner / role / admin | brak (brak Ownable i AccessControl) | kod, ABI | POTWIERDZONE |
| Publiczny mint | `mint(uint256 power)`: `tx.origin == msg.sender`, `power < 196`, limit cap. Po wyczerpaniu cap zawsze revert | kod | POTWIERDZONE |
| Podatek, hooki, blacklista, pauza, rebase | brak (`_transfer` nie jest nadpisany) | kod | POTWIERDZONE |
| Zwracane wartości | standard OZ 4.8: `bool` + revert przy błędzie | kod | POTWIERDZONE |
| Kompilator | 0.8.17, optimizer 20 runs, Exact Match | Etherscan | POTWIERDZONE |
| Zgodność z lockboxem | pełna: standardowy ERC-20 bez efektów ubocznych, więc `HypERC20Collateral` nie potrzebuje żadnych obejść | analiza | POTWIERDZONE |
| **Podróbka** | „VMPX” pod `0x428FE664…85dB` (0.6.12, funkcje typu owner). Whitelistujemy **tylko** `0xb48E…` | Ethplorer / Etherscan | POTWIERDZONE |
| Płynność | Uniswap V3 VMPX/WETH `0xd6eb9af2…6a66`: ~5,6 tys. USD. Wolumen ~10 USD/dobę. Pule V4 ETH/VMPX i HEX/VMPX oraz V3 XEN/VMPX mają marginalne wartości | DexPaprika, DEXTools | POTWIERDZONE (rząd wielkości) |
| Fee tier puli V3 | 1% (tylko wzmianka użytkowników z 2023) | ChainCatcher | NIEPOTWIERDZONE |
| Cena / FDV | ~0,0010–0,0012 USD, FDV ~118–132 tys. USD (odpowiada „~129 745 USD” z briefu). MEXC 0,0237 to odstająca wartość | DexPaprika, CoinGecko, Etherscan | POTWIERDZONE (przedział) |
| Oracle (Chainlink itp.) | nie znaleziono | wyszukiwanie | NIEPOTWIERDZONE (brak dowodu nieistnienia) |
| Emitent | Fair Crypto Foundation / Jack Levin (stała `AUTHORS` w kodzie) | kod, vmpx.io | POTWIERDZONE |
| Związek z X1 | vmpx.io: VMPX „qualify for the TGE of the X1 blockchain” (zapowiedź z ery EVM X1) | vmpx.io | POTWIERDZONE (zapowiedź). Obecne warunki: NIEPOTWIERDZONE |
| **Oficjalny VMPX na X1** | nie znaleziono. x.com, docs.x1.xyz/tokens i eksplorer były niedostępne | — | **BLOKER przed publicznym pilotażem**. Trzeba potwierdzić u emitenta, żeby uniknąć konfliktu z ewentualnym oficjalnym tokenem |

## 2. Ethereum: infrastruktura Hyperlane

| Pozycja | Ustalenie | Źródło | Status |
|---|---|---|---|
| Mailbox | `0xc005dc82818d67AF737725bD4bf75435d065D239` | hyperlane-registry@05582adc `chains/ethereum/addresses.yaml` | POTWIERDZONE (registry) |
| MerkleTreeHook / ValidatorAnnounce | `0x48e6c30B…8CCA` / `0xCe74905e…ff96` | jw. | POTWIERDZONE (registry) |
| reorgPeriod w registry | 15 bloków (~3 min). Pełna finalność ~2 epoki (~13 min) | `chains/ethereum/metadata.yaml` | POTWIERDZONE |
| Publiczny zbiór walidatorów Ethereum | 6 z 9 (AW, DSRV, Zee Prime, Staked, Luganodes, Mitosis, Substance Labs, …) | `typescript/sdk/src/consts/multisigIsm.ts` @a9b3e870 | POTWIERDZONE (konfiguracja). Czytelność ich checkpointów dla naszego relayera: NIEPOTWIERDZONE |
| IGP Hyperlane dla nieznanej domeny | revert „Configured IGP doesn't support domain” | `InterchainGasPaymaster.sol:400` | POTWIERDZONE. Pilotaż jedzie bez IGP Hyperlane (własny hook opłaty) |
| Opłata w natywnym ETH | możliwa przez post-dispatch hook routera. `ProtocolFee` pobiera tylko stałą kwotę, więc procent wymaga własnego hooka (`VmpxEthFeeHook`) | kod core 12.2.0 | POTWIERDZONE |
| Wymagany hook Mailboxa na mainnecie | czy pobiera opłatę: nie sprawdzono | — | NIEPOTWIERDZONE (wycena `quoteTransferRemote` uwzględni go automatycznie) |

## 3. X1

| Pozycja | Ustalenie | Źródło | Status |
|---|---|---|---|
| Dokumentacja | docs.x1.xyz | docs.x1.xyz | POTWIERDZONE |
| Mainnet | start 2025-10-06. Później „Buenos Aires reboot”: rollback, nowy punkt genesis w epoce 10 | docs.x1.xyz/readme.md, …/mainnet-buenos-aires-reboot.md | POTWIERDZONE. Data rebootu: NIEPOTWIERDZONE |
| Nazwy myląco podobne | „X1” EVM (chainId 204005, FairCrypto/go-x1) to stara wersja. OKX X Layer (`xlayer` w registry) i X1 EcoChain to inne projekty. „XNT” w CoinGecko to Neptune Privacy | sequence chainlist, registry | POTWIERDZONE |
| RPC | `https://rpc.mainnet.x1.xyz`, `https://rpc.testnet.x1.xyz`. Limity: 300 req/5 s, 40 send/5 s | docs …/resources.md, …/rpc-rate-limits.md | POTWIERDZONE |
| Eksplorer | explorer.mainnet.x1.xyz / explorer.testnet.x1.xyz (fork eksplorera Solany) | x1-labs/x1-explorer | POTWIERDZONE |
| Genesis hash | nieopublikowany | — | NIEPOTWIERDZONE. Odczyt: `getGenesisHash` |
| Runtime | Tachyon = fork Agave **v4.0.3** (od 2026-07-08). Własne feature-gates | x1-labs/tachyon `Cargo.toml` @91ebdaf8 | POTWIERDZONE |
| Opłaty | base fee = CU × 10, min. 1500 lamportów. Inaczej niż na Solanie | tachyon `fee/src/lib.rs` | POTWIERDZONE (kod). Aktywne gates: NIEPOTWIERDZONE |
| Narzędzia | docs: solana-cli 2.0.26, anchor 0.30.1, „fully SVM compatible” | docs …/create-programs-on-x1.md | POTWIERDZONE (deklaracja). Test: NIEPOTWIERDZONE |
| Programy Hyperlane Sealevel na Tachyon 4.0.3 | budowane toolchainem Solana 3.0.14 / SBF v1.51 | monorepo `rust/sealevel/programs/toolchain.env` | **NIEPOTWIERDZONE. Pierwszy test na testnecie X1** |
| SPL Token / Token-2022 | obecne (XDEX używa Token-2022 z rozszerzeniami, USDC.x to Token-2022) | XDEX docs, explorer | POTWIERDZONE (obecność). Te same ID na mainnecie: NIEPOTWIERDZONE |
| Metaplex Token Metadata | fork x1-labs `metaqbxx…518x1s`. Nie jest potrzebny: synthetic Hyperlane używa Token-2022 metadata | x1-labs/mpl-token-metadata | NIEPOTWIERDZONE (niekrytyczne) |
| Wrapped XNT | `So111…112` jako WXNT, 9 dec | x1-explorer `token-info.ts` | POTWIERDZONE (mint). Użycie przez DEX: NIEPOTWIERDZONE |
| DEX | XDEX (dawniej XenDEX) = fork Raydium CP-Swap, fungible LP token, `deposit`. **Sprzeczne ID programu**: `7EEuq61…QHf` (IDL / eksplorer) vs `sEsYH97…b4fN` (getting-started). Audyt Oshield 06/2025. Brak CLMM i narzędzia do blokady LP | xdexdocs, x1-explorer | POTWIERDZONE (typ). ID: NIEPOTWIERDZONE |
| Portfele | X1 Wallet (rozszerzenie Chrome, wydawca „jack”, v0.10.122). Backpack tylko z własnym RPC. Phantom wymieniony przez XDEX | Chrome Web Store, docs | POTWIERDZONE |
| Multisig | Squads v4 pod `DDL3Xp6i…Q941` według commita x1-explorer. Brak UI Squads dla X1 | x1-explorer git | NIEPOTWIERDZONE |
| Verified builds | nie znaleziono rejestru | — | NIEPOTWIERDZONE. Publikujemy własne hashe buildów |
| **Hyperlane na X1** | brak w registry (sealevel: eclipse, nara, solana, solaxy, sonicsvm, soon, svmbnb) | hyperlane-registry@05582adc | **BLOKER dla „gotowej” infrastruktury**: core wdrażamy sami |
| Wormhole / LayerZero na X1 | brak w `wormhole-sdk-ts` i w `lz-definitions@3.1.19` | jw. | **BLOKER** |
| „Warp Bridge” X1 Labs | Solana↔X1, „guardian multisig”. Nie ma związku z Hyperlane Warp Routes i nie obsługuje Ethereum | app.bridge.x1.xyz | POTWIERDZONE |
| Trasa ETH→XNT | brak bezpośredniej. Jest ETH →(Wormhole/CCTP)→ Solana USDC →(Warp)→ USDC.x →(XDEX)→ XNT | app.bridge.x1.xyz, x1report | Bezpośrednia: BLOKER. Wielohopowa: NIEPOTWIERDZONE |
| Cena XNT | 0,2397 USD (2026-10-28 14:25 UTC), pula XNT/USDC.X | x1report.com (strona trzecia) | NIEPOTWIERDZONE (jedno źródło) |
| Walidatory X1 | docs: „over 1,000”. Operator mostu deklaruje 10 własnych | docs | NIEPOTWIERDZONE |

## 4. Wnioski i blokery

1. **Technicznie wykonalne:** Hyperlane z Collateral na Ethereum i Synthetic na X1. Core na X1 wdrażamy sami, uruchamiamy własnych atestatorów i relayer. Wszystkie elementy są open-source (Apache-2.0), nie potrzeba niczyjej zgody.
2. **Bloker techniczny do zdjęcia na testnecie:** zgodność programów Sealevel (toolchain 3.0.14) z Tachyon 4.0.3. Weryfikuje to skrypt `svm/compat/check-x1.mjs` i próbne wdrożenie.
3. **Bloker formalny przed publicznym pilotażem:** stanowisko emitenta VMPX / X1 Labs wobec prywatnej reprezentacji. Do tego czasu nazwa i symbol w UI pozostają jednoznacznie nieoficjalne („VMPXe”, „unofficial”).
4. **Ekonomia** (`economics/results.md`): przy dzisiejszym wolumenie opłata 3% nie pokrywa nawet marginalnego OPEX. Nie zbuduje też LP. Płynność LP musi zasilić właściciel, a most jest usługą, nie źródłem przychodu.
