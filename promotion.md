# 发布宣传文案（Promotion Copy）

以下文案可直接用于 GitHub 社交分享、微信、X/Twitter、掘金、知乎、公众号等渠道。均为开源宣传用途，不涉及任何私密信息。

---

## 一、一句话定位（中英）

EN: Coordinate 3+ AI agents with capability-based routing, single-writer ownership, independent verification, and token-efficient workflows.

CN: 一套开源的多 agent 协作工作流 skill：按能力路由、单写入者锁、独立复核、验收门禁、token 成本优化。

---

## 二、X / Twitter 短推（英文）

```
Open-sourced the multi-agent orchestration skill I've been running in production.

It coordinates 3+ AI agents with:
- capability-based role routing
- single-writer file ownership
- independent verification before "done"
- explicit approval for deploy/publish
- token-aware cost controls

No more agents overwriting each other or claiming done without evidence.

github.com/3338902669-ops/agent-orchestra
#AI #LLM #MultiAgent #OpenSource
```

---

## 三、微信朋友圈 / 公众号（中文）

今天把我平时跑的那套多 agent 协作流程开源了。

核心就三件事：
1. 多个 agent 一起干活时，先探测各自能力再分角色，不靠猜名字；
2. 同一个文件同一时间只允许一个 agent 写，其他人只做独立复核；
3. 重要任务走「规划 → 实现 → 独立验证 → 最终验收」闭环，部署/发布必须我本人确认。

另外内置了 token 成本优化：结构化任务包、低成本模型干机械活、强模型只留给架构和验收，独立检查并行跑。

定位：它不是"保证不出错"，而是让出错变得可见、可回滚、可追责。

仓库：https://github.com/3338902669-ops/agent-orchestra
MIT 协议，欢迎拿去改。

#多agent协作 #AI工作流 #开源

---

## 四、掘金 / 知乎 / 技术博客（中文长文标题与摘要）

标题候选：
- 《多 Agent 协作的正确姿势：能力路由 + 单写入者 + 独立验收》
- 《我如何让 3 个 AI agent 协作不互相踩脚，还省了一半 token》
- 《开源一套可落地的多 Agent 编排协议》

摘要：多个 AI agent 并行协作时，最常见的三个事故是：角色靠名字猜、文件互相覆盖、验收靠自说自话。这篇文章分享一套已在本机稳定运行的编排协议——能力优先路由、单资源主写入锁、重要任务四级流水线、外部动作人工批准，以及一整套 token 成本控制策略。已开源，MIT 协议。

---

## 五、发布注意事项

- 本仓库为开源宣传用途，不包含任何个人隐私、密钥或业务数据。
- 文中链接均为公开仓库地址，可安全分享。
- 若在社交媒体引用，可附加仓库 Topics 标签提升曝光：ai-agents, multi-agent, orchestration, token-efficiency。

---

## 六、英文长文（Medium / DEV / Hacker News 发布版）

### Title

**How I Stopped My AI Agents from Stepping on Each Other (and Cut Token Costs in Half)**

### Body

Running three or more AI agents on the same project is a recipe for three classic accidents:

1. **Roles are guessed from names.** The agent called "coder" does architecture, the one called "reviewer" never touches code, and nobody verifies capability before assigning work.
2. **Files get overwritten.** Two agents edit the same file at the same time; the last writer wins silently; the diff makes no sense.
3. **"Done" is self-declared.** The implementing agent says it finished and verified its own work. Nobody independently checks the acceptance criteria.

I open-sourced the protocol I run locally every day: **multi-agent-orchestration** — a capability-first skill for coordinating 3+ agents.

### The core ideas

**Capability discovery over name-based roles.** Before any work starts, each agent reports a compact manifest: model, tools, read/write permissions, specialties, cost tier, availability. Role assignment (coordinator, implementer, verifier, environment specialist, domain reviewer) is scored on evidence, not brand names.

**Single-writer ownership.** One primary writer per file or resource per task. Reviewers write only isolated artifacts — tests, reports, patches — and never overwrite the owner's files. No more silent last-writer-wins.

**Risk-aware pipelines.** Routine work takes a short path. Important work runs specify → implement → verify → accept. Critical work adds domain review and explicit human approval for deploy, publish, send, or delete. External actions always require a recorded user confirmation.

**Evidence-gated completion.** You may not claim "done" or "verified" without criterion-linked evidence: reproducible tests, runtime output, hashes, screenshots. A failed gate returns the task to its responsible stage — it never silently becomes "close enough."

**Token efficiency as a first-class feature.**

- One canonical task packet instead of pasting full transcripts into every prompt.
- Bounded outputs: agents return JSON or short reports with required fields.
- Independent read-only checks run in parallel; writes and dependent work stay serial.
- Cheap models handle discovery, extraction, formatting, and mechanical checks.
- Strong models are reserved for ambiguity, architecture, adversarial review, and final acceptance.
- Stable discovery and test results are cached by revision or hash.
- Exploration stops once every acceptance criterion has fresh evidence.

Never compress requirements, permissions, exact errors, code, paths, URLs, hashes, or acceptance evidence. Saving tokens must never save correctness.

### Honest disclaimer

This is not a guarantee of infallibility. It is a set of controls that makes failures **visible, recoverable, and attributable**: stop conditions, recoverable baselines, approval records, and residual-risk reporting. That is the most any orchestration layer can promise — and it is usually enough to prevent the three classic accidents above.

### Get it

- Repository: https://github.com/3338902669-ops/agent-orchestra
- Live landing page: https://3338902669-ops.github.io/agent-orchestra/
- One-click install: `powershell -ExecutionPolicy Bypass -File scripts/install.ps1` (Windows) or `./scripts/install.sh` (Linux/macOS)
- License: MIT — use it, change it, ship it.

---

## 七、中文接地气版（朋友圈/微信短版）

三个 AI agent 一起干活，最怕三件事：角色靠猜、文件互踩、验收自卖自夸。

我把自己天天在用的那套流程开源了，核心就四招：
1. 干活前先让每个 agent 报能力，按证据分角色，不靠名字猜；
2. 一个文件同时只准一个 agent 写，其他人只做独立复核；
3. 重要任务必须走完「规划 → 实现 → 独立验证 → 最终验收」，部署发布必须我点头；
4. 说"做完了"必须带证据，测试没过就打回去重做。

还顺手把 token 成本压了一截：结构化任务包、便宜模型干杂活、贵的模型只留给架构和验收、独立检查并行跑。

不是保证不出错，而是让出错看得见、能回滚、找得到人。

仓库：https://github.com/3338902669-ops/agent-orchestra
MIT，随便拿去改。
