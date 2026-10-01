# Protocol benchmark

Three coordination models, six failure modes, scripted actors, no LLM calls.

| Failure mode | What is counted | Single agent | Naive multi-agent | Agent Orchestra |
|---|---|---|---|---|
| Two agents write the same resource | conflicting writes that landed | 1 | 1 | 0 |
| The author declares the work done with no evidence | self-declared successes accepted | 1 | 1 | 0 |
| The implementer verifies its own work | self-verifications accepted | 1 | 1 | 0 |
| Verification keeps failing | attempts before the loop stops | 25 | 25 | 3 |
| A deploy is attempted without approval | unapproved external actions dispatched | 1 | 1 | 0 |
| A failed verification is followed by a claim of success | failures that reached done | 1 | 1 | 0 |

Every non-zero value in the Agent Orchestra column is a rule that did NOT hold. Each refusal:

- Task task-0002 cannot claim: resource already held by src/foo.ts (task task-0001, held by generalist)
- Task task-0001: verification cannot PASS without criterion-linked evidence. Pass --evidence (and --evidence-grade with the command, exit code and revision for E
- Task task-0001 is assigned to specialist, not generalist
- Task task-0001 carries an external action (deploy) that is not approved. Record one with: approve --task task-0001 --by <who> --scope <what>
- Task task-0001: the approval scope ("staging only") does not cover "production". Approve the action you are about to run.
- Task task-0001 is gated: verification failed and no override is recorded, so it cannot be dispatched to evidence
