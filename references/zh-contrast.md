# Chinese contrast

The Chinese one-line summaries that used to sit inside SKILL.md, kept here so the skill itself
stays small: the bilingual value is for readers, and readers can open a file.

## 

一套协议覆盖两条轴 —— **同批任务内怎么分工**，以及**跨会话/跨工具怎么交接**。两条轴共用同一套硬规则：单写入者、核验者≠实现者、分级证据、共享记录优先于调度器。

## Activation (when to use this skill)

关键词层是**保守的确定性过滤器**，不是万能的意图理解。命中明确词组与意图正则，同时句级否决「模型对比评测」「人的分工」这类同词不同义的请求；不确定时宁可沉默也不误召。真正的路由依据是上面的 description，且**用户明确要求使用时，一律优先**。

## Important-task intake gate

重要任务在首次写入/派发/核验前必须问用户三件事（单独还是协作、是否安全扫描、是否独立核验）并留档，不得替用户默认勾选；这三问只决定协作方式，不替代不可逆动作的授权。

## Roster: three or more agents, any names

花名册是**数据**，不是代码 —— 3 个、5 个、12 个都行，名字随便起；选人顺序是「分数高 → 能力标签命中 → 成本低 → id 字典序」，全程可复现，换团队不用改代码。

## Rigor: how much verification this change has to carry

严格度按**影响面**选，不按兴趣选，而且必须写明、不能靠猜。L1 可自检；L2 必须异体验证 + 正反用例；L3 必须有独立核验、机器产物、审批记录（署名+范围+理由）、**E1 证据**并保留失败记录。外部动作永远不能填 L1；L3 没有 E1 证据到不了 done。

## Verification gate

核验就是门禁，但由**你自己团队里按能力选出的 Agent**执行，不绑定任何外部工具。核验者永远不是实现者；失败即退回实现，并同时拦截 done 与 evidence 派发；要放行必须写下署名 + 范围 + 理由，且失败记录不被抹掉。

## Handoff: the shared record

交接靠**共享记录**而不是聊天记录 —— 交接单、规则、记忆快照、角色表四件套；铁律是「先读再动 / 接续不重做 / 进展留痕 / 切换先交接 / 完成附证据」。共享记录代表意图，队列只是调度器。
