# Architecture — the production deployment behind this protocol

This repository holds the protocol (root skill) and its companion package
(`agent-team-os/`). Both are run in production, every day, by the deployment
summarised here: one human decision-maker and a team of AI agents split
between a cloud VM and one Windows machine. This document is the
current-state architecture of that deployment, as of **2026-10-23**. It is
the public, sanitised record — host-specific identifiers (user names,
machine names, network addresses) are deliberately generalised, and the
repository's hygiene gate rejects them. The channel-level detail lives in
[`references/deployment-profile.md`](../references/deployment-profile.md).

## 1. Shape

- The human is the only decision and approval point — every external action
  (send, publish, delete, deploy, pay, change an account setting) waits for
  a per-item nod. A passed verification gate is not a delivery.
- A cloud coordinator is the human's single contact point: it decomposes
  work, dispatches it, stays in the loop while cross-agent work is in
  flight, reads artifacts back before reporting, and reports in two
  columns — done / blocked-needs-a-decision.
- Local seats execute. Each seat has its own identity, memory and
  permission boundary; cross-seat claims must carry evidence anchors
  (source path, hash, raw command output). No artifact, no conclusion.

## 2. Seats

| Seat | Carrier | Duty |
|---|---|---|
| Coordinator | cloud VM | dispatch hub, read-back and reconciliation, the human's only interface |
| codex | standalone local agent | implementation; security-review seat |
| dsh | standalone local agent | local lead: outreach-radar watch, scheduled guardianship, repairs; **single writer** of the shared record |
| tianshu | standalone local agent | independent verification only — the verifier is never the implementer |
| xiaoyu | Grok Bot principal | sole intake for the Grok Bot line; sub-bots are reached through it, never dispatched directly |

Three further personas in the team group chat are mirrors of codex, dsh and
tianshu inside Grok Bot, not separate agents. All local seats run one
pinned model (deepseek-flash); the coordinator runs on the cloud host's
model.

Work is routed by kind, not by habit: local operations and radar watch to
dsh, code and security review to codex, independent verification to
tianshu, Grok Bot and content work to xiaoyu, rulings (decisions recorded
on the boards) are never auto-executed — they are reported to the human.
Load guard: a seat with an unacknowledged dispatch older than two hours
receives no new non-urgent work.

## 3. How work is run

