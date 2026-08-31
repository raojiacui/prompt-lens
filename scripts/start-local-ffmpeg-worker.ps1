param(
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env.local"

function Test-Command($Name) {
  if (-not $Name) { return $false }
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-FirstExistingPath([string[]]$Paths) {
  foreach ($candidate in $Paths) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

function Get-LocalBinary($FileName, $PackageGlob) {
  $binPath = Join-Path $root "node_modules\.bin\$FileName"
  if (Test-Path -LiteralPath $binPath) {
    return (Resolve-Path -LiteralPath $binPath).Path
  }

  $pnpmRoot = Join-Path $root "node_modules\.pnpm"
  if (Test-Path -LiteralPath $pnpmRoot) {
    $match = Get-ChildItem -LiteralPath $pnpmRoot -Directory -Filter $PackageGlob -ErrorAction SilentlyContinue |
      ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter $FileName -ErrorAction SilentlyContinue |
          Select-Object -First 1
      } |
      Select-Object -First 1
    if ($match) {
      return $match.FullName
    }
  }
  return $null
}

try {
  Set-Location -LiteralPath $root

  if (-not (Test-Command "node")) {
    throw "Node.js was not found on PATH. Install Node.js 20+ and reopen PowerShell."
  }

  $nodeVersionText = (& node -p "process.versions.node").Trim()
  $nodeMajor = [int]($nodeVersionText.Split(".")[0])
  if ($nodeMajor -lt 20) {
    throw "Node.js $nodeVersionText is too old. This project expects Node.js 20+."
  }

  if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
    throw "node_modules was not found. Run 'pnpm install' in $root first."
  }

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
  } else {
    Write-Warning ".env.local was not found. The worker can start, but protected endpoints will fail until env vars are configured."
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
  if (-not $env:PYTHON_PATH) {
    $python310 = $null
    if (Test-Command "py") {
      $python310 = (& py -3.10 -c "import sys; print(sys.executable)" 2>$null).Trim()
    }
    if ($python310 -and (Test-Path -LiteralPath $python310)) {
      $env:PYTHON_PATH = $python310
    } elseif (Test-Command "python3") {
      $env:PYTHON_PATH = "python3"
    } elseif (Test-Command "python") {
      $env:PYTHON_PATH = "python"
    }
  }
  if (-not $env:PYSCENEDETECT_SCRIPT_PATH) {
    $env:PYSCENEDETECT_SCRIPT_PATH = Join-Path $root "workers\ffmpeg-worker\scene-detect.py"
  }

  if (-not $env:FFMPEG_PATH) {
    $localFfmpeg = Get-FirstExistingPath @(
      (Get-LocalBinary "ffmpeg.exe" "@ffmpeg-installer+win32-x64*"),
      (Get-LocalBinary "ffmpeg" "@ffmpeg-installer+linux-x64*"),
      (Get-LocalBinary "ffmpeg" "@ffmpeg-installer+darwin-x64*"),
      (Get-LocalBinary "ffmpeg" "@ffmpeg-installer+darwin-arm64*")
    )
    if ($localFfmpeg) {
      $env:FFMPEG_PATH = $localFfmpeg
    }
  }

  $ffmpegCommand = if ($env:FFMPEG_PATH) { $env:FFMPEG_PATH } else { "ffmpeg" }
  $ffprobeCommand = if ($env:FFPROBE_PATH) { $env:FFPROBE_PATH } else { "ffprobe" }

  if (-not (Test-Command $ffmpegCommand)) {
    Write-Warning "ffmpeg was not found. Install ffmpeg globally or set FFMPEG_PATH. Video processing requests will fail until this is fixed."
  }
  if (-not (Test-Command $ffprobeCommand)) {
    Write-Warning "ffprobe was not found. Install ffmpeg/ffprobe globally or set FFPROBE_PATH. Video processing requests will fail until this is fixed."
  }

  if (Test-Command "Get-NetTCPConnection") {
    $portInUse = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portInUse) {
      throw "Port $env:PORT is already in use by process $($portInUse.OwningProcess). Start with -Port 8081 or stop that process."
    }
  }

  Write-Host "Starting Prompt Lens FFmpeg worker on port $env:PORT"
  node (Join-Path $root "workers\ffmpeg-worker\server.mjs")
} catch {
  Write-Error $_
  exit 1
}
