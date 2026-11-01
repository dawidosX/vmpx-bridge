# Przegląd zewnętrzny testnetu (Sepolia ⇄ X1 testnet), 2026-10-30

Źródło: niezależny recenzent zewnętrzny, przekazany przez właściciela 30 paź 2026. Oryginalny tekst jest niżej, bez zmian. Weryfikację każdej tezy przeprowadzono **na żywo** 30 paź 2026, tylko odczytem (`cast call` na Sepolii, `hyperlane-sealevel-client`/`solana` na `rpc.testnet.x1.xyz`), a także w kodzie i w wynikach e2e (`~/vmpx-bridge-testnet/logs/08-e2e.log`, `state/e2e-tx-report.md`).

## Weryfikacja

Adresy na Sepolii: router (proxy) `0x048C…f6C8`, impl `0xBe2d…e5d0`, ProxyAdmin `0x502b…9816`, Timelock `0x0665…7F8E`, AggregationIsm `0xd4BB…CE0a`, MessageIdMultisigIsm `0x9cb6…DF93`, PausableIsm `0xa4d4…eb9e`, RateLimitedIsm `0xc60b…3002`, PausableHook `0xf7f5…1227`, VmpxEthFeeHook `0x72BC…f3D8`, EmergencyPauser `0x921C…9f4F`, Mailbox `0xfFAE…4766`.

