# 15 — Key custody / Przechowywanie kluczy

Status: **plan (31 Oct 2026)**. Testnet roles are migrated step by step (section 5). Mainnet values are the target and will be confirmed before launch. This document is public on purpose: it says *what* each key can do and *how* it is protected. Who holds which device, signer addresses and locations are kept in the operator's private repository.

---

## English

### 1. Principles

1. **No single key can move collateral.** Unlocking VMPX needs 5 of 7 Hyperlane validator signatures (X1 → Ethereum) and passes the pause switch and the rate limit. Changing code or configuration needs a multisig and, on Ethereum, a 48 h timelock.
2. **Hardware wallets (Ledger) for every human signer** of the Safe (Ethereum) and Squads (X1) multisigs. No signer key on a server.
3. **Hot keys only where a machine must sign automatically**, and only with the smallest possible power: the auto-pause key (can only pause), relayers (can only deliver or delay valid messages), the price bot (bounded, retired after the fixed fee).
4. **Validator keys in a cloud KMS** (non-exportable) on mainnet, one identity per machine.
5. **Verify before you sign.** Every Safe and Squads signature is checked against an independently computed hash (section 4).
6. Private keys and seed phrases never appear in chat, tickets, repositories or logs. Seeds of hardware wallets exist only on paper or metal, offline, in at least two places.

### 2. Roles

