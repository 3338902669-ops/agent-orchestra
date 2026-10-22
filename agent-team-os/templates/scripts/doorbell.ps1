<#
  doorbell.ps1 - event-driven wake dispatcher for the team mailbox.

  Watches the mailbox storage directory with an OS filesystem watcher.
  When a write lands, it reads new delivery events per recipient
  (incrementally, from a durable per-recipient cursor), filters out
  system events, and dispatches each remaining event to that seat's
  native wake mechanism. It never polls: no filesystem write, no pass.

  Cursor semantics (see references/doorbell-event-driven.md):
    - Cursors persist in a state file under the bridge directory.
    - On first run each cursor seeds at the current tail of the event
      stream; history never fires wakes.
    - A cursor advances at dispatch time, not on wake success. A failed
      wake is NOT retried automatically; its evidence is the per-event
      output file plus the dispatch log entry. Re-dispatch manually.

  The bearer token is never held by the watcher process. For each
  events read, the mailbox CLI is started as a child process, the
  token file is read fresh, and the token is placed only in that
  child's environment. It is never printed, never logged, and never
  passed as a command-line argument.

  Wake commands are configuration data with a strict shape (see the
  $Seats comment below): a JSON array of arguments, executed directly
  -- never through a shell and never via Invoke-Expression. Event
  data (sender, subject) is written only into the per-event prompt
  file and reaches the woken seat as file content, never as command
  text: a sender or subject that looks like a command is inert.

  Instantiate all placeholders before use (see templates/PLACEHOLDERS.md).

  Usage:
    .\doorbell.ps1          # resident watcher (single instance)
    .\doorbell.ps1 -Once    # run one dispatch pass and exit

  Requires: the mailbox CLI named by the mail-bin setting below, able to
  run
      inbox-events --agent <identity> --after <cursor>
  against the mailbox endpoint the server actually binds, returning JSON
  of the shape:
      { "events": [ { "id": 1, "message_id": 1, "sender": "...",
                      "subject": "...", "kind": "message" } ],
        "next_cursor": 1 }
  Events whose kind marks them as server-generated administrative
  notifications (contact approvals / requests) are skipped, never woken.
#>
param(
  [switch]$Once
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuration (instantiate the placeholders for your deployment)
# ---------------------------------------------------------------------------
$StorageDir = '{{STORAGE_DIR}}'
$BridgeDir  = '{{BRIDGE_DIR}}'
$WorkDir    = '{{WORK_DIR}}'
$MailBin    = '{{MAIL_BIN}}'
$MailHost   = '{{MAIL_HOST}}'
$MailPort   = '{{MAIL_PORT}}'
$ProjectKey = '{{PROJECT_KEY}}'
$TokenFile  = '{{TOKEN_FILE}}'

$StateFile  = Join-Path $BridgeDir 'doorbell-state.json'
$LogFile    = Join-Path $BridgeDir 'doorbell.log'
$OutDir     = Join-Path $BridgeDir 'out'
$LockFile   = Join-Path $BridgeDir 'doorbell.lock'
$DebounceMs = 1500

# Recipients: mail identity -> role -> wake specification.
# A wake specification is a JSON array of command arguments, e.g.
#   ["agent-cli", "run", "--prompt-file", "{prompt_file}"]
# The first element is the executable; the array is invoked directly
# (no shell, no Invoke-Expression). Only two runtime tokens may
# appear in the array: {prompt_file} (path of the prompt file the
# doorbell writes for this event) and {id} (the event id, validated
# numeric before use). Event data such as sender and subject is
# NEVER substituted into a command: it is written only into the
# prompt file's text. Keep the identity <-> role mapping in the
# roster.
$Seats = @(
  @{ Identity = '{{COORDINATOR_NAME}}'; Role = 'coordinator'; Wake = '{{WAKE_COORDINATOR_CMD}}' }
  @{ Identity = '{{BUILDER_NAME}}';     Role = 'builder';     Wake = '{{WAKE_BUILDER_CMD}}' }
  @{ Identity = '{{VERIFIER_NAME}}';    Role = 'verifier';    Wake = '{{WAKE_VERIFIER_CMD}}' }
  @{ Identity = '{{OPERATOR_NAME}}';    Role = 'operator';    Wake = '{{WAKE_OPERATOR_CMD}}' }
  @{ Identity = '{{DISPATCHER_NAME}}';  Role = 'dispatcher';  Wake = '{{WAKE_DISPATCHER_CMD}}' }
)

# Short instruction written to the prompt file for seats woken with one.
# Keep it free of task logic: the seat reads its own mail and decides.
$PromptTemplate = 'New mail in your team mailbox: message {id} from {from}, subject "{subject}". Read it with your mail tools, act per your standing instructions, and acknowledge it when done.'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Log($message) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  Add-Content -Path $LogFile -Value "$stamp $message" -Encoding UTF8
}

