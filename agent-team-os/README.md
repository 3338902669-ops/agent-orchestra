# agent-team-os

A hub-coordinated multi-agent team operating system: a set of documents, templates, and a checker that give one or more AI agents a shared memory, explicit governance, identity-based mailbox communication, and event-driven wake-up — so a team of agents (coordinator, builder, verifier, operator, dispatcher) works from the same facts, under human approval gates, with receipts for every handoff. The same artifacts also run a single agent in multiple role sessions; see `references/single-agent-mode.md`.

## The four layers

1. **Layered memory** — curated long-term memory, daily logs, person/group profiles, a temporal knowledge graph, shared commons rule fragments, and digests. See `references/memory-model.md`.
2. **Governance** — the coordinator is the single human entry point. Roster, single-writer rule, evidence anchors, a verifier independent from the implementer, human approval gates (review-passed != delivered), skill-library classification with quarantine, and a task registry. See `references/governance.md`.
3. **Identity mailbox comms** — fixed identities per seat, threaded messages, delivery and ack receipts, file reservations, and a contact policy. Known limitation: on the CLI path the sender is self-declared. See `references/comms-mail.md`. The mailbox server itself is an external dependency and is not shipped in this package; the contract a compatible server must implement is `references/mail-server-interface.md`.
4. **Event-driven doorbell** — filesystem-write events, durable per-recipient cursors, and native wake dispatch per seat. No polling anywhere. See `references/doorbell-event-driven.md`.

## Who should use it

A person running one or more AI agents as a team: one human, several agent seats, recurring work that must survive across sessions. Equally, a person with a single agent who wants role separation (builder vs. verifier) and durable memory before scaling up — start with `references/single-agent-mode.md`, keep every artifact, and replace session-seats with real agents later.

## Layout

Root:

- `SKILL.md` — the skill definition and entry point.
- `README.md` — this file.
- `QUICKSTART.md` — 30-minute setup.
- `LICENSE`, `NOTICE` — Apache License 2.0 and attribution.
- `CHANGELOG.md` — release history.
- `denylist.example.txt` — deliberately fake example terms for the hygiene suite (see `references/verification.md`).

References (`references/`):

- `references/memory-model.md` — memory layers and write discipline.
- `references/governance.md` — roster, gates, single-writer, evidence anchors.
- `references/comms-mail.md` — mailbox identities, threads, receipts.
- `references/mail-server-interface.md` — the external mail server contract (not shipped; choose or implement a compatible server).
- `references/doorbell-event-driven.md` — event-driven wake dispatch.
- `references/adapters-compatibility.md` — per-agent-type wiring and compatibility matrix.
- `references/single-agent-mode.md` — one agent, many sessions, each session a seat.
- `references/error-handling.md` — error taxonomy and reporting discipline.
- `references/bootstrap-from-zero.md` — cold-start phases with acceptance checks.
- `references/verification.md` — the five verification suites and the hygiene rule.

Templates (`templates/`):

- `templates/MEMORY.md`, `templates/daily-log.md`, `templates/person.md`, `templates/group.md` — memory layer templates.
- `templates/roster.md`, `templates/task-registry.md` — governance templates.
- `templates/PLACEHOLDERS.md` — every placeholder, in one format.
- `templates/commons-fragments/approval-gates.md`, `templates/commons-fragments/evidence-anchors.md`, `templates/commons-fragments/single-writer.md`, `templates/commons-fragments/verifier-independence.md` — rule fragments copied into every seat's instruction file.
- `templates/scripts/mail-helper.ps1`, `templates/scripts/doorbell.ps1` — starter scripts to adapt per host.

Checker:

- `scripts/check.py` — five suites: hygiene, compatibility, usability, error behaviour, reproducibility.

## Start here

- New deployment: follow [QUICKSTART.md](QUICKSTART.md), then the full phases in `references/bootstrap-from-zero.md`.
- Skill contract and operating rules: see [SKILL.md](SKILL.md).

## Verify

```bash
python3 scripts/check.py
```

A clean package prints PASS for every suite, ends with ALL CHECKS PASSED, and exits zero. Any finding is reported as a named error with a non-zero exit. See `references/verification.md` for what each suite checks.
