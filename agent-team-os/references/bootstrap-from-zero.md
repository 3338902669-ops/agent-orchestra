# Bootstrap From Zero

Cold-start procedure: from no communication channel to a working multi-seat mesh. Each phase has an acceptance check. Do not proceed to the next phase until the current phase passes; record each pass in the task registry.

Placeholders used below are defined in [../templates/PLACEHOLDERS.md](../templates/PLACEHOLDERS.md).

For the single-agent variant, each phase notes what changes when every seat is a session of one agent. The full model is in [single-agent-mode.md](single-agent-mode.md).

## Phase 0 — Prerequisites

Set up:

- One reachable host for the mailbox server. All seats must be able to reach `{{MAIL_HOST}}:{{MAIL_PORT}}`.
- One token file at `{{TOKEN_FILE}}`, readable only by the operator and the seats. The token is the effective credential for the mailbox; do not commit it or copy it into memory files.
- Directories under `{{WORK_DIR}}`: memory, daily logs, profiles, commons fragments, and the task registry location.
- One instruction file location per seat.
- A filled copy of [../templates/PLACEHOLDERS.md](../templates/PLACEHOLDERS.md) values for this deployment (kept outside the package).

**Acceptance:** every seat's environment can resolve `{{MAIL_HOST}}`, read `{{TOKEN_FILE}}`, and write to its assigned paths under `{{WORK_DIR}}`. Verify by a read/write probe per seat, not by assumption.

*Single-agent variant:* all seats are sessions on one host, so reachability is local. The token file and directory layout are unchanged.

## Phase 1 — Mailbox server + coordinator identity

1. Stand up the mailbox server on `{{MAIL_HOST}}:{{MAIL_PORT}}`, bound to the intended interface only, with the token from `{{TOKEN_FILE}}` and project key `{{PROJECT_KEY}}`. The server is an external dependency — it is not shipped in this package; the contract it must implement is [mail-server-interface.md](mail-server-interface.md).
2. Register the coordinator identity. Record it in the identity mapping table: seat role → mailbox identity.
3. Keep the server resident under whatever supervisor the host provides, so it survives restarts.

**Acceptance:** the coordinator sends itself a message and reads it back in the same thread. The read-back message ID matches the sent message ID, and a delivery receipt exists. If this fails, fix transport or identity first — see [error-handling.md](error-handling.md), class 1 and class 3.

*Single-agent variant:* identical. The coordinator session performs the self-test.

See [comms-mail.md](comms-mail.md) for mailbox semantics.

## Phase 2 — Onboard each seat

For each remaining seat (builder, verifier, operator, dispatcher — include only the seats your roster needs, but coordinator and verifier are mandatory):

1. Register the seat's mailbox identity and add it to the identity mapping table.
2. Install the seat's instruction file (commons fragments are added in Phase 3; the base file must exist now).
3. Run one live round-trip: coordinator sends a task-shaped test message → seat replies in-thread → seat acks the original message.

**Acceptance (per seat):** reply and ack both exist in the thread, the ack references the original message ID, and the identity in the mapping table matches the identity that replied. A seat is not onboarded until its round-trip passes. Record the message IDs as evidence anchors in the task registry.

*Single-agent variant:* the seat is a session. Start the session with its brief, run the same round-trip, then close or idle the session. The acceptance criteria are unchanged.

## Phase 3 — Distribute commons fragments

1. Copy the commons fragments from `../templates/commons-fragments/` — approval gates, evidence anchors, single-writer, verifier independence — into every seat's instruction file.
2. Use identical text in every seat. Local additions go in a separate, clearly marked section, never inside the fragment text.
3. Restart or re-brief each seat so it loads the updated instruction file.

**Acceptance:** each seat, when asked, can quote the approval-gate rule back verbatim in substance: review-passed is not delivered, and external or irreversible actions require explicit human approval at the gate. Test every seat, not a sample.

*Single-agent variant:* the fragments are included in each session's brief template. Acceptance is tested once per seat-brief, in a fresh session.

See [governance.md](governance.md) for the rules the fragments encode.

## Phase 4 — Memory layers

Initialize the memory layers from templates:

- Curated long-term memory from `../templates/MEMORY.md`.
- Daily log from `../templates/daily-log.md` — start today's log.
- Person profiles from `../templates/person.md` and group profiles from `../templates/group.md` — create only for people/groups already in scope; do not pre-create empty profiles speculatively.
- Roster from `../templates/roster.md` and task registry from `../templates/task-registry.md` (frozen in Phase 6).
- Digest location and graph store location recorded in the roster notes, even if the graph is populated later.

**Acceptance:** every memory path referenced by any seat's instruction file exists, the single writer for each layer is named in the roster, and the coordinator can read back one entry written into each initialized layer.

*Single-agent variant:* identical files and writers. The writer is a seat, which is a session; the rule is unchanged.

See [memory-model.md](memory-model.md) for layer semantics.

## Phase 5 — Doorbell

1. Install the doorbell from `../templates/scripts/doorbell.ps1` (or the equivalent watcher for the host), watching the mailbox storage location for write events.
2. Initialize a durable cursor per recipient seat. Cursors persist across doorbell restarts.
3. Configure the dispatch table: seat → native wake method. No polling anywhere in the design; dispatch is event-driven only.

**Acceptance (per seat):** with the doorbell resident, send a message to the seat **without any manual wake**. The event dispatches, the seat starts, replies, and acks. Measure nothing by polling the seat; judge only by the reply, the ack, and the doorbell log. All seats must pass individually.

*Single-agent variant:* the doorbell simplifies to a session-level trigger: the event causes the coordinator to start or notify the target session. Acceptance is the same, with the session as the woken unit.

See [doorbell-event-driven.md](doorbell-event-driven.md) for cursor semantics and dispatch failure handling.

## Phase 6 — Task registry + roster baseline

1. Complete the roster from `../templates/roster.md`: every seat, identity, responsibility, wake method, and single-writer assignments.
2. Complete the task registry from `../templates/task-registry.md`: register the bootstrap itself as the first closed task, with Phase 1–5 message IDs as evidence anchors.
3. Declare this roster + registry state the operating baseline. Changes after this point go through the coordinator and are logged in the daily log.

**Acceptance:** `python3 scripts/check.py` run from the package root reports no structural findings for the instantiated files, and a fresh reader can reconstruct — from the roster and registry alone — who each seat is, how to reach it, and what has already been proven to work.

*Single-agent variant:* identical, with wake methods recorded as session triggers.

## After bootstrap

- Run the verification suites in [verification.md](verification.md) against the package itself.
- Operate under [governance.md](governance.md). Bootstrap proves the mesh works once; governance is what keeps it working.

See also: [../README.md](../README.md), [../QUICKSTART.md](../QUICKSTART.md).
