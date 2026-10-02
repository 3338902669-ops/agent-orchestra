# One-click installer for the agent-orchestra skill.
#
# Usage:  .\scripts\install.ps1 [-Target <skill-dir>] [-Mode full|light] [-Force]
#
#   full  (default) SKILL.md, references, config, scripts, bench, examples - the checks the skill
#                    refers to actually work, so the gate can run where it was installed.
#   light           SKILL.md, references, config only: the prompt-level skill, with no runnable checks.
#
# A review found this failing on a target that did not exist yet (it copied into a missing directory)
# and installing only three items, so every documented command that calls a script was broken after a
# successful install.
param(
  [string]$Target = "",
  [ValidateSet("full", "light")]
  [string]$Mode = "full",
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$repo = Split-Path -Parent $here
if (-not $Target) {
  # Set AGENT_SKILLS_DIR for your host, or pass -Target explicitly.
  $candidates = @(
    $env:AGENT_SKILLS_DIR,
    (Join-Path $env:USERPROFILE ".claude\skills"),
    (Join-Path $env:USERPROFILE ".agents\skills")
  ) | Where-Object { $_ }
  foreach ($c in $candidates) {
    if (Test-Path $c) { $Target = Join-Path $c "agent-orchestra"; break }
  }
}
if (-not $Target) {
  Write-Host "No skill directory detected. Pass -Target <path> explicitly." -ForegroundColor Yellow
  exit 1
}
# The target usually does not exist on a first install, and copying into a missing directory fails.
if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }
$items = if ($Mode -eq "full") {
  @("SKILL.md", "references", "config", "scripts", "bench", "examples")
} else {
  @("SKILL.md", "references", "config")
}
$copied = @()
foreach ($item in $items) {
  $src = Join-Path $repo $item
  $dst = Join-Path $Target $item
  if (-not (Test-Path $src)) {
    if ($Mode -eq "light" -and $item -notin @("SKILL.md", "references", "config")) { continue }
    Write-Host "Missing: $src" -ForegroundColor Red
    exit 1
  }
  if ((Test-Path $dst) -and -not $Force) { Write-Host "Exists (use -Force): $dst" -ForegroundColor Yellow; continue }
  Copy-Item $src $dst -Recurse -Force
  $copied += $item
}
Write-Host "Installed $($copied -join ', ') to $Target [$Mode]" -ForegroundColor Green
# Smoke check: an install that cannot run the checks it documents is not an install.
$smoke = Join-Path $Target "scripts\check-handoff.mjs"
if ($Mode -eq "full") {
  if (-not (Test-Path $smoke)) { Write-Host "Smoke check FAILED: scripts/check-handoff.mjs is not present" -ForegroundColor Red; exit 1 }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    & node $smoke --dir (Join-Path $Target "examples\handoff") | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Smoke check FAILED: check-handoff.mjs exited $LASTEXITCODE" -ForegroundColor Red; exit 1 }
    Write-Host "Smoke check passed: the installed checks run" -ForegroundColor Green
  } else {
    Write-Host "node not found: skipped the smoke check (install is still complete)" -ForegroundColor Yellow
  }
} else {
  Write-Host "Light mode: no runnable checks installed (use -Mode full)" -ForegroundColor Yellow
}
