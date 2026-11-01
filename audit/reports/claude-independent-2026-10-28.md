# Raport przeglądu: Claude (niezależny agent), 2026-10-28, commit przed poprawkami rundy 1

> Raport niezależnego agenta. Agent dostał kod, zakres i model zaufania, ale nie dostał wniosków autora. PoC zostały napisane i uruchomione w kopii repo (`/tmp/review`). Status poprawek jest w `docs/12-review-findings.md`.

## Ustalenia

| ID | Sev | Tytuł | Lokalizacja | Pewność |
|---|---|---|---|---|
| H-1 | High | Własny hook routera zastępuje domyślny hook Mailboxa. Depozyty nie trafiają do MerkleTreeHook, więc każdy depozyt ETH→X1 zostaje zablokowany i nigdy nie jest mintowany | `evm/script/DeployEth.s.sol` (krok hooków) | wysoka (PoC uruchomiony; topologia mainnet/testnet4 sprawdzona w `typescript/infra/config/environments/mainnet3/core.ts`) |
| M-1 | Medium | Wypłaty X1→ETH bez IGP i bez minimum. Każdy może opróżnić ETH relayera „pyłowymi” spaleniami i zatrzymać wypłaty | `agents/relayer.env.example`, `testnet/07-agents.sh`, `svm/warp-route/token-config.json` | wysoka |
| M-2 | Medium | Pojedyncza wiadomość X1→ETH większa niż pojemność RateLimitedIsm nie może zostać dostarczona. Strona X1 nie zna tego limitu | `DeployEth.s.sol`; upstream `RateLimitedIsm.verify` | wysoka (PoC) |
| M-3 | Medium | Dzienną pojemność odblokowań można tanio zmonopolizować (griefing dostępności) | `DeployEth.s.sol` | wysoka (PoC) |
| M-4 | Medium | Timelock 48 h nie daje realnego okna wyjścia. Uprawnienia po stronie X1 omijają go całkowicie | `DeployEth.s.sol`; właściciel tokena i ISM na X1 | wysoka |
| L-1 | Low | Dziedziczone `setFeeRecipient` i `setFeeHook` działają: właściciel może pobrać dodatkowe eVMPX od użytkowników z otwartym approve albo zablokować depozyty | upstream `TokenRouter` | wysoka (PoC) |
| L-2 | Low | Pojemność rate-limitu jest obcięta poniżej `RATE_CAP` (dzielenie przez 86400). Wiadomość równa `RATE_CAP` utknie na zawsze | upstream `RateLimited.setRefillRate` | wysoka (PoC) |
| L-3 | Low | Hook opłaty należy do EOA deployera, dopóki timelock nie zaakceptuje własności (≥48 h) | `DeployEth.s.sol` | wysoka |
| L-4 | Low | Skrypt deployu nie waliduje ról, unikalności walidatorów ani opóźnienia timelocka | `DeployEth.s.sol` | wysoka |
| L-5 | Low | Ogłoszone zmiany ceny i parametrów nie wygasają, reset ceny nie ma anulowania, a wykonać je może każdy | `VmpxEthFeeHook.sol` | wysoka |
| L-6 | Low | Opłata spada przy nieaktualnej cenie. Bot cenowy może sprowadzić opłatę do minimum | `VmpxEthFeeHook.sol` | wysoka |
| L-7 | Low | Wiadomości X1→ETH z odbiorcą `0x0` albo z niezerowymi górnymi bajtami są niedostarczalne lub trafiają gdzie indziej. Odbiorcę sprawdza tylko kierunek ETH→X1 | `VmpxCollateralRouter.sol`; upstream `_handle` | średnia |
| I-1 | Info | `donate()` (payable) i funkcje ERC-4626 nadal są wywoływalne. Przekazane tam tokeny i ETH przepadają | upstream `LpCollateralRouter.donate` | wysoka |
| I-2 | Info | MessageId multisig ISM ignoruje domenę źródłową. Domeny rozróżnia tylko enrollment routera | upstream | wysoka |
| I-3 | Info | Operacje: klucze hex w zmiennych środowiskowych, słaby skan sekretów w `09-collect.sh`, `reorgPeriod 0` na X1, placeholdery TODO w konfiguracji mainnet | `testnet/*`, `agents/*`, `svm/*` | średnia |

### H-1 (skrót)

`Mailbox.dispatch` wywołuje `requiredHook` (na Ethereum i Sepolii to `ProtocolFee` z zerową opłatą), a potem hook nadawcy. Domyślny hook (zawierający MerkleTreeHook) jest używany tylko wtedy, gdy nadawca nie ma własnego hooka. `router.setHook(aggregation[PausableHook, VmpxEthFeeHook])` zastępował go, więc wiadomość nigdy nie trafiała do drzewa merkle. Walidatory nie mogły jej podpisać, a środki użytkownika zostawały w lockboxie.

Testy tego nie wykryły, bo `MockMailbox` i sztuczne rooty pomijają drzewo merkle.

Poprawka: `hooks = [pauseHook, MerkleTreeHook, feeHook]` oraz test na prawdziwym Mailboxie z ProtocolFee.

### M-4 (skrót)

- Safe jest jednocześnie proposerem, executorem i cancellerem, a guardian nie może anulować.
- Większość kolaterału nie zdąży wyjść w ciągu 48 h, bo wyjście ogranicza rate-limit.
- Właściciel tokena na X1 może natychmiast podmienić ISM, routery albo walidatorów, zmintować VMPXe bez pokrycia i spalić je na odblokowanie prawdziwych eVMPX, w tempie `RATE_CAP` na dobę.

## Sprawdzone i w porządku (według recenzenta)

- Inicjalizacja proxy jest atomowa, a implementacja ma `_disableInitializers`. Nie ma kolizji storage, bo jedyny dodatek to immutable `dustUnit`.
- Dust guard: arytmetyka 9/18 dec jest dokładna, a granice u64 na X1 są bezpieczne.
- Odblokowanie wymaga Mailboxa (ochrona przed replay), wszystkich 3 modułów ISM i `onlyRemoteRouter`. Odrzucane są zmieniona kwota, obcy nadawca, nieznany origin i duplikaty podpisów.
- RateLimitedIsm działa tylko na ruch przychodzący, tylko dla `recipient = proxy`, w jednostkach 18 dec. Jego permissionless `verify` nie da się uprzedzić.
- Rebalance jest niemożliwy, bo `addBridge` revertuje. `withdraw` i `redeem` nie ruszają kolaterału, bo nie ma udziałów.
- Przepływ ETH w hooku opłaty jest poprawny: dokładny quote, nadwyżka wraca do nadawcy, w hookach nie zostaje ETH, a reentrancy jest nieszkodliwe.
- Guardian może pauzować, ale nie może zmieniać kodu ani konfiguracji. Ścieżka timelock i upgrade zachowuje stan.
- eVMPX nie ma hooków ani opłat transferowych.

## Luki w testach (według recenzenta)

- Brak prawdziwego Mailboxa (stąd H-1). `DeployEth` nie był wykonywany w testach.
- Test donate nie wywoływał `donate`.
- Brak testów dla `setFeeRecipient`, `setFeeHook`, `addRebalancer`, `redeem`, `unenrollRemoteRouter` i `setDestinationGas`.
- Test rate-limitu traktował trwałe zablokowanie jako sukces.
- Testy hooka obejmowały tylko `quoteDispatch`.
- Niezmiennik testował jednego, uczciwego aktora.
