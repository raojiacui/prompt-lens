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
if (-not $env:R2_ENDPOINT -and -not $env:B2_ENDPOINT -and $env:B2_REGION) {
  $env:R2_ENDPOINT = "https://s3.$($env:B2_REGION).backblazeb2.com"
}
if (-not $env:R2_ACCESS_KEY_ID -and $env:B2_ACCESS_KEY_ID) {
  $env:R2_ACCESS_KEY_ID = $env:B2_ACCESS_KEY_ID
}
if (-not $env:R2_SECRET_ACCESS_KEY -and $env:B2_SECRET_ACCESS_KEY) {
  $env:R2_SECRET_ACCESS_KEY = $env:B2_SECRET_ACCESS_KEY
}
if (-not $env:R2_BUCKET -and -not $env:R2_BUCKET_NAME -and $env:B2_BUCKET_NAME) {
  $env:R2_BUCKET = $env:B2_BUCKET_NAME
}
if (-not $env:R2_PUBLIC_URL -and $env:B2_PUBLIC_URL) {
  $env:R2_PUBLIC_URL = $env:B2_PUBLIC_URL
}

node (Join-Path $root "workers\ffmpeg-worker\server.mjs")