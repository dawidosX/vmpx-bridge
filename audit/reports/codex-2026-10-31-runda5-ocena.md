# Ocena przeglądu Codex, runda 5 (31 paź 2026, zakres `72da87f..3ea31f4`)

Raport: [`codex-2026-10-31-runda5.md`](codex-2026-10-31-runda5.md). Wszystkie znaleziska R5 potwierdzone w kodzie `3ea31f4`. Auto-pauza zostaje w trybie `DRY_RUN=1`.

**Wniosek właściciela (runda C):** porównywanie sald dwóch łańcuchów nie da dowodu, który uzasadnia automatyczną pauzę: odczyty nigdy nie są jednym snapshotem (R5-01, R5-03). Model auto-pauzy zmieniamy: pauza tylko na dowody jednoznaczne, dopasowane po ID wiadomości, niezależne od chwili odczytu. Porównanie sald zostaje jako alarm dla człowieka. Plan: `docs/16-auto-pause-model.md`.

| ID | Waga | Ocena | Poprawka (runda C) |
|---|---|---|---|
| R5-01 | Średnie | potwierdzone: warunki slotów nie dowodzą kompletności (burn między listą a podażą może zniknąć z zobowiązań) | `index.complete` opisane jako heurystyka; saldo nie prowadzi do pauzy, tylko do alarmu po > 30 min trwałego niedoboru |
| R5-02 | Niskie | potwierdzone: strona akceptuje brak `index` | brak `index` = nieznane |
| R5-03 | Średnie | potwierdzone: burn→unlock między odczytami daje potwierdzony fałszywy niedobór | j.w.: saldo nie pauzuje; pauza wyłącznie na dowody po ID wiadomości |
| R5-04 | Średnie | potwierdzone: `attemptAt` przed końcem ticka, nakładanie przebiegów, brak timeoutów | jeden aktywny przebieg, timeouty RPC i ticka, czas zakończenia wyniku i czas potwierdzonego CRITICAL; auto-pauza sprawdza ten drugi |
| R5-05 | Średnie | potwierdzone: stare rekordy bez hashy poza kontrolą reorga | przebudowa bazy indeksera od bloku wdrożenia, bez migracji starych rekordów; stara baza jako kopia |
| R5-06 | Średnie | potwierdzone: ponownie włączona transakcja może mieć inny nonce i ID | dekodowanie Dispatch z receipt, zastąpienie rekordu; test z innym nonce |
| R5-07 | Niskie | potwierdzone: diagnostyka przed wysłaniem pauzy | `pauseAll()` najpierw, ponowienia, potem diagnostyka z timeoutem i sprawdzenie obu kierunków |

## Status (31 paź 2026, runda C)

| Punkt | Commit | Testy / weryfikacja |
|---|---|---|
| model auto-pauzy (dowody po ID), saldo jako alarm, R5-04, R5-07 | `9ac451e` | dowody 8 (mint bez lock, unlock bez burn, zdrowy ruch w obu kierunkach w dowolnej kolejności, obcy odbiorca, przycięta historia RPC, nierozpoznana wiadomość), rdzeń 9 (w tym scenariusz Codexa burn→unlock między odczytami: nigdy CRITICAL), zawieszone RPC na prawdziwym `monitor.mjs`, auto-pauza 9 (atrapa `cast`: ponowienia, nieudana pauza, częściowa pauza). Przebieg na żywym testnecie: 0 CRITICAL, 0 nierozpoznanych; 76 dispatchy ETH, 54 burny X1 = 54 unlocki ETH |
| R5-01, R5-02, R5-05, R5-06 | `3b3f907` | indekser 18 (inny nonce po reorgu, rekordy bez hasha, alarm po 30 min); przebudowa bazy od bloku wdrożenia lokalnie: 135 transferów jak produkcja, wszystkie z hashem, pokrycie 0 |

`index.complete` opisane jako heurystyka; auto-pauza nie korzysta z sald. `DRY_RUN=1`.
