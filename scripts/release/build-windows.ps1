$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$outputDir = if ($env:KORBIT_BUILD_OUTPUT_DIR) { $env:KORBIT_BUILD_OUTPUT_DIR } else { Join-Path $repoRoot "uploads\releases" }
$appUrl = if ($env:KORBIT_APP_URL) { $env:KORBIT_APP_URL } elseif ($env:KORBIT_PUBLIC_WEB_URL) { $env:KORBIT_PUBLIC_WEB_URL } else { "http://localhost:3000" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetPath = Join-Path $outputDir ("korbit-windows-{0}.exe" -f $stamp)
$runtimeUrlPath = Join-Path $repoRoot "apps\korbit-desktop\src\runtime-url.txt"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Set-Content -Path $runtimeUrlPath -Value $appUrl -Encoding UTF8

Push-Location $repoRoot
try {
  $env:CI = "1"
  $env:KORBIT_APP_URL = $appUrl
  corepack pnpm install --prod=false --no-frozen-lockfile --config.confirmModulesPurge=false
  corepack pnpm --filter ./apps/korbit-desktop run build:win
} finally {
  Pop-Location
}

$distDir = Join-Path $repoRoot "apps\korbit-desktop\dist"
$artifact = Get-ChildItem -Path $distDir -Filter *.exe -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $artifact) {
  throw "Failed to find built EXE artifact in $distDir"
}

Copy-Item -Force $artifact.FullName $targetPath
Write-Output ("ARTIFACT_PATH={0}" -f $targetPath)
