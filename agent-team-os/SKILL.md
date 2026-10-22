---
name: agent-team-os
description: Run a team of AI agents (or one agent in several role sessions) as one governed unit — layered long-term memory, hub-coordinated governance with evidence anchors and human approval gates, an identity-based agent mailbox with receipts, and an event-driven doorbell that wakes seats on new mail without polling. Use when setting up or operating a multi-agent team, when agents must share durable memory and verifiable hand-offs, or when a single agent should work in the same pattern across multiple sessions. Do not use for adversarial or multi-tenant environments, or for any flow where a single message by itself authorizes payment, deployment, or credential release — on the mailbox's CLI path the sender is self-declared.
---

# Agent Team OS

A complete operating pattern for a small team of AI agents coordinated by one
hub, designed so that work is **remembered, verifiable, and never silently
lost** — and so that a human stays in charge of anything irreversible.

## The four layers

1. **Layered memory** — what the team knows.
   A curated long-term memory file, daily logs, person/group profiles, a
   temporal knowledge graph, shared rule fragments distributed to every seat,
   and periodic digests. Each layer has strict rules for what belongs in it.
   → `references/memory-model.md`

2. **Governance** — how the team is allowed to act.
   One coordinator is the human's single entry point. A roster assigns one
   owner (single writer) per resource. Cross-agent relays must carry evidence
   anchors (path / hash / raw output); no artifact = no conclusion. The
   verifier is never the implementer. Passing a review gate is **not**
   delivery: outward or irreversible actions (send, publish, delete, deploy,
   pay, change settings) need per-item human approval.
   → `references/governance.md`

3. **Identity mailbox** — how seats communicate durably.
   Every seat has a fixed mail identity. Messages carry ids, threads,
   delivery receipts, and acknowledgements; landed mail is never lost
   (store-and-forward). File reservations stop two seats editing the same
   file. Non-MCP seats use a thin helper script.
   → `references/comms-mail.md`, template: `templates/scripts/mail-helper.ps1`

4. **Event-driven doorbell** — how seats hear about new mail in real time.
   No polling anywhere. A watcher on the mailbox storage fires on writes,
   consumes durable per-recipient delivery events through persistent cursors,
   and dispatches each recipient's native wake (CLI round, bridge task,
   task-card CLI, GUI paste, coordinator marker file).
   → `references/doorbell-event-driven.md`, template: `templates/scripts/doorbell.ps1`

## Modes

- **Multi-agent mode** — several different agents hold the seats.
- **Single-agent mode** — one agent runs several sessions, each session plays
  one seat with the same roster, mailbox, memory layers, and governance. The
  doorbell simplifies to a session-level trigger. Everything else is identical,
  so scaling from one agent to many replaces seats, not the system.
  → `references/single-agent-mode.md`

Seats are connected through **adapters** (MCP-native, CLI, GUI desktop, API,
file-only); the compatibility matrix defines what each type needs and how it
degrades. → `references/adapters-compatibility.md`

## When to use this skill

- You run (or are setting up) more than one agent — or one agent in several
  role sessions — and they must coordinate over days, not minutes.
- Work keeps getting lost between sessions, or hand-offs can't be verified.
- You need a human approval gate between "an agent says it's done" and
  "something happened in the real world".

## When NOT to use it

- A single one-shot agent task with no follow-up: the overhead buys nothing.
- Adversarial settings where seats must not trust each other: the mailbox's
  CLI path treats sender identity as self-declared (see the known limitation
  in `references/comms-mail.md`).

## Getting started

1. Cold-start from zero communication: `references/bootstrap-from-zero.md`
   (each phase has an acceptance check; do not skip phases).
2. Or take the 30-minute path: `QUICKSTART.md`.
3. Instantiate the templates: `templates/` (placeholder list:
   `templates/PLACEHOLDERS.md`).

## Verification

Five suites — hygiene, compatibility, usability, error behaviour,
reproducibility — are implemented by `scripts/check.py` and specified
in `references/verification.md`:

```
python3 scripts/check.py              # all suites
python3 scripts/check.py --category COMPAT   # one suite
python3 scripts/check.py --self-test  # poisoned-fixture negative test
```

Every failure is reported as a **named error** with a non-zero exit code;
reporting failures honestly is part of the system, not an exception to it
(`references/error-handling.md`).
