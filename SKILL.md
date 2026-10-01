---
name: agent-orchestra
description: Use when three or more AI agents are available and a task needs coordinated execution, or when work must be handed to another agent, session or tool. Ships capability-scored role assignment from a roster of any size (any agent names), single-writer ownership, a verification gate run by the best-suited agent that cannot be walked past, a shared handoff record, evidence-graded completion, a dependency-free task-queue CLI, an important-task intake gate, and a coordination anti-pattern guide. Activation is configurable: global, keyword-triggered, or manual.

Do not use for: container or infrastructure orchestration (k8s, docker-compose, service meshes), ordinary job queues and schedulers, comparing or evaluating AI models against each other, or splitting work between people. Those share vocabulary with this skill and none of them is multi-agent coordination.
---

# Agent Orchestra

One protocol for two axes of multi-agent work:

- **In-task coordination** - who does what right now, who may write, who verifies, and what counts as done.
- **Cross-session handoff** - how the state survives when the work moves to another agent, another session or another tool.

Both axes share the same hard rules: one writer per resource, a verifier that is never the implementer, graded evidence, and a shared record that outranks any scheduler. It makes coordination failures visible and recoverable. It cannot promise infallibility, and it never replaces user authorization.

> 中文：一套协议覆盖两条轴 —— **同批任务内怎么分工**，以及**跨会话/跨工具怎么交接**。两条轴共用同一套硬规则：单写入者、核验者≠实现者、分级证据、共享记录优先于调度器。

## Activation (when to use this skill)

Configure in `config/agents.example.yaml` under `activation:`.

| mode | behavior | token cost |
|---|---|---|
| global | engages for every task | highest (always loaded) |
| keyword | engages only when task text matches keywords | default; low |
| manual | engages only when the user explicitly invokes it | lowest |

1. Read the activation block from `config/agents.example.yaml`.
2. global -> engage. manual -> engage only when the user asked for multi-agent work or a handoff.
3. keyword -> run `node scripts/detect-trigger.mjs --text "<task text>"`. Exit 0 (ENGAGED) means use this skill; 1 (NOT_ENGAGED) means do not. Exclude keywords, and the sentence-level comparison veto, win over any hit.

What the keyword layer is, honestly: a **conservative deterministic filter**, not a full
understanding of intent. It matches unambiguous phrases plus intent patterns, and it refuses to
engage when the request is really a comparison of models or a split between people - those share
the vocabulary and none of them is coordination. Being wrong in the other direction costs one
missed phrase, so it is tuned to stay silent when unsure rather than to fire on a lookalike. The
description above is what the host model routes on, and an explicit request always wins: if a
user says to use this skill, no keyword check applies.

> 中文：关键词层是**保守的确定性过滤器**，不是万能的意图理解。命中明确词组与意图正则，同时句级否决「模型对比评测」「人的分工」这类同词不同义的请求；不确定时宁可沉默也不误召。真正的路由依据是上面的 description，且**用户明确要求使用时，一律优先**。

## Seven non-negotiables

1. **One primary writer per file or resource.** Everyone else is read-only or writes isolated artifacts until a recorded handoff promotes them.
2. **Verifier != implementer.** The verifier is the best-suited eligible agent by capability score, never a fixed name, and never the agent who wrote the code. A self-check is E3, not a verification result.
3. **The verification gate cannot be walked past.** A failed verification returns the task to `implement`; the task can then neither reach `done` nor be dispatched to `evidence` until a verify passes or a human records an override with an approver, a scope and a reason. The failed result stays on the record.
4. **Read before acting; resume instead of redoing; write progress down before switching.** Any agent picking up a task reads the shared record first and continues from the recorded step.
5. **No completion claim without criterion-linked evidence.** "I checked" is not evidence. See `references/evidence-grading.md`.
6. **Irreversible actions need separate, explicit user approval.** Deploy, publish, send, upload, delete, account changes: the approval is recorded (`orchestrator.mjs approve`). *A passed verification is not a shipping authorization.*
7. **The human-readable shared record outranks the queue.** If the record and the queue disagree, stop and follow the record; the queue is a scheduler, not the authority on intent.

> 中文对照：① 一个文件同一时刻只有一个主写入者；② 核验者由能力评分选出、绝不是实现者；③ 核验门禁不可绕过（失败即退回，复验通过或带署名覆盖才放行）；④ 先读再动、接续不重做、切换前留痕；⑤ 完成必须附可复现证据；⑥ 不可逆动作需单独授权；⑦ 共享记录优先于队列。

