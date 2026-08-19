param(
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env.local"

if (Test-Path -LiteralPath $envPath) {
  Get-Content -LiteralPath $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -le 0) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    if ($name -match '^[A-Za-z_][A-Za-z0-9_]*$') {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

if (-not $env:WORKER_SECRET -and $env:FFMPEG_WORKER_SECRET) {
  $env:WORKER_SECRET = $env:FFMPEG_WORKER_SECRET
}
if (-not $env:PORT) {
  $env:PORT = [string]$Port
}
if (-not $env:R2_ENDPOINT -and $env:R2_ACCOUNT_ID) {
  $env:R2_ENDPOINT = "https://$($env:R2_ACCOUNT_ID).r2.cloudflarestorage.com"
}

node (Join-Path $root "workers\ffmpeg-worker\server.mjs")