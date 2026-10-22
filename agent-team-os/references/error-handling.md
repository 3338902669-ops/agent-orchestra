# Error Handling

Error taxonomy and reporting discipline for the whole system: memory, governance, mailbox comms, and the event-driven doorbell.

Core rule: every failure surfaces as a **named error**, with evidence, at the step where it occurred. Checkers and gates must fail with a named error and a non-zero exit code, and must list **all** findings rather than stopping at the first.

## Error classes

### 1. Transport / link down

- **Surfaces as:** mailbox server unreachable, send/read timeout, connection refused, or a wake target that cannot be reached at the network level.
- **Evidence to capture:** target host/port as configured (for example `{{MAIL_HOST}}:{{MAIL_PORT}}`), timestamp, exact client error text, and whether a local health check succeeded.
- **Operator response:** confirm the mailbox host is running, confirm `{{TOKEN_FILE}}` exists on both ends, and re-test with a coordinator self-message. Do not reassign work to another seat to work around a down link.
- **Retry policy:** automatic retry is allowed with backoff for reads and health checks only. Sends may be retried once the link is confirmed up; the retried send must reference the original message ID to avoid duplicate threads. Never retry in a tight loop.

### 2. Sandbox / execution refusal

- **Surfaces as:** a seat reports it cannot execute a command, write a path, or spawn a subprocess that the task requires — often a deterministic platform error, not a transient failure.
- **Evidence to capture:** exact error string from the seat, the command or operation attempted, the working directory, and the seat identity.
- **Operator response:** do not re-dispatch the same task to the same seat in the same configuration. Reassign to a seat whose execution environment permits the operation, or change the task design. Record the limitation against that seat in the roster notes.
- **Retry policy:** never auto-retry. A sandbox refusal is deterministic until the configuration changes. Retry only after a documented configuration change, and state what changed.

### 3. Identity / trust mismatch

- **Surfaces as:** a message arrives from an unregistered identity, an ack references an unknown thread, a seat quotes a rule that is not in the current commons, or a CLI-sent message claims a sender that does not match the dispatch record.
- **Evidence to capture:** claimed sender, thread ID, message ID, roster entry (or its absence), and the dispatch/doorbell log line for that message.
- **Known limitation:** on the CLI path the sender is self-declared and is not verified by the server. Trust is at the token level: possession of the token in `{{TOKEN_FILE}}` is the effective credential. Treat CLI sender claims accordingly in any consequential workflow.
- **Operator response:** stop the affected workflow, do not act on the mismatched message, and reconcile the identity mapping table before resuming.
- **Retry policy:** never auto-retry and never auto-correct identity. Identity changes require a coordinator decision and a roster update.

### 4. Storage / archive inconsistency

- **Surfaces as:** memory file and digest disagree, task registry status does not match the mailbox thread, a referenced artifact is missing, or a mailbox archive search fails to find a message that a receipt references.
- **Evidence to capture:** both conflicting values with their file paths and line or message references, the receipt or evidence anchor that proves which value was expected, and the last known-good check timestamp.
- **Operator response:** treat the primary artifact (memory file, registry entry, or mailbox record — whichever owns that field under the single-writer rule) as authoritative. The single writer for that artifact fixes the derived copy. Do not edit both sides to make them agree.
- **Retry policy:** reads may be retried once in case of a transient filesystem error. Writes are never auto-retried; a failed write is reported and re-issued explicitly by the owning seat after the cause is fixed.

### 5. Wake dispatch failure

- **Surfaces as:** a message is stored and a receipt exists, but the target seat does not start, or the doorbell log shows a dispatch with no subsequent ack within the expected window.
- **Evidence to capture:** message ID, recipient seat, doorbell cursor value before and after the event, dispatch log line, and the wake method configured for that seat in the roster.
- **Operator response:** check the doorbell is resident, check the cursor has not advanced past an undispatched message, and test the seat's native wake in isolation. Note: if the cursor advances at dispatch time, a failed seat execution is not automatically retried by the doorbell — recovery is manual by design.
- **Retry policy:** manual re-dispatch only, once, after the wake method is verified. Never enable a polling fallback to compensate; fix the event path instead. See [doorbell-event-driven.md](doorbell-event-driven.md).

### 6. Verification failure

- **Surfaces as:** the verifier seat returns fail, a checker exits non-zero, or an acceptance check in [bootstrap-from-zero.md](bootstrap-from-zero.md) or [verification.md](verification.md) does not pass.
- **Evidence to capture:** the full checker/verifier output (all findings, not a summary), the artifact version or hash checked, and the acceptance criteria used.
- **Operator response:** the work returns to the builder seat with the findings attached. Review-passed is not delivered: a verification failure blocks the approval gate until a fresh verification passes. See [governance.md](governance.md).
- **Retry policy:** re-verification is allowed after a documented fix. The verifier must be independent of the fix's implementer — in single-agent mode, a fresh session. Never re-run the same check on an unchanged artifact expecting a different result.

## Reporting rules

These rules apply to every seat, checker, and gate:

1. **Report failures as-is.** Name the failing step, the named error, and the evidence. Do not soften, summarize away, or omit a failure.
2. **Never invent numbers or statuses.** If a count, latency, or status was not returned by a tool or a receipt, state that it is unknown. Do not estimate and present it as measured.
3. **A failed check is a result.** It is recorded in the daily log and the task registry like any other outcome. It is not hidden, deferred silently, or re-run until it passes without a change in between.
4. **List all findings.** Checkers and verifiers collect every finding in one pass and report them together. Fixing one finding and re-running to discover the next is a defect in the checker, not a workflow.
5. **Fail closed.** Any checker or gate that cannot complete its checks — missing file, unreadable input, unknown format — exits non-zero with a named error. It never exits zero with a warning in place of a check.
6. **Preserve the original output.** When reporting upward, attach or quote the original error output alongside any interpretation. The coordinator decides based on evidence, not paraphrase.

## Named-error format

Use a stable, machine-greppable name plus a human sentence:

```text
ERROR <CLASS>_<SPECIFIC>: <what failed> at <step> — <evidence reference>
```

Examples of the pattern (illustrative names, not an exhaustive registry):

```text
ERROR TRANSPORT_UNREACHABLE: mailbox read failed at send-self-test — {{MAIL_HOST}}:{{MAIL_PORT}} connection refused
ERROR VERIFICATION_FINDINGS: checker reported 2 findings at usability — references/comms-mail.md links to missing file
```

Every new checker must register its error names in its own output and exit non-zero on any of them. See [verification.md](verification.md) for how `scripts/check.py` applies this.

See also: [governance.md](governance.md), [comms-mail.md](comms-mail.md), [../README.md](../README.md).
