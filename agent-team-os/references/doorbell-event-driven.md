# Doorbell: Event-Driven Wake

The doorbell wakes a seat when mail arrives for it. Mail itself lives
in the mailbox; see [comms-mail.md](comms-mail.md). The doorbell stores
no messages — it only dispatches wake events.

## Why not polling

Polling was rejected on purpose:

- **Latency vs. waste:** short intervals wake idle seats constantly;
  long intervals delay real work. There is no good interval.
- **Cost:** every poll that starts an agent costs a full context load,
  even when the answer is "nothing new."
- **Noise:** empty polls fill logs and make real failures harder to
  spot.

Instead, the doorbell reacts to a filesystem event: the mailbox storage
directory changes only when a message actually lands. No write, no
wake.

## Components

| Component | Job |
|---|---|
| Watcher | Resident process monitoring the mailbox storage directory with an OS filesystem watcher |
| Cursor state | Per-recipient persistent cursor, stored in a state file |
| Dispatcher | Reads new delivery events per recipient and routes each to the right wake adapter |
| Wake adapters | One per seat type; each invokes that seat's native wake mechanism |

Reference implementation:
[../templates/scripts/doorbell.ps1](../templates/scripts/doorbell.ps1)

Suggested layout (adapt paths to the seat's host):

```text
~/doorbell/
  doorbell.ps1        # watcher + dispatcher
  doorbell-state.json # per-recipient cursors
  doorbell.log        # append-only dispatch log
  out/
    doorbell-<role>-<event-id>.out   # per-event wake output / evidence
    doorbell-coordinator-<event-id>.md  # marker files for the coordinator
```

## Event flow

1. A message lands in the mailbox archive. The storage directory under
   `~/` (or `%USERPROFILE%\` on that style of host) changes on disk.
2. The filesystem watcher fires. Events are debounced (see below), so
   a burst of writes becomes one dispatch pass.
3. For each recipient with mail, the dispatcher reads delivery events
   incrementally:

   ```text
   inbox-events --agent <mail-identity> --after <cursor>
   ```

   It returns new events plus a `next_cursor`. Conceptually: only
   events after the stored cursor, in order.
4. System events are filtered out (see below) and do not advance a
   wake.
5. Each remaining event is dispatched to the recipient's wake adapter.
6. The recipient's cursor advances to `next_cursor` **at dispatch
   time** and the state file is written.
7. The dispatch is logged, and the wake adapter's output is captured
   to a per-event output file.

### Endpoint subtlety

The events reader must be pointed at the address the server actually
binds, with the token supplied to the reader process only:

```text
MAIL_HOST = {{MAIL_HOST}}
MAIL_PORT = {{MAIL_PORT}}
PROJECT   = {{PROJECT_KEY}}
token     = read from the local token file at read time, placed only
            in the events-reader child process's environment; the
            watcher process itself never holds it
```

If the server binds a private-network address, it does not listen on
loopback. Defaulting the reader to loopback in that setup fails with
connection refused, even though the server is healthy. Configure the
reader explicitly; do not rely on its default.

## Wake adapters

One adapter per seat type. The dispatcher selects by recipient.

| Recipient type | Wake mechanism |
|---|---|
| CLI agent | Launch one agent round from the command line, with the new message id in the prompt |
| Sandboxed desktop agent | Write a request file, then run a bridge task that executes inside the agent's interactive session |
| Verifier | Invoke the verifier CLI with a task card: object path + content hash + verbatim requirement + invariants to check |
| GUI agent | Use an interactive-session helper to bring the agent window forward, verify the target window, then paste a wake message |
| Coordinator | Drop a marker file (`doorbell-coordinator-<event-id>.md`) for the coordinator to pick up on its next turn |

Adapter rules:

- **Commands are data, never evaluated.** A wake specification is a
  fixed executable plus an argument array (see
  [../templates/PLACEHOLDERS.md](../templates/PLACEHOLDERS.md)),
  invoked directly — no shell, no `Invoke-Expression`, no
  string-built commands, in the reference implementation or in any
  adapter derived from it. The only values substituted into the
  array are the prompt file's path and the event id, and the event
  id is validated numeric before use (it also appears in file
  names). Event data — sender, subject, body — is written only into
  the prompt file and reaches the seat as file content. This is a
  security invariant, not a style choice: on the mailbox's CLI path
  the sender is self-declared, so anything a sender can control must
  be treated as hostile text, never as command text.
- **Pin the working directory.** Some agent CLIs resolve their data
  directory relative to the current working directory. A launcher
  started from a system directory can fail trying to create that data
  directory where it has no write access. Every adapter sets an
  explicit, writable working directory under the seat's home
  (for example `~/work/` or `%USERPROFILE%\work\`) before invoking
  the agent.
- **Single-line prompts where the bridge requires it.** If a bridge
  only forwards the first line of a request, the adapter must send the
  whole instruction as one line.
- **Capture output.** Stdout/stderr of every wake goes to the per-event
  output file, even on success. No output file means the wake was
  never dispatched.
- **No task logic in the adapter.** The adapter wakes; the seat reads
  its mail and decides what to do.

## Cursor semantics

This is the part to get exactly right.

- **Storage:** cursors persist in `doorbell-state.json`, keyed by
  recipient mail identity.
- **Seeding:** on first run, each cursor seeds at the current tail of
  the event stream. History never fires wakes. Only mail arriving
  after the doorbell starts will wake a seat.
- **Advance at dispatch, not on success:** the cursor moves when an
  event is handed to a wake adapter, before the outcome is known.
- **Failure traces:** if the wake runs and fails, or the seat errors
  after waking, the evidence is the per-event output file plus the
  doorbell log entry. The event is not re-read automatically, because
  the cursor has already moved.
- **No automatic retry:** a failed wake is not retried. The operator
  inspects the output file and log, fixes the cause, and re-dispatches
  manually — for example by re-invoking the adapter for that message
  id, or by sending a fresh message.

Why advance at dispatch: advancing only on success requires defining
"success" for a wake (process started? agent replied? task done?),
and a permanently failing seat would block all later events behind
it. Advance-at-dispatch keeps the stream moving and makes failures
visible instead of silent and repeating.

Trade-off, stated plainly: a wake that fires and fails will not fire
again on its own. Monitoring the log is part of operating this system.

## Filtering system events

Not every delivery event is task mail. Skip, without waking:

- Contact approval notifications
- Contact request notifications
- Other server-generated administrative events with no task body

Skipped events are logged at debug level with their event id, so a
"missing wake" report can be checked against the filter.

## Debounce

Filesystem watchers fire many times for one logical write. The
dispatcher debounces:

- On the first event, start a short quiet window (for example
  1–2 seconds).
- Further events inside the window reset or extend it, but do not
  start a second dispatch pass.
- When the window closes, run one pass: read events for all
  recipients, dispatch each new event once.

Because reads are cursor-based and incremental, a coalesced pass
loses nothing: every event after the cursor is returned.

## Single-instance guard

Only one watcher may run per mailbox storage directory.

- On startup, acquire an exclusive lock (a lock file with the process
  id, or a named OS mutex).
- If the lock is held by a live process, exit immediately and log it.
  Do not dispatch.
- If the lock is stale (owning process is gone), take it over and log
  the takeover.

Two watchers with independent cursors would double-wake every seat
and interleave state-file writes.

## Logging

Append-only log, one line per decision, with timestamps:

```text
2026-01-01T09:00:00Z dispatch role=builder event=123 message=42 adapter=cli
2026-01-01T09:00:01Z cursor   role=builder advanced_to=123
2026-01-01T09:00:01Z skip     event=124 reason=system-contact-event
2026-01-01T09:00:03Z wake-exit role=builder event=123 code=0 out=out/doorbell-builder-123.out
```

Log at minimum: watcher start/stop, lock takeover, each dispatch,
each cursor advance, each skip, each wake exit code, and each read
failure. Never log the bearer token or full message bodies.

## Cost and cascade notes

- **Waking is expensive.** Each wake of a large-context agent costs a
  full context load, even for a one-line message. Do not send trivial
  mail to expensive seats; batch small updates.
- **Replies cascade by design.** If seat A mails seat B, B wakes. If
  B replies, A wakes. A back-and-forth thread wakes both seats on
  every turn. That is intended — it is how seats converse without a
  human relay — but an unbounded ping-pong loop burns budget. Seats
  should end threads explicitly ("no reply needed") when done, and the
  coordinator should break loops it observes.
- **Broadcasts multiply cost.** One message to N recipients is N
  wakes. Address only the seats that must act.

## Failure modes and operator responses

| Failure | Symptom | Operator response |
|---|---|---|
| Watcher down | Mail lands, no wakes, no new log lines | Check the lock and process; restart the watcher. Cursors persist, so on restart only events after the stored cursor dispatch — mail that arrived while down wakes seats then, except events already advanced past. If a manual catch-up is needed, read each inbox directly. |
| Mail server down | Events reader fails with connection errors in the log; sends also fail (see [comms-mail.md](comms-mail.md)) | Restore the server first. The watcher keeps running and retries reads on new filesystem events; if no new writes occur after recovery, restart the watcher or trigger one dispatch pass manually. Senders must retry failed sends — there is no client queue. |
| Wake mechanism broken (one seat) | Dispatch logged, wake exit non-zero, error in the per-event output file; cursor already advanced | Read `out/doorbell-<role>-<event-id>.out`. Fix the adapter cause (working directory, bridge task, window helper). Then re-dispatch that message manually. Do not rewind the cursor for the whole stream to retry one event. |
| State file corrupt or lost | Watcher fails to start, or cursors reset | Stop the watcher. Restore from backup if available. If cursors must be re-seeded, they seed at the current tail: pending mail will not wake seats, so notify affected seats manually for anything already delivered. |
| Wrong events endpoint | Repeated connection-refused read errors while the server is up | Point the reader at the bound address (`{{MAIL_HOST}}:{{MAIL_PORT}}`), with the token supplied to the reader child process only. Do not assume loopback. |
| Duplicate watcher | Double wakes for the same event | Kill the extra instance; confirm the single-instance lock is held by the survivor. Check the state file for interleaved advances before trusting cursors. |

## Related

- Mailbox concepts and limits: [comms-mail.md](comms-mail.md)
- Delivery-event stream contract: [mail-server-interface.md](mail-server-interface.md)
- Doorbell script: [../templates/scripts/doorbell.ps1](../templates/scripts/doorbell.ps1)
- Error handling: [error-handling.md](error-handling.md)
- Round-trip testing: [verification.md](verification.md)
