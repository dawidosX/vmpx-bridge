# Ocena przeglądu Codex, runda 7 (31 paź 2026, zakres `a5ea49b..fcc2acc`)

Raport: [`codex-2026-10-31-runda7.md`](codex-2026-10-31-runda7.md). Bezwzględne ścieżki lokalne w raporcie zamieniono na odnośniki względne, treść bez zmian. Wszystkie znaleziska R7 potwierdzone w kodzie `fcc2acc`. Auto-pauza zostaje w trybie `DRY_RUN=1`.

| ID | Waga | Ocena (z kodu) | Poprawka (runda E) |
|---|---|---|---|
| R7-01 | Średnie | potwierdzone: kolektor dowodów i odczyt minta dzielą jeden budżet przebiegu; `check()` po przekroczeniu limitu przerywa przed `readMint()`, a abort zastępuje już zebrany dowód wynikiem UNKNOWN | trzy niezależne zadania z osobnymi budżetami: (a) kontrola minta — pierwsza, zawsze wykonana, (b) dowody wiadomości, (c) salda; potwierdzone naruszenie nie może zostać nadpisane przez timeout lub błąd innego zadania ani zapis cache |
| R7-02 | Średnie | potwierdzone: drugie źródło ETH pyta tylko o kandydatów; ciche pominięcie logu przez główne źródło dłużej niż 256 bloków nie tworzy kandydata | drugie źródło skanuje niezależnie (DispatchId i ProcessId lockboxa) z własnym kursorem; zbiory porównywane po finalized, rozbieżność = UNKNOWN + alarm; okresowy pełny przegląd od `FROM_BLOCK` (w tle, z budżetem); naprawa bez limitu 256 bloków |
| R7-03 | Średnie | potwierdzone: `mint-from-foreign-sender` wymaga braku DispatchId, więc istniejący dispatch obcego nadawcy blokuje potwierdzenie | osobna ścieżka: treść wiadomości (domena źródłowa, nadawca) porównana z oczekiwanym routerem; niezgodność potwierdzona w dwóch źródłach X1 = CRITICAL niezależnie od DispatchId |
| R7-04 | Niskie | potwierdzone: przerwa liczona dopiero przy następnym udanym odczycie; indekser liczy niekompletne przebiegi do ciągłości | przerwa ponad limit także przy błędzie wygasza licznik; niekompletne przebiegi indeksera nie liczą się do ciągłości |
| R7-05 | Średnie | potwierdzone: po ostatnim sprawdzeniu są jeszcze `await` przed portfelem; zmiany formularza nie zmieniają generacji; `opKey()` nieużywany w `app.js` | parametry operacji utrwalone na starcie (także `from`), pola formularza zablokowane do końca operacji, porównanie konta, sieci i generacji po ostatnim `await` przed portfelem; X1: kontrola po podpisie przed wysłaniem; `opKey()` użyty w aplikacji |
| R7-06 | Średnie | potwierdzone: zapis do `localStorage` dopiero z ID; blokada tylko w pamięci karty | zapis operacji od chwili uzyskania hasha EVM / podpisu X1; po F5 uzgodnienie wyniku i odzyskanie ID; dopóki operacja jest „wysłana/nieznana”, nowa wysyłka zablokowana (komunikat + „Sprawdź status”), także między kartami |
| R7-07 | Średnie | potwierdzone: `expired` traktowane jako pewna porażka | po wygaśnięciu blockhasha koniec rozsyłania, uzgodnienie podpisu z historią (`finalized`); bez rozstrzygnięcia UNKNOWN z podpisem i linkiem |
| R7-08 | Niskie | potwierdzone: podgląd opłat X1 bez limitu wieku | podgląd ważny najwyżej 60 s; przed podpisem ponowna wycena, istotna zmiana wymaga ponownej akceptacji |

Dodatkowo (pytanie 14 raportu): zapisy w `localStorage` z przyszłym czasem albo z transakcją/podpisem innego konta niż podłączone są odrzucane.

## Uwagi
- Rekomendacja Codexa (pytanie 10): izolowana próba samego wykonania pauzy z syntetycznymi metrykami jest dopuszczalna; próba z rzeczywistym kolektorem dopiero po R7-01 i R7-02, poprawie R7-03 i wykazaniu niezależności i kompletności obu źródeł.
- Testy deklarujące więcej, niż sprawdzają (sekcja „Testy” raportu): w rundzie E każdy z wymienionych przypadków dostaje test na właściwym poziomie (handler aplikacji, F5, druga karta, wyczerpanie budżetu kolektora, trwająca awaria).
- CSP (pytanie 18): nagłówki ustawia nginx; sprawdzenie odpowiedzi serwera należy do testów wydania strony (`ops/e2e`).