| # | Teza recenzenta | Werdykt | Dowód |
|---|---|---|---|
| 1 | Most to Hyperlane Warp Route: `HypERC20Collateral` za proxy EIP-1967 + Hyperlane Token Router na X1 | **POTWIERDZONE** | `cast implementation 0x048C…` → `0xbe2d…e5d0` (`VmpxCollateralRouter`, `HypERC20Collateral` 12.2.0 + ograniczenia, `evm/src/VmpxCollateralRouter.sol`). X1: program `8hA1…41fR` (`hyperlane-sealevel-token`), mint `GjSY…CBzj` Token-2022 + metadataPointer, 9 dec, mint authority = PDA mintu (`check-x1.mjs --post-deploy`: PASS) |
| 2 | Księgowość: lockbox 415 = podaż X1 415; 505 wpłat − 90 wypłat | **POTWIERDZONE** | `balanceOf(lockbox)` = 415e18. `getTokenSupply` (finalized, 3×) = 415 000 000 000. Wpłaty 5×100 + 5, wypłaty 40 + 40 + 10 (`e2e-tx-report.md`) |
| 3 | „Protocol fee of 0” przy burnie, czyli trasa nie pobiera opłaty | **ŚWIADOMA DECYZJA PROJEKTOWA** (częściowo) | Na X1→ETH w pilotażu nie ma opłaty projektu (`docs/06-fee-design.md:48–53`). Koszt dostarczenia użytkownik płaci w XNT przez IGP (to nie jest „fee” programu tokena). Na ETH→X1 opłatę projektu pobiera `VmpxEthFeeHook` (3%, min/max) w hooku routera (`hooks()` aggregation = `[PausableHook, MerkleTreeHook 0x4917…, VmpxEthFeeHook]`) |
| 4 | „Nie wiadomo, jakiego typu jest ISM; `0xd4bb…` to proxy, a `moduleType` wymaga argumentów” | **OBALONE** | `moduleType()` nie przyjmuje argumentów i zwraca **2 = AGGREGATION**. `modulesAndThreshold(0x)` = `[0x9cb6… (MessageIdMultisig, type 5), 0xa4d4… (PausableIsm, type 6), 0xc60b… (RateLimitedIsm, type 6)]`, próg **3/3**. Multisig: `validatorsAndThreshold` = 3 atestatory X1 operatora, próg **2**. `0xd4bb…` to klon minimal-proxy (278 B, bajtkod `363d3d37…`) z `StaticAggregationIsmFactory` Hyperlane, a nie proxy aktualizowalne: listy modułów nie da się zmienić. PausableIsm `paused()=false`, RateLimitedIsm `calculateCurrentLevel()` = `maxCapacity()` = 1 036 800e18 |
| 5 | „Pauza zablokowała prawdziwą wiadomość; wiadomości czekają i są dostarczane po wznowieniu” | **POTWIERDZONE** | Pauza 06:45:24 → unpause 06:56:36 (tx `0x0a17…945d`, `0xf520…f9f4`). Burn 10 o 06:45:38, unlock `0x6061…d005` o 06:56:48. 08: „unlock held for 10 min while paused”, „held unlock delivered after unpause (60s)” |
| 6 | „Przetestowano tylko odblokowanie w pauzie, nigdy zablokowany depozyt” | **OBALONE** | 08 (2026-10-30T06:29Z): `PASS deposit blocked while paused`, `PASS no tokens taken while paused` (`08-e2e.log:251–252`). Na łańcuchu nie ma po tym śladu, bo `cast send` symuluje transakcję przed wysłaniem. Revert w PausableHook kończy się na `eth_estimateGas`, więc tx nigdy nie trafia do mempoola. Testy jednostkowe: `test_guardianPausesDeposits_noFundsTaken` (`evm/test/Governance.t.sol:25`), `test_singlePauserStopsDepositsAndOnlyGuardianRestarts` (`evm/test/ReviewFixes.t.sol:244`) |
| 7 | „Sam lockbox nie jest pauzowalny; pauza żyje w kontrolerze `0x921c…`, który posiada `0xf7f5…` i `0xa4d4…`” | **POTWIERDZONE, ŚWIADOMA DECYZJA PROJEKTOWA** | `PausableHook.owner()` = `PausableIsm.owner()` = `0x921C…` (EmergencyPauser). Pauza depozytów to PausableHook w łańcuchu hooków, a pauza odblokowań to PausableIsm w AggregationIsm 3/3. Efekt jest równoważny pauzie lockboxa, bez dodawania kodu do kolaterału (`docs/13-pause-and-change.md`). `isPauser(0xdA83…495c)` = true, `guardian()` = `0x3B33…60A8` |
| 8 | „Jeden klucz `ASLb…N5Yg` kontroluje router, mailbox i ISM na X1; jest też mint/update authority” | **POTWIERDZONE (testnet), ŚWIADOMA DECYZJA; poprawka częściowa** | `solana program show`: upgrade authority programów tokena `8hA1…`, mailboxa `74gG…`, ISM otwartego `8b7z…`, ISM zamkniętego `2e7V…`, IGP `JLoJ…` i VA `Gb3k…` = `ASLb…`. Owner tokena i ISM = `ASLb…`. **Ale mint authority to nie `ASLb…`**, tylko PDA mintu (mintować może tylko program). Metadata update authority = `ASLb…`. Na mainnecie: Squads „X1-config” i „X1-upgrade” (`docs/13`, M-4) |
| 9 | „Owner lockboxa `0x0665…` to ten sam kontrakt, który jest ownerem mailboxa ETH” | **OBALONE** | `router.owner()` = `0x0665…` (nasz `TimelockController`). `Mailbox(0xfFAE…).owner()` = **`0xfaD1…031C`** (Hyperlane), czyli inny adres. Warstwa wiadomości i kolaterał mają niezależnych właścicieli |
| 10 | „Owner implementacji `0x0468…` to goły EOA, więc implementację można podmienić jednostronnie” | **OBALONE** (co do mechanizmu); **ŚWIADOMA DECYZJA testnetu** co do klucza | Implementację podmienia tylko `ProxyAdmin` (`cast admin` = `0x502b…`), którego `owner()` = Timelock `0x0665…`. `owner()` w storage implementacji nie ma żadnej władzy nad proxy: proxy używa własnego storage. Initializer implementacji jest zablokowany (`_disableInitializers()`, `evm/src/VmpxCollateralRouter.sol:52`; slot 0 = `0xff`; `test_implementationCannotBeHijacked`, `evm/test/Governance.t.sol:168`). **Rzeczywiste ryzyko testnetu jest gdzie indziej:** w timelocku PROPOSER/EXECUTOR/CANCELLER = `0x0468…` (`SAFE` w `testnet.env` to EOA), a `getMinDelay()` = **300 s**. Guardian `0x3B33…` ma tylko CANCELLER. Na mainnecie: Safe 3/5 i 172 800 s, wymuszane przez skrypt (`test_scriptRejects*`, L-4) |
| 11 | „Obcinanie 18→9: kwota niepodzielna przez 1e9 wei po cichu traci resztę; dodać próg dust” | **OBALONE** | Lockbox odrzuca takie kwoty: `if (_amount % dustUnit != 0) revert AmountNotMultipleOfDustUnit(...)` (`evm/src/VmpxCollateralRouter.sol:63–64`, `dustUnit` = 1e9 immutable). Na żywo: `cast call transferRemote(…, 1000000000000000001)` z konta testowego zwraca revert `0x641a25e7`, czyli `AmountNotMultipleOfDustUnit(1000000000000000001, 1000000000)`. Kwota okrągła przechodzi symulację. 08: `PASS dust amount rejected` ×3. Test: `test_dustAmountReverts` (`evm/test/Bridge.t.sol:103`), `testFuzz_scalingIsLossless`. Recenzent tego nie widział, bo revert następuje w symulacji, więc na łańcuchu nie powstaje żadna tx |
| 12 | Opóźnienia: ETH→X1 13–15 min, X1→ETH 27 s / 11 min; „przestańcie mówić, że to natychmiastowe” | **POTWIERDZONE** (z uzupełnieniem) | Pomiar z tx (niżej). ETH→X1 w warunkach normalnych: 13 min 30 s – 18 min 54 s. Depozyt 5 (13 min 14 s) był wstrzymany zamkniętym ISM, ale okno 10 min zmieściło się w czasie finalizacji. X1→ETH: 27 s. Wartość 11 min 10 s to wiadomość wstrzymana pauzą (dostarczona 12 s po wznowieniu), a nie zwykłe opóźnienie. Frontend: `frontend/README.md`, `frontend/index.html` |

