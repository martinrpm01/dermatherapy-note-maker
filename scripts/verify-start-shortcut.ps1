param(
  [string]$ShortcutPath = "$env:USERPROFILE\Desktop\Dermatherapy Note Maker.lnk",
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"

$launchStatusPaths = @(
  (Join-Path $env:APPDATA "Dermatherapy Note Maker\launch-status.json"),
  (Join-Path $env:APPDATA "dermatherapy-note-maker\launch-status.json"),
  (Join-Path $env:USERPROFILE "Desktop\PT notes\launch-status.json")
)
$acceptableScreens = @("dashboard", "unlock", "pin_setup")
$startedAt = Get-Date

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
  throw "Start shortcut not found at '$ShortcutPath'."
}

Start-Process -FilePath $ShortcutPath

$deadline = $startedAt.AddSeconds($TimeoutSeconds)

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500

  foreach ($launchStatusPath in $launchStatusPaths) {
    if (-not (Test-Path -LiteralPath $launchStatusPath)) {
      continue
    }

    try {
      $status = Get-Content -LiteralPath $launchStatusPath -Raw | ConvertFrom-Json
    } catch {
      continue
    }

    if (-not $status.updatedAt -or -not $status.screen) {
      continue
    }

    $updatedAt = Get-Date $status.updatedAt
    if ($updatedAt -lt $startedAt.AddSeconds(-1)) {
      continue
    }

    if ($acceptableScreens -contains $status.screen) {
      [pscustomobject]@{
        ShortcutPath = $ShortcutPath
        StatusPath = $launchStatusPath
        Screen = $status.screen
        UpdatedAt = $status.updatedAt
      } | ConvertTo-Json -Depth 3
      exit 0
    }
  }
}

throw "The start shortcut launched, but the app did not report a startup screen within $TimeoutSeconds seconds."
