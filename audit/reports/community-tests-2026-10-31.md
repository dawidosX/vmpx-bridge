# Testy społeczności strony testnetu (31 paź 2026) i runda UX v38

Źródło: checklista testów ręcznych (około 50 scenariuszy w 8 grupach: przepływ główny, walidacja, portfele i sieci, transakcje i statystyki, bezpieczeństwo, wydajność, UI/UX) wypełniona przez członka społeczności na stronie v37. Oryginał z danymi testera jest przechowywany prywatnie. Ten plik to podsumowanie.

**Zakres:** testy funkcjonalne i UX strony z poziomu przeglądarki. Oznaczenia OK w punktach bezpieczeństwa (replay, niezmiennik 1:1, uprawnienia, kontrakty, program X1) to obserwacje użytkownika strony, **nie audyt kodu**. Audyt kontraktów i programu jest osobny (`audit/reports/`).

## Wynik i co zmieniła wersja v38

| ID | Zgłoszenie (skrót) | v38 |
|---|---|---|
| FUN-03 | Licznik „Waiting for confirmation” bez końca, choć transfer doszedł | **Błąd potwierdzony.** v37 śledziła saldo odbiorcy; po innym ruchu na portfelu próg nie był osiągany. Teraz śledzenie po ID wiadomości (konto processed na X1, `processedAt` na Ethereum), po 20 min komunikat z linkiem do Transakcji; stare zapisy same się domykają |
| FUN-01/02, NET-05 | Odświeżenie rozłącza portfele i gubi stan transferu | ciche przywrócenie (`eth_accounts`, Wallet Standard `silent`), wznowienie śledzenia ostatniego transferu w obu kierunkach |
| NET-03 | Zła sieć w MetaMask bez komunikatu; konto ETH z portfela wielosieciowego jako „X1” | stały baner z przyciskiem przełączenia sieci, blokada wysyłki; portfel X1 musi deklarować łańcuch `solana:*` i 32-bajtowy klucz; przed podpisem sprawdzenie genesis X1 testnet, mintu i programu |
| NET-04 | Brak ostrzeżenia o zmianie konta/sieci | zmiana konta, sieci lub rozłączenie unieważnia przygotowaną operację; ponowne sprawdzenie sieci, konta, salda, allowance i opłaty przed każdym podpisem |
| FUN-05 | Okno podpisu X1 nie pojawiło się | limit 60 s, komunikat i przycisk „Połącz ponownie”; nic nie jest wysyłane bez podpisu |
| NET-08 | Brak komunikatu przy awarii RPC | baner braku połączenia z ponowieniem; osobne stany: wynik nieznany (z hashem, bez zachęty do ponowienia), oczekiwanie, opóźnienie |
| NET-06 | Podwójne kliknięcie | było OK; teraz dodatkowo blokada w kodzie (jedna wysyłka naraz) |
| SEC-10 | Czytelność podpisu | approve dokładnie na kwotę (test), w podsumowaniu sieć, odbiorca i kontrakt |
| FUN-03/05 | Domyślny adres odbiorcy | podłączony portfel po stronie docelowej, edytowalny |
| FUN-01 | Brak salda ETH | saldo ETH obok VMPX, ostrzeżenie przy braku ETH na gaz / XNT na opłaty |
| FUN-09 | Brak „Add to wallet” po stronie X1 | Wallet Standard nie ma odpowiednika `watchAsset`; zostaje Copy + eksplorator (były już w v37) |
| VAL-02 | Czy przesyłać ułamki | zostają (najwyżej 9 miejsc po przecinku), bez blokady |
| FUN-10, UIX-02 | Mainnet, urządzenia mobilne | N/A w tej rundzie |

Pozostałe scenariusze (walidacja kwot i adresów, transakcje i statystyki, wydajność, UI/UX) tester oznaczył OK.

Testy v38: `node --test frontend/tests/core.test.mjs` (śledzenie po ID, unieważnianie, walidacja portfela X1, exact approve, blokada podwójnej wysyłki, klasy błędów, PDA zgodne z monitorem).
