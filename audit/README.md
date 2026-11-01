# Audyt wieloma modelami: procedura

## Cel i granice

Kilka niezależnych przeglądów (Grok, GPT, Kimi, Claude Code) plus narzędzia statyczne. Każdy model inaczej czyta kod, więc suma ich ustaleń jest szersza niż jeden przegląd.

**Czego to nie zastąpi.** Modele bardzo dobrze znajdują znane wzorce błędów: hook pomijający drzewo merkle (H-1 w `reports/`), dziedziczone ścieżki admina, zaokrąglenia. Słabo radzą sobie z:
- błędami wymagającymi wiedzy spoza kodu (zachowanie agentów, rollbacki X1),
- długimi łańcuchami ekonomicznymi,
- weryfikacją własnych twierdzeń, bo zdarzają się zmyślone numery linii.

Dlatego zostają warstwy ograniczające szkody: limit dzienny, pauza, timelock, monitor pokrycia i jawny model powierniczy.

## Krok po kroku

1. **Zamrożenie wersji:** `git tag audit-round-N`, potem `audit/build-context.sh` → `audit/context.txt`.
2. **Przeglądy niezależne.** Każdy model dostaje ten sam `PROMPT.md` + `context.txt`, w **nowej** rozmowie, bez wyników innych modeli (nie podsuwamy hipotez).
   - **Grok, GPT, Kimi:** wklej prompt i plik. Jeśli kontekst jest za mały, podziel: najpierw `SCOPE.md` + `evm/src` + `script`, potem upstream.
   - **Claude Code:** uruchom w katalogu repo z promptem z `PROMPT.md`. Agent może sam uruchamiać `forge test` i pisać PoC w kopii repo.
   - Zapisz każdy raport jako `reports/<model>-<data>.md`, w formacie z `FINDINGS_TEMPLATE.md`.
3. **Narzędzia statyczne:** `slither` (wynik w `tools/slither.txt`). Opcjonalnie Aderyn i fuzzing Echidna/Medusa na niezmiennikach z `SCOPE.md`.
4. **Konsolidacja:** tabela w `docs/12-review-findings.md`.
   - Duplikaty łączymy, zachowując informację, który model co znalazł.
   - **Każde ustalenie High/Medium trzeba potwierdzić PoC (test Foundry) albo obalić z uzasadnieniem.** Samo twierdzenie modelu nie wystarcza.
   - Każda poprawka dostaje test regresyjny (`evm/test/ReviewFixes.t.sol`).
5. **Runda kontrolna:** po poprawkach ten sam prompt na nowym commicie do co najmniej 2 modeli, z pytaniem „czy poprawki są kompletne i czy coś zepsuły”.
6. **Kryterium wyjścia na publiczny pilotaż:**
   - 0 otwartych Critical/High i każdy Medium naprawiony albo świadomie zaakceptowany (zapisane w `docs/12`);
   - testnet E2E (`testnet/08-e2e.sh`) bez FAIL;
   - limit dzienny ustawiony na kwotę, którą operator jest w stanie pokryć.

## Runda 1 (2026-10-28)

| Przegląd | Wynik |
|---|---|
| Claude (niezależny agent, bez wiedzy o intencjach autora) | 1 High, 4 Medium, 7 Low, 3 Info. Raport: `reports/claude-independent-2026-10-28.md` |
| Slither 0.11.6 | 1 Medium (divide-before-multiply, poprawione), reszta Low/Info (`tools/slither.txt`) |
| Grok / GPT / Kimi | **do wykonania przez operatora** według kroków 1–4 |
