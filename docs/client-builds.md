# Client Builds (VPS)

This repository now has buildable shell clients for testing:
- Windows: Electron wrapper -> `EXE`
- Android: Capacitor WebView wrapper -> `APK`

Both clients open your deployed Korbit web URL.

Artifacts location:
- Produced into `uploads/releases` in repository root.
- In VPS setup they are downloadable via `/api/uploads/releases/*`.

Manual build on VPS host:

```bash
cd /opt/korbit
KORBIT_APP_URL="https://your-chat-domain" bash scripts/release/build-windows.sh
KORBIT_APP_URL="https://your-chat-domain" bash scripts/release/build-android.sh
```

Build from admin account:
- Login as admin.
- Open `/chats` and use sidebar block `Builds`.
- Click `Build Windows` / `Build Android`.
- Download the generated artifact from the same block.

Local Windows build commands:

```powershell
$env:KORBIT_APP_URL = "https://your-chat-domain"
powershell -ExecutionPolicy Bypass -File scripts/release/build-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts/release/build-android.ps1
```
