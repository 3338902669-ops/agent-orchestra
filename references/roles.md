# Capability-Based Role Assignment

Quick card for assigning roles. Full definitions, ownership rules, fallback order, and conflict priority are in `references/routing-and-roles.md`.

## Score, do not assume

Score each available agent for each role from 0 to 3: 3 means a direct tool and repeated evidence; 2 plausible with evidence; 1 indirect or unverified; 0 unavailable or forbidden.

Choose the highest score, then prefer lower cost and lower contention. Break ties by availability and prior evidence — never by name, vendor, seniority, or arbitrary order.

Automatic routing needs at least three distinct available agents; with fewer, ask the user to assign roles manually.

## The five roles

| Role | Owns | Writes |
|---|---|---|
| Coordinator | decomposition, task packet, state, conflict resolution, acceptance mapping | the shared task record and queue |
| Implementation Worker | the change | only files inside the task's write scope |
| Verification Worker | independent reproduction, boundary and regression checks | isolated tests/reports |
| Environment Specialist | runtime, MCP, build, toolchain, config diagnosis | minimal config, scoped patch |
| Domain Reviewer | UX, content, security, legal, accessibility criteria | criteria-linked findings |

Never infer a role from an agent's identity. A role is a responsibility, not a write permission.

## Assignment map

| Work | Preferred role | Evidence |
|---|---|---|
| requirements | coordinator | task packet |
| code or file changes | implementation worker | diff and changed-file list |
| runtime or API checks | verification worker | reproducible output |
| build or MCP failures | environment specialist | diagnostic and scoped fix |
| UX/content/security/domain | domain reviewer | criteria-linked findings |

## Ownership and independence

- **One primary writer per file or resource.** Reviewers write only isolated artifacts unless a recorded handoff promotes them.
- A handoff records old owner, new owner, reason, baseline revision, and next check.
- **Verifier != implementer.** An agent that wrote the change cannot certify it; its self-check is E3, not a verification result. If no independent agent exists, say "same-system peer check" or "self-asserted" — never "independently verified".
- Routine work may collapse roles into one agent. Important work requires an independent verifier; critical work adds a domain reviewer and human approval for irreversible actions.

## Conflict

`user's latest instruction > shared handoff record > team rules / queue`. On an ownership conflict, stop and follow the record.

See also `references/evidence-grading.md` and `references/task-queue.md`.