## Important-task intake gate

Before the **first write, first dispatch or first verification** of an important task, ask the user and record three choices - never default them:

1. Execute solo, or start collaborative mode?
2. Run the security scan, or skip it?
3. Run an independent verification pass, or skip it?

"Important" includes at least: multi-file or architectural change, user-facing/product delivery, production/outreach/publish/deploy, data migration or deletion, permission/credential/security change, costly scanning, cross-agent collaboration, or any task the user calls high-quality/fully verified. When the boundary is unclear, treat it as important.

The gate decides *how* work is coordinated. It does **not** authorize irreversible actions. See `references/important-task-intake.md`.

> 中文：重要任务在首次写入/派发/核验前必须问用户三件事（单独还是协作、是否安全扫描、是否独立核验）并留档，不得替用户默认勾选；这三问只决定协作方式，不替代不可逆动作的授权。

## Fast path

1. Inventory each agent's tools, model, workspace, permissions, specialties, cost tier and availability.
2. Score capabilities against roles; never infer a role from an agent's name.
3. Classify the task: routine / important / critical.
4. Write a compact task packet: objective, non-goals, ownership, risks, acceptance tests, owner, verifier.
5. Take the ownership lock before editing.
6. Run the pipeline `specify -> implement -> verify -> evidence -> done`; important work requires an independent verifier, critical work adds domain review and approval.
7. Stop on failed gates, ownership conflicts, missing evidence or unapproved external actions.

## Roster: three or more agents, any names

Roles are assigned from a **roster**, which is data, not code. Three agents work; so do five, eight or twelve, and the agents can be called anything at all - nothing depends on an agent being named `coordinator` or `verifier`:

```yaml
agents:
  planner: { cost: 2, specialties: [],       scores: { specify: 3, implement: 1, verify: 1, evidence: 3 } }
  builder: { cost: 4, specialties: [full],   scores: { specify: 1, implement: 3, verify: 1, evidence: 1 } }
  webhand: { cost: 5, specialties: [web],    scores: { specify: 1, implement: 2, verify: 1, evidence: 1 } }
  auditor: { cost: 6, specialties: [verify], scores: { specify: 1, implement: 1, verify: 3, evidence: 2 } }
  scribe:  { cost: 1, specialties: [],       scores: { specify: 1, implement: 1, verify: 0, evidence: 3 } }
routes:                      # optional: anything omitted is resolved by score
  specify: planner
  evidence: scribe
  implement: { build: builder, web: webhand }
```

- Scores are 0-3 per role. Selection is deterministic and reproducible: **highest score -> capability match in `specialties` -> lower `cost` -> agent id order**. `available: false` parks an agent without deleting it.
- Stage owners come from `routes` when the roster names one, otherwise from the score. A roster that can fill no agent for a stage is rejected loudly, never routed by accident.
- Install a roster of your own with `orchestrator.mjs init --roster <file.json>`. Adding an agent is a data edit: declare it, score it, it joins selection.

> 中文：花名册是**数据**，不是代码 —— 3 个、5 个、12 个都行，名字随便起；选人顺序是「分数高 → 能力标签命中 → 成本低 → id 字典序」，全程可复现，换团队不用改代码。

## Roles and ownership

| Role | Owns |
|---|---|
| Coordinator | decomposition, state, conflict resolution, accepting evidence |
| Implementation worker | edits assigned resources only |
| Verification worker | independent reproduction, boundary and regression checks (never the implementer) |
| Environment specialist | runtime, MCP, build, toolchain diagnosis |
| Domain reviewer | UX, content, security, legal or other domain criteria |

One agent may hold several roles on **routine** work only. Important work requires an independent verifier; critical work adds a domain reviewer and human approval. Ownership conflicts are resolved by stopping, not by racing: the last timestamped entry in the shared record wins.

See `references/roles.md` and `references/routing-and-roles.md`.

## Rigor: how much verification this change has to carry

Rigor is chosen from the **blast radius** of the change, not from how interesting it is, and it
decides which activities are mandatory - the way an integrity level selects V&V tasks in
IEEE 1012. State it; do not infer it. The engine stores it per task (`--rigor`) and enforces it.

