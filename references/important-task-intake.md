# Important-Task Intake Gate

The intake gate is a **pre-flight question set**. It runs before the first write, the first dispatch, or the first verification of a task that matters, and it records how the work will be coordinated.

It decides **how** work is run. It is **not** permission to run it.

## 1. What counts as an important task

Treat a task as important when any of these is true:

- multi-file or architectural change;
- user-facing or product delivery (web page, app, customer-facing artifact);
- production, outreach, publish, deploy, upload, or send;
- data migration or deletion;
- permission, credential, or security-related change;
- an expensive scan or a cost-visible operation;
- cross-agent collaboration;
- the user calls it important, high-quality, or fully verified.

If the boundary is unclear, treat it as important. The cost of one extra question is lower than a mis-coordinated irreversible action.

Critical work is important work **plus** domain review and explicit human approval for irreversible steps.

## 2. The three questions

Ask the user. Record the answer. Never pre-select.

| # | Question | Choices | Default (only if the user explicitly says "you choose") |
|---|---|---|---|
| 1 | Execute solo, or start collaborative mode? | `single` / `collaborative` | `single` |
| 2 | Run the security scan, or skip it? | run / skip (recorded as `planned` / `skip`) | skip |
| 3 | Run an independent verification pass, or skip it? | run / skip (recorded as `planned` / `skip`) | skip |

Ask in plain words (run it / skip it); the queue records the mechanical value: yes -> `planned`, no -> `skip`. The recorded value, not the phrasing, is what the queue enforces.

Rules:

1. **All three are answered before the gate opens.** A partial answer keeps the task in intake.
2. **Never default on the user's behalf.** The defaults in the table apply only when the user explicitly delegates the choice; the delegation itself must be recorded.
3. **The user may answer "yes / no / default for this class from now on".** A standing default is itself a recorded decision: scope it (which class of task), date it, and re-confirm when the class changes.
4. **Read-only reconnaissance is allowed while the gate is closed.** Inspecting, listing, and scoring capabilities do not require the gate; writing, dispatching, and verifying do.
5. **The gate re-opens** if the task changes shape: a new subsystem, a new external action, a new domain criterion, or a new owner.

## 3. What each answer changes

| Answer | Effect on the run |
|---|---|
| `single` | one writer path; the coordinator may hold several roles; the result is labeled with its true evidence grade |
| `collaborative` | capability scoring, explicit role assignment, single-writer lock, and a verification worker that is not the implementer |
| security `planned` | a scan stage is scheduled into the plan. **`planned` does not start the scan**: starting it needs a second, explicit user confirmation, because scans cost money, time, and produce findings that block release |
| security `skip` | record the skip, the reason, and the owner of the residual risk. A skipped scan is never reported as "clean" |
| verification `planned` | the verify stage must be executed by an agent that did not implement the change; without one, the result is at most E2/E3 |
| verification `skip` | self-check only; every completion claim is capped at E3/E4 and must say "not independently verified" |

## 4. Enforcement

- The queue **refuses to create** an important task that omits any of the three choices. An unknown or misspelled value is also refused. A rejected creation is a non-zero exit, never a silent default.
- The recorded choices travel with the task and into every dispatch prompt, together with the constraint that a planned scan must not be started without a further confirmation.
- A task whose recorded mode contradicts the run (for example, `collaborative` recorded but one agent did everything) is a coordination defect: stop and reconcile before continuing.
- **L3 always states all three.** Rigor L3 means consequential - irreversible, published, deployed -
  so it is important by definition and the engine requires the three answers even when the caller
  never passed `--important`. A consequential task cannot silently default `security_scan` to skip.
- **A task with an external action always states all three.** `create --external-action <kind>` without
  `--execution-mode`, `--security` and `--independent-verify` is refused, because "nobody asked" must
  never mean "no scan, no independent verification" for something that leaves the machine.
- **Routine tasks may take the defaults, but the record says so.** They carry
  `startChoicesSource: 'defaults'` (versus `'stated'`) and the CLI prints
  `start choices assumed (single / skip / skip)` on stderr, so an assumed answer is never mistaken for
  a stated one.

## 5. What the gate does not authorize

- It is not consent to deploy, publish, send, upload, delete, or change production or accounts. Those need a separate approval record, per action and per scope (see `references/task-queue.md`, section 7).
- It is not consent to widen write scope, read secrets, or spend beyond the stated budget.
- It does not replace the evidence requirement: a collaborative run still needs criterion-linked E1 evidence; an important task with `verification: skip` is weaker, not stronger.

## 6. Recording format

Record the gate in the shared task record, and mirror it into the queue's task fields:

```json
{
  "task_id": "task-0001",
  "risk": "important",
  "intake": {
    "asked_at": "<timestamp>",
    "answered_by": "user",
    "execution_mode": "collaborative",
    "security_scan": "planned",
    "independent_verification": "planned",
    "notes": "scan starts only after a second confirmation"
  },
  "authorization": { "irreversible_actions_approved": false }
}
```

The `authorization` block stays false until a separate, scoped approval exists. Do not fold the intake answers into that block — they answer different questions.

## 7. Pre-flight checklist

1. Is this task important or critical by section 1? If unsure, yes.
2. Were all three questions asked and recorded verbatim, not paraphrased?
3. Did the user answer, or explicitly delegate the choice?
4. If a scan is planned, is the second confirmation still pending? Then the scan is not started.
5. Is every irreversible step still behind its own approval gate?
6. Is the verifier identity different from the implementer identity?