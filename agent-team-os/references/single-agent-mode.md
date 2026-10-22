# Single-Agent Mode

Single-agent mode is a first-class deployment, not a degraded fallback. One agent runs multiple sessions. Each session plays one seat (coordinator, builder, verifier, operator, or dispatcher) and follows the same rules a separate agent in that seat would follow.

Use it to start small, validate the workflow, or run a full team on a single host. Scaling to multiple agents later requires no redesign — see the expansion table below and [bootstrap-from-zero.md](bootstrap-from-zero.md).

## Concept

- **Seat = session.** A seat is a role with an identity, an instruction file, and a mailbox. In single-agent mode that seat is realized as a dedicated session, not a separate process or account.
- **One session, one seat at a time.** Do not let a single session switch seats mid-task. Context bleed between seats defeats verifier independence and evidence discipline.
- **Coordination is asynchronous.** Sessions coordinate through the mailbox and the shared memory layers, exactly as separate agents do. Do not coordinate by copying context between sessions.
- **The coordinator session is the human entry point.** The human talks to the coordinator session only. Other sessions receive work via the mailbox.

## What stays identical

These artifacts and rules do not change between single-agent and multi-agent mode:

- Memory layers: curated long-term memory, daily logs, person/group profiles, temporal knowledge graph, shared commons fragments, and digests — see [memory-model.md](memory-model.md).
- Roster: one row per seat, with identity, responsibility, and wake method — see `../templates/roster.md`.
- Governance rules: single-writer rule, evidence anchors, approval gates, and verifier independence — see [governance.md](governance.md).
- Mailbox: fixed identities, threads, delivery receipts, ack receipts, file reservations, and contact policy — see [comms-mail.md](comms-mail.md).
- Task registry: every unit of work is registered, owned by one seat, and closed with evidence.
- Reporting discipline: failures reported as-is, with named errors — see [error-handling.md](error-handling.md).

If an artifact would need to be rewritten to scale up, it is in the wrong format for single-agent mode.

## What changes

| Aspect | Single-agent mode | Notes |
|---|---|---|
| Seat realization | Session | Start a fresh session per seat per task where possible. |
| Wake | Start or notify a session | The doorbell triggers session creation/notification instead of waking a separate agent. |
| Doorbell | Session-level trigger | Filesystem event → coordinator starts/notifies the target session. No native per-agent wake needed. See [doorbell-event-driven.md](doorbell-event-driven.md). |
| Verifier independence | Fresh session + verifier brief | The verifier session must not inherit the implementation session's context, reasoning, or files beyond the deliverable and its evidence anchors. Brief it from the task registry entry and the artifact under review only. |
| Identity | Same fixed identities | Session-seats still send, reply, and ack under their seat identity. On the CLI path the sender is self-declared — see [comms-mail.md](comms-mail.md) for the known limitation. |

## Verifier independence in practice

1. Builder session completes work and records evidence anchors in the task registry.
2. Coordinator closes the builder session or leaves it idle; do not reuse it as verifier.
3. Coordinator starts a new session with a verifier brief: task ID, acceptance criteria, artifact paths, and evidence anchors. No implementation transcript.
4. Verifier session inspects the artifact directly, records a pass/fail with evidence, and acks via the mailbox.
5. If verification fails, the fix goes to a builder session — which may be new or the original — but re-verification again uses a fresh verifier session.

## Limits

- **Correlated blind spots.** All sessions share the same underlying model. A verifier session is independent in context, not in model biases. For high-stakes work, add a human approval gate; do not treat session separation as equivalent to a different implementer.
- **Context cost.** Each seat session carries its own instruction file, commons fragments, and task context. Total token cost scales with the number of active seats, even though only one agent is running.
- **Throughput.** Sessions run sequentially or with limited parallelism on one host. The mailbox and doorbell still work, but end-to-end latency is higher than with separate agents.
- **No isolation boundary.** Sessions share the host filesystem and credentials. File reservations and the single-writer rule are conventions enforced by discipline and checks, not by OS isolation.

## Expansion: single-agent → multi-agent

| Element | Kept verbatim | Replaced |
|---|---|---|
| Memory files and digests | Yes — same paths, same format | — |
| Commons fragments | Yes — same text in every instruction file | Distribution method may change |
| Roster | Yes — same rows and identities | Wake method column updated per seat |
| Mailbox identities, threads, receipts | Yes | — |
| Task registry | Yes | — |
| Seat definitions | Yes | Session-seat → real agent per seat |
| Doorbell cursors and dispatch table | Structure kept | Session trigger → native wake per agent |
| Instruction files | Content kept | Delivery target changes from session brief to agent config |
| Adapter wiring per agent type | — | Added per [adapters-compatibility.md](adapters-compatibility.md) |

Procedure: freeze the task registry, stop the doorbell, replace one seat at a time, run one live round-trip per replaced seat (coordinator sends, seat replies + acks in-thread), then resume the doorbell and run one end-to-end event test per seat. This mirrors Phase 2 and Phase 5 in [bootstrap-from-zero.md](bootstrap-from-zero.md).

## When to stay single-agent

Stay in single-agent mode if the team is one person, the workload fits sequential sessions, or you are still validating roster, governance, and mailbox discipline. The mode is complete on its own; expansion is optional, not a fix for a broken single-agent setup.

See also: [../README.md](../README.md), [adapters-compatibility.md](adapters-compatibility.md), [bootstrap-from-zero.md](bootstrap-from-zero.md).