| Role | What it can do with VMPX / the bridge | Key storage (mainnet target) | Threshold / delay | Limits |
|---|---|---|---|---|
| **Ethereum admin** (proposer and executor of the `TimelockController`) | upgrade the lockbox router, change ISM, hooks, fees (`setBridgeFee` ≤ 5%), rate limit; after the delay this can ultimately reach the collateral | **Safe** multisig, signers on Ledger | **open decision (section 8): 2 of 2** (owner's Ledger + team Safe 1 of 2, rehearsed on Sepolia) **or 3 of 5**; every change waits **48 h** in the timelock | the guardian can cancel during the 48 h; changes are public on-chain; `MAX_FEE_BPS = 500` is immutable |
| **Guardian** (`EmergencyPauser` guardian, timelock canceller) | unpause, cancel scheduled timelock operations, add/remove pausers | testnet: the owner's Ledger; mainnet: **Safe** multisig, Ledger signers (separate from the admin) | mainnet **2 of 3**, immediate | cannot upgrade, change fees or move funds. **But a compromised guardian can disable the brake**: resume the bridge during an incident, cancel the admin's repair operations and remove pausers. Hence a multisig and signers different from the admin |
| **Pauser** | stop deposits and unlocks at once (`pauseAll`) | one **hot key** for the auto-pause monitor + the guardian's Ledger | 1 signature, immediate | **pause only**; only the guardian resumes |
| **X1 owner** (token configuration owner, mailbox owner, owners of the multisig ISM and the IGP, program upgrade authorities, metadata authority) | change the X1 ISM, its validator set and threshold, remote routers; upgrade the token, mailbox and ISM programs; change the X1 protocol fee (≤ `max_protocol_fee`) and gas prices | **Squads v4** multisig on X1 (our own deployment, section 7), signers on Ledger | same open decision as the Ethereum admin (section 8); **`time_lock` 48 h** on mainnet (Squads v4 setting) for every authority (layout: section 8) | **can reach the collateral:** a malicious ISM or token upgrade can mint unbacked VMPXe on X1; those tokens can then be *genuinely* burned and the validators will sign the real burn, so collateral leaves Ethereum. Bounded by the rate limit (tank C + C/day) and the pause; the planned authority monitor (review round 3, R-02: not running yet) will pause Ethereum on any X1 configuration change. Hence multisig + 48 h delay |
| **LP treasury** | receives the 3% VMPX bridge fee (Ethereum) and the XNT protocol fee (X1); funds the VMPXe/XNT pool | **Safe** (VMPX on Ethereum) and **Squads vault** (XNT, VMPXe, LP tokens on X1) | proposed 2 of 3 | no power over the bridge; holds only fee revenue |
| **Hyperlane validators** (X1 → Ethereum attestors) | sign checkpoints; 5 of 7 can authorize an unlock on Ethereum | **cloud KMS** (non-exportable secp256k1), one key and one cloud identity per machine | **5 of 7** | rate limit (tank C + C/day), pause, monitoring; a quorum is needed |
| **Relayer** | delivers messages in both directions, pays gas | **hot keys** with a small gas balance | — | cannot forge messages; can only delay or censor; loss = its gas balance |
| **Price bot** | updates the fee hook's reference price within ±20% per hour and ±50% per window | **hot key** | — | fee capped by `maxFeeWei`; **retired** once the fixed ETH fee is active (price no longer used) |
| **Deployer** | temporary wiring during deployment | hot key, used once | — | must hold **no role** after hand-over (checked by `svm/compat/check-x1.mjs --mainnet`, which rejects the deployer as any authority, and by the deployment script) |
| **Ethereum → X1 validators** (verify Ethereum messages for the X1 ISM) | their threshold can authorize a mint on X1 | **not our keys:** the public Hyperlane validator set for Ethereum (**6 of 9** on mainnet, Abacus Works 1 of 1 on Sepolia), listed in the X1 multisig ISM (owner = X1 owner). Option (section 8): our own 5 of 7 set in KMS | **6 of 9** | unbacked mints can only leave via real burns, signed by our X1 → Ethereum validators and bounded by the Ethereum rate limit and the pause |
| **Fee recipients** (fee hook beneficiary, IGP beneficiary on X1) | receive ETH / XNT fees | Safe / Squads vault of the operator | as the LP treasury | no power over the bridge |
| **Hyperlane Mailbox owner on Ethereum** (external: Hyperlane governance) | can change the mailbox's *required* hook (protocol fee) and default hook/ISM | outside our control | Hyperlane governance | our router sets its own ISM and hook, so defaults do not apply; a changed required hook can block or price dispatches, not forge them. External trust assumption |

Ethereum → X1 mints are authorized by the X1 token's ISM, which lists the public Hyperlane validators watching Ethereum (variant A, `docs/03`, `docs/13`). Those keys are not ours; the KMS rule applies to them only if the own-set option is chosen.

### 3. Hardware wallets

- Every human signer has **their own Ledger**; no device is shared between two roles that check each other (admin vs guardian).
- The same person may sign in Safe (Ethereum) and Squads (X1) with one Ledger, using different apps (Ethereum, Solana).
- Firmware and apps are installed only through Ledger Live; the device is bought from the manufacturer.
- Recovery phrase: written offline (paper or metal), stored in two separate places, never photographed, typed or read aloud.
- Lost or compromised device: in an **m of n with m < n** setup the other signers replace that signer at once (owner swap), then the guardian checks that no unexpected operation is scheduled. **With 2 of 2 this is impossible:** the remaining signer alone cannot change the owners, so a lost owner's Ledger can only be recovered from its seed (tested backup required); a compromised one can only be neutralised by the guardian pausing and cancelling until the owner restores the seed on a new device and swaps the key.
- **Ledger and EIP-712:** recent Ledger firmware and Ethereum app versions display the EIP-712 domain and message hashes of a Safe transaction; older ones sign blindly. Keep firmware current and never sign a Safe transaction whose hashes the device does not show.

### 4. Verifying what you sign

**Safe (Ethereum)**
1. Read the proposed operation in the Safe app: target contract, function and arguments. For timelock operations also decode the inner call (`schedule` / `execute` → target, data, salt, delay).
2. Compute the **safeTxHash** (and the domain and message hashes) independently on a second computer from the published transaction data: `evm/script/safe-tx-hashes.sh` in this repository (also cross-checks the result against `getTransactionHash` of the Safe itself, and with `--nested` prints the hashes of a nested Safe's `approveHash`), or the open-source `safe-tx-hashes` script.
3. On the Ledger screen, compare the hashes character by character with step 2. Sign only if they match.
4. For timelock operations, after scheduling check the `CallScheduled` event (id, target, data) before anyone executes.

**Squads (X1)**
1. Inspect the vault transaction (program, accounts, instruction data) with the Squads CLI on a second computer, from the on-chain proposal account.
2. The Ledger Solana app shows the message hash (blind signing must be enabled). Compare it with the hash of the transaction message prepared in step 1.
3. Approve only if they match; execute only after the threshold is reached and the proposal is re-read.

Nobody signs a transaction they cannot decode. "Please just sign" is a reason to stop.

### 5. Testnet migration (Sepolia ⇄ X1 testnet)

Today all admin roles on testnet are held by the deployer's software key; that is acceptable only for a testnet. The plan below rehearses the mainnet setup. Each step is executed only after the owner's approval.

1. **Safe on Sepolia (done, Safe 1.5.0, no modules, no guard):** admin Safe **2 of 2** = the owner's Ledger + a nested **team Safe 1 of 2**. Any admin action needs the owner's Ledger *and* one team member. On testnet both team signers are further accounts of the owner's Ledger (one device, acceptable only on testnet); on mainnet they are replaced by IT staff with their own hardware wallets. Nested signing: the team Safe executes `approveHash(safeTxHash)` on the admin Safe, so a team member signs the team Safe's own hash, which `safe-tx-hashes.sh --nested` prints.
   **Open decision (owner, before mainnet): 2 of 2 or 3 of 5.** With 2 of 2 the owner's Ledger is a single point of failure for liveness (lost device and lost seed = the admin is frozen, upgrades and fee changes impossible; the bridge itself keeps working and the guardian can still pause). Mainnet: either keep 2 of 2 with a tested seed backup, or move to 3 of 5 (section 2).
2. **Timelock roles → Safe, in two timelock operations:** (A) the deployer grants proposer, executor and canceller to the Safe and canceller to the guardian Ledger; (B) **the Safe itself** schedules and executes the revocation of all deployer roles and of the old guardian's canceller role. B proves that the Safe can propose and execute before the deployer loses its roles. `TIMELOCK_ADMIN_ROLE` stays with the Timelock only (no external admin), so every later role change also waits for the delay. Check that the deployer can no longer schedule or execute: `evm/script/check-roles.sh 2b` (read-only). This gate covers the timelock only; the end of the whole migration (guardian, pausers, price updater, fee recipients, owners, Safe owners and modules, X1 authorities) is a separate gate, `check-roles.sh full` (Codex round 4, R4-07).
3. **Guardian → the owner's Ledger** (`proposeGuardian` / `acceptGuardian`); one hot **pauser** key on the testnet server for auto-pause; pause and unpause rehearsed from the Ledger.
4. **Rehearsal:** a timelock operation scheduled and executed by the Safe with a Ledger signature and hash verification; pause and unpause from the Ledger; an attempt with the old deployer key must fail.
5. **X1:** a Squads v4 multisig on X1 testnet: **our own program deployment first** (section 7); the existing `DDL3Xp6i…` only for a first rehearsal. Move the token configuration owner, the mailbox owner and the upgrade authorities (token, mailbox, ISM) to the Squads vault. Rehearse an ISM change through the multisig. Verify with `check-x1.mjs --post-deploy` (expected authority = the vault).
6. **LP treasury:** move the testnet treasuries from encrypted server keys to the Safe and the Squads vault.

### 6. Validator keys: KMS vs encrypted local keys

| | Cloud KMS (AWS KMS or GCP Cloud KMS) | Encrypted local keystore |
|---|---|---|
| Support in the agents (`f556e18`) | checkpoint signer: `aws` (`id`, `region`) and `gcp` (`key_version_name`) are supported. The X1 (Sealevel) transaction signer supports only a local hex key | yes |
| Key exportable | **no** (signing happens in the KMS) | yes, while decrypted in memory |
| Server compromise | the attacker can sign only while they control the machine and its cloud credentials; access can be revoked centrally and is logged | the attacker can copy the key once and sign forever |
| Cost (AWS, list price) | **$1 per key per month** plus signing requests (asymmetric signing is not in the free tier; $0.15 per 10,000 for ECC keys in AWS's example). 7 validators, a few thousand checkpoints a month: about **$7–8 per month** | none |
| Operational risk | dependency on the cloud provider and its credentials; outage = that validator stops (5 of 7 tolerates 2) | password handling on the server |

**Recommendation for mainnet: KMS for all 7 checkpoint keys**, with separate cloud identities per machine (one *remotely* compromised machine gives one key at most), alerts on any use outside the validator process, and a split across two providers if possible (for example 4 on AWS, 3 on GCP) so that one provider outage cannot reach the threshold. The X1 announcement transaction of each validator is sent once with a small hot key that holds only a few XNT and has no other role. **Testnet stays as it is** (encrypted keystores on the testnet server).

**Correlated failure.** A threshold of validators is only as independent as the infrastructure, management access and people behind them. Keys in KMS cannot be copied, but a shared location, a shared management network or a shared administrator can use several validator identities at once while the attacker is present, so such validators are one point of trust as well as of failure. Mitigations: separate cloud identities and credentials per validator, alerts on signing outside the validator process, the rate limit and the pause; spreading the validator set over independent locations and operators is a separate decision.

**Key rotation.** A validator key is replaced by deploying a new multisig ISM (factory, deterministic address) with the new set and switching the router's aggregation ISM through the timelock (48 h on mainnet), with the old and new validators signing in parallel until the switch, exactly as in the no-downtime migration. On X1 (Ethereum → X1 validators) the X1 owner updates the multisig ISM's validator set, subject to the Squads time lock.

### 7. X1 multisig program (Squads v4)

Findings (on-chain reads, 31 Oct 2026):

| | Solana mainnet | X1 mainnet | X1 testnet |
|---|---|---|---|
| Program | `SQDS4ep6…pCf` | `SQDS4ep6…pCf` (same id) | `DDL3Xp6i…QJ41` |
| Upgrade authority | **none (immutable)** | **a single system account** `2sXr5THr…Q6Z7` (no multisig) | **a single system account** `45bQSp8X…cyU` |
| Program code (sha256 of the deployed ELF) | `d4866083…2fac` | `e39338bd…0eec` (**different**) | `72ae1dd5…5f7d` (**different**) |

On X1 mainnet the program was deployed and upgraded by `45bQ…` and its authority was then set to `2sXr…`. The owner of these keys is not publicly identified. **Whoever holds the upgrade key can replace the Squads code and take over every vault**, including one that owns our X1 programs. The deployed code also differs from the immutable build on Solana, so the Squads audits cannot be assumed to cover it.

**Decision proposed: our own deployment of Squads v4 on X1**:
- from the audited source, built reproducibly (verifiable build). The reference is the commit whose unmodified build reproduces the immutable Solana binary (`d4866083…2fac`); the candidate is `3742e552` (crate version 2.0.0, Jan 2024), which the OtterSec verification registry lists for `SQDS4…` but as not verified. Only if the hash is reproduced do we treat the source as the audited, deployed program. The only source changes needed for a new program id are `declare_id!` and the program-config initializer constant; they are reviewed and listed;
- upgrade authority **none** after the testnet rehearsal (or, if an upgrade path is wanted, our own multisig with a time lock);
- program config initialized by us, with no creation fee;
- multisig on mainnet: signers on Ledger (threshold: the same open decision as the Safe, 2 of 2 or 3 of 5), **`time_lock` = 48 h**, matching the Ethereum timelock, and no `config_authority` (membership changes only through the multisig itself).

Using the existing X1 deployment would make the unknown holder of `2sXr…` a single point of failure for all X1 authorities; acceptable for testnet rehearsal only.

### 8. Open decisions (owner, before mainnet)

1. **Admin threshold (Safe on Ethereum, Squads on X1): 2 of 2 or 3 of 5.** 2 of 2 = the owner's Ledger + a team Safe 1 of 2: the owner has a mandatory veto and is a single point of failure for liveness (section 3). 3 of 5 = five independent signers, any two may be lost.
2. **X1 authority layout.** Recommended: **one Squads** holding every X1 authority (token configuration, ISM, mailbox, IGP owners and the program upgrade authorities) with `time_lock` 48 h, matching the Ethereum timelock. An emergency stop on X1 is not needed for the collateral: the Ethereum pause holds every unlock. Alternative (earlier draft in `docs/13`): a separate fast "X1-config" Squads without a time lock for the ISM switch; it can mint unbacked VMPXe at once if compromised, so it is not recommended.
3. **Ethereum → X1 validators:** the public Hyperlane set (variant A, 6 of 9) is the plan. Our own 5 of 7 set would need its own Ethereum validators with a full Merkle-tree history (archive RPC; `docs/13`); it stays an option.

---

## Polski

### 1. Zasady

1. **Żaden pojedynczy klucz nie przesunie kolaterału.** Odblokowanie VMPX wymaga 5 z 7 podpisów walidatorów Hyperlane (X1 → Ethereum) i przechodzi przez pauzę i limit. Zmiana kodu lub konfiguracji wymaga multisiga, a na Ethereum dodatkowo Timelocka 48 h.
2. **Ledger dla każdego człowieka podpisującego** w multisigach Safe (Ethereum) i Squads (X1). Żadnego klucza podpisującego na serwerze.
3. **Gorące klucze tylko tam, gdzie musi podpisywać maszyna**, i tylko z minimalnymi uprawnieniami: klucz auto-pauzy (może tylko zatrzymać), relayery (mogą tylko dostarczyć albo opóźnić prawdziwe wiadomości), bot ceny (w granicach, wycofany po przejściu na stałą opłatę).
4. **Klucze walidatorów w chmurowym KMS** (bez możliwości eksportu) na mainnecie, osobna tożsamość na każdą maszynę.
5. **Weryfikuj przed podpisem.** Każdy podpis w Safe i Squads sprawdzamy z niezależnie policzonym hashem (sekcja 4).
6. Klucze prywatne i seed phrase nigdy nie trafiają do czatu, zgłoszeń, repozytoriów ani logów. Seedy Ledgerów istnieją tylko offline, na papierze albo metalu, w co najmniej dwóch miejscach.

### 2. Role

| Rola | Co może zrobić z VMPX i mostem | Gdzie klucz (cel na mainnet) | Próg / opóźnienie | Ograniczenia |
|---|---|---|---|---|
| **Admin Ethereum** (proposer i executor `TimelockController`) | upgrade routera lockboxa, zmiana ISM, hooków, opłat (`setBridgeFee` ≤ 5%), limitu; po opóźnieniu w ostateczności sięga kolaterału | multisig **Safe**, podpisujący na Ledgerach | **decyzja otwarta (sekcja 8): 2 z 2** (Ledger właściciela + Safe zespołu 1 z 2, próba na Sepolii) **albo 3 z 5**; każda zmiana czeka **48 h** w Timelocku | strażnik może anulować w ciągu 48 h; zmiany są jawne on-chain; `MAX_FEE_BPS = 500` jest niezmienne |
| **Strażnik** (guardian `EmergencyPauser`, canceller Timelocka) | wznowienie po pauzie, anulowanie zaplanowanych operacji, dodawanie i usuwanie pauserów | testnet: Ledger właściciela; mainnet: multisig **Safe**, podpisujący na Ledgerach (inni niż admin) | mainnet **2 z 3**, natychmiast | nie robi upgrade'ów, nie zmienia opłat, nie przesuwa środków. **Przejęty strażnik może jednak wyłączyć hamulec**: wznowić most w trakcie incydentu, anulować naprawcze operacje admina i usunąć pauserów. Dlatego multisig i podpisujący inni niż admin |
| **Pauser** | natychmiastowe zatrzymanie depozytów i odblokowań (`pauseAll`) | jeden **gorący klucz** monitora auto-pauzy + Ledger strażnika | 1 podpis, natychmiast | **tylko pauza**; wznawia wyłącznie strażnik |
| **Właściciel X1** (owner konfiguracji tokena, owner skrzynki, ownerzy multisig ISM i IGP, upgrade authority programów, authority metadanych) | zmiana ISM na X1, jego walidatorów i progu oraz routerów; upgrade programów tokena, skrzynki i ISM; zmiana opłaty protokołu X1 (≤ `max_protocol_fee`) i cen gazu | multisig **Squads v4** na X1 (własne wdrożenie, sekcja 7), podpisujący na Ledgerach | ta sama decyzja otwarta co admin Ethereum (sekcja 8); **`time_lock` 48 h** na mainnecie (ustawienie Squads v4) dla każdego uprawnienia (układ: sekcja 8) | **może sięgnąć kolaterału:** złośliwy ISM albo upgrade tokena pozwala zmintować VMPXe bez pokrycia na X1; te tokeny można potem *prawdziwie* spalić, walidatorzy podpiszą prawdziwy burn i kolaterał wyjdzie z Ethereum. Ograniczają to limit (zbiornik C + C/dobę) i pauza; planowany monitor uprawnień (przegląd runda 3, R-02: jeszcze nie działa) będzie pauzował Ethereum przy każdej zmianie konfiguracji X1. Dlatego multisig i 48 h opóźnienia |
| **Skarbiec LP** | odbiera 3% opłaty w VMPX (Ethereum) i opłatę protokołu w XNT (X1); zasila pulę VMPXe/XNT | **Safe** (VMPX na Ethereum) i **vault Squads** (XNT, VMPXe, tokeny LP na X1) | proponowane 2 z 3 | brak władzy nad mostem; trzyma tylko przychód z opłat |
| **Walidatory Hyperlane** (atestatory X1 → Ethereum) | podpisują checkpointy; 5 z 7 autoryzuje odblokowanie na Ethereum | **chmurowy KMS** (secp256k1 bez eksportu), osobny klucz i tożsamość chmurowa na maszynę | **5 z 7** | limit (zbiornik C + C/dobę), pauza, monitoring; potrzebny próg |
| **Relayer** | dostarcza wiadomości w obu kierunkach, płaci gas | **gorące klucze** z małym saldem na gas | — | nie podrobi wiadomości; może tylko opóźnić albo cenzurować; strata = saldo na gas |
| **Bot ceny** | aktualizuje cenę referencyjną hooka (±20% na godzinę, ±50% w oknie) | **gorący klucz** | — | opłata ograniczona `maxFeeWei`; **wycofany** po przejściu na stałą opłatę w ETH (cena nie jest już używana) |
| **Deployer** | tymczasowe okablowanie przy wdrożeniu | gorący klucz, jednorazowo | — | po przekazaniu **nie może mieć żadnej roli** (sprawdza `svm/compat/check-x1.mjs --mainnet`, który odrzuca deployera jako dowolny authority, oraz skrypt wdrożenia) |
| **Walidatory Ethereum → X1** (weryfikują wiadomości z Ethereum dla ISM na X1) | ich próg autoryzuje mint na X1 | **nie nasze klucze:** publiczny zbiór walidatorów Hyperlane dla Ethereum (**6 z 9** na mainnecie, Abacus Works 1 z 1 na Sepolii), wpisany w multisig ISM na X1 (owner = właściciel X1). Opcja (sekcja 8): własny zbiór 5 z 7 w KMS | **6 z 9** | mint bez pokrycia wychodzi tylko przez prawdziwe burny, które podpisują nasze walidatory X1 → Ethereum, pod limitem i pauzą na Ethereum |
| **Odbiorcy opłat** (beneficjent hooka opłat, beneficjent IGP na X1) | odbierają opłaty w ETH / XNT | Safe / vault Squads operatora | jak skarbiec LP | brak władzy nad mostem |
| **Właściciel Mailboxa Hyperlane na Ethereum** (zewnętrzny: governance Hyperlane) | może zmienić *wymagany* hook skrzynki (opłata protokołu) oraz domyślny hook i ISM | poza naszą kontrolą | governance Hyperlane | nasz router ustawia własny ISM i hook, więc domyślne nie mają zastosowania; zmieniony wymagany hook może zablokować albo podrożyć wysyłkę, ale nie podrobi wiadomości. Zewnętrzne założenie zaufania |

Minty Ethereum → X1 autoryzuje ISM tokena na X1, w którym jest publiczny zbiór walidatorów Hyperlane obserwujących Ethereum (wariant A, `docs/03`, `docs/13`). To nie są nasze klucze; zasada KMS dotyczy ich tylko przy wyborze opcji z własnym zbiorem.

### 3. Ledgery

- Każdy podpisujący ma **własnego Ledgera**. Jedno urządzenie nie obsługuje dwóch ról, które się nawzajem kontrolują (admin i strażnik).
- Ta sama osoba może podpisywać w Safe (Ethereum) i Squads (X1) jednym Ledgerem, w różnych aplikacjach (Ethereum, Solana).
- Firmware i aplikacje tylko przez Ledger Live; urządzenie kupione u producenta.
- Seed: zapisany offline (papier albo metal), w dwóch osobnych miejscach; nigdy nie fotografowany, nie wpisywany i nie czytany na głos.
- Zgubione albo przejęte urządzenie: w układzie **m z n przy m < n** pozostali podpisujący od razu wymieniają tego podpisującego (owner swap), a strażnik sprawdza, czy nie zaplanowano nieoczekiwanej operacji. **Przy 2 z 2 to niemożliwe:** drugi podpisujący sam nie zmieni właścicieli, więc zgubiony Ledger właściciela da się odzyskać tylko z seeda (wymagana sprawdzona kopia); przejęty można zneutralizować tylko pauzą i anulowaniem przez strażnika, dopóki właściciel nie odtworzy seeda na nowym urządzeniu i nie wymieni klucza.
- **Ledger i EIP-712:** nowsze firmware i aplikacja Ethereum pokazują hashe domeny i wiadomości EIP-712 transakcji Safe; starsze podpisują w ciemno. Firmware zawsze aktualne i nigdy nie podpisujemy transakcji Safe, której hashy urządzenie nie pokazuje.

### 4. Weryfikacja tego, co podpisujesz

**Safe (Ethereum)**
1. W aplikacji Safe przeczytaj operację: kontrakt docelowy, funkcja i argumenty. Przy operacjach Timelocka rozkoduj też wywołanie wewnętrzne (`schedule` / `execute` → cel, dane, salt, opóźnienie).
2. Policz **safeTxHash** (oraz hashe domeny i wiadomości) niezależnie, na drugim komputerze, z opublikowanych danych transakcji: `evm/script/safe-tx-hashes.sh` z tego repo (dodatkowo porównuje wynik z `getTransactionHash` samego Safe, a z `--nested` liczy hashe `approveHash` zagnieżdżonego Safe) albo otwarty skrypt `safe-tx-hashes`.
3. Na ekranie Ledgera porównaj hashe znak po znaku z krokiem 2. Podpisuj tylko, gdy się zgadzają.
4. Przy operacjach Timelocka po zaplanowaniu sprawdź zdarzenie `CallScheduled` (id, cel, dane), zanim ktokolwiek je wykona.

**Squads (X1)**
1. Sprawdź transakcję vaultu (program, konta, dane instrukcji) przez Squads CLI na drugim komputerze, z konta propozycji on-chain.
2. Aplikacja Solana na Ledgerze pokazuje hash wiadomości (wymaga włączonego blind signing). Porównaj go z hashem wiadomości przygotowanej w kroku 1.
3. Zatwierdzaj tylko przy zgodności; wykonuj dopiero po osiągnięciu progu i ponownym odczycie propozycji.

Nikt nie podpisuje transakcji, której nie umie rozkodować. „Po prostu podpisz” to powód, żeby przerwać.

### 5. Migracja na testnecie (Sepolia ⇄ X1 testnet)

Dziś wszystkie role administracyjne na testnecie trzyma programowy klucz deployera. Na testnecie to akceptowalne. Plan poniżej jest próbą generalną układu z mainnetu. Każdy krok wykonujemy dopiero po zgodzie właściciela.

1. **Safe na Sepolii (gotowe, Safe 1.5.0, bez modułów i guarda):** Safe admina **2 z 2** = Ledger właściciela + zagnieżdżony **Safe zespołu 1 z 2**. Każda akcja admina wymaga Ledgera właściciela *i* jednej osoby z zespołu. Na testnecie obaj podpisujący zespołu to kolejne konta na Ledgerze właściciela (jedno urządzenie, dopuszczalne tylko na testnecie); na mainnecie zastąpią ich osoby z IT z własnymi portfelami sprzętowymi. Podpis zagnieżdżony: Safe zespołu wykonuje `approveHash(safeTxHash)` na Safe admina, więc członek zespołu podpisuje własny hash Safe zespołu, który wypisuje `safe-tx-hashes.sh --nested`.
   **Decyzja otwarta (właściciel, przed mainnetem): 2 z 2 czy 3 z 5.** Przy 2 z 2 Ledger właściciela jest pojedynczym punktem awarii dla działania admina (zgubione urządzenie i zgubiony seed = admin zamrożony, bez upgrade'ów i zmian opłat; sam most działa dalej, a strażnik nadal może wstrzymać). Mainnet: albo 2 z 2 ze sprawdzoną kopią seeda, albo 3 z 5 (sekcja 2).
2. **Role Timelocka → Safe, w dwóch operacjach Timelocka:** (A) deployer nadaje Safe role proposer, executor i canceller, a Ledgerowi strażnika canceller; (B) **sam Safe** planuje i wykonuje odebranie wszystkich ról deployerowi i roli canceller staremu strażnikowi. B dowodzi, że Safe umie planować i wykonywać, zanim deployer straci role. `TIMELOCK_ADMIN_ROLE` zostaje tylko przy Timelocku (bez zewnętrznego admina), więc każda późniejsza zmiana ról też czeka na opóźnienie. Sprawdzenie, że deployer nie może już planować ani wykonywać: `evm/script/check-roles.sh 2b` (tylko odczyt). Ta bramka obejmuje wyłącznie Timelock; koniec całej migracji (strażnik, pauserzy, price updater, odbiorcy opłat, właściciele, właściciele i moduły Safe, uprawnienia X1) to osobna bramka `check-roles.sh full` (przegląd Codex runda 4, R4-07).
3. **Strażnik → Ledger właściciela** (`proposeGuardian` / `acceptGuardian`); jeden gorący klucz **pausera** na serwerze testnetu do auto-pauzy; próba pauzy i wznowienia z Ledgera.
4. **Próba generalna:** operacja Timelocka zaplanowana i wykonana przez Safe z podpisem Ledgera i weryfikacją hashy; pauza i wznowienie z Ledgera; próba starym kluczem deployera musi się nie udać.
5. **X1:** multisig Squads v4 na X1 testnet: **najpierw własne wdrożenie programu** (sekcja 7); istniejący `DDL3Xp6i…` tylko do pierwszej próby. Przeniesienie właściciela konfiguracji tokena, właściciela skrzynki i upgrade authority (token, skrzynka, ISM) na vault Squads. Próba zmiany ISM przez multisig. Weryfikacja `check-x1.mjs --post-deploy` (oczekiwany authority = vault).
6. **Skarbiec LP:** przeniesienie skarbców testnetu z zaszyfrowanych kluczy na serwerze do Safe i vaultu Squads.

### 6. Klucze walidatorów: KMS a zaszyfrowane klucze lokalne

| | Chmurowy KMS (AWS KMS albo GCP Cloud KMS) | Zaszyfrowany keystore lokalny |
|---|---|---|
| Wsparcie w agentach (`f556e18`) | podpis checkpointów: `aws` (`id`, `region`) i `gcp` (`key_version_name`). Podpis transakcji na X1 (Sealevel) obsługuje tylko lokalny klucz hex | tak |
| Czy klucz da się wynieść | **nie** (podpis dzieje się w KMS) | tak, gdy jest odszyfrowany w pamięci |
| Przejęcie serwera | atakujący podpisuje tylko, dopóki kontroluje maszynę i jej poświadczenia chmurowe; dostęp da się centralnie odebrać i jest logowany | atakujący kopiuje klucz raz i podpisuje bez końca |
| Koszt (AWS, cennik) | **1 USD za klucz miesięcznie** plus podpisy (podpisy asymetryczne nie są w darmowym pakiecie; w przykładzie AWS 0,15 USD za 10 000 dla kluczy ECC). 7 walidatorów, kilka tysięcy checkpointów miesięcznie: ok. **7–8 USD miesięcznie** | brak |
| Ryzyko operacyjne | zależność od dostawcy chmury i poświadczeń; awaria = ten walidator stoi (5 z 7 znosi 2) | obsługa hasła na serwerze |

**Rekomendacja na mainnet: KMS dla wszystkich 7 kluczy checkpointów**:
- osobne tożsamości chmurowe na każdą maszynę (przejęcie jednej maszyny daje najwyżej jeden klucz);
- alerty na każde użycie klucza spoza procesu walidatora;
- jeśli się da, podział na dwóch dostawców (np. 4 w AWS, 3 w GCP), żeby awaria jednego nie sięgnęła progu.

Transakcję ogłoszenia (announce) każdego walidatora na X1 wysyłamy raz małym gorącym kluczem z kilkoma XNT i bez innej roli. **Testnet zostaje bez zmian** (zaszyfrowane keystore'y na serwerze testnetu).

**Awaria skorelowana.** Próg walidatorów jest tak niezależny jak infrastruktura, dostęp administracyjny i ludzie, którzy za nimi stoją. Kluczy w KMS nie da się skopiować, ale wspólna lokalizacja, wspólna sieć zarządzania albo wspólny administrator pozwala użyć kilku tożsamości walidatorów naraz, dopóki atakujący ma dostęp. Takie walidatory są więc jednym punktem zaufania, nie tylko awarii. Ograniczenia: osobne tożsamości i poświadczenia dla każdego walidatora, alerty na podpis spoza procesu walidatora, limit i pauza; rozłożenie walidatorów na niezależne lokalizacje i operatorów to osobna decyzja.

**Rotacja kluczy.** Klucz walidatora wymieniamy, wdrażając nowy multisig ISM (fabryka, adres deterministyczny) z nowym zbiorem i przełączając agregujący ISM routera przez Timelock (48 h na mainnecie). Do przełączenia stare i nowe walidatory podpisują równolegle, jak w migracji bez przerwy. Na X1 (walidatory Ethereum → X1) zbiór w multisig ISM zmienia właściciel X1, z opóźnieniem `time_lock` Squads.

### 7. Program multisig na X1 (Squads v4)

Ustalenia (odczyty on-chain, 31 paź 2026):

| | Solana mainnet | X1 mainnet | X1 testnet |
|---|---|---|---|
| Program | `SQDS4ep6…pCf` | `SQDS4ep6…pCf` (to samo ID) | `DDL3Xp6i…QJ41` |
| Upgrade authority | **brak (niezmienny)** | **jedno konto systemowe** `2sXr5THr…Q6Z7` (nie multisig) | **jedno konto systemowe** `45bQSp8X…cyU` |
| Kod programu (sha256 wdrożonego ELF) | `d4866083…2fac` | `e39338bd…0eec` (**inny**) | `72ae1dd5…5f7d` (**inny**) |

Na X1 mainnet program wdrożył i aktualizował klucz `45bQ…`, który potem przekazał authority na `2sXr…`. Właściciel tych kluczy nie jest publicznie znany. **Kto ma klucz upgrade'u, może podmienić kod Squads i przejąć każdy vault**, także ten, który będzie właścicielem naszych programów na X1. Wdrożony kod różni się też od niezmiennego buildu na Solanie, więc nie można zakładać, że obejmują go audyty Squads.

**Proponowana decyzja: własne wdrożenie Squads v4 na X1**:
- z audytowanego źródła, w buildzie odtwarzalnym (verifiable build). Punktem odniesienia jest commit, którego niezmieniony build odtwarza niezmienny program na Solanie (`d4866083…2fac`); kandydat to `3742e552` (wersja crate 2.0.0, styczeń 2024), wskazany dla `SQDS4…` w rejestrze weryfikacji OtterSec, ale jako niezweryfikowany. Źródło uznajemy za audytowany, wdrożony program tylko po odtworzeniu hasha. Jedyne zmiany źródeł potrzebne dla nowego ID to `declare_id!` i stała inicjatora konfiguracji programu; przeglądamy je i wypisujemy;
- upgrade authority **brak** po próbie na testnecie (albo, jeśli chcemy ścieżki upgrade'u, nasz własny multisig z time lockiem);
- konfigurację programu inicjalizujemy sami, bez opłaty za tworzenie;
- multisig na mainnecie: podpisujący na Ledgerach (próg: ta sama otwarta decyzja co przy Safe, 2 z 2 albo 3 z 5), **`time_lock` = 48 h**, jak Timelock na Ethereum, i bez `config_authority` (zmiany składu tylko przez sam multisig).

Używanie istniejącego wdrożenia na X1 robi z nieznanego posiadacza `2sXr…` pojedynczy punkt awarii dla wszystkich uprawnień na X1. Akceptowalne tylko na próbę na testnecie.

### 8. Decyzje otwarte (właściciel, przed mainnetem)

1. **Próg admina (Safe na Ethereum, Squads na X1): 2 z 2 albo 3 z 5.** 2 z 2 = Ledger właściciela + Safe zespołu 1 z 2: właściciel ma obowiązkowe weto i jest pojedynczym punktem awarii dla działania admina (sekcja 3). 3 z 5 = pięciu niezależnych podpisujących, dwóch można stracić.
2. **Układ uprawnień na X1.** Rekomendacja: **jeden Squads** z wszystkimi uprawnieniami X1 (owner konfiguracji tokena, ISM, skrzynki, IGP oraz upgrade authority programów) i `time_lock` 48 h, jak Timelock na Ethereum. Awaryjny stop na X1 nie jest potrzebny dla kolaterału: pauza na Ethereum wstrzymuje każde odblokowanie. Alternatywa (wcześniejszy szkic w `docs/13`): osobny szybki Squads „X1-config” bez time-locka do przełączania ISM; po przejęciu może od razu zmintować VMPXe bez pokrycia, więc go nie rekomendujemy.
3. **Walidatory Ethereum → X1:** planem jest publiczny zbiór Hyperlane (wariant A, 6 z 9). Własny zbiór 5 z 7 wymagałby własnych walidatorów Ethereum z pełną historią drzewa Merkle (archiwalne RPC; `docs/13`); zostaje jako opcja.