- **Collaboration pattern for large or consequential work** (the "four
  pieces"): several agents in parallel, a security review by codex, an
  independent verification by tianshu, and a coordinator read-back of the
  actual artifacts. All three gates must pass before delivery; an
  implementer's self-check is not a verification result.
- **Tiered rigour** (rule set 2026-10-23): small, single-step, reversible
  tasks take a light route (incremental checks, scripted verification);
  important tasks always run the full procedure. Saving model quota never
  lowers the standard on important work.
- **Task cards**: every dispatch states the object, its hash, the
  requirement verbatim and executable acceptance assertions — a card that
  only states a goal is rejected. GUI work follows a method ladder:
  element-level (accessibility tree) first, window-level coordinates
  second, foreground input last and only with a stated reason.

## 4. Communication layer

Currently live:

1. **Agent mailbox** — fixed identity per seat, threaded messages,
   delivery receipts and ack semantics. Known limit, stated plainly:
   sender identity is self-asserted at token level (`verified_sender`
   is false); the mailbox is trusted accordingly and never treated as
   proof of authorship for gated actions.
2. **Event doorbell** — a filesystem watcher on the mailbox store wakes
   each seat through its native channel (CLI round, bridge task,
   verification card, GUI wake) with per-seat persistent cursors. Zero
   polling; a failed seat execution is not silently retried — the cursor
   semantics are recorded and the coordinator follows up.
3. **Direct channels** — SSH CLI for codex and dsh, a headless
   `rivet -p` invocation for tianshu (heavy verification cards pre-split
   the reply into its own final round, after a 2026-10-22 incident where
   the work consumed the session budget and the reply was never sent),
   and a GUI wake task for Grok Bot, which has no port and no CLI.
4. **Cloud inbound wake** — new mail reaches the coordinator in under
   60 seconds; a 15-minute outbox patrol is the fallback.
5. **Boards and relay** — three dashboards (team tasks, radar report,
   content operations) record work; a relay on the local machine turns
   board records into mailbox dispatches, and a pickup loop (every
   10 minutes) routes them by kind. Boards record and relay only; they
   never claim anything was sent or fixed — status advances only from
   real mailbox events (acks and replies) read back by a sync loop.

In shadow since 2026-10-23 (**comms v2**): a NATS JetStream transport, a
Postgres task ledger (state machine and audit trail) and A2A task
contracts, with at-least-once delivery and idempotent receivers. The
local machine runs a leaf node that dials out to the cloud hub — no new
inbound ports on the box. Production dispatches are mirrored into the
shadow ledger; cutover is a separate decision, gated on at least 7 days
of shadow running, at least 100 mirrored tasks and clean daily
reconciliation. The mailbox stays as the out-of-band alerting channel.

## 5. Memory layer

- **Layered files**: a curated long-term memory, daily logs, and
  people/group pages (the text layer of the relationship graph).
- **Shared rule fragments (cloud-commons)**: rules are registered as
  versioned fragments and distributed into every seat's instruction file
  with drift verification — ten fragments in force, including the
  collaboration pattern, the task-card standard, a skill-routing gate
  and (since 2026-10-23) graph retrieval.
- **Temporal knowledge graph** (Graphiti on Neo4j): facts carry
  `valid_at` / `invalid_at`; a new fact supersedes an old one in time
  instead of deleting it, so corrections propagate. As of 2026-10-23:
  **286 episodes / 1,367 entities / 2,646 facts**, with a daily
  incremental ingest wired into routine use and retrieval smoke-tested.
- **Seed governance pilot**: memory seeds carry trigger conditions and
  source-graded weights (human ruling 1.0 / measured 0.9 / seat report
  0.7 / inference 0.4), a 30-day half-life decay to a floor, and
  correction propagation as worked cases.

## 6. Operations surface

- **Standalone snapshot site**: board snapshots are pushed every
  5 minutes to a Cloudflare Workers + D1 site, so the human can read the
  last known state — and queue instructions — while the tunnel is down.
  Queued instructions are consumed by the pickup loop when the link
  returns. Token gate first; Access hardening still pending.
- **Scheduled jobs**: board pickup (10 min), board status sync (5 min),
  standalone sync (5 min), content-operations daily report, Cloudflare
  quota daily, mailbox outbox patrol (15 min), graph daily ingest.
- **Skills governance**: the local library (232 skills) is classified
  A 47 / B 87 / C 50 / D 46 / X 2; the 98 C/D/X entries were quarantined
  reversibly, leaving 134 in service. Standing rule: a useful skill that
  is installed must actually be used — installed-but-idle is treated as
  not installed, and audits disposition the idle set (in use /
  quarantined / pending) rather than letting it accumulate.

## 7. Security and authorisation boundaries

- **Authorisation does not travel by relay.** An irreversible external
  action is executed only on the human's own in-session confirmation; an
  executor is entitled — required — to refuse an approval it received
  second-hand through another agent (precedent set and upheld
  2026-10-22).
- **Sandbox tiers**: read-only / workspace-write / danger-full-access.
  Widening a tier is done by the human in a local session, never by an
  agent self-promoting.
- **Credentials** live only in secure storage or the box's environment.
  Values never enter chat, memory files or this repository; anything
  open-sourced passes a denylist hygiene check and two independent gates
  before release.
- **Security scanning**: on 2026-10-23 the repository received its first
  full security scan (Codex driven over the DeepSeek route): 13 findings
  baselined (1 high, 9 medium, 3 low). Fixes are implemented locally and
  are being verified independently before they ship — they are
  deliberately not in this tree yet, and this document does not describe
  them.

## 8. Honest limits

- Mailbox sender identity is token-level self-assertion (see §4).
- Seats share one OS user on the box: there is no file-level isolation
  between them; tamper-resistance is procedural, not ACL-based.
- The cloud↔box link rides a tailnet; when the box sleeps or shuts down,
  the link is down and work queues until it returns. (Hard-won rule:
  never tear down the cloud VM's own tailnet identity to "fix" the link —
  that deregisters the device and takes every channel down with it.)
- Some platforms cannot be posted to from a cloud VM at all; those go
  through compliant channels or the human's own hands.
- Seed weighting and correction propagation are piloted in the graph
  layer only, not yet across all memory surfaces.

## 9. Timeline

- **2026-10-20** — Cloud coordination takes over; three local channels
  (codex, dsh, tianshu) probed live; approval-gate precedents set.
- **2026-10-21** — Collaboration commons built and distributed to all
  seats; mailbox + event doorbell live; agent-team-os open-sourced
  (history rewritten to a single clean commit after both gates passed);
  pairwise channel matrix PONG-verified.
- **2026-10-22** — Comms overhaul chartered (audit, then a frozen
  payload/queueing spec); task-card standard adopted; skill-routing gate
  merged into the commons; three-board standalone site live; seed-memory
  pilot lands; local seats unified on deepseek-flash; relayed-approval
  refusal upheld as compliant behaviour.
- **2026-10-23** — agent-team-os merged into this repository as the
  companion package; CI hygiene fix shipped. Comms v2 route decided
  (NATS JetStream + Postgres ledger + A2A) and its shadow phase started.
  Graph memory wired into daily use (286 episodes / 2,646 facts, daily
  ingest, graph-retrieval commons fragment). First full security scan:
  13 findings baselined, fix line under independent verification.
  Facade refresh: production-adoption section in the README and this
  architecture document.
