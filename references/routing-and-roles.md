# Routing and Roles

Capability-first routing assigns work from *measured* capability, never from an agent's name, vendor, model brand, or chat history. This file defines the roles, the ownership boundary, the independence constraint, the failure/fallback order, and the conflict priority that all other reference files assume.

## 1. The five roles

| Role | Owns | May write | Must not |
|---|---|---|---|
| **Coordinator** | decomposition, task packet, shared state, conflict resolution, evidence aggregation, acceptance mapping | the shared task record, the task queue, coordination artifacts | edit coordinated resources unless it also holds the writer lock for them |
| **Implementation Worker** | the change itself | only resources inside the task's declared write scope | verify its own work; widen scope; dispatch other agents privately |
| **Verification Worker** | independent reproduction, boundary and regression checks, adversarial probing | isolated test scripts and reports, findings | modify the implementation under test; certify its own findings as final |
| **Environment Specialist** | runtime, MCP, build, toolchain, permission and config diagnosis | the minimum configuration needed to restore the environment; a scoped patch | rewrite product code to route around a broken environment |
| **Domain Reviewer** | UX, content, security, legal, accessibility or other domain criteria | criteria-linked findings and isolated artifacts | sign off on work it implemented; override the coordinator's acceptance |

Role rules:

1. **Never infer a role from an identity.** An agent is eligible for a role only after it is scored (section 2) or explicitly assigned by the user.
2. **A role is a responsibility, not a permission.** Holding a role never grants write access beyond the task's declared write scope.
3. **Role collapse is allowed only for routine work.** Routine work may seat several roles in one agent. Important work requires a verification worker that is not the implementer. Critical work additionally requires a domain reviewer and explicit human approval for irreversible actions.
4. **Every role owns an end-to-end deliverable**, not a fragment. A role that cannot name its deliverable is not a role — it is a chat participant.

## 2. Capability scoring (before assigning anything)

Discover routing metadata only: agent id, model, tools, read/write permissions, specialties, cost tier, availability. If introspection is unavailable, request a compact capability manifest (see `references/agent-manifest.schema.json`).

Score each available agent for each role from 0 to 3:

| Score | Meaning |
|---|---|
| 3 | direct tool for the job, with repeated prior evidence |
| 2 | plausible for the job, with some evidence |
| 1 | indirect path, or no evidence yet |
| 0 | tool missing, permission missing, or forbidden by policy |

Selection order, applied in this sequence:

1. highest score;
2. lower cost tier;
3. lower contention (fewer owned resources, no lock conflicts);
4. availability and prior evidence on the same revision;
5. never arbitrary order, seniority, or arrival time.

Gates:

- **Automatic routing requires at least three distinct available agents.** With fewer, ask the user for manual assignments and record the request in the shared task record.
- **Availability is a snapshot, not a promise.** Re-check availability if more than one stage has elapsed since discovery.
- **Re-score when the task changes shape** (new subsystem, new external action, new domain criterion). A stale score is not evidence.

## 3. Assignment map

| Work | Default role | Required evidence at handoff |
|---|---|---|
| requirements, scope, acceptance criteria | Coordinator | task packet with definition of done |
| code or file changes | Implementation Worker | diff, changed-file list, commands, exit codes |
| runtime, API, regression or adversarial checks | Verification Worker | reproducible command output, findings list |
| build, MCP, model-routing or permission failures | Environment Specialist | diagnostic output, scoped fix, version/config proof |
| UX, content, security, legal, accessibility | Domain Reviewer | criteria-linked findings with severity |
| evidence aggregation and acceptance mapping | Coordinator | criterion-by-criterion mapping + residual risk |

## 4. Single-writer ownership

- **One primary writer per file or resource at any time.** Everyone else is read-only, or writes isolated artifacts (tests, reports, scratch outputs) that never overwrite the writer's resources.
- **Take the lock before the first write.** If the resource is already locked by another agent, stop; do not "merge carefully" and do not edit in parallel.
- **A handoff record is required to move ownership.** It contains: resource, previous owner, new owner, reason, baseline revision, and the next check to run. Ownership without a record is a conflict, not a handoff.
- **On conflict, stop and follow the human-readable task record.** Never resolve an ownership conflict by writing faster.
- **Reviewers may promote themselves to writers only through a recorded handoff**, and only after the previous owner has released the lock.

## 5. Verifier != implementer (hard constraint)

An agent that wrote the implementation cannot certify it. Its self-check is graded E3, never a verification result (see `references/evidence-grading.md`).

Mechanics:

1. Before the verify stage, compare the verifier's identity with the identity recorded for the implement stage.
2. If they are the same agent, reassign verification to the next eligible agent by the section 2 order.
3. If no independent agent exists, do not fabricate one: record the result at its true grade (`same-system peer check` or `self-asserted`) and state explicitly that it is **not independently verified**.
4. The verification worker reports findings; the coordinator decides acceptance. A verifier that both finds and dismisses its own finding has certified itself.
5. Verification passing is **not** authorization to ship. Irreversible actions still require the approval gate.

## 6. Failure, fallback and escalation order

Apply the first matching row; record the trigger and the action in the shared task record.

| Trigger | Action | Must not |
|---|---|---|
| implementation blocked by environment/tooling | route to the Environment Specialist; if unavailable, record the limitation and the fallback command | silently skip the blocked check |
| implementation fails twice in the same stage | escalate one model/capability tier, or hand the task to the next-highest-scoring implementation worker with a recorded handoff | retry the same plan a third time unchanged |
| verification FAIL | return the task to `implement` with the failing criteria attached; the verifier does not fix it | advance to evidence with an open release-blocking finding |
| verifier and implementer are the same agent | reassign to a different agent, or downgrade the claim to E2/E3 | present a self-check as independent verification |
| fewer than three available agents | ask the user for manual role assignment and record the answer | auto-route anyway |
| a required specialist is unavailable and the criterion depends on it | mark the criterion unverified; keep the task open | mark it passed by analogy |
| user instruction contradicts the queue or these rules | follow the user, then update the record; reconcile the queue afterwards | let the queue overrule the user |

## 7. Conflict priority

`user's latest instruction  >  shared handoff record  >  team rules / task queue`

- The **user's latest instruction** always wins, including a change of owner or scope mid-task.
- The **shared handoff record** (the human-readable task record) holds intent: current owner, current step, next action, evidence. When it disagrees with the machine queue, the record wins.
- **Team rules and the queue** govern mechanics (stages, locks, dispatch). They never override intent.
- After any conflict resolution, write the discrepancy and the resolution into the record so the next agent does not re-litigate it.

## 8. Stop conditions

Stop the stage and escalate to the coordinator when any of these is true:

- ownership conflict or a lock held by an unknown owner;
- no recoverable baseline before a risky edit;
- material ambiguity in scope, acceptance criteria, or permissions;
- a release-blocking finding that no owner has accepted;
- a completion claim without criterion-linked evidence;
- a request for secrets, credentials, or elevated access that the user has not granted;
- an external or irreversible action without a recorded approval.

Stopping is a valid outcome. Proceeding through a stop condition is a defect.