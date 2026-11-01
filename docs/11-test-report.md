# 11 — Raport testów

Wygenerowano: 2026-10-28T16:01:29Z przez `scripts/run-all-tests.sh`.

Zakres sekcji 1–5: testy lokalne na mockach. Sekcja 0 to testnet (etap A). **Nie** obejmują rzeczywistego programu Sealevel na X1 ani mainnetowego Mailboxa:
- strona X1 w testach EVM to `HypERC20` (9 dec) z Hyperlane, który odtwarza arytmetykę programu Sealevel, ale nim nie jest;
- zgodność z X1 sprawdza `svm/compat/check-x1.mjs` (wymaga dostępu do RPC X1, z sandboxa niedostępnego — wynik niżej).

## 0. Testnet, etap A (Sepolia ↔ X1 testnet), 29–30 paź 2026

Konfiguracja:
- wszystko na Macu operatora: 3 atestatory X1→Sepolia i relayer, Hyperlane agents f556e18;
- ETH→X1: publiczny walidator Hyperlane dla Sepolii (Abacus Works, 1/1, wariant A, `03-architecture.md`);
- lockbox Sepolia `0x048C8208B0B37157FBbD71a737a34B1C5A00f6C8`;
- program tokena X1 `8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR`, mint `GjSYfUZueEiH7pjP6df1aJimEBzDZKdJbP17akxjCBzj`.

**Wynik `testnet/08-e2e.sh` z 2026-10-30T06:29Z: 14 PASS / 1 FAIL.**
- **Jedyny FAIL:** publiczne RPC X1 zwróciło stronę HTML zamiast JSON-a w `check-x1.mjs` przy odczycie upgrade authority.
- **Naprawa:** w `f3d577f` (ponawianie i odczyty `finalized`). Ponowne `check-x1.mjs --post-deploy` daje OK; upgrade i metadata authority = deployer `ASLb41…N5Yg`, na mainnecie Squads.
- **Podaż:** check-x1 w przebiegu pokazał 410, bo trafił na opóźniony węzeł RPC. Trzy odczyty `finalized` dały 415 VMPXe = lockbox 415e18.

```
PASS  dust amount rejected (execution reverted)
PASS  deposit 100 sent (overpaid 0.01 ETH, refund expected)
PASS  100 VMPXe minted on X1 (860s)
PASS  40 VMPX unlocked on Sepolia (20s)
PASS  pauseAll by single pauser key
PASS  deposit blocked while paused
PASS  no tokens taken while paused
PASS  unlock held for 10 min while paused
PASS  pauser cannot unpause
PASS  guardian unpaused
PASS  held unlock delivered after unpause (60s)
PASS  mint held for 10 min with closed ISM
PASS  held mint delivered after ISM restored (200s)
PASS  locked == X1 supply (no in-flight)        locked 415e18, supply 415
PASS  X1 authorities check (po f3d577f): Token-2022, 9 dec, mint authority = PDA, freeze brak, bez nieoczekiwanych rozszerzeń
```

**Problemy znalezione i naprawione w trakcie etapu A:**

| Commit | Problem |
|---|---|
| `10fb235` | własne walidatory Sepolii nie podpisywały (muszą odbudować całe drzewo merkle Sepolii, ok. 873 tys. liści, a to wymaga archiwalnego RPC) → przejście na publiczny zbiór Hyperlane; dodatkowo log gasu w e2e i poprawny test dust |
| `80791b5` | `replacement transaction underpriced` (RPC za load balancerem zwracało stary nonce) → nonce liczony lokalnie i kontrola na starcie (pending nonce, wiadomości w drodze) |
| `9fcdd37` | X1→Sepolia stało na `GasPaymentNotFound`: w konfiguracji agentów był ID programu IGP zamiast konta IGP, a `index.from: 1` pomijał płatność nr 0 |
| `f3d577f` | `check-x1.mjs`: ponawianie przy odpowiedzi innej niż JSON, odczyty `finalized` |

**Wszystkie transakcje testu** (6 przebiegów `08-e2e.sh`, w tym przerwane; próby odrzucone na symulacji, jak dust, depozyt w pauzie czy unpause przez pausera, nie trafiają na łańcuch):

