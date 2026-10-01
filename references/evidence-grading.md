# Evidence Grading

Every claim that work is done, verified, fixed, or passing must carry an explicit evidence grade. The grade says **who produced the evidence and whether it can be reproduced**, not how confident the author feels.

## 1. The four grades

| Grade | Meaning | Allowed wording |
|---|---|---|
| **E1 — reproducible evidence** | command output, exit code, hash, screenshot, URL response; another agent can rerun it and see the same thing | "verified: `<command>` exited 0, output ..." |
| **E2 — same-system peer check** | another agent in the same system re-ran it and supplied reproduction steps | "peer-checked by <agent> (steps attached): ..." |
| **E3 — self-assertion** | the author says it was checked or looks fine, with no reproducible artifact | "**self-checked, not independently verified**: ..." |
| **E4 — planned** | not executed yet; a plan, hypothesis, or intent | "planned verification: ..." |

Grades are about the *evidence*, not about the agent. A strong agent can only produce E3 when it did not run anything. A weak tool that prints a reproducible exit code produces E1.

## 2. Assigning the grade

Ask in order; the first "yes" sets the grade:

1. Did an agent that **did not author** the change reproduce it, and are the steps attached? -> **E2** (or **E1** if the artifact alone is sufficient for anyone to rerun it).
2. Is there an artifact anyone can replay without the author: command, exit code, key output, hash, URL status and body, screenshot, file bytes? -> **E1**.
3. Did the author merely inspect or reason about it? -> **E3**.
4. Is it still a plan? -> **E4**.

Two hard ceilings:

- **Same-system peer check is not independent verification.** Two agents of the same team, running the same tooling under the same rules, form one system. When the criterion genuinely requires independence, only the user or a tool outside the system can supply it. Say "same-system peer check" instead of "independently verified".
- **A grade cannot be inherited across a change.** New revision, new environment, or new code -> the old E1 is now E4 until rerun.

## 3. What E1 must contain

A minimal E1 record carries all of these:

| Field | Example |
|---|---|
| criterion | the acceptance criterion this proves |
| command | the exact command, with arguments |
| exit code | the literal exit status (not "it worked") |
| key output | the decisive lines, not the whole log |
| artifact | path, hash, screenshot, or URL plus response status |
| revision | baseline revision / commit / file hash the evidence applies to |
| author | who ran it |
| verifier | who reproduced it, or "none" |

If the exit code is missing, the result is not E1. If the artifact is stale relative to the current revision, the result is not E1.

## 4. Forbidden phrasings

- Presenting E3 in E1's voice: "verified" / "tested" / "confirmed" with no command, no exit code, no artifact.
- "Multiple agents looked at it" as a substitute for independence.
- "The scanner started" or "the report file exists" as proof of a passing gate. A started run and a written report are not a conclusion; the exit code and the parsed conclusion are.
- "Should work", "looks correct", "obviously fine" stated as a result.
- Carrying a previous round's "verified" into a new round after context compaction, session resume, or any edit to the verified artifact.
- Reporting a tool failure (transport error, quota, timeout) as either a pass or a finding. No conclusion is a third outcome; name it as such.

## 5. Re-verification triggers

Re-run and re-grade before restating any claim when any of these is true:

1. context was compacted, summarized, or the session resumed;
2. the verified artifact changed after the evidence was captured;
3. the environment, dependency, configuration, or credentials changed;
4. the baseline revision advanced (new commit, new file hash);
5. the evidence is older than the task's freshness window (default: the current task run);
6. the claim is about an irreversible action.

After any of these, the correct wording is "re-verified this round: <command> exited <code>" — or the honest E3/E4 fallback.

## 6. Recording

Write evidence once, in the shared task record and the queue's evidence field, in this shape:

```
criterion: acceptance-2 (no unrelated files changed)
command:   <verify command>
exit:      0
output:    <2-4 decisive lines>
artifact:  <path or URL>  hash: <hash>
revision:  <baseline revision>
grade:     E1
author:    implementer
verifier:  verifier-agent (reproduced, steps attached)
```

Rules for the record:

- Keep **who said it** separate from **what the evidence is**. "Agent X claims" and "command Y exited 0" are different facts.
- One criterion, one entry. A criterion with no entry is unverified, not passed.
- Record residual risk explicitly for anything left at E3/E4.

## 7. Evidence and approval are different gates

- **Irreversible actions** (deploy, publish, send, upload, delete, production or account change) require explicit user approval recorded in the queue **in addition to** evidence. E1 evidence is not authorization.
- **A passed verification is not a shipping authorization.** Shipping requires the approval record, scoped to the task and the action.
- The implementer never approves its own external action, and the verifier's PASS never substitutes for the user's decision.

## 8. Quick self-audit before any completion claim

1. Which grade is this claim?
2. If E1: what is the command, the exit code, and the revision?
3. Who ran it, and who reproduced it?
4. Is every acceptance criterion covered by its own entry?
5. Is anything irreversible still waiting for approval?

Any claim that cannot answer 1-4 is downgraded to E3 or E4 before it is written down.