# Quickstart — 30 minutes

From a copy of this package to a working coordinator + one seat, with memory initialized and the checker passing. For the full cold-start procedure with acceptance checks per phase, see `references/bootstrap-from-zero.md`.

**Single-agent shortcut:** if you have one agent, do every step below anyway, treating each seat as a session of that agent. What changes — and what deliberately does not — is described in `references/single-agent-mode.md`. Do not skip the roster, mailbox, or receipts; they are what make later scaling a seat swap instead of a redesign.

## 0. External dependency: the mailbox server

**This package does not include a mailbox server.** The whole system depends on one: before anything below can work, you must run a mail server that implements the contract in `references/mail-server-interface.md`, or select an existing server that does. That document specifies the full interface the system assumes — the tool surface (send / reply / ack), the HTTP JSON-RPC endpoint, bearer-token authentication, project keys, delivery and ack receipts, and the delivery-event stream the doorbell consumes — precisely enough to choose or implement a compatible server. Budget the server setup separately; the 30 minutes below starts once a compatible server is reachable.

## 1. Copy templates and fill placeholders (~5 min)

Copy `templates/` into your working directory (`{{WORK_DIR}}`). Fill every placeholder using `templates/PLACEHOLDERS.md` as the reference — the package defines 21 placeholders, and that document lists the full set. Keep the filled values in your deployment, not in this package. Keep the token file itself readable only by you and your seats.

## 2. Initialize memory files (~5 min)

- Create your curated memory from `templates/MEMORY.md`. Write only facts that should persist across all future work.
- Start today's daily log from `templates/daily-log.md`.
- Create person/group profiles from `templates/person.md` and `templates/group.md` only for people and groups already in scope.

Layer semantics and write discipline: `references/memory-model.md`.

## 3. Write your roster (~5 min)

Fill in `templates/roster.md`: one row per seat (coordinator, builder, verifier, operator, dispatcher — include the seats you need; coordinator and verifier are mandatory). For each seat record its mailbox identity, responsibility, wake method, and which memory layers it is the single writer for. Also start `templates/task-registry.md` — the quickstart itself is your first entry.

## 4. Stand up the mailbox and run one round-trip (~10 min)

Stand up your mailbox server (the external dependency from Step 0 — its contract is `references/mail-server-interface.md`) on `{{MAIL_HOST}}:{{MAIL_PORT}}` with the token from `{{TOKEN_FILE}}` and project key `{{PROJECT_KEY}}`, register the coordinator identity, then register one seat. Run the round-trip:

1. Coordinator sends itself a message and reads it back (server + identity sanity check).
2. Coordinator sends a test message to the seat.
3. Seat replies in-thread and acks the original message.

Both receipts must exist before you continue. Mailbox semantics: `references/comms-mail.md`. Full onboarding for all seats: `references/bootstrap-from-zero.md` (Phases 1–3, including distributing the commons fragments from `templates/commons-fragments/` into every seat's instruction file).

## 5. Optionally enable the doorbell (~5 min)

Adapt `templates/scripts/doorbell.ps1` for your host, initialize a durable cursor per seat, and leave it resident. Test it once: send the seat a message with **no manual wake** and confirm the event alone produces a reply + ack. If you skip this step, seats must be woken manually — the mailbox and receipts still work. Design and cursor semantics: `references/doorbell-event-driven.md`.

## 6. Run the checker

```bash
python3 scripts/check.py
```

Fix every named error it reports and re-run until all suites PASS. The checker runs 5 suites — hygiene (including the scan for deployment-specific identifiers), compatibility, usability, error behaviour, and reproducibility. What each suite checks: `references/verification.md`. How failures must be reported across the whole system: `references/error-handling.md`.

## Done — what you have

- Memory layers initialized from templates, each with a named single writer.
- A roster and task registry as the operating baseline.
- A mailbox with at least two identities proven by a live round-trip with receipts.
- Optionally, an event-driven doorbell proven by one no-manual-wake test.
- A package that passes `python3 scripts/check.py`.

Next: onboard remaining seats and freeze the baseline by following `references/bootstrap-from-zero.md` through Phase 6.
