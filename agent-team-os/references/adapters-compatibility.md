# Adapters and Compatibility

Each seat connects to the team in two independent ways:

- **Mail access** — how it sends, replies, acks, and searches. See
  [comms-mail.md](comms-mail.md).
- **Wake mechanism** — how the doorbell starts it when mail arrives.
  See [doorbell-event-driven.md](doorbell-event-driven.md).

An agent type is only usable when both halves are wired. Wire mail
first, then the wake path, then test the pair together.

## Compatibility matrix

| Agent type | Mail access | Wake mechanism | Required templates | Wiring notes |
|---|---|---|---|---|
| MCP-native | Native mailbox tools in-session; concepts in `references/comms-mail.md` | Doorbell launches a session round via `templates/scripts/doorbell.ps1` | `templates/roster.md`, `references/doorbell-event-driven.md` | No helper script needed. Identity is the tool-configured identity; keep it matching the roster mapping. |
| CLI | Helper script `templates/scripts/mail-helper.ps1` over HTTP JSON-RPC, per `references/comms-mail.md` | Doorbell launches one CLI round via `templates/scripts/doorbell.ps1` | `templates/roster.md`, `references/doorbell-event-driven.md` | Pin a writable working directory for the launch. Sender field on this path is self-declared; token possession is the trust boundary. |
| GUI desktop | Helper script `templates/scripts/mail-helper.ps1`, usually run by a bridge inside the desktop session, per `references/comms-mail.md` | Interactive-session helper pastes a wake message; dispatched by `templates/scripts/doorbell.ps1` | `templates/roster.md`, `references/doorbell-event-driven.md` | Sandboxed seats may need a request-file plus bridge task instead of a direct launch. Verify the foreground window title before pasting. |
| API | Direct HTTP JSON-RPC calls to the mailbox endpoint, shaped as in `references/comms-mail.md`; `templates/scripts/mail-helper.ps1` as reference implementation | External caller or doorbell webhook-style dispatch via `templates/scripts/doorbell.ps1` | `templates/roster.md`, `references/doorbell-event-driven.md` | No local agent process is assumed. The integrating system owns retries for sends attempted during an outage. |
| File-only | No live mail access; exchanges files in a shared inbox/outbox folder; addressing conventions in `references/comms-mail.md` | Marker file dropped by `templates/scripts/doorbell.ps1`; seat acts on its next manual or scheduled run | `templates/roster.md`, `templates/task-registry.md` | Slowest type. No delivery receipt or ack until the seat next runs and writes a reply file. Do not assign time-critical work. |

Seat roles used with these adapters: coordinator, builder, verifier, operator, dispatcher.

Paths above are repo-relative. Template files referenced from this
document live at `../templates/roster.md` and
`../templates/task-registry.md` relative to this file.

## MCP-native

**Capabilities needed**

- A tool integration that exposes send / reply / ack, search, and
  file reservations in the seat's session.
- A launch command the doorbell can invoke for one round, with a
  pinned writable working directory under `~/`.

**Degradation when a capability is missing**

- Without reservations, the seat can still mail but must coordinate
  file edits manually through the coordinator.
- Without a launchable round, mail access works but wakes do not:
  the seat behaves like a File-only seat and only reads on its next
  manually started session.

**How errors surface**

- Tool errors return in-session, where the seat can report them in a
  reply.
- Wake failures appear only in the doorbell log and the per-event
  output file; the seat itself never started, so it cannot report
  them. The operator checks those.

## CLI

**Capabilities needed**

- A command-line entry point that runs one round and exits.
- Ability to run the helper script in
  `templates/scripts/mail-helper.ps1` (or an equivalent CLI surface)
  with the bearer token read from a local token file.
- A writable working directory the CLI resolves its data directory
  against, pinned by the wake launcher.

**Degradation when a capability is missing**

- Without a one-round entry point (interactive-only CLI), the doorbell
  cannot wake it unattended; start rounds manually.
- Without script execution, the seat cannot send or ack on its own;
  the coordinator must relay its mail, and acks lose their meaning.

**How errors surface**

- Helper failures are non-zero exits with the error on stderr; the
  seat must check the exit code of every send.
- Wake failures are captured in the per-event output file from
  `templates/scripts/doorbell.ps1`. A hang in the CLI looks like a
  wake that never exits; the operator kills it and re-dispatches
  manually — there is no automatic retry.

## GUI desktop

**Capabilities needed**

- A desktop session the wake helper can interact with: bring the
  agent window forward, confirm it is the foreground window, then
  paste.
- A bridge that runs inside that session for sandboxed seats: it reads
  a request file written by the doorbell and executes it where the
  agent can act.
- Access to the helper script, directly or through the bridge, to
  read mail and send replies and acks.

**Degradation when a capability is missing**

- Without an interactive-session helper, wakes cannot be delivered
  while the session is locked or unattended; the seat degrades to
  File-only behaviour.
- Without the bridge, a sandboxed seat can be woken by paste but may
  be unable to run the helper; replies then require a human or the
  coordinator to relay them.

**How errors surface**

- A failed paste (wrong window, session locked) is only visible in
  the wake helper's log and the per-event output file. Always verify
  the foreground window title before pasting, and log the result.
- Bridge failures leave the request file unconsumed. An unconsumed
  request file older than one wake cycle is the operator's signal
  that this seat is stuck.

## API

**Capabilities needed**

- Outbound access to `{{MAIL_SCHEME}}://{{MAIL_HOST}}:{{MAIL_PORT}}/` for
  project `{{PROJECT_KEY}}` (`https` preferred; `http` only on a
  trusted network), with the bearer token supplied by the
  integrating system — never embedded in code or committed.
- An endpoint, callback, or scheduled job on the integrating side that
  the doorbell dispatch can trigger as the wake.

**Degradation when a capability is missing**

- Without a wake trigger, the integration is poll-or-manual: it can
  send and read mail when it runs, but nothing starts it on arrival.
  Name that limitation in the roster notes rather than pretending it
  is event-driven.
- Without search access, the seat can still send / reply / ack but
  cannot audit threads; the coordinator performs searches for it.

**How errors surface**

- HTTP and JSON-RPC errors return to the caller synchronously;
  surface them to the operator of the integrating system, not into a
  mail thread that may itself be failing.
- Sends attempted during a server outage fail and are not queued on
  the client. The integrating system owns logging and retry.

## File-only

**Capabilities needed**

- Read and write access to a shared folder (for example `~/inbox/`
  and `~/outbox/`, or `C:\Users\<you>\inbox\` and
  `C:\Users\<you>\outbox\`).
- A convention the seat follows on each run: read new inbox files,
  act, write a reply file to the outbox, and record processed file
  names so nothing is handled twice.

**Degradation when a capability is missing**

- Without write access to the outbox, the seat is read-only: it can
  receive tasks but can never report back through the team. Do not
  assign it accountable work.
- Without a processed-file record, restarts re-handle old tasks.
  Expect duplicates and guard task designs accordingly.

**How errors surface**

- There is no receipt, no ack, and no error channel in real time.
  Errors surface only as absence: no reply file appears. The
  coordinator sets an expected reply window per task in
  `templates/task-registry.md` and escalates to the operator when it
  lapses.
- Malformed task files surface on the seat's next run, in whatever
  local log it keeps. Keep task files to a strict template so a human
  can spot the problem directly in the folder.

## Support rule

An agent type is **supported** only when every file referenced in its
row of the matrix exists in this package **and** its wake path has
passed one live round-trip test — mail sent, wake fired, seat replied
and acked — as described in [verification.md](verification.md). A type
that is wired but untested is "experimental," and the roster must say
so next to any seat using it.