function Fill-Prompt($template, $evt) {
  # Prompt TEXT only. The result is written to the prompt file and
  # handed to the woken seat by path; it is never part of a command
  # line, so event data substituted here stays inert text.
  $template.Replace('{id}', [string]$evt.message_id).
            Replace('{from}', [string]$evt.sender).
            Replace('{subject}', [string]$evt.subject)
}

function ConvertTo-WakeArgv($seat) {
  # Parse and validate one seat's wake specification at startup, so
  # a malformed or unsafe spec fails fast instead of at dispatch.
  if (-not $seat.Wake) { return $null }
  try {
    $argv = @($seat.Wake | ConvertFrom-Json)
  } catch {
    throw "E_WAKE_CONFIG seat $($seat.Role): wake spec is not a JSON array of arguments"
  }
  if ($argv.Count -eq 0 -or -not $argv[0]) {
    throw "E_WAKE_CONFIG seat $($seat.Role): wake spec has no executable"
  }
  foreach ($el in $argv) {
    foreach ($m in [regex]::Matches([string]$el, '\{[a-z_]+\}')) {
      if ($m.Value -notin @('{id}', '{prompt_file}')) {
        throw "E_WAKE_CONFIG seat $($seat.Role): runtime token $($m.Value) is not allowed in a wake command (only {id} and {prompt_file}); event data never enters a command line"
      }
    }
  }
  return $argv
}

