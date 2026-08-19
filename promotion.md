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
