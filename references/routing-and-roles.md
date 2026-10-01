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

## 2. Capability scoring and the roster

Discover routing metadata only: agent id, model, tools, read/write permissions, specialties, cost tier, availability. If introspection is unavailable, request a compact capability manifest (see `references/agent-manifest.schema.json`).

### 2.1 The roster is data

A **roster** answers who can do what, how well, and at what cost. It is validated when the queue is created and stored inside the queue state, so routing is reproducible from the state file alone:

```js
{
  agents: {
    <id>: {
      cost,                          // number; lower wins a tie
      available,                     // boolean; false parks an agent without deleting it
      specialties: [<capability>],   // labels: full | web | complex | verify | environment
      scores: {                      // 0..3 per role
        specify, triage, implement, verify, evidence, environment
      }
    }
  },
  routes: {                          // optional explicit owners
    specify?, evidence?, triage?,
    implement?: { <task type>: <id> }
  }
}
```

- `scores` is keyed by **role**. The allowed roles are `specify`, `triage`, `implement`, `verify`, `evidence`, `environment`; a role key that is absent counts as 0.
- An unknown role name, a score outside 0-3, a non-numeric `cost`, a non-boolean `available`, a non-array `specialties`, or a roster with **zero agents** is rejected loudly at creation. A malformed roster never silently downgrades routing.
- `routes` is optional. A role named there is used when that agent exists and is not parked (`available: false`); otherwise resolution falls back to the scores. `routes.implement` is keyed by task type (`build`, `web`, `complex`, `verify`, `environment`).
- Validation accepts any number of agents (one or more); team policy sets a higher bar for *automatic* routing (section 2.4).

### 2.2 What the scores mean

Score each available agent for each role from 0 to 3:

| Score | Meaning |
|---|---|
| 3 | direct tool for the job, with repeated prior evidence |
| 2 | plausible for the job, with some evidence |
| 1 | indirect path, or no evidence yet |
| 0 | tool missing, permission missing, or forbidden by policy |

A score describes capability for a **role**, never an identity: an agent called anything at all can hold any role.

### 2.3 Selection is deterministic

`selectAgent(role, { roster, exclude, capability })` returns `{ id, score, specialty, cost }` or `null`, ordered by:

1. **highest `scores[role]`**;
2. then a **capability match** - the agent's `specialties` contains the task's capability label;
3. then **lower `cost`**;
4. then the **agent id in lexicographic order**: a stable final tiebreak, so the same roster and the same task always route the same way and no model improvisation enters the decision.

Agents with `available: false` and every id in `exclude` are removed before ranking. `ownerFor(role, { roster, type, capability, exclude })` honours an explicit `routes` entry first and otherwise returns `selectAgent`. For implementation, `implementerForType(type, roster)` derives the capability label from the task type (`build` -> `full`, `web` -> `web`, `complex` -> `complex`, `verify` -> `verify`, `environment` -> `environment`) and applies the same ranking.

Human judgement still covers what the roster cannot express - lower contention, availability, prior evidence on the same revision (section 2.6) - but it never overrides the four keys above.

### 2.4 The roster can be any size

Nothing in the mechanism depends on a roster having a particular size or particular names:

| Roster | Accepted | Note |
|---|---|---|
| 3 agents | yes | the default roster (`generalist`, `frontend`, `specialist`) |
| 5 agents | yes | e.g. a coordinator, two builders, an auditor and a scribe |
| 12 agents | yes | ranking is linear per stage and needs no code change |
| 1-2 agents | yes by validation | but see the automatic-routing gate below |

- **Validation floor:** at least one agent. A roster that declares none is refused.
- **Automatic-routing floor (policy, not code):** `minimum_agents_for_auto_routing: 3` in `config/agents.example.yaml`. Below three distinct available agents, ask the user for manual assignments and record the request in the shared task record instead of auto-routing. A one-agent roster is still legitimate for a solo run in which the user does the routing.
- **Fail closed:** if no agent can own a stage, the task is refused (`No agent in the roster can own the <stage> stage`) rather than routed by accident.

### 2.5 Adding an agent

Adding an agent is a **data edit, not a code change**:

1. declare the id under `agents`;
2. give it `cost`, `available`, `specialties`, and a 0-3 score for each role it may hold;
3. optionally name it in `routes` if it should own a stage outright;
4. install or re-validate the roster (`init --roster <file.json>` prints the accepted agent ids);
5. re-check which stage owner the scores now produce - a new agent can take a stage away from the previous owner.

### 2.6 Gates

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

How much independence is required is set by **rigor**, which the task states and the engine stores
(see `references/verification-standard.md`): L1 may be self-checked; **L2 must be verified by a different
agent**; **L3 must be verified by an agent that took no part in the work at all** - producing evidence on
the task counts as taking part - and L3 cannot reach `done` without E1 evidence.

An agent that wrote the implementation cannot certify it. Its self-check is graded E3, never a verification result (see `references/evidence-grading.md`).

### 5.1 Choosing the verifier

The verifier is the **highest-scoring eligible agent for the `verify` role**, chosen by the same deterministic ranking as every other role (section 2.3):

- the implementer is **hard-excluded**: `selectVerifier(implementer, roster, { capability })` removes that id before ranking, so the implementer is never returned even when it holds the best score;
- a capability match, then lower `cost`, then the lexicographic agent id settle ties;
- **it fails closed.** If nobody is eligible, verification cannot be assigned. If the best eligible candidate has a `verify` score of **0**, the run stops with an error instead of pretending that an unscored agent can verify: fix the roster (score an agent 1 or more) or assign the verifier explicitly. `verifierFor(implementer)` is the convenience wrapper over the default roster.

Mechanics:

1. Before the verify stage, compare the verifier's identity with the identity recorded for the implement stage.
2. If they are the same agent, reassign verification to the next eligible agent by the section 2 order.
3. If no independent agent exists, do not fabricate one: record the result at its true grade (`same-system peer check` or `self-asserted`) and state explicitly that it is **not independently verified**.
4. The verification worker reports findings; the coordinator decides acceptance. A verifier that both finds and dismisses its own finding has certified itself.
5. Verification passing is **not** authorization to ship. Irreversible actions still require the approval gate (section 7 of `references/task-queue.md`).

### 5.2 The gate: fail, pass, override

Completing the `verify` stage **is** the PASS: the record is stamped `status: passed`, `blocked: false`, `lastResult: pass`, `attempts + 1`, with the verifier and the timestamp. A verifier that cannot reproduce a criterion records a **failure** instead:

- `failVerification(state, id, agent, { criteria | findings })` - only in the `verify` stage, and only by the agent holding the lock (the verifier). It must state **what failed** (at least one of `criteria` or `findings`), and the verifier never fixes the work itself. The record becomes `status: failed`, `blocked: true`, `lastResult: fail`, `attempts + 1`, the lock is released, and the task returns to `implement` under the roster's implementer.
- While the gate is blocked the task can neither reach `done` nor be dispatched to `evidence` (the two interception points in `references/task-queue.md`, section 3.1).
- `overrideVerificationGate(state, id, { approvedBy, scope, reason })` is the deliberate, auditable exception. **All three fields are required**, and an override is only accepted while the gate is `blocked`. It clears `blocked` but **keeps `status: failed`** and stores the override beside it, so the record still shows who approved, for what scope, and why. The failure is never erased.

An override is a decision, not evidence. It does not upgrade the verification grade, and it does not authorize irreversible actions.

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