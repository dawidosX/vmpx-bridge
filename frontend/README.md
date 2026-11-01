# Frontend: wymagania

`index.html` to statyczny prototyp (tryb DEMO, nic nie wysyła). Parametry są w obiekcie `CONFIG`. Ten plik zbiera wymagania, które frontend musi spełnić przed publicznym pilotażem. Ich źródłem jest testnet (etap A, 29–30 paź 2026) i przegląd zewnętrzny `audit/reports/external-review-2026-10-30.md`.

## Czas transferu: „minuty, nie sekundy”

Pomiar na testnecie, z tx pochodzących z `09-collect`:

| kierunek | warunki normalne | z czego wynika |
|---|---|---|
| Ethereum → X1 | **ok. 1 min** (test 1b, 30 paź: 52 s od bloku do mintu); mainnet ok. 4–5 min (szacunek) | relayer czeka tyle bloków co walidatorzy (Sepolia 2, Ethereum 15). Wcześniej, z `"finalized"`: 13–19 min (n = 6) |
| X1 → Ethereum | **27 s** (n = 1) | finalizacja X1 jest szybka. Pauza albo limit dzienny wydłużają czas do wznowienia (w e2e: 11 min w pauzie) |

Wymagania:
1. Nigdy nie pisz „natychmiast” ani „w kilka sekund”. Przy kierunku ETH→X1 pokazuj **„zwykle 1–2 minuty (na mainnecie ok. 5 minut)”** i komunikat, żeby nie wysyłać drugi raz.
2. Przy X1→ETH pokazuj „zwykle poniżej 1 min” oraz informację, że pauza lub limit mogą transfer wstrzymać, ale środki nie przepadają.
3. Status transferu musi przetrwać zamknięcie karty. Pokazuj link do tx źródłowej i ID wiadomości Hyperlane, żeby użytkownik nie wysyłał ponownie.
4. Alarm „transfer opóźniony” dopiero po 15 min dla ETH→X1 i po 10 min dla X1→ETH (zgodnie z `docs/08-runbook.md`).

## Kwoty i dust

- Kwota musi być wielokrotnością 1e9 wei, czyli mieć najwyżej 9 miejsc po przecinku. Kontrakt odrzuca inne kwoty (`AmountNotMultipleOfDustUnit`), ale frontend ma to wyłapać wcześniej i nie wysyłać transakcji, która się nie powiedzie.

## Transakcje na X1

- Limit compute units dla `transfer_remote` wynosi **ok. 250 tys. CU**. Pomiar: 142–155 tys. Domyślny limit klienta Hyperlane to 1,4 mln CU, przez co opłata rośnie ok. 5,5×.
- Koszt dostarczenia na Ethereum (IGP, w XNT) ma pochodzić z wyceny on-chain, z odpowiedniego zapytania do IGP. Nie wolno go wpisywać na stałe.

## Model zaufania (sekcja „Model bezpieczeństwa”)

- Podpisy różnią się w zależności od kierunku i model zaufania musi to jasno rozróżniać (`docs/03-architecture.md`):
  - **ETH → X1 (mint VMPXe):** walidatorzy Hyperlane. Testnet: 1/1 Abacus Works; mainnet: 6/9, **do potwierdzenia** przed wdrożeniem (lista z `multisigIsm.ts` przypiętego commita). To nie są klucze operatora;
  - **X1 → ETH (odblokowanie VMPX):** atestatory operatora mostu. Testnet 2/3, mainnet 5/7.
- Pokazuj, kto ma klucze administracyjne: Safe i Timelock na Ethereum, Squads na X1. Pokazuj też, że pauza zatrzymuje depozyty i odblokowania, a nie sam lockbox.