### Opóźnienia (czas tx źródłowej → czas tx docelowej)

| kierunek | źródło | cel | czas | uwagi |
|---|---|---|---|---|
| ETH→X1 | `0x94a5…5576` 10-29 16:23:12 | `31v2fDM8…` 19:21:10 | 177 min 58 s | **wykluczone**: walidatory Sepolii bez historii (przed przejściem na wariant A) |
| ETH→X1 | `0xcb96…8c61` 10-29 19:25:36 | `32Jf5Auf…` 19:39:19 | 13 min 43 s | normalne |
| ETH→X1 | `0xf895…46f4` 10-29 19:45:00 | `tK7n9t6t…` 19:58:30 | 13 min 30 s | normalne |
| ETH→X1 | `0x917f…068c` 10-29 21:02:48 | `5w1TdAfF…` 21:21:42 | 18 min 54 s | normalne |
| ETH→X1 | `0x0463…ad31` 10-30 06:30:12 | `mUkJkfuM…` 06:44:52 | 14 min 40 s | normalne |
| ETH→X1 | `0x141a…7399` 10-30 06:57:12 | `5rnTvi9S…` 07:10:26 | 13 min 14 s | ISM zamknięty 06:57–07:07 |
| X1→ETH | `3CiVfPUo…` 10-29 19:58:48 | `0x2734…2196` 20:55:00 | 56 min 12 s | **wykluczone**: błąd konfiguracji IGP relayera (naprawione w 9fcdd37) |
| X1→ETH | `2cP9Eqos…` 10-30 06:44:57 | `0x5e84…a36a` 06:45:24 | 27 s | normalne |
| X1→ETH | `ZHyCLqHe…` 10-30 06:45:38 | `0x6061…d005` 06:56:48 | 11 min 10 s | pauza 06:45:24–06:56:36 |

**ETH→X1, warunki normalne (n = 5):** min 13 min 14 s, średnio 14 min 48 s, max 18 min 54 s.
**X1→ETH, warunki normalne (n = 1):** 27 s. Próba jest za mała, by mówić o rozkładzie. Na etapie B trzeba zebrać więcej pomiarów.

### Model uprawnień (stan na żywo, 30 paź 2026)

