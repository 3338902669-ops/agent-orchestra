<#
  mail-helper.ps1 - thin mailbox helper for seats without native MCP tooling.

  Performs the three core mailbox operations (send / reply / ack) against the
  mailbox server's HTTP JSON-RPC endpoint, one tool call per invocation.
  The bearer token is read from a local token file at runtime; it is never
  printed, never logged, and never committed.

  The transport scheme is a deployment setting ({{MAIL_SCHEME}}). The
  bearer token travels in the Authorization header, so use https
  wherever the server offers it. Plaintext http leaves the token
  unencrypted on the wire and is acceptable only on a trusted network
  (loopback, or a private overlay restricted to the team) -- that
  restriction is a deployment precondition, not a default; see
  references/mail-server-interface.md.

  Instantiate all placeholders before use (see templates/PLACEHOLDERS.md).

  Usage:
    .\mail-helper.ps1 -Action send  -From <identity> -To <identity> -Subject <text> -Body <markdown>
    .\mail-helper.ps1 -Action reply -From <identity> -MessageId <id> -Body <markdown>
    .\mail-helper.ps1 -Action ack   -From <identity> -MessageId <id>

  Failures throw named errors (E_*) and exit non-zero. Check the exit code of
  every call: a failed send is a failed handoff until retried successfully.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('send', 'reply', 'ack')][string]$Action,
  [Parameter(Mandatory = $true)][string]$From,
  [string]$To = '',
  [string]$Subject = '',
  [string]$Body = '',
  [int]$MessageId = 0
)

$MailScheme = '{{MAIL_SCHEME}}'
$MailHost   = '{{MAIL_HOST}}'
$MailPort   = '{{MAIL_PORT}}'
$ProjectKey = '{{PROJECT_KEY}}'
$TokenFile  = '{{TOKEN_FILE}}'

if (-not (Test-Path $TokenFile)) { throw "E_CONFIG_TOKEN_FILE token file not found: $TokenFile" }
$token = (Get-Content $TokenFile -Raw).Trim()
if (-not $token) { throw "E_CONFIG_TOKEN_FILE token file is empty: $TokenFile" }
$headers = @{ Authorization = "Bearer $token" }
$uri = "${MailScheme}://${MailHost}:${MailPort}/mcp/"

function Call-Mail($tool, $argsHash) {
  $payload = @{ jsonrpc = '2.0'; id = 1; method = 'tools/call'; params = @{ name = $tool; arguments = $argsHash } } |
    ConvertTo-Json -Depth 6 -Compress
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 30
  } catch {
    throw "E_TRANSPORT_UNREACHABLE mailbox call $tool failed: $($_.Exception.Message)"
  }
  if ($resp.error) { throw "E_TRANSPORT_RPC mailbox returned an error for ${tool}: $($resp.error.message)" }
  $resp.result.content[0].text
}

switch ($Action) {
  'send' {
    if (-not $To -or -not $Subject) { throw 'E_USAGE send requires -To and -Subject' }
    Call-Mail 'send_message' @{
      project_key = $ProjectKey; sender_name = $From; to = @($To)
      subject = $Subject; body_md = $Body; ack_required = $true
    }
  }
  'reply' {
    if ($MessageId -le 0) { throw 'E_USAGE reply requires -MessageId' }
    Call-Mail 'reply_message' @{
      project_key = $ProjectKey; sender_name = $From; message_id = $MessageId; body_md = $Body
    }
  }
  'ack' {
    if ($MessageId -le 0) { throw 'E_USAGE ack requires -MessageId' }
    Call-Mail 'acknowledge_message' @{
      project_key = $ProjectKey; agent_name = $From; message_id = $MessageId
    }
  }
}
