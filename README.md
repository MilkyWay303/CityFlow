# CityFlow — zgłoszenia drogowe w Krakowie

## Uruchomienie

Wymagany jest Node.js 18 lub nowszy. W folderze aplikacji uruchom:

-------------------------
```powershell
node server.js
```

Następnie otwórz `http://127.0.0.1:4173`f. Zatrzymaj serwer skrótem `Ctrl+C`.

-------------------------

## Funkcje

- Mieszkaniec wybiera krakowską ulicę i kategorię problemu, dodaje opis oraz opcjonalnie zdjęcie.
- Podgląd wybranego zdjęcia jest dostępny przed wysłaniem zgłoszenia.
- Po zapisaniu mieszkaniec otrzymuje potwierdzenie z nazwą zgłoszenia, ulicą, kategorią oraz datą i godziną. Nazwa zgłoszenia jest jego numerem, np. `Aleja-29-Listopada-1`.
- Numer zgłoszenia zawiera uproszczoną nazwę ulicy i kolejny, niezależny dla każdej ulicy numer, na przykład `Aleja-29-Listopada-1`. Licznik nie cofa się po usunięciu wpisu.
- Panel urzędnika dzieli zgłoszenia na niesprawdzone i sprawdzone. Nowe wpisy trafiają do niesprawdzonych; urzędnik może zweryfikować pojedyncze zgłoszenie lub zaznaczoną grupę, a także cofnąć status.
- Nazwa wyświetlana przy każdym zgłoszeniu to jego numer w formacie `Nazwa-Ulicy-Numer`.
- W panelu urzędnik może zaznaczać i usuwać wiele wpisów, kopiować opisy, powiększać i pobierać zdjęcia, a ulice są sortowane według liczby zgłoszeń w aktywnej zakładce.
- Przy każdym zgłoszeniu wyświetlana jest data i godzina jego wysłania.
- Priorytet rośnie wraz z liczbą zgłoszeń: 1 — obserwacja, 2–4 — średni, 5 lub więcej — wysoki.
- Zdjęcia są zmniejszane przed zapisem. Zgłoszenia i zdjęcia są zapisywane w pliku `storage/reports.json`, a liczniki numerów w `storage/report-counters.json`. Dane pozostają dostępne po restarcie serwera.
- Panel urzędnika jest chroniony hasłem `321123`. Sesja wygasa po 8 godzinach. Aby ustawić inne hasło przed uruchomieniem, ustaw zmienną środowiskową `OFFICIAL_PASSWORD`.

## Ważne ograniczenie

To lokalna wersja demonstracyjna. Aplikacja nasłuchuje wyłącznie na tym urządzeniu, a zgłoszenia nie są przesyłane do Urzędu Miasta ani udostępniane przez internet. Hasło domyślne należy zmienić przed udostępnieniem urządzenia innym osobom.
