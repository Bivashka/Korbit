$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$mobileDir = Join-Path $repoRoot "apps\korbit-mobile"
$outputDir = if ($env:KORBIT_BUILD_OUTPUT_DIR) { $env:KORBIT_BUILD_OUTPUT_DIR } else { Join-Path $repoRoot "uploads\releases" }
$appUrl = if ($env:KORBIT_APP_URL) { $env:KORBIT_APP_URL } elseif ($env:KORBIT_PUBLIC_WEB_URL) { $env:KORBIT_PUBLIC_WEB_URL } else { "http://localhost:3000" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetPath = Join-Path $outputDir ("korbit-android-{0}.apk" -f $stamp)

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Push-Location $repoRoot
try {
  $env:KORBIT_APP_URL = $appUrl
  corepack pnpm install --filter @korbit/korbit-mobile... --prod=false --no-frozen-lockfile
  if (-not (Test-Path (Join-Path $mobileDir "android"))) {
    corepack pnpm --filter @korbit/korbit-mobile exec cap add android
  }
  corepack pnpm --filter @korbit/korbit-mobile exec cap sync android
} finally {
  Pop-Location
}

docker run --rm `
  -v "${repoRoot}:/workspace" `
  -w /workspace/apps/korbit-mobile/android `
  -e GRADLE_USER_HOME=/workspace/.gradle `
  mingc/android-build-box:latest `
  /bin/bash -lc "chmod +x ./gradlew || true; bash ./gradlew assembleDebug"

$sourceApk = Join-Path $mobileDir "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $sourceApk)) {
  throw "Failed to find built APK artifact in $sourceApk"
}

Copy-Item -Force $sourceApk $targetPath
Write-Output ("ARTIFACT_PATH={0}" -f $targetPath)
