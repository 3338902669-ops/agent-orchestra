# Skill 体系评估、改进措施与变现方案

> 评估时间：2026-10-08；评估对象：agent-orchestra 与本机的配套仓库（技能包、治理运行时、网页设计知识库）。
> 方法：全部 skill 通读，脚本实际运行验证（gate.mjs / orchestrator 测试 / bench / 各工具 CLI），量化声明逐项核对。
> 归因说明：commit 身份无法区分人类与 AI 协作体（治理运行时的 VERIFICATION.md 记录实现者与核验者为不同角色），本报告评价作品体系。

---

## 一、能力评估

### 总判

在"AI 智能体治理与验证工程"这个窄赛道里，是高手。依据不是写得漂亮，而是三件事：**测自己的测试、诚实记录失败、把真实事故变成检查项**。

### 1. 验证工程是玩真的

- `scripts/gate.mjs`（545 行）：16 个检查步骤 + 12 个故障注入 mutation，实测 `VERDICT: PASS`（steps 16，notRejected 0）。数字全部属实。
- 注释里埋着真实事故：曾因"检查器只扫描会发布的集合、而 git 提交的是更大的集合"，导致核验者的 58KB transcript（含客户任务标题）被 `git add -A` 推到公开仓库；修复是改用 `git ls-files` 定义扫描集合。`claims` 检查步骤承认自己曾经漏检（正则要求数字后紧跟 "tests"，于是 "106 engine tests" 对它不可见），修好后用数词表同时匹配。
- `scripts/orchestrator/lib.test.mjs`：106/106 通过；bench 跑 positive control，失败则拒绝给数字（fail-closed 是实际行为，不是口号）。

### 2. 诚实度罕见

- `KNOWN-FINDINGS.md` 登记 14 条自身缺陷；gar 两轮独立核验 "failed to complete" 如实记录失败原因；Round 4 修复明确标注"尚未经过独立核验"——"修了"和"被独立确认修了"是两种声称。
- web-design-kb 的 `motion-inspect` 面对自家 751 条数据里 620 条缺 strength 字段，不静默丢弃而是打印 WARNING。
- E1–E4 分级的核心规则是"不许 E3 冒充 E1"：没跑过的命令不许自称 verified。这是把反幻觉做成了工程纪律。

### 3. 对抗思维

- activation 判定有 83 条对抗用例（mustEngage 6 + mustNotEngage 21 + ambiguous 56）。
- exit 3 的设计最见水平：七轮对抗验证证明词表分不清"比较模型"和"协调模型"后，选择不是继续打补丁，而是承认分不清、保守降级为人工判定。知道什么时候不猜，比猜对更难。

### 4. 短板

- **本机另一个技能包明显低一档**：`_INDEX.md` 列 76 个 skill，实质只有 11 个；最长的 `subagent-driven-development`（503 行）引用了仓库内不存在的 `../requesting-code-review/code-reviewer.md`（3 处），`writing-plans` 等依赖的 `executing-plans` / `finishing-a-development-branch` 在包内全部缺失——从 superpowers 体系摘出来时没跑引用检查；多为二创/搬运（末尾自列来源）。
- **地基有个作者自己承认的洞**：`references/routing-and-roles.md:129` 明说能力分数是自声明的，"Treat a score as a claim, not a measurement"；gar 的 honest limits 承认只是进程内纪律而非安全边界。
- **领域很窄**：四个仓库翻来覆去是同一个母题（多智能体协作、核验分离、证据分级）。证据支撑的是"AI 工程里的 agent 治理与验证"，不是 AI 全栈。

### 校准结论

99 stars 是外部佐证。方法论是"活"的——日常就是这么带 AI 小队的（实现者与核验者具名出现在核验记录里）。能指挥 AI 小队产出带 106 个测试、18 个故障注入的治理运行时，这本身就是稀缺的 AI 能力。但别泛化成"AI 全才"，证据没到那份上。

---

## 二、改进措施（按优先级）

1. **修 ocsp 的断裂引用**（半天工作量，卖钱前必须修）：补上缺失的 4 个 skill（executing-plans、finishing-a-development-branch、requesting-code-review、self-improving-agent）或删除引用。
2. **解决 76 vs 11 的指数虚胖**：`_INDEX.md` 只列真实有的 11 个，或明确标注 trial 状态。诚实是这套作品的招牌。
3. **agent-orchestra v2.3 核心 feature**：能力分数自声明 → 记录每次 verify 结果，按 agent 统计历史通过率自动校准分数。把"claim"变成"measurement"，这是质变。
4. **gar 保持现状**：作者自己列了 honest limits，别过度承诺；想往真安全走，下一步是独立 policy 服务。
5. **wdkb 苦力活**：406 条无 spec 条目继续补 prompt coverage，可批量交给实现方。
6. **社区转化**：99 stars 了，加 CONTRIBUTING.md 和 issue 模板，把 star 变成 contributor。

---

## 三、变现方案（按回款速度排序）

1. **最快：方法论变接单信任状**（零成本，立即生效）。本地客户接海外高端网站单时，"99 stars 开源治理框架作者 + 多智能体核验 pipeline"是极强的信任背书，直接支撑更高报价。不卖 skill 本体，卖"这个团队靠谱"。
2. **快：付费 skill 包**。ocsp 修好后出 pro 版（补全 skill + 实操视频 + 持续更新），Gumroad 定价 $29–49，X/V2EX 发 launch 帖。前提是先完成改进 1、2。
3. **中：企业内训/咨询**。"AI Agent 协作治理" 1 天 workshop，5k–2w/场。先写 2–3 篇深度技术文章攒可信度。
4. **慢：GitHub Sponsors + agensi 商店上架**。被动收入，不指望吃饭。
5. **不建议：SaaS 化 orchestrator**。投入大、回款慢，与快钱偏好相悖。

**建议顺序**：1 现在就用 → 修 ocsp（为 2 铺路）→ 2 → 3。
