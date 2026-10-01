# Protocol conformance

Every MUST in [AGENT-ORCHESTRA-PROTOCOL.md](AGENT-ORCHESTRA-PROTOCOL.md) mapped to the code that
enforces it and the test that pins it. **This table is machine-checked** by
`scripts/check-conformance.mjs`, which fails if a reference does not resolve, if an ENFORCED row
has no enforcement point or no test, or if this file has drifted from `conformance.json`.

| ID | Contract | Requirement | Status | Enforced by | Pinned by |
|---|---|---|---|---|---|
| T1 | Task | A task MUST declare a type, a rigor level and an owner at every stage | ENFORCED | `createTask`, `ownerFor` | test: `a new task is queued in specify and owned by the coordinator` |
| T2 | Task | specify MUST NOT end without a spec and an acceptance criterion | ENFORCED | `completeStage` | test: `the specify stage cannot end without a spec and an acceptance criterion` |
| T3 | Task | A task carrying an external action MUST be L3 | ENFORCED | `createTask` | test: `an external action must be L3 - L1 and L2 are both refused` |
| T4 | Task | An L3 task MUST answer the three intake questions even without --important | ENFORCED | `createTask` | test: `an L3 task must state the three start choices, even without --important` |
| R1 | Resource | No two live tasks may hold an overlapping resource | ENFORCED | `claimTask` | test: `a resource held by a live task cannot be claimed by another task` |
| R2 | Resource | A refused claim MUST name the resource and its holder | ENFORCED | `claimTask` | test: `a resource held by a live task cannot be claimed by another task` |
| R3 | Resource | A resource lock is held for a stage, not for the life of the task | ENFORCED | `completeStage` | test: `claim and complete release the lock between stages` |
| O1 | Ownership | Exactly one agent holds a task; only the holder may act on it | ENFORCED | `requireOwner` | test: `a held lock rejects a second agent` |
| O2 | Ownership | A stale lock MUST be recoverable, and the recovery recorded | ENFORCED | `recoverTask` | test: `recover clears a stranded lock, keeps the phase and re-queues the task` |
| O3 | Ownership | State MUST be written atomically under an exclusive lock | ENFORCED | `scripts/orchestrator/orchestrator.mjs` | test: `four concurrent creates: every task survives (no lost update)` |
| O4 | Ownership | Roster lookups MUST use own properties, not the prototype chain | ENFORCED | `namedOwner` | test: `a route named after a prototype member is ignored, not resolved` |
| H1 | Handoff | The record MUST carry status, owner, current step, next step and evidence | ENFORCED | `scripts/check-handoff.mjs` | test: `a missing field fails: a successor cannot resume without it` |
| H2 | Handoff | The precedence claim MUST be positive; a negated one MUST be refused | ENFORCED | `scripts/check-handoff.mjs` | test: `a negated precedence claim does not satisfy the requirement` |
| H3 | Handoff | The record outranks the queue at runtime | DOCUMENTED ONLY | - | - |
| V1 | Verification | The verifier MUST NOT be the implementer at L2 and L3 | ENFORCED | `selectVerifier` | test: `the verifier is never the implementer (every type)` |
| V2 | Verification | An important task MUST NOT self-verify at any level | ENFORCED | `completeStage` | test: `an important task may not self-verify, even at L1` |
| V3 | Verification | A verification PASS MUST arrive with criterion-linked evidence | ENFORCED | `completeStage` | test: `a verification PASS must carry its witness` |
| V4 | Verification | A failed verification MUST block done and dispatch to evidence | ENFORCED | `failVerification`, `nextDispatch` | test: `the gate cannot be walked past: no done without a pass or an override` |
| V5 | Verification | At L3 the verifier MUST NOT be an author of the task's evidence | ENFORCED | `completeStage` | test: `an L3 verifier may not also be an author of the evidence` |
| V6 | Verification | Consequential work MUST pass a domain review by a domain-qualified third party | ENFORCED | `selectDomainReviewer` | test: `an L3 task refuses to run when no domain-qualified third party exists` |
| E1 | Evidence | E1 MUST carry a command, an exit code and a revision | ENFORCED | `normalizeEvidence` | test: `E1 evidence carrying explicit nulls is refused, not just undefined` |
| E2 | Evidence | E2 MUST name a peer, and the peer MUST NOT be the author | ENFORCED | `normalizeEvidence` | test: `E2 must name a peer, and the peer must not be the author` |
| E3 | Evidence | An ungraded sentence MUST be recorded as E3 with a note | ENFORCED | `normalizeEvidence` | test: `a bare evidence string is stored as E3 and labelled, never as E1` |
| E4 | Evidence | E4 MUST say what is planned | ENFORCED | `normalizeEvidence` | test: `E4 must say what is planned` |
| E5 | Evidence | The per-level floor: L1 any grade, L2 E1/E2, L3 E1 | ENFORCED | `completeStage` | test: `L2 requires E1 or E2 evidence: a self-report cannot close it` |
| E6 | Evidence | E1 attests that the command actually ran | OUT OF SCOPE | - | - |
| A1 | Approval | An external action at its step MUST NOT be dispatched before approval | ENFORCED | `nextDispatch` | test: `an unapproved external action blocks its own step, not the internal stages` |
| A2 | Approval | The approval scope MUST equal the action's target | ENFORCED | `nextDispatch` | test: `an approval scope must EQUAL the action target, not merely appear in it` |
| A3 | Approval | An approval MUST record an approver and a scope | ENFORCED | `approveExternalAction` | test: `approval requires both approvedBy and scope` |
| A4 | Approval | The approver's identity is authenticated | OUT OF SCOPE | - | - |
| C1 | Recovery | Three failed verifications MUST block the task | ENFORCED | `failVerification` | test: `three failed verifications block the task instead of retrying forever` |
| C2 | Recovery | A blocked task MUST refuse claims, completions and approvals | ENFORCED | `claimTask`, `completeStage` | test: `a blocked task refuses claim, complete and approve` |
| C3 | Recovery | Recovery MUST be explicit and MUST state a reason | ENFORCED | `recoverTask` | test: `recover requires a reason and refuses unrecoverable tasks` |
| C4 | Recovery | A non-dispatchable task MUST NOT be reported as success | ENFORCED | `nextDispatch` | test: `dispatch throws for non-dispatchable tasks` |
| X1 | Activation | Engagement MUST require a curated keyword and an act of coordinating | ENFORCED | `scripts/detect-trigger.mjs` | test: `activation engages on how people describe the problem` |
| X2 | Activation | A comparison or evaluation request MUST NOT auto-engage | ENFORCED | `scripts/detect-trigger.mjs` | test: `activation stays silent on ordinary requests that share a word` |
| X3 | Activation | Ambiguous phrasing MUST be surfaced, not guessed | ENFORCED | `scripts/detect-trigger.mjs` | test: `ambiguous requests are surfaced as POSSIBLE, never guessed` |
| G1 | Gate | The gate MUST inject known faults and reject every one | ENFORCED | `scripts/gate.mjs` | gate mutation: the description becomes a plain scalar containing a colon (the GitHub YAML error) |
| G2 | Gate | SKILL.md frontmatter MUST parse, not merely contain the keys | ENFORCED | `scripts/check-frontmatter.mjs` | gate mutation: the description becomes a plain scalar containing a colon (the GitHub YAML error) |
| G3 | Gate | Shipped text files MUST be LF so scripts run where they are unpacked | ENFORCED | `scripts/gate.mjs` | gate mutation: a shipped file reverts to CRLF |
| G4 | Gate | The published artifact MUST be LF-clean, executable, complete, and MUST NOT name the repository | ENFORCED | `scripts/check-artifact.mjs` | gate mutation: artifact |

**41 requirements: 38 ENFORCED, 1 DOCUMENTED ONLY, 2 OUT OF SCOPE.**

The two OUT OF SCOPE rows are the honest boundary of a local, dependency-free runtime, and they
are registered in KNOWN-FINDINGS.md rather than implied: E1 is a structural claim rather than
provenance (F-012), and the queue is a ledger rather than an authorisation server (F-003, F-011).
