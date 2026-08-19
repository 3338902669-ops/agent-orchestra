# One-click installer for the multi-agent-orchestration skill.
# Usage:  .\scripts\install.ps1 [-Target <skill-dir>] [-Force]
param(
  [string]$Target = "",
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$repo = Split-Path -Parent $here
if (-not $Target) {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".claude\skills"),
    (Join-Path $env:USERPROFILE ".agents\skills"),
    (Join-Path $env:USERPROFILE ".dsh\skills")
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $Target = Join-Path $c "multi-agent-orchestration"; break }
  }
}
if (-not $Target) {
  Write-Host "No skill directory detected. Pass -Target <path> explicitly." -ForegroundColor Yellow
  exit 1
}
$items = @("SKILL.md","references","config")
foreach ($item in $items) {
  $src = Join-Path $repo $item
  $dst = Join-Path $Target $item
  if (-not (Test-Path $src)) { Write-Host "Missing: $src" -ForegroundColor Red; exit 1 }
  if ((Test-Path $dst) -and -not $Force) { Write-Host "Exists (use -Force): $dst" -ForegroundColor Yellow; continue }
  Copy-Item $src $dst -Recurse -Force
}
Write-Host "Installed to $Target" -ForegroundColor Green
