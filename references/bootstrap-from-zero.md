# Bootstrap from zero: no inter-agent communication to a working mesh

This reference is the cold-start path for the deployment profile in SKILL.md
("hub-coordinated mesh"). It assumes the worst starting point: several agents
exist, none of them can reach any other, and there is no shared infrastructure
except what the bootstrap itself creates. Every stage ends with a checkable
artifact; do not advance a stage on intention, only on evidence.

The invariant throughout: **a channel counts as up only when a probe
round-trips.** Configuration, enrollment, a green console icon — none of these
are reachability.

## Stage 0 — Inventory (artifact: channel matrix, draft)

For each agent, record:

- **Invocation surface**: headless CLI, API, remote shell, GUI-only, or none.
- **Writable ground**: directories it can read and write (local disk, shared
  folders, cloud drives, a repo).
- **Session model**: persistent process, per-invocation process, or a bot
  inside a host application (a persona inside a multi-bot app is a *surface*
  of an agent, not a separate agent — model mirrors as one seat, several
  surfaces).
- **Reaches**: which other agents' writable ground it can also write to.

Output a draft matrix: rows = ordered pairs, cells = candidate mechanism or
"none yet". An empty matrix is a valid starting point; stage 1 exists for it.

## Stage 1 — The mailbox: a channel that always works

If any writable location is visible to two or more agents — a shared
directory, a synced folder, a git repo, even a folder only the future hub can
see plus one other agent — stand up a file mailbox there:

```
shared/
  mailbox/<agent-id>/inbox/     # others write here; only <agent-id> consumes
  mailbox/<agent-id>/outbox/    # <agent-id> publishes replies and artifacts
  CURRENT-TASK.md               # the shared record (single writer, stage 2)
  TEAM-ROSTER.md                # the roster (stage 2)
```

Protocol:

- One file per message, named `YYYYMMDD-HHMMSS-<from>-<topic>.md`. Never edit
  a message after sending; corrections are new files that cite the old name.
- A message is a task card, not prose: addressee, request verbatim where it
  matters, object paths, acceptance invariants, and a reply-to filename.
- Every claim of fact carries an **evidence anchor**: source path, a short
  content hash (first 16 hex of sha256), or raw command output. A claim
  without an anchor is treated as no claim.
- The receiver acknowledges by writing a receipt file into its outbox. No
  receipt = not received, regardless of what the sender believes.
- Polling cadence is a deployment parameter (the reference deployment polls
  every 15 minutes). Latency is the price of this rung; correctness is not
  negotiable at any rung.

This rung alone reproduces dispatch, acknowledgement, handoff and verification
requests. The reference deployment ran one seat (a GUI-bound bot with no port
and no CLI) on exactly this rung before faster channels existed.

If literally no writable ground is shared, the fallback is the **user-relayed
mailbox**: the hub emits a message file, the user carries it (paste, file
drop) to the other agent, and carries the receipt back. Slow, lossy, and still
a protocol — the invariants do not change.

## Stage 2 — Hub, roster, three pinned seats (artifacts: roster, commons v1)

- Designate **one hub**: the agent with the broadest reach across the matrix
  and the user's single point of contact. All assignments, approvals and
  state changes flow through the hub; direct links (stage 4) never carry new
  assignments.
- Write the roster into the shared ground: seat id, surfaces, capability
  scores with evidence levels, channel rows. Pin three seats by explicit
  decision of the user (or of the hub, recorded as a deployment decision):
  **coordinator** (the hub), **verifier** (never implements; a dedicated
  seat), **single writer** of the shared record.
- Stand up the **commons**: a versioned rules file in the shared ground
  holding the rules of engagement as fragments (evidence discipline, gating,
  memory partition, internal-format freedom). The hub is its only editor.

## Stage 3 — Distribution (artifact: per-member verification)

Merge the commons fragments into each agent's own instructions file, by
script where possible. After every sync, **verify per member** that the
fragments landed (read back the file, compare). A fragment missing anywhere
is a failed distribution, not a partial success. Each agent acknowledges the
commons version it runs in its next receipt.

## Stage 4 — The pairwise ladder (artifact: channel matrix, verified)

Upgrade channels pair by pair, strongest mechanism each surface allows:

1. Mailbox (stage 1) — always available, always kept as fallback.
2. Hub-relayed direct messages — hub forwards structured payloads.
3. Direct invocation — headless CLI over SSH or remote shell; a native
   headless call for a verifier; an MCP or vendor bridge where one exists.
4. Session-bound surfaces — an agent trapped in a desktop session (sandboxed
   token, GUI-only) is reached through an interactive-session bridge: a
   scheduled task running in the logged-on session that takes a request file
   and leaves a result file, or a GUI wake automation that activates its
   window and pastes the payload.

For each ordered pair, run a **PONG probe in both directions** and record the
result in the matrix with the date. Record per-channel quirks in the matrix
as you discover them (truncation limits, sandbox denials, session isolation)
— a quirk written down is a failure that happens once.

Failure handling is a ladder, not an event: on outage, fall back one rung
(direct → hub-relayed → mailbox → user-relayed) and keep working; re-probe
after any recovery before trusting the rung again.

## Stage 5 — Memory layer (artifact: digest index)

- Each agent keeps its own private memory. What is shared is **digests**:
  short per-agent summaries in the shared ground, plus a hub-maintained
  index. Raw memory is never bulk-copied between agents — it leaks
  credentials and context that were never meant to travel.
- Optional upgrade: a temporal knowledge graph behind the hub (facts with
  validity windows; superseded facts keep the timestamp they stopped being
  true). Only hub-ingested, source-anchored content enters it. The mesh must
  work without this layer; it is an accelerator, not a dependency.

## Stage 6 — Operating rhythm

- The user talks only to the hub. Gated decisions are batched into one list;
  approval is per item.
- Internal agent-to-agent traffic may use any compact machine-native format;
  human language is produced only at the user boundary.
- The hub stays in the loop on in-flight cross-agent work: it re-reads the
  actual artifacts before reporting up. No artifact, no conclusion.
- The verifier reviews work it did not implement, against the acceptance
  invariants on the task card, and its verdict cites anchors.

## Bootstrap acceptance checklist

- [ ] Channel matrix exists; every "up" cell has a dated, bidirectional PONG.
- [ ] Mailbox round-trip proven for every pair that must communicate,
      directly or via the hub; receipts on file.
- [ ] Roster written; coordinator, verifier and single-writer seats pinned.
- [ ] Commons v1 distributed and verified per member; versions acknowledged.
- [ ] One real task has run end-to-end through the mesh — dispatch, work,
      verification by a non-implementer, hub report — with anchors at each
      hand-off.
- [ ] Fallback order written down; at least one channel outage has been
      ridden through on a lower rung (or simulated and recorded).