| # | czas UTC | sieć | operacja | kwota | gas / CU | opłata | tx |
|---|---|---|---|---|---|---|---|
| 1 | 10-29 16:22 | Sepolia | mintTo (mock) |  | 238 354 gas | 0.000020 ETH | [0x33a33ece…](https://sepolia.etherscan.io/tx/0x33a33ece6a69165e03c0870c0a21fb7b036b3ebb06bb1282a28f723878408f38) |
| 2 | 10-29 16:23 | Sepolia | approve |  | 128 239 gas | 0.000100 ETH | [0xcfb1314e…](https://sepolia.etherscan.io/tx/0xcfb1314e71c106d7926c7c8f788f130fbccc792aadb2f8f7e24bf5fd0eca5038) |
| 3 | 10-29 16:23 | Sepolia | transferRemote (lock) | 100 | 478 175 gas | 0.000425 ETH | [0x94a5ef25…](https://sepolia.etherscan.io/tx/0x94a5ef25df37026664801ca5451b3e1683fa5a53189f26a5719dda0af6be5576) |
| 4 | 10-29 19:21 | X1 | process (mint, relayer) | 100 | 227 173 CU | 0.002502 XNT | [31v2fDM854…](https://explorer.testnet.x1.xyz/tx/31v2fDM854R4mVnZ2yQu4rWVcXnBvfK4PTsjJ5kJYhR8YpnC7q5M7Qw1hg2DjsvZDLyi4TLKE2wcv4VXKsBkGfz6) |
| 5 | 10-29 19:25 | Sepolia | mintTo (mock) |  | 42 514 gas | 0.000002 ETH | [0xf856c5c7…](https://sepolia.etherscan.io/tx/0xf856c5c7987f9ea64b96849bb7b55f745dc19a8e1e8e7fe8c5e9d1c5ce3a5c54) |
| 6 | 10-29 19:25 | Sepolia | approve |  | 20 319 gas | 0.000011 ETH | [0xdf0bc0b9…](https://sepolia.etherscan.io/tx/0xdf0bc0b98a935309fd74a556dd396e7718cd558d01eda8d3baec86768fdb3160) |
| 7 | 10-29 19:25 | Sepolia | transferRemote (lock) | 100 | 279 339 gas | 0.000279 ETH | [0xcb96df7b…](https://sepolia.etherscan.io/tx/0xcb96df7b923a7aacd266c3d5845c7f9ab611259cdaa5a8a52bf24c80c7ce8c61) |
| 8 | 10-29 19:37 | Sepolia | mintTo (mock) |  | 42 514 gas | 0.000043 ETH | [0xdc793b45…](https://sepolia.etherscan.io/tx/0xdc793b45689a839b3845d2fca549827e7fb81964a9a23d19114b1f22e1cc016f) |
| 9 | 10-29 19:39 | X1 | process (mint, relayer) | 100 | 211 663 CU | 0.002331 XNT | [32Jf5AufJt…](https://explorer.testnet.x1.xyz/tx/32Jf5AufJt1NTqcMtUDf7Jv2bXpD6mcpTvAqvyFtwyucxoeLurCNtVsWes9xT8kBhd744SyDTJkHiG6Zn3bNaqaQ) |
| 10 | 10-29 19:44 | Sepolia | mintTo (mock) |  | 42 514 gas | 0.000043 ETH | [0xc027199a…](https://sepolia.etherscan.io/tx/0xc027199ab372202ec5ca1492a99bf6be8f526d40926e32eb9bb8658fd43338db) |
| 11 | 10-29 19:44 | Sepolia | approve |  | 20 319 gas | 0.000020 ETH | [0x828a90cb…](https://sepolia.etherscan.io/tx/0x828a90cbf99a7b70ba890928ab4da2934a7e41d952e8edcc11afbdb09df3ed92) |
| 12 | 10-29 19:45 | Sepolia | transferRemote (lock) | 100 | 291 324 gas | 0.000291 ETH | [0xf89528a4…](https://sepolia.etherscan.io/tx/0xf89528a42b6867147ebef612af39b08c9ce13a8378b1dcc6c028f652980746f4) |
| 13 | 10-29 19:58 | X1 | process (mint, relayer) | 100 | 213 271 CU | 0.002349 XNT | [tK7n9t6tJt…](https://explorer.testnet.x1.xyz/tx/tK7n9t6tJtTiduEZasfiXRqHn3LiJtHohcP3JTZBPBy2rL8LLJq7J8JQN1UhXSn3azpwtsCiSHK4dxjivGkiSda) |
| 14 | 10-29 19:58 | X1 | transfer-remote (burn, X1 -> Sepolia) | 40 | 141 864 CU | 0.014002 XNT | [3CiVfPUoBJ…](https://explorer.testnet.x1.xyz/tx/3CiVfPUoBJiU95aEqyXai4Ye11dADYW9XwBTzxVr5XBek5vPtjoNr3tyBtP83D53wsS5UXz2qfdNYCVtbDENtKPQ) |
| 15 | 10-29 20:55 | Sepolia | process (unlock, relayer) | 40 | 404 931 gas | 0.000006 ETH | [0x2734dcc0…](https://sepolia.etherscan.io/tx/0x2734dcc0cd608d86c87f831ceaf2a61951643ff89b916ff8c06d1a95eeea2196) |
| 16 | 10-29 21:02 | Sepolia | mintTo (mock) |  | 42 514 gas | 0.000000 ETH | [0x104c7bae…](https://sepolia.etherscan.io/tx/0x104c7baed20a93cbb5c76f4fd296a4e59b4dd3d523e84858c3de86ba0dca2f04) |
| 17 | 10-29 21:02 | Sepolia | approve |  | 20 319 gas | 0.000000 ETH | [0x6a9197d5…](https://sepolia.etherscan.io/tx/0x6a9197d5e7b23e820db9dc211e063f2bc96acd0f87dd04072682a06d3bb3362e) |
| 18 | 10-29 21:02 | Sepolia | transferRemote (lock) | 100 | 279 339 gas | 0.000000 ETH | [0x917f4701…](https://sepolia.etherscan.io/tx/0x917f470182cc5922642ea7239824428a6338ea6f7a1ad7e67212df5442dc068c) |
| 19 | 10-29 21:21 | X1 | process (mint, relayer) | 100 | 213 109 CU | 0.002347 XNT | [5w1TdAfFRh…](https://explorer.testnet.x1.xyz/tx/5w1TdAfFRhJCwrmZ9b348zk8qR9HUVZyWvYGdsWpeaWDfywKunHZDfNWJTwGFdBoYrEumyL2gpa3gecMkkK8YTxU) |
| 20 | 10-30 06:29 | Sepolia | mintTo (mock) |  | 42 514 gas | 0.000043 ETH | [0xa82fcee6…](https://sepolia.etherscan.io/tx/0xa82fcee6c21c211c2165bdda72d50315fa41c0dca1cdca10a964d1449ee974f4) |
| 21 | 10-30 06:30 | Sepolia | approve |  | 20 319 gas | 0.000020 ETH | [0xebfd6720…](https://sepolia.etherscan.io/tx/0xebfd6720f45be5d7f7a55e513ac463ae0505d18198f00d3b530f112d6892e700) |
| 22 | 10-30 06:30 | Sepolia | transferRemote (lock) | 100 | 285 331 gas | 0.000285 ETH | [0x0463a4de…](https://sepolia.etherscan.io/tx/0x0463a4de1eb657229d84ebf269849a192fc14ca775b9cdc495e4d09c392cad31) |
| 23 | 10-30 06:44 | X1 | process (mint, relayer) | 100 | 211 771 CU | 0.002332 XNT | [mUkJkfuMB9…](https://explorer.testnet.x1.xyz/tx/mUkJkfuMB9TF2GsbZe3x6VDFMmysbQzWxwxyvaVSU5u5eoJpJXW1k3evr5tmbCx1EHxRkq4mFqXu2dQfCwNZAXp) |
| 24 | 10-30 06:44 | X1 | transfer-remote (burn, X1 -> Sepolia) | 40 | 154 859 CU | 0.014002 XNT | [2cP9EqosYg…](https://explorer.testnet.x1.xyz/tx/2cP9EqosYgp2yQSg5RtGfMHMy5eknysY7oEquNP7Xo1pyCXnNCgrT4WtLcG1taug6SMbmWRX4Kbny2fNt7mhLt52) |
| 25 | 10-30 06:45 | Sepolia | process (unlock, relayer) | 40 | 394 713 gas | 0.000000 ETH | [0x5e84548d…](https://sepolia.etherscan.io/tx/0x5e84548d5eeeed8c27f325ae142699d910405b9baac7d926743258a08201a36a) |
| 26 | 10-30 06:45 | Sepolia | pauseAll |  | 56 127 gas | 0.000056 ETH | [0x0a17d0a7…](https://sepolia.etherscan.io/tx/0x0a17d0a7d3ee014546f1d0900f1f792994f148d3649f617bf3ad5eacd1b9945d) |
| 27 | 10-30 06:45 | X1 | transfer-remote (burn, X1 -> Sepolia) | 10 | 146 284 CU | 0.014002 XNT | [ZHyCLqHece…](https://explorer.testnet.x1.xyz/tx/ZHyCLqHeceEBTDZz5WqJn1aCRNwmjt83npw6Ju2T2JL33c7uF68FbnvrnET4rf1itGuARymskkpSwsw9X8FVUYL) |
| 28 | 10-30 06:56 | Sepolia | unpause by guardian |  | 53 661 gas | 0.000054 ETH | [0xf520bbe1…](https://sepolia.etherscan.io/tx/0xf520bbe15c29a8778a3f4d64ea2c1201ee6a1a4c34880999222988452efec9f4) |
| 29 | 10-30 06:56 | Sepolia | process (unlock, relayer) | 10 | 404 955 gas | 0.000020 ETH | [0x6061bd74…](https://sepolia.etherscan.io/tx/0x6061bd74bdcb791a7dfb6388c577b8cbbc0e01ed94339057dd2b43f4c793d005) |
| 30 | 10-30 06:57 | X1 | set ISM -> closed (pause mints) |  | 5 416 CU | 0.014002 XNT | [4axbyTHkUq…](https://explorer.testnet.x1.xyz/tx/4axbyTHkUqbWcSoyrP5sgWmgJ5UUhBCTQfQfBheNg8WX2T7kFq93WJZ7axuyN3euByx8xB8zFke9vxZnWZ1kG4vF) |
| 31 | 10-30 06:57 | Sepolia | transferRemote (lock) | 5 | 279 327 gas | 0.000279 ETH | [0x141a0004…](https://sepolia.etherscan.io/tx/0x141a0004db3dfaa5d9f4b23347b8ebaa3264055b40dc63accf13d6ca19df7399) |
| 32 | 10-30 07:07 | X1 | set ISM -> open (resume) |  | 5 416 CU | 0.014002 XNT | [3aNu8b1PA4…](https://explorer.testnet.x1.xyz/tx/3aNu8b1PA4GRfAQhZwmtTfm1hDKbdgqJXTeEuRDjQSdiQpZp2VraarmuhtzsRRjAoY9rDbraCy8waPe1UkA2M57A) |
| 33 | 10-30 07:10 | X1 | process (mint, relayer) | 5 | 211 276 CU | 0.002327 XNT | [5rnTvi9SHS…](https://explorer.testnet.x1.xyz/tx/5rnTvi9SHSwjzGxBgmEjN3EsrzCmWQYvnozTR496uSsuQnXVw9eBmpY3Sq7taEBRtwJxzTF2X1dAJDRnSUe33B4W) |

Zestawienie gasu i kosztów: `09-costs.md`, „Pomiary z testnetu”.

## 1. EVM (Foundry, @hyperlane-xyz/core 12.2.0, solc 0.8.22)
```
[PASS] testFuzz_scalingIsLossless(uint256) (runs: 512, μ: 1346814, ~: 1346813)
[PASS] test_belowThresholdRejected() (gas: 1240011)
[PASS] test_delayedDeliveryStillWorksOnce() (gas: 806905)
[PASS] test_donationDoesNotCreateClaims() (gas: 507000)
[PASS] test_duplicateSignerRejected() (gas: 1292154)
[PASS] test_dustAmountReverts() (gas: 88331)
[PASS] test_ethValidatorsCannotAttestX1Messages() (gas: 1283844)
[PASS] test_fakeSignaturesRejected() (gas: 1285508)
[PASS] test_feeCapIsHard() (gas: 16322)
[PASS] test_feeChangeNeedsDelay() (gas: 140760)
[PASS] test_feeIsThreePercentOfReferenceValue() (gas: 31820)
[PASS] test_feesGoOnlyToBeneficiary() (gas: 540267)
[PASS] test_fullRoundTrip() (gas: 1489025)
[PASS] test_hookRejectsForeignRouter() (gas: 23474)
[PASS] test_lpVaultAndRebalanceDisabled() (gas: 76349)
[PASS] test_nonOwnerCannotAnnounce() (gas: 14662)
[PASS] test_onlyOwnerCanChangeHookOrIsm() (gas: 48946)
[PASS] test_overpaymentRefunded() (gas: 508302)
[PASS] test_pauseBlocksUnlockAndResumeRecovers() (gas: 1444522)
[PASS] test_priceResetDelayed() (gas: 62876)
[PASS] test_priceUpdateBounded() (gas: 47714)
[PASS] test_rateLimitCapsUnlocks() (gas: 1368101)
[PASS] test_replayOnEthReverts() (gas: 1341304)
[PASS] test_replayOnX1Reverts() (gas: 814873)
[PASS] test_smallestUnitRoundTrip() (gas: 1343513)
[PASS] test_tamperedAmountRejected() (gas: 1733109)
[PASS] test_u64Bounds() (gas: 5377)
[PASS] test_underpaymentReverts() (gas: 497973)
[PASS] test_unenrolledRouterOnX1CannotUnlock() (gas: 4226396)
[PASS] test_unknownOriginDomainRejected() (gas: 500369)
[PASS] test_unlockWorksWhenTreasuryBroken() (gas: 1722813)
[PASS] test_wrongDestinationDomainOnHook() (gas: 26761)
Suite result: ok. 32 passed; 0 failed; 0 skipped; finished in 916.97ms (932.35ms CPU time)
[PASS] test_emergencyFullStop_thenResume() (gas: 3129284)
[PASS] test_guardianCannotUpgradeOrReconfigure() (gas: 34179)
[PASS] test_guardianPausesDeposits_noFundsTaken() (gas: 999192)
[PASS] test_implementationCannotBeHijacked() (gas: 31045)
[PASS] test_nonGuardianCannotPause() (gas: 21743)
[PASS] test_onlyTimelockCanUpgrade() (gas: 49966)
[PASS] test_upgradeCanBeCancelledDuringDelay() (gas: 3419218)
[PASS] test_upgradeThroughTimelockKeepsCollateralAndState() (gas: 4797130)
Suite result: ok. 8 passed; 0 failed; 0 skipped; finished in 10.06ms (6.95ms CPU time)
[PASS] test_scriptRejectsDuplicateValidators() (gas: 14701060)
[PASS] test_scriptRejectsLowThreshold() (gas: 14710705)
[PASS] test_scriptRejectsSameAdminAndGuardian() (gas: 14710885)
[PASS] test_scriptRejectsTruncatingRateCap() (gas: 14711128)
[PASS] test_scriptWiringOnRealMailbox() (gas: 27584843)
[PASS] test_singlePauserStopsDepositsAndOnlyGuardianRestarts() (gas: 27492663)
Suite result: ok. 6 passed; 0 failed; 0 skipped; finished in 6.82ms (5.61ms CPU time)
[PASS] test_H1_depositIsInsertedIntoMerkleTree() (gas: 499236)
[PASS] test_I1_donateCreatesNoClaim() (gas: 116283)
[PASS] test_L1_feeRecipientHasNoEffect() (gas: 676279)
[PASS] test_L1_tokenFeeHookBlocksInsteadOfCharging() (gas: 90781)
[PASS] test_L2_exactCapDeliverable() (gas: 1348806)
[PASS] test_L5_paramsExpire() (gas: 108676)
[PASS] test_L5_priceResetCancelExpireOwnerOnly() (gas: 83961)
[PASS] test_L6_cumulativeDailyBound() (gas: 50744)
[PASS] test_M2_oversizedUnlockRecoverable() (gas: 1469161)
[PASS] test_postDispatchForeignReverts() (gas: 29653)
Suite result: ok. 10 passed; 0 failed; 0 skipped; finished in 7.16ms (4.61ms CPU time)
[PASS] invariant_fullyCollateralized() (runs: 128, calls: 5120, reverts: 1025)
[PASS] invariant_userValueConserved() (runs: 128, calls: 5120, reverts: 1022)
Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 4.76s (6.69s CPU time)
Ran 5 test suites in 4.76s (5.70s CPU time): 58 tests passed, 0 failed, 0 skipped (58 total tests)
```

## 2. Arytmetyka decimals Sealevel (Rust)
```
test tests::eighteen_decimals_on_svm_would_overflow ... ok
test tests::multiples_of_1e9_roundtrip_exactly ... ok
test tests::u64_max_local_does_not_overflow_remote_u128 ... ok
test tests::upstream_truncates_dust_silently ... ok
test tests::whole_cap_fits_u64_at_9_decimals ... ok
test tests::exhaustive_sample_roundtrip ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## 3. Monitor pokrycia (node:test)
```
ok 1 - balanced: no in-flight
ok 2 - balanced with in-flight both directions
ok 3 - CRITICAL: X1 supply exceeds lock (unbacked mint)
ok 4 - CRITICAL: in-flight burn not redeemable
ok 5 - WARN: surplus (donation)
ok 6 - tolerance absorbs indexer lag only within bound
ok 7 - mint authority / freeze / extensions
ok 8 - stuck messages
# pass 8
# fail 0
```

## 4. Symulacja ekonomiczna
```
OK: economics/results.csv + results.md (asercja: brak ujemnego kolaterału, kolaterał == pula + saldo użytkowników w każdym kroku)
```

## 5. Kompatybilność X1 (live)
```
FAIL  rpc error  ->  "fetch failed"

1 FAIL
```

## Pokrycie wymagań z briefu (§9)

| Wymaganie | Test |
|---|---|
| Pełny transfer i powrót | `test_fullRoundTrip`, `test_smallestUnitRoundTrip`, `testFuzz_scalingIsLossless` |
| Replay i ponowna dostawa | `test_replayOnEthReverts`, `test_replayOnX1Reverts`, `test_delayedDeliveryStillWorksOnce` |
| Fałszywe podpisy, zły próg, nieuprawniony nadawca | `test_fakeSignaturesRejected` (`!threshold`), `test_belowThresholdRejected`, `test_duplicateSignerRejected`, `test_ethValidatorsCannotAttestX1Messages`, `test_unenrolledRouterOnX1CannotUnlock` (`Enrolled router does not match sender`) |
| Błędna sieć, token, router, odbiorca | `test_unknownOriginDomainRejected`, `test_wrongDestinationDomainOnHook`, `test_hookRejectsForeignRouter`, `test_tamperedAmountRejected`, `test_dustAmountReverts` (odbiorca 0) |
| Reorgi i finalność | **niepokryte lokalnie**: konfiguracja agentów (finalized) + scenariusz testnetowy (runbook §1.10) |
| Przerwa RPC, walidatora, relayera | `test_delayedDeliveryStillWorksOnce` (30 dni bez relayera); wyłączenie 3–4 atestatorów: scenariusz testnetowy |
| Restart z odtworzeniem stanu | scenariusz testnetowy (runbook §1.10) — **niepokryte lokalnie** |
| Decimals, dust, granice | `test_u64Bounds`, `test_dustAmountReverts`, `testFuzz_scalingIsLossless`, `svm/decimals-check` (6 testów) |
| Błędy wyceny, manipulacja, wygasłe ceny | `test_priceUpdateBounded`, `test_priceResetDelayed`, `test_unlockWorksWhenTreasuryBroken` (fallback stale), `test_feeIsThreePercentOfReferenceValue` |
| Nadpłaty i niedopłaty | `test_overpaymentRefunded`, `test_underpaymentReverts` |
| Pause/unpause, odzyskiwanie | `test_pauseBlocksUnlockAndResumeRecovers`, `test_rateLimitCapsUnlocks` |
| Mint / freeze / upgrade authority | `check-x1.mjs --post-deploy` + `classifyMintState` (monitor); **wykonane na testnecie** (§0): mint authority = PDA, freeze brak, upgrade authority = deployer (na mainnecie Squads) |
| Niezmienniki zabezpieczenia | `InvariantTest` (128 przebiegów × 40 wywołań, losowe depozyty/burn/dostawy/pauzy), `_assertCollateralInvariant` w testach jednostkowych |
| Niezależność wypłat od skarbca/LP | `test_unlockWorksWhenTreasuryBroken`, `test_feesGoOnlyToBeneficiary` |
| Pauza awaryjna i zmiany (upgrade) | e2e na testnecie (§0, kroki 4–6: `pauseAll`, blokada depozytu i unlocku, wznowienie przez guardiana, zamknięty ISM na X1); `test_emergencyFullStop_thenResume`, `test_guardianPausesDeposits_noFundsTaken`, `test_singlePauserStopsDepositsAndOnlyGuardianRestarts`, `test_upgradeThroughTimelockKeepsCollateralAndState`, `test_upgradeCanBeCancelledDuringDelay`, `test_onlyTimelockCanUpgrade`, `test_guardianCannotUpgradeOrReconfigure` |
| Regresje z przeglądu (docs/12) | `ReviewFixesTest` (10), `DeployScriptTest` (6, prawdziwy `Mailbox` + `MerkleTreeHook` + `ProtocolFee`) |
| Uprawnienia | `test_onlyOwnerCanChangeHookOrIsm`, `test_nonOwnerCannotAnnounce`, `test_feeCapIsHard`, `test_feeChangeNeedsDelay`, `test_lpVaultAndRebalanceDisabled` |