| Sieć | Obiekt | Właściciel / uprawniony | Mainnet (docelowo) |
|---|---|---|---|
| Sepolia | Router (lockbox, proxy) `owner()` | Timelock `0x0665…` | Timelock 48 h ← Safe 3/5 |
| Sepolia | Implementacja routera (upgrade) | ProxyAdmin `0x502b…` → owner Timelock `0x0665…` | jw. |
| Sepolia | Timelock: proposer / executor / canceller | `0x0468…` (EOA, testnet) / to samo / `0x0468…` + guardian `0x3B33…`; `minDelay` 300 s | Safe 3/5; guardian Safe 2/4 jako canceller; 172 800 s |
| Sepolia | VmpxEthFeeHook `owner()` | Timelock `0x0665…` | Timelock |
| Sepolia | RateLimitedIsm `owner()` | Timelock `0x0665…` | Timelock |
| Sepolia | PausableHook, PausableIsm `owner()` | EmergencyPauser `0x921C…` | EmergencyPauser |
| Sepolia | EmergencyPauser | guardian `0x3B33…` (wznawia, zarządza pauserami); pauser `0xdA83…` (tylko `pauseAll`) | guardian Safe; pauserzy: dyżurni + bot |
| Sepolia | AggregationIsm / MultisigIsm | niezmienne (statyczne klony z fabryki); zmiana = nowy ISM + `setInterchainSecurityModule` przez Timelock | jw. |
| Sepolia | Mailbox | Hyperlane `0xfaD1…` (nie my) | Hyperlane |
| X1 | Owner tokena (ISM, routery, IGP) | `ASLb…N5Yg` (keypair deployera) | Squads „X1-config” |
| X1 | ISM otwarty `8b7z…` (walidatory ETH→X1) | owner `ASLb…` | Squads „X1-config” |
| X1 | Upgrade authority: token, mailbox, ISM ×2, IGP, VA | `ASLb…` | Squads „X1-upgrade” (time-lock 48 h) |
| X1 | Mint authority | PDA mintu (tylko program) | bez zmian |
| X1 | Freeze authority | brak | brak |
| X1 | Metadata update authority | `ASLb…` | Squads |

## Oryginalny tekst przeglądu

> Checked all of it live against both RPCs — Sepolia and `rpc.testnet.x1.xyz`. Everything resolves, nothing failed, and the accounting reconciles to the wei.
>
> What it actually is: a Hyperlane Warp Route, not a custom bridge.
>
> • ETH: `HypERC20Collateral` lockbox (2059-byte EIP1967 proxy, impl `0xbe2d4fd8…`), `token()` → VMPX `0xcc0c8475…` (18dp, 60,000 supply), `localDomain` = 11155111
> • X1: Hyperlane native Token Router program `8hA1rhuA…`, mint `GjSYfUZ…` is Token-2022 + metadataPointer, 9dp, name literally "Bridged VMPX (Ethereum) - unofficial TESTNET", mintAuthority = its own PDA (so only the router can mint)
>
> Accounting is exact:
>
> • Lockbox balance 415.0 VMPX = X1 mint supply 415.0 tVMPXe ✓
> • Flow: 505 in (100×5 + 5) − 90 out (40+40+10) = 415 ✓
> • 18→9 decimal scaling correct both directions
> • "Protocol fee of 0 paid" on every burn → the route charges zero bridge fee right now
>
> Both directions verified with matching message IDs:
>
> ```
> | Direction                 | Amount | Latency |
> | ------------------------- | ------ | ------- |
> | deposit → msg 0x1ff4070f… | 100    | 14m40s  |
> | deposit → msg 0xebae3fdb… | 5      | 13m14s  |
> | burn → msg 0x385c1576…    | 40     | 27s     |
> | burn → msg 0x5031b79f…    | 10     | 11m10s  |
> ```
>
> Your `pauseAll("E2e drill")` was a genuine test — and it actually blocked a live message. Pause window 06:45:24 → 06:56:36 UTC; the X1 burn of 10 landed at 06:45:38 inside it, and the ETH release executed 12 seconds after unpause. Good result: messages queue and drain on unpause, nothing dropped. Only caveat — with just 9 bridge txs in ~14h you only exercised the release path under pause, never a blocked deposit. Also note the lockbox itself isn't pausable; pause lives on the separate controller `0x921c892e…` that owns `0xf7f5b15f…` and `0xa4d4b8ca…`.
>
> Three things I'd fix before mainnet:
>
> 1. Single-key control on X1. Router + mailbox + ISM are all upgradeable by one plain keypair `ASLb41hC…5Yg` — no multisig, and it's also your mint/update authority. On testnet fine; on mainnet that is the trust model.
> 2. ETH side shares an owner. The lockbox owner `0x0665dee3…` is the same contract that owns the ETH mailbox — message layer and collateral aren't independent. And the impl owner `0x0468f544…` is a bare EOA, so the implementation can be swapped unilaterally.
> 3. 18→9dp truncation. Any VMPX not divisible by 1e9 wei silently loses the remainder crossing to X1. Round amounts hide it; odd amounts won't. Add a dust floor.
>
> One thing I could not verify: the actual ISM type. `0xd4bb5d6a…` is a proxy and `moduleType` needs args — it verifies successfully on every inbound message, but whether it's multisig or merkle-root is unconfirmed. Check that one yourself, I won't guess at it.
>
> Also — stop telling people it's instant. ETH→X1 is 13–15 minutes. Say "minutes," not "seconds."
