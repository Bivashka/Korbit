# korbit-desktop

Electron desktop shell for Korbit web app.

Build EXE:

```powershell
$env:KORBIT_APP_URL = "https://your-chat-domain"
powershell -ExecutionPolicy Bypass -File ../../scripts/release/build-windows.ps1
```

Runtime URL override options:

- `korbit-desktop-url.txt` рядом с `.exe` (одна строка с `https://...`)
- аргумент запуска `--url=https://...`
