# Known findings

Every accepted defect lives here with a severity, an owner, a disposition and a review date.
A finding without a review date is an unowned risk; an empty register is a claim that none
exist, which is why the gate prints this file's review dates with the evidence record.

| ID | Severity | Finding | Disposition | Owner | Review by |
|---|---|---|---|---|---|
| F-001 | medium | `dispatch` renders a POSIX shell command; quoting is not correct for cmd.exe. Mitigated by printing the argv array alongside, but the rendered string is still POSIX-only. | accept, documented in `scripts/orchestrator/README.md`; prefer the argv form | maintainer | 2026-12-01 |
| F-002 | low | The config lint parses YAML line-by-line rather than with a full parser, so exotic YAML (deep nesting, anchors) could be misread. | accept: the file is linted and its values are checked against engine enums, so a misread surfaces as a failed check | maintainer | 2026-12-01 |
| F-003 | low | `approve` and `override` record the approver's name but do not authenticate it. | accept: the queue is a local file under the operator's control; attribution is by convention | maintainer | 2026-12-01 |
| F-004 | low | `recover` does not check that the caller owns the stranded lock. | accept: recovery is a coordinator action and is recorded as an event | maintainer | 2026-12-01 |
| F-005 | low | Roster and route lookups use plain objects, so a crafted name such as `constructor` can resolve through the prototype chain. | open: use a null-prototype map and `Object.hasOwn` | maintainer | 2026-11-15 |
| F-006 | low | Verifier independence is structural (a different agent id) but not contextual: two agents on the same model route share failure modes. | accept with disclosure: `references/verification-standard.md` section 5 requires it be reported as weaker than "independent" | maintainer | 2027-01-01 |
| F-008 | low | Meta-discourse in which collaboration is the TOPIC rather than the action engages: producing it ("写一篇关于 AI 助手如何协同的文章", "做 AI 一起协作的调研") and also editing it ("删掉关于 AI 助手协同的注释"). The sentence really does contain an agent subject and an act of coordinating, just pointed at prose instead of work. | accept: the consequence is a needless skill load, not a reorganised workflow, and the host routes on the description. Asserted by a test so it cannot change silently; revisit if a topic-level signal becomes reliable. | maintainer | 2027-01-01 |
| F-007 | low | The activation layer is a deterministic filter, not an intent model. Engagement requires an agent-ish subject plus an act of coordinating, with a comparison veto on top; unusual phrasings (multi-model voting, heavy dialect, languages whose terms are absent) can therefore stay silent. | accept as the designed failure direction: a missed phrase costs a nudge, a false engage reorganises unrelated work. Explicit invocation always wins, and the frontmatter description is what the host routes on. Three verification rounds produced 25 cases, all now permanent tests. | maintainer | 2027-01-01 |
