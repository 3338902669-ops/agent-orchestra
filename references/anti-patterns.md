# Coordination Anti-Patterns

Eight failure modes that break multi-agent work, and the engineering fix for each. Read this **before** forming a team: every one of them is cheaper to prevent than to debug.

Each entry states the symptom, why it happens, the observable signal, the executable countermeasure, its owner, and what to do once it has already happened.

---

## 1. Context explosion

- **Symptom:** the shared transcript grows until early constraints, ownership, and acceptance criteria fall out of the window; agents re-litigate settled decisions.
- **Why:** every agent is handed the full history instead of the state.
- **Signal:** repeated questions about already-answered scope; a context window at its limit; tokens spent on retelling rather than working.
- **Fix:** the shared record stores **conclusions and state only** — owner, phase, decisions, evidence pointers — and stays under ~200 lines. Process chat stays in the working agent's own session. The coordinator re-sends the minimal necessary context per batch.
- **Owner:** Coordinator.
- **If it already happened:** stop; have the coordinator rebuild the record from current artifacts and evidence, then resume from the rebuilt record — do not resume from the transcript.

## 2. Hallucination contagion

- **Symptom:** one member's wrong output is repeated as fact by the others, and eventually appears in the handoff record.
- **Why:** shared memory accepts unverified writes.
- **Signal:** the same claim spreading while no one can name the command or file that proves it; "everyone agrees" with zero E1 evidence.
- **Fix:** partition shared memory. Entries become visible to the team **only after the coordinator marks them verified**. Unverified content stays quarantined with its source and a confidence note, and is never used as an input to a decision.
- **Owner:** Coordinator (verification marking), every writer (source labelling).
- **If it already happened:** trace the claim to its origin, mark it unverified, re-grade every downstream decision that depended on it, and correct the record. Assume any conclusion that cites it is E4 until re-run.

## 3. Coordination deadlock

- **Symptom:** A waits for B, B waits for C, C waits for A; the run hangs with no writes and no errors.
- **Why:** unbounded mutual waits and no arbitration.
- **Signal:** no state change for longer than the wait budget; several agents "waiting on approval"; a lock held by an agent that is blocked on another lock.
- **Fix:** queue resource and artifact requests in a **globally fixed order**; every wait carries a timeout (default 15 minutes) that escalates to the coordinator; the coordinator breaks ties by the conflict priority (user > record > rules).
- **Owner:** Coordinator.
- **If it already happened:** break the cycle at the coordinator — release the stale lock through a recorded recovery, reassign one side, and record the cycle and the break.

## 4. State divergence

- **Symptom:** two members disagree about the task's phase or owner; work is repeated, or a stage is skipped.
- **Why:** state lives in chat and in memory instead of one place.
- **Signal:** two different "current owners"; the same file edited twice; a phase reported as complete in one thread and in_progress in another.
- **Fix:** one source of truth — the shared task record and its stage machine. State changes are written to disk. Verbal, in-session, or implied state does not count. The queue mirrors the record and is reconciled to it.
- **Owner:** Coordinator.
- **If it already happened:** freeze writes, read the record, declare one owner, reconcile the queue, and diff the artifacts to find duplicated or conflicting edits before continuing.

## 5. Communication storm

- **Symptom:** members message each other directly; links and duplicated questions grow quadratically with headcount; nobody can reconstruct what was decided.
- **Why:** peer-to-peer coordination with no hub.
- **Signal:** message count rising faster than work output; the same question asked in several threads; decisions that exist only in a DM-like channel.
- **Fix:** **hub-and-spoke.** Members talk to the coordinator; the coordinator relays. Broadcast only for a genuine global change (ownership, scope, gate result).
- **Owner:** Coordinator.
- **If it already happened:** collapse the threads into one record entry; forbid side channels for dispatch; re-state the current owner and phase from the record.

## 6. Agent sprawl

- **Symptom:** roles are split until boundaries overlap, several agents "help" with the same file, and nobody owns the outcome.
- **Why:** adding agents feels like adding capacity; coordination cost is invisible.
- **Signal:** two agents with overlapping write scopes; a role that cannot name its deliverable; more agents than independent workstreams.
- **Fix:** **subtraction first.** A new role must justify why it cannot fold into an existing loop, and must own an end-to-end deliverable. One primary writer per resource, always.
- **Owner:** Coordinator.
- **If it already happened:** merge or retire overlapping roles, hand each deliverable to exactly one owner, and re-issue the task packet with the reduced team.

## 7. Dispatch left to LLM improvisation

- **Symptom:** the same task routes differently on two runs; work is slow, skipped, or sent to a worker with no capability for it.
- **Why:** a model is asked to *mechanically distribute* work instead of planning it.
- **Signal:** different owners for identical task state; dispatch with no rule to cite; tasks assigned by name rather than by score.
- **Fix:** make dispatch **deterministic**: board scan + fixed rules (capability tag, current phase, assignment order, lock state) produce the same command for the same state every time. The model plans and interprets; it does not improvise the distribution. Non-dispatchable state fails loudly with a non-zero exit.
- **Owner:** Coordinator / queue implementation.
- **If it already happened:** cancel the improvised assignment, re-derive the dispatch from the rules, and record which rule was bypassed.

## 8. No acceptance aggregation

- **Symptom:** every member delivers "their part", nobody assembles and checks the whole; defects surface only at integration or in the user's hands.
- **Why:** delivery is treated as the end of the pipeline.
- **Signal:** per-part "done" messages with no criterion-by-criterion mapping; no single artifact that answers every acceptance criterion.
- **Fix:** the coordinator runs an independent acceptance gate against **every** criterion with runtime evidence. A failing batch is returned whole to its responsible stage — not patched member by member. Do not accept an aggregate that was never assembled.
- **Owner:** Coordinator.
- **If it already happened:** treat the delivery as unverified, assemble the acceptance matrix, re-run the failed criteria, and report the true grade per criterion.

---

## Hard red lines

1. **Never let two members write the same file at the same time.** Not even for a one-line fix.
2. **Never start work or deliver outside the shared record and queue.** Work that exists only in a private session does not exist.
3. **Never treat "I think it is done" as done.** Runtime evidence is required, and it carries a grade (see `references/evidence-grading.md`).
4. **Never hand a task directly to another member in private.** All dispatch flows through the coordinator and is recorded.
5. **Never let the implementer verify itself** and call the result independent.
6. **Never execute an irreversible action without a recorded, scoped user approval.**
7. **Never let the queue overrule the user's latest instruction or the shared record.**

## Fast triage

| What you observe | Likely pitfall | First action |
|---|---|---|
| agents re-asking settled questions | 1 context explosion | rebuild the record |
| a claim spreading with no command behind it | 2 hallucination contagion | quarantine + re-grade |
| nothing changes, everyone waits | 3 deadlock | timeout + coordinator arbitration |
| two owners, duplicated edits | 4 state divergence | freeze writes, read the record |
| message volume outruns output | 5 communication storm | force hub-and-spoke |
| overlapping roles, unclear owner | 6 agent sprawl | subtract roles |
| same state routes differently | 7 improvised dispatch | re-derive from rules |
| parts done, whole unchecked | 8 no acceptance aggregation | assemble the acceptance matrix |