function Read-Events($identity, $after) {
  # Token hygiene: the token is read fresh from its file for this
  # one call and placed ONLY in the child process's environment
  # block. The watcher's own environment never holds it, wake
  # adapters never inherit it, and it is never logged. The mail
  # binary must be a real executable: it is started directly,
  # without a shell. Arguments are built from configuration values
  # (seat identity, cursor, endpoint) -- never from event data.
  $token = (Get-Content $TokenFile -Raw).Trim()
  if (-not $token) { throw "E_CONFIG_TOKEN_FILE token file is empty: $TokenFile" }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $MailBin
  $psi.Arguments = 'inbox-events --agent "{0}" --after {1} --host "{2}" --port {3} --project "{4}"' -f `
    $identity, $after, $MailHost, $MailPort, $ProjectKey
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.EnvironmentVariables['HTTP_BEARER_TOKEN'] = $token
  $proc = [System.Diagnostics.Process]::Start($psi)
  $errTask = $proc.StandardError.ReadToEndAsync()
  $json = $proc.StandardOutput.ReadToEnd()
  $proc.WaitForExit()
  $null = $errTask.Result
  if ($proc.ExitCode -ne 0) {
    throw "E_READ_FAILED inbox-events failed for $identity (exit $($proc.ExitCode))"
  }
  return ($json | ConvertFrom-Json)
}

function Get-Cursors {
  $cursors = @{}
  if (Test-Path $StateFile) {
    try {
      $raw = Get-Content $StateFile -Raw | ConvertFrom-Json
      foreach ($prop in $raw.PSObject.Properties) {
        $cursors[$prop.Name] = [long]$prop.Value
      }
    } catch {
      throw "E_STATE_CORRUPT state file unreadable: $StateFile ($($_.Exception.Message))"
    }
  }
  return $cursors
}

function Save-State($cursors) {
  $tmp = "$StateFile.tmp"
  $cursors | ConvertTo-Json | Set-Content -Path $tmp -Encoding UTF8
  Move-Item -Force $tmp $StateFile
}

function Test-SystemEvent($evt) {
  # Server-generated administrative events (contact approvals and
  # requests) carry no task body: skip them without waking anyone.
  if ($evt.kind -and $evt.kind -match 'contact') { return $true }
  if ($evt.subject -and $evt.subject -match '^Contact (approved|request)') { return $true }
  return $false
}

# ---------------------------------------------------------------------------
# Wake dispatch
# ---------------------------------------------------------------------------
function Invoke-Wake($seat, $evt) {
  $eventId    = [string]$evt.id
  $promptFile = Join-Path $OutDir ("doorbell-{0}-{1}.prompt.txt" -f $seat.Role, $eventId)
  $outFile    = Join-Path $OutDir ("doorbell-{0}-{1}.out" -f $seat.Role, $eventId)
  $prompt     = Fill-Prompt $PromptTemplate $evt
  Set-Content -Path $promptFile -Value $prompt -Encoding UTF8

  if ($seat.Role -eq 'coordinator') {
    # Coordinator adapter: drop a marker file for its next turn.
    $marker = Join-Path $OutDir ("doorbell-coordinator-{0}.md" -f $eventId)
    Set-Content -Path $marker -Value $prompt -Encoding UTF8
  }
  if (-not $seat.WakeArgv) {
    Set-Content -Path $outFile -Value 'no wake command configured for this seat' -Encoding UTF8
    return 0
  }

  # Fixed command + argument array, invoked directly: no shell, no
  # Invoke-Expression, no string-built command anywhere. The only
  # substitutions are the prompt file's path and the event id (the
  # dispatcher validated it numeric before dispatch). Event data
  # (sender, subject) never reaches this command line; it exists
  # only inside the prompt file's text.
  $wakeArgv = @($seat.WakeArgv | ForEach-Object {
    ([string]$_).Replace('{prompt_file}', $promptFile).Replace('{id}', $eventId)
  })
  $wakeExe  = $wakeArgv[0]
  $wakeArgs = @()
  if ($wakeArgv.Count -gt 1) { $wakeArgs = $wakeArgv[1..($wakeArgv.Count - 1)] }
  # Adapter rule: pin a writable working directory before launching.
  Push-Location $WorkDir
  try {
    $output = & $wakeExe @wakeArgs 2>&1
    $code = $LASTEXITCODE
  } catch {
    $output = $_.Exception.Message
    $code = 1
  } finally {
    Pop-Location
  }
  if ($null -eq $code) { $code = 0 }
  $output | Out-File -FilePath $outFile -Encoding UTF8
  return $code
}

function Initialize-StateIfNeeded {
  if (Test-Path $StateFile) { return }
  # First run: seed every cursor at the current tail. History never
  # fires wakes; only mail arriving after this point dispatches.
  $cursors = @{}
  foreach ($seat in $Seats) {
    try {
      $result = Read-Events $seat.Identity 0
      $cursors[$seat.Identity] = [long]$result.next_cursor
      Write-Log "seed      role=$($seat.Role) cursor=$($result.next_cursor)"
    } catch {
      Write-Log "seed-fail role=$($seat.Role) error=$($_.Exception.Message)"
      $cursors[$seat.Identity] = 0
    }
  }
  Save-State $cursors
}

function Invoke-DispatchPass {
  $cursors = Get-Cursors
  foreach ($seat in $Seats) {
    $after = 0
    if ($cursors.ContainsKey($seat.Identity)) { $after = $cursors[$seat.Identity] }
    try {
      $result = Read-Events $seat.Identity $after
    } catch {
      # The watcher keeps running; reads retry on the next write event.
      Write-Log "read-fail role=$($seat.Role) error=$($_.Exception.Message)"
      continue
    }
    foreach ($evt in $result.events) {
      if (Test-SystemEvent $evt) {
        Write-Log "skip      event=$($evt.id) reason=system-contact-event"
        continue
      }
      # The event id is used in file names and as a wake argument:
      # it must be a plain number. Anything else is treated as a
      # malformed (or hostile) event and skipped, never dispatched.
      if ([string]$evt.id -notmatch '^[0-9]+$') {
        Write-Log "skip      role=$($seat.Role) reason=invalid-event-id"
        continue
      }
      Write-Log "dispatch  role=$($seat.Role) event=$($evt.id) message=$($evt.message_id) adapter=wake-cmd"
      try {
        $code = Invoke-Wake $seat $evt
      } catch {
        $code = 1
        Write-Log "wake-fail role=$($seat.Role) event=$($evt.id) error=$($_.Exception.Message)"
      }
      Write-Log "wake-exit role=$($seat.Role) event=$($evt.id) code=$code out=out/doorbell-$($seat.Role)-$($evt.id).out"
    }
    # Advance at dispatch, not on success (see header). Skipped system
    # events still advance the cursor: they were read and decided on.
    if ($null -ne $result.next_cursor -and $result.next_cursor -ne $after) {
      $cursors[$seat.Identity] = [long]$result.next_cursor
      Write-Log "cursor    role=$($seat.Role) advanced_to=$($result.next_cursor)"
    }
  }
  Save-State $cursors
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
foreach ($dir in @($BridgeDir, $OutDir)) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}
if (-not (Test-Path $StorageDir)) { throw "E_CONFIG_STORAGE_DIR mailbox storage directory not found: $StorageDir" }
if (-not (Test-Path $TokenFile)) { throw "E_CONFIG_TOKEN_FILE token file not found: $TokenFile" }
# The token itself is deliberately NOT loaded here: the watcher
# process never holds it. Read-Events reads the file fresh for each
# child process it spawns.

# Validate every wake specification before watching starts.
foreach ($seat in $Seats) {
  $seat.WakeArgv = ConvertTo-WakeArgv $seat
}

# Single-instance guard: one watcher per mailbox storage directory.
if (Test-Path $LockFile) {
  $owner = (Get-Content $LockFile -Raw).Trim()
  if ($owner -match '^\d+$' -and (Get-Process -Id ([int]$owner) -ErrorAction SilentlyContinue)) {
    Write-Log "lock      held by live pid=$owner; exiting without dispatching"
    exit 0
  }
  Write-Log "lock      stale lock from pid=$owner; taking over"
}
Set-Content -Path $LockFile -Value $PID -Encoding ASCII

Write-Log "start     watching=$StorageDir seats=$($Seats.Count)"
Initialize-StateIfNeeded

if ($Once) {
  Invoke-DispatchPass
  Write-Log 'stop      single pass complete'
  Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
  exit 0
}

# ---------------------------------------------------------------------------
# Resident watch loop: filesystem events only, no polling.
# ---------------------------------------------------------------------------
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $StorageDir
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor `
  [System.IO.NotifyFilters]::FileName -bor `
  [System.IO.NotifyFilters]::DirectoryName
$watcher.EnableRaisingEvents = $true
try {
  while ($true) {
    $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 60000)
    if ($change.TimedOut) { continue }
    # Debounce: let the write burst settle into one quiet window, then
    # drain notifications already queued. Reads are cursor-based and
    # incremental, so a coalesced pass loses nothing.
    Start-Sleep -Milliseconds $DebounceMs
    while (-not $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 1).TimedOut) { }
    try {
      Invoke-DispatchPass
    } catch {
      Write-Log "pass-fail error=$($_.Exception.Message)"
    }
  }
} finally {
  $watcher.EnableRaisingEvents = $false
  $watcher.Dispose()
  Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
  Write-Log 'stop      watcher stopped'
}