| Level | Applies when | Mandatory |
|---|---|---|
| **L1 local** | one file, no shared interface, reversible | tests for the change; self-produced evidence allowed (never E1) |
| **L2 shared** (default) | multiple files, shared config, or user-visible behaviour | verifier must differ from the implementer; positive **and** negative cases; evidence graded E1 or E2 |
| **L3 consequential** | irreversible, published, deployed, or touching credentials/permissions | independent verification, a machine-produced artifact, an approval record (approver + scope + reason), **E1 evidence**, and a kept failure record |

Two rules the engine enforces rather than trusting: an **external action can never be filed as
L1** (it leaves the machine), and an **L3 task cannot reach `done` without E1 evidence** - a
command, its exit code and the revision it applies to.

> 中文：严格度按**影响面**选，不按兴趣选，而且必须写明、不能靠猜。L1 可自检；L2 必须异体验证 + 正反用例；L3 必须有独立核验、机器产物、审批记录（署名+范围+理由）、**E1 证据**并保留失败记录。外部动作永远不能填 L1；L3 没有 E1 证据到不了 done。

See `references/verification-standard.md` for the ten requirements this is derived from.

## Verification gate

Verification is a gate in the same sense as a security scan, except it is run by **an agent from your own team, chosen for the job** - no external tool and no particular vendor is required:

- the verifier is the highest-scoring eligible agent for `verify`, and the implementer is **never** eligible (if nobody is scored above 0, the run fails closed instead of pretending);
- completing the `verify` stage is a PASS; `fail` records the failing criteria and sends the task back to `implement` - the verifier never fixes the work itself;
- the gate blocks two things: reaching `done` from `evidence`, and being dispatched to `evidence` at all;
- a human can override deliberately with `override --task <id> --by <who> --scope <what> --reason <why>` - all three are required, and the failed result is kept next to the override rather than erased.

> 中文：核验就是门禁，但由**你自己团队里按能力选出的 Agent**执行，不绑定任何外部工具。核验者永远不是实现者；失败即退回实现，并同时拦截 done 与 evidence 派发；要放行必须写下署名 + 范围 + 理由，且失败记录不被抹掉。

## Handoff: the shared record

When the work moves - another session, another tool, another day - the state moves through a **shared record**, not through chat history:

| File | Holds | Updated |
|---|---|---|
| `CURRENT-TASK.md` | the live handoff entry: status, owner, progress, next step, evidence | on every substantial step |
| `HANDOFF-RULES.md` | the team's rules of engagement | when rules change |
| `MEMORY-SNAPSHOT.md` | shared decisions, preferences, lessons | periodically / on big decisions |
| `AGENT-ROLES.md` | who can do what | when the roster changes |

The five iron rules, in order: **read before acting**, **resume instead of redoing**, **write progress down**, **hand off before switching**, **completion carries graded evidence**. A task waiting to be picked up is `handoff-wait`; a task stuck on a condition names that condition and is only marked `blocked` after three rounds.

The record is the authority on intent; the queue is the scheduler. When they disagree, the record wins and the queue is reconciled to it.

> 中文：交接靠**共享记录**而不是聊天记录 —— 交接单、规则、记忆快照、角色表四件套；铁律是「先读再动 / 接续不重做 / 进展留痕 / 切换先交接 / 完成附证据」。共享记录代表意图，队列只是调度器。

Full detail, including the cross-tool checklist and the memory sync routine: `references/handoff.md`.

## Pipeline and queue

Stage machine: `specify -> implement -> verify -> evidence -> done`, plus `blocked` and `recovery`.

```bash
node scripts/orchestrator/orchestrator.mjs init --roster my-team.json         # 3, 5 or 12 agents
node scripts/orchestrator/orchestrator.mjs create --title "Fix checkout" --type build --workspace "<workspace>"
node scripts/orchestrator/orchestrator.mjs claim  --task task-0001 --agent implementer-a
node scripts/orchestrator/orchestrator.mjs dispatch --task task-0001          # dry-run command only
node scripts/orchestrator/orchestrator.mjs fail   --task task-0001 --agent verifier-b --criteria "test X fails"
node scripts/orchestrator/orchestrator.mjs override --task task-0001 --by user --scope "release 2.1" --reason "pre-existing flake"
node scripts/orchestrator/orchestrator.mjs approve --task task-0002 --by user --scope "deploy to production"
```

