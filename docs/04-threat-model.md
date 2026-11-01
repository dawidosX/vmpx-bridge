# 04 — Model zagrożeń

Aktywa: (1) VMPX w lockboxie, (2) integralność podaży VMPXe na X1, (3) ETH z opłat, (4) LP na X1, (5) dostępność wypłat.

| # | Zagrożenie | Wpływ | Mitygacja | Test / kontrola | Ryzyko rezydualne |
|---|---|---|---|---|---|
| T1 | Przejęcie ≥7 kluczy atestatorów X1 | Odblokowanie całego kolaterału | Osobne klucze w KMS/HSM, różni dostawcy chmur, RateLimitedIsm (limit/24 h), PausableIsm, monitor pokrycia → pauza | `test_rateLimitCapsUnlocks`, `test_pauseBlocksUnlockAndResumeRecovers`, alert `CollateralUndercovered` | **Wysokie przy jednym operatorze**. Strata ograniczona do limitu dziennego, o ile pauza nastąpi w ciągu doby |
| T2 | Fałszywe podpisy, za mało podpisów, ten sam podpis dwukrotnie | Nieuprawniony mint lub unlock | MessageIdMultisigIsm (sortowani sygnatariusze, próg) | `test_fakeSignaturesRejected`, `test_belowThresholdRejected`, `test_duplicateSignerRejected`, `test_ethValidatorsCannotAttestX1Messages` | Niskie |
| T3 | Replay, ponowna dostawa | Podwójny mint lub unlock | Mailbox `deliveries[id]` (EVM), processed-message PDA (SVM) | `test_replayOnEthReverts`, `test_replayOnX1Reverts` | Niskie |
| T4 | Wiadomość od nieznanego routera lub domeny | Unlock bez spalenia | `routers[origin] == sender` w `handle` | `test_unenrolledRouterOnX1CannotUnlock`, `test_unknownOriginDomainRejected` | Niskie |
| T5 | Podmiana treści (kwota, odbiorca) przez relayera | Kradzież | Podpis obejmuje `messageId = keccak(message)` | `test_tamperedAmountRejected` | Niskie |
| T6 | Przejęcie ownera routera | Zmiana ISM → dowolny unlock | Timelock 48 h + Safe 3/5, alert na `IsmSet`, `HookSet`, `RemoteRouterEnrolled`, `OwnershipTransferred` | `test_onlyOwnerCanChangeHookOrIsm`, `WATCHED_EVM_EVENTS` | Średnie: wymaga monitoringu i reakcji w 48 h |
| T7 | Rebalancing i LP-vault upstreamu jako ścieżka drenażu | Wyprowadzenie kolaterału | Wyłączone w `VmpxCollateralRouter` | `test_lpVaultAndRebalanceDisabled`, `test_donationDoesNotCreateClaims` | Niskie. `addRebalancer` nadal istnieje, ale bez dozwolonego mostu nie ma efektu |
| T8 | Mint authority lub upgrade authority na X1 w rękach deployera | Nielimitowany mint VMPXe → drenaż kolaterału przez legalne burn→unlock | Klient przenosi mint authority na PDA. Upgrade i metadata → Squads. Weryfikacja po wdrożeniu | `check-x1.mjs --post-deploy`, `classifyMintState` | Średnie w oknie wdrożenia, niskie po weryfikacji |
| T9 | Rollback lub reorg X1 po podpisaniu checkpointu | Unlock bez spalenia (burn cofnięty) | Podpis tylko na `finalized`, pauza przy każdym ogłoszonym restarcie X1, limit dzienny | runbook §4 | **Średnie**: X1 miał już rollback („Buenos Aires reboot”) |
| T10 | Reorg Ethereum | Mint bez blokady | Atestacja po finalized. Wariant A: weryfikujemy politykę publicznych walidatorów | test na Sepolii | Niskie |
| T11 | Manipulacja wyceną opłaty (flash loan, pump puli) | Za niska lub za wysoka opłata | Cena referencyjna on-chain (bez spot/TWAP), max ±20% na aktualizację, min. 1 h odstępu, reset tylko po 3 dniach, opłata w [min, max] | `test_priceUpdateBounded`, `test_priceResetDelayed`, `test_feeIsThreePercentOfReferenceValue` | Niskie: zła cena zmienia tylko opłatę, nigdy kolaterał |
| T12 | Obejście opłaty przez bezpośrednie wywołanie routera | Utrata przychodu | Opłata jest hookiem samego routera, a nie wrapperem | `test_underpaymentReverts`, `test_hookRejectsForeignRouter` | Niskie |
| T13 | Cicha utrata dust | Strata użytkownika | Revert, jeśli `amount % 1e9 != 0` | `test_dustAmountReverts`, `svm/decimals-check` | Niskie |
| T14 | Awaria skarbca lub beneficiary | Blokada mostu | Ścieżka unlock nie dotyka hooka. Wypłata opłat to osobna operacja | `test_unlockWorksWhenTreasuryBroken` | Niskie |
| T15 | Relayer lub RPC niedostępny | Opóźnienie | Wiadomości czekają bez limitu czasu. Relayer standby. Alert kolejki | `test_delayedDeliveryStillWorksOnce` | Niskie (dostępność, nie środki) |
| T16 | Phishing: podróbka VMPX lub fałszywy VMPXe | Użytkownik bridguje zły token | Router ma niezmienny adres tokena. Frontend pokazuje adresy, metadata zawiera origin | — | Średnie (poza kontrolą on-chain) |
| T17 | Wymiana metadanych tokena na X1 (nazwa „oficjalny”) | Wprowadzenie w błąd | Metadata authority → Squads, monitoring metadanych | `check-x1.mjs` | Niskie |
| T18 | Nieaudytowany kod (modyfikacje, nowsze programy SVM) | Nieznane błędy | Minimalne modyfikacje + testy, programy SVM z audytowanego commita, jeśli to możliwe | `05-audit-matrix.md` | **Średnie, do czasu audytu** |
| T19 | Konflikt z oficjalnym VMPX na X1 | Rozjazd rynku, utrata zaufania | Nazwa „VMPXe (unofficial)”, zapytanie do emitenta przed publicznym startem | — | Do ustalenia |
| T21 | Hook routera pomija MerkleTreeHook | Depozyty zablokowane na zawsze (brak atestacji) | Merkle w łańcuchu hooków, skrypt wymaga `MERKLE_HOOK`, test na prawdziwym Mailboxie | `test_H1_*`, `test_scriptWiringOnRealMailbox` | Niskie |
| T22 | Drenaż ETH relayera wiadomościami-pyłkami z X1 | Zatrzymanie wypłat | IGP Sealevel (płatność w XNT), relayer `onChainFeeQuoting` dla X1 | e2e | Niskie |
| T23 | Złośliwy upgrade przez przejętego admina | Utrata kolaterału | Timelock 48 h + weto guardiana + alert `CallScheduled` → pauza | `test_upgradeCanBeCancelledDuringDelay` | Średnie |
| T24 | Przejęty klucz pausera | Zatrzymanie mostu | Pauser może tylko pauzować; guardian usuwa klucz i wznawia | `test_singlePauserStopsDepositsAndOnlyGuardianRestarts` | Niskie |
| T20 | Kompromitacja frontendu | Podmiana odbiorcy lub kontraktu | Hosting statyczny z hashem (IPFS), adresy kontraktów publikowane w repo i on-chain | — | Średnie |
