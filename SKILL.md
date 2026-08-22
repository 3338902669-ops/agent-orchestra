---
name: multi-agent-orchestration
description: Use when three or more AI agents are available and a task needs coordinated execution, role assignment, independent verification, risk controls, or lower token/API cost. Activation is configurable: global, keyword-triggered, or manual.
---

# Multi-Agent Orchestration

A capability-first coordination protocol with explicit ownership, evidence, stop conditions, and token-aware routing. It reduces error risk but cannot promise absolute infallibility.

## Activation (when to use this skill)

Configure in config/agents.example.yaml under `activation:`.

| mode | behavior | token cost |
|---|---|---|
| global | engages for every task | highest (always loaded) |
| keyword | engages only when task text matches keywords | default; low |
| manual | engages only when the user explicitly invokes it | lowest |

Decide engagement before starting any work:

1. Read the activation block from config/agents.example.yaml.
2. If mode is global -> engage.
3. If mode is manual -> engage only when the user explicitly asked for multi-agent orchestration.
4. If mode is keyword -> run:

    node scripts/detect-trigger.mjs --text "<task text>" --config config/agents.example.yaml

   Exit code 0 (ENGAGED) means use this skill; exit code 1 (NOT_ENGAGED) means do not use it.
   Exclude keywords act as a veto even when a trigger keyword matched.

## Fast Path

1. Discover each agent's tools, model, workspace, permissions, specialties, cost tier, and availability.
2. Map capabilities to roles; never infer from names alone.
3. Classify the task as routine, important, or critical using user configuration.
4. Create a compact task packet: objective, non-goals, ownership, risks, and acceptance tests.
5. Enforce one primary writer per file or resource.
6. For important work use specify -> implement -> verify -> accept.
7. For critical work add domain review and human approval for external or irreversible actions.
8. Stop on failed gates, ownership conflicts, missing evidence, or unapproved external actions.

## Roles

Coordinator decomposes work, maintains state, resolves conflicts, and accepts evidence. Implementer edits assigned resources. Verifier independently tests behavior and regressions. Environment specialist diagnoses runtime, MCP, build, and toolchain problems. Domain reviewer checks UX, content, security, legal, or other domain criteria.

One agent may hold multiple roles for routine work only. Important work requires an independent verifier.

## Token Policy

Load only the reference section needed. Use one coordinator summary instead of full transcripts. Send bounded structured packets. Parallelize independent read-only checks; serialize dependent work and writes. Use cheap models for discovery and mechanical checks; reserve strong models for ambiguity, architecture, adversarial review, and acceptance. Never compress requirements, code, paths, URLs, hashes, errors, permissions, or evidence.

See references/token-efficiency.md.

## Completion Gate

Do not claim done, verified, or deployed without criterion-linked evidence. User-facing work should test actual runtime, target environments, core interactions, errors, keyboard/accessibility where relevant, resource loading, and fallback or reduced-motion behavior where relevant. A failed gate returns the task to its responsible stage.

See references/protocol.md, references/roles.md, and config/agents.example.yaml.


## 协同调度防翻车指南（八大坑与工程化解法）

> 多个 Agent 并行推进时的典型翻车点，组建团队前逐条对照。

| # | 坑 | 症状 | 工程化解法 |
|---|---|---|---|
| 1 | 上下文爆炸 | 共享对话越滚越长，早期约束和验收标准被挤出窗口 | 交接单只存结论与状态（≤200行）；过程性讨论留本地；每批次由总控重发「最小必要上下文」 |
| 2 | 幻觉传染 | 一个成员输出错误信息，经共享记忆被全员当事实扩散 | 共享记忆分区：写入需总控标「已验证」才可见；未验证内容进隔离区并标注来源与置信度 |
| 3 | 协作死锁 | A 等 B、B 等 C、C 又等 A，系统永久挂起 | 资源/产出申请按全局固定顺序排队；每个等待带超时（默认15分钟），超时升级总控裁决 |
| 4 | 状态不一致 | 两人手里的任务状态对不上，重复做或漏做 | 唯一事实源=任务看板状态机；改状态即写盘；口头状态不作数 |
| 5 | 通信风暴 | 成员互相直聊，消息链路随人数平方膨胀 | 星型拓扑：只允许「成员↔总控」通信，禁止成员互发；协作由总控转交 |
| 6 | Agent 蔓延 | 按功能细分拆太多角色，边界重叠没人负全责 | 减法原则：新角色先回答「能否并入现有闭环」；每个角色端到端负责一段可交付物 |
| 7 | 调度靠 LLM 临场发挥 | 同一输入两次派发结果不同，忽快忽慢还漏派 | 派发确定性化：看板扫描+固定规则（标签/负载/顺序）；LLM 只做规划不做机械分发 |
| 8 | 无验收聚合 | 各自交付没人拼装校验，缺陷集成时才爆 | 总控独立验收门禁：对照验收标准逐条核验+运行证据；不合格整批退回 |

### 硬性红线
- 禁止两成员同时写同一文件；禁止跳过看板直接开工/交付；
- 禁止把「我认为完成了」当完成——必须附运行证据；
- 禁止成员间私相授受任务（一切派发过总控）。