- `dispatch` prints the command to run and an `argv` array; it never launches an agent. Prefer `argv` over pasting the command line into a shell.
- A non-dispatchable task (blocked, gated, no assignee, no command) fails with a non-zero exit code. Exit 0 must never disguise an undispatchable task.
- `approve` is the only path for external actions, per task and per scope; `fail` closes the verification gate; `override` is the only way past it.

See `references/task-queue.md` and `scripts/orchestrator/README.md`.

## Evidence grading

| Grade | Meaning | Allowed wording |
|---|---|---|
| E1 reproducible | command output, exit code, hash, screenshot, URL response | "verified: `<command>` exited 0, output ..." |
| E2 same-system peer check | another agent re-ran it and gave reproduction steps | "peer-checked by <agent> (steps attached): ..." |
| E3 self-assertion | the author says it looks fine | "**self-checked, not independently verified**: ..." |
| E4 planned | not executed yet | "planned verification: ..." |

Never let E3 speak in E1's voice. Same-system peer checks are not independent verification. Grades do not survive a revision change: after an edit, a resumed session or context compaction, re-verify before restating an old "verified".

The engine enforces this rather than trusting the wording: a bare string handed to
`complete --evidence "..."` is stored as **E3 with a note saying it was downgraded**, and
`--evidence-grade E1` is refused unless it also carries `--evidence-command`,
`--evidence-exit-code` and `--evidence-revision`. Grade labels are not decoration - an
ungraded sentence cannot borrow E1's voice because it is not allowed to carry the label.

See `references/evidence-grading.md` and `references/verification-standard.md`.

## Token and cost policy

Load only the reference section you need. One coordinator summary instead of full transcripts. Bounded structured packets. Parallelize read-only checks; serialize dependent work and writes. Cheap models for discovery and mechanical checks; strong models for ambiguity, architecture, adversarial review and acceptance. Never compress requirements, code, paths, URLs, hashes, errors, permissions or evidence.

See `references/token-efficiency.md`.

## Completion gate

Do not claim done, verified or deployed without criterion-linked evidence. User-facing work should test the actual runtime, target environments, core interactions, errors, keyboard/accessibility where relevant, resource loading, and reduced-motion/fallback behaviour. A failed gate returns the task to its responsible stage. A passed gate is not a shipping authorization.

## Stop conditions

Ownership conflict; unrecoverable baseline; material ambiguity; release-blocking finding; missing evidence; a request for secrets; an external action without recorded approval; a verifier that was also the implementer; a shared record and queue that disagree.

## Anti-patterns (read before forming a team)

| # | Pitfall | Symptom | Engineering fix |
|---|---|---|---|
| 1 | Context explosion | the shared transcript grows until early constraints and acceptance criteria fall out of the window | the shared record stores conclusions and state only (<=200 lines); process chat stays local; the coordinator re-sends the minimal necessary context each batch |
| 2 | Hallucination contagion | one member's wrong output spreads as fact through shared memory | partition shared memory: entries become visible only after the coordinator marks them verified; unverified content stays quarantined with source and confidence |
| 3 | Coordination deadlock | A waits for B, B for C, C for A; the system hangs forever | queue resource requests in a globally fixed order; every wait carries a timeout (default 15 min) that escalates to the coordinator |
| 4 | State divergence | two members disagree about task state; work is repeated or dropped | single source of truth = the shared record's state machine; state changes are written to disk; verbal/session state does not count |
| 5 | Communication storm | members message each other; links grow quadratically with headcount | hub-and-spoke: members talk to the coordinator only; coordination is relayed |
| 6 | Agent sprawl | roles are split until boundaries overlap and nobody owns the outcome | subtraction first: a new role must justify why it cannot fold into an existing loop; every role owns an end-to-end deliverable |
| 7 | Dispatch left to LLM improvisation | the same input routes differently twice; work is slow or skipped | make dispatch deterministic: board scan + fixed rules; the LLM plans, it does not mechanically distribute |
| 8 | No acceptance aggregation | each member delivers, nobody assembles and checks; defects surface at integration | the coordinator runs an independent acceptance gate against every criterion with runtime evidence; failing batches are returned whole |

### Hard red lines

- Never let two members write the same file at the same time.
- Never start work or deliver outside the shared record and the queue.
- Never treat "I think it is done" as done - runtime evidence is required.
- Never let members hand tasks to each other privately; all dispatch flows through the coordinator.
- Never let an implementer certify its own work.

See `references/anti-patterns.md`, `references/protocol.md` and `config/agents.example.yaml`.