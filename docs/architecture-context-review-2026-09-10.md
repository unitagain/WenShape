# WenShape 架构、上下文工程与 Agent 质量评估

评估日期：2026-09-10。对象：`WenShape-main/` 检查时的 `develop` 未提交工作区。

本文是一次源码审阅、确定性探针与工程检查形成的评估，不是发布认证，也不是模型写作质量测评。项目定位、既定决策及仓库级证据数字统一引用根目录 [plan.md](../../plan.md) §2、§3.2、§7；不在本文建立另一套测试数、代码量或 revision 基线。

## 1. 结论摘要

WenShape 的总体方向适合本地优先、中长篇创作产品：模块化单体、单 Writer 工具循环、文件真相源与 SQLite 控制平面分离，以及 Canon、创作记忆、大纲、设定卡的语义分层，均有合理依据。目录前置、正文按需读取、来源登记、预算核算、压缩谱系、提案后采纳等基础设施也已存在。

但目前不能据此认定“上下文与记忆闭环已可靠实现”，更没有充分证据支持“整体工程质量高于行业顶级方案”。本次发现的主要问题不是缺少新框架，而是已有合同在跨组件传递中失效：

- 工具声称可恢复，原始内容却已在保存 artifact 之前被裁掉；Writer 也缺少相应的恢复入口。
- 工具结果有 hash，不代表它绑定了磁盘资产版本；JIT 读取后的源变化可以逃过校验。
- 记忆正文召回与目录推送使用不同准入规则；目录也会影响模型，不能视为治理之外的无害元数据。
- 异步压缩没有固定会话身份，切换活动会话时可把摘要投影与 artifact 写到不同会话。
- Writer 的 `incomplete` 会被计划层汇总成 `done`；长篇早期事实还可能在相关性计算前就被排除。

这些问题已通过生产类/存储接口上的局部确定性实验复现，而常规工程检查仍通过。因此，当前更准确的判断是：**架构基础较完整，但生产主链路的语义完整性、会话隔离和结果可信度仍需补强。**

建议保留现有架构，在现有 owner 内优先修复隔离、终态和上下文保真合同；暂不以增加 Agent、扩大上下文窗口、引入远程向量数据库或更换工作流框架作为默认方案。相关高风险场景修复并验收前，不宜承诺可靠的跨会话长期记忆、长篇全库召回或自动完成多步任务。

## 2. 范围、方法与证据边界

### 2.1 审阅范围

从 `plan.md` 入手，沿以下真实调用面检查，而非只依据类名、注释或测试数量判断能力：

- `ChatTurnService → ContextPlanning/Assembly → WritingService → WriterToolset/Agentic loop → Gateway`。
- JIT 卡片、Canon、关系、正文、大纲与创作记忆读取；候选选择、向量缓存、token 核算及来源校验。
- 会话事件、历史投影、压缩、artifact、后台任务与恢复接口。
- 计划执行、终态传播、change set 采纳、revision 与写入日志。
- 前端对话持久化、实时事件、任务卡状态及关键质量门禁。

未扩展到归档项目或管理端。工作区已有大量 U8–U11 相关改动，本次评估针对其合并后的实际行为，不将它们归因于某一个历史提交，也不覆盖或整理这些改动。

### 2.2 证据分级

| 标记 | 含义 | 能证明什么 |
| --- | --- | --- |
| A | 阅读生产实现，并以合成数据、真实生产类或 FakeGateway/Fake Writer 执行局部探针 | 指定输入与时序下存在确定行为；不等于真实 UI、真实模型端到端验收 |
| B | 源码与调用链直接支持，未模拟完整触发环境 | 合同缺口或可达风险；不能给出发生频率 |
| C | 文档、权威资料与工程判断 | 对标原则、设计取舍与验证建议，不是本项目实测收益 |

探针使用临时合成项目，未读取真实用户正文做模型实验，未调用付费 LLM，也未安装依赖。BGE 实验只获取公开 tokenizer/config，不下载模型权重。下面的局部样本数字用于解释反例，不是新的仓库级基线。

未完成：真实 Provider 稳定性与成本测量、文学质量盲评、完整浏览器金路径、Windows 桌面打包 smoke、跨重启主 turn 续跑验证。本次 dirty 工作区检查不能替代 `plan.md` §3.3 要求的 clean revision 发布证据。

## 3. 架构判断：值得保留的部分与真正的接缝

当前关键链路可简化为：

```text
用户请求 + 会话身份 + 当前资产
  → 路由 / ContextPlan / TurnScope
  → 稳定指令与轻量目录 + 历史/正文投影
  → 单 Writer 循环
      → JIT 工具 → 文件真相源 / 派生索引
      → 来源登记 + 工具 artifact
      → Gateway 最终载荷检查 → 模型
  → 结构化终态 + change set
  → 作者采纳 → revision 校验 → 逐资产写回
  → 会话事件 / 记忆治理 / 后处理
```

以下选择应保留：

1. 文件是真相源，索引可重建；SQLite 承担任务、幂等、revision 等控制信息。该分工适合本地工程资产，不需要为了 Agent 标签而分布式化。
2. 单 Writer 串行修改，生成提案后由用户采纳，有助于限制并发写入冲突。多个角色/服务的存在不代表必须演化为多 Agent 自主协作。
3. Canon 是已发生事实，大纲是规划，Cards 是设定，Creative Memory 是偏好与决定。该区分比“所有东西塞进统一向量记忆”更符合小说创作的时间与可信度语义。
4. Context、Memory、Runtime、Durability、Provider、Evidence 已有明确 owner；取消、deadline、权限、来源闭合与写入前校验具备可复用底座。

主要架构债务集中于四类接缝：身份没有贯穿、完整性元数据强于真实能力、裁剪规则分散、结构化结果退化为字符串。修复应让现有 owner 的合同穿透真实入口，不应新建平行的 Context/Memory/Runtime 实现。

## 4. 与公开成熟方案对标

这里的“对齐行业”指对齐可核验的设计原则，不意味着必须采用某一家 SDK，也不将供应商博客的性能收益外推到 WenShape。资料于本次评估期间联网核验，链接见 §10。

| 维度 | 公开方案中的关键原则 | WenShape 现状与判断 |
| --- | --- | --- |
| Context engineering | 高信号、最小必要上下文；轻量索引与 JIT 组合；按需逐步展开 [R1] | 路线一致；但来源版本、恢复可达性及多处前置裁剪未闭环 |
| 持久会话与工作上下文 | 会话日志独立于有限模型窗口，裁剪后仍可按范围查询原事件 [R2] | 有事件、压缩产物和 HTTP 恢复接口；会话绑定存在竞态，Writer 不能直接恢复被省略的历史 |
| Memory | 短期状态按 thread 隔离，长期记忆按 namespace 管理 [R3]；评测覆盖时间、更新、跨会话与拒答 [R4] | 资产语义分层较好；目录与正文准入分叉，章节时点未贯穿 JIT |
| Retrieval | 候选覆盖先于 rerank；词法与语义组合，必要时给 chunk 补局部上下文 [R5] | 已有混合排序与分块；生产参数漏传、按时间先裁候选，使后续排序无从补救 |
| Agent / workflow | 简单、可组合的工作流；自治程度与任务需要相配；durable replay 要有稳定身份和幂等边界 [R3][R6] | 单 Writer 适配当前任务；终态汇总与异步会话身份仍不可靠 |
| 质量验证 | 分开验证检索、读取、任务结果与长时记忆能力 [R4] | 工程检查覆盖面可观；缺少穿过真实入口的跨合同反例及产品效果证据 |

R2 的云端 sandbox/容器拆分不是本项目的直接迁移建议；可借鉴的是“持久记录与上下文窗口分离”“session 身份固定”“可恢复接口真实可用”。R5 的 BM25、上下文化 chunk 或 rerank 也不是立即引入依赖的理由，应在候选池与 tokenizer 正确后，用本项目语料决定是否值得采用。

## 5. 主要发现

优先级定义：P1 为相关场景发布前应处理的隔离、完整性或结果可信度问题；P2 为应有计划修复的检索精度、配置兼容与质量风险。本次没有足够证据认定 P0 事故或已发生数据泄露。以下编号是评估索引，不等同于 `plan.md` 历史工作包 P1–P8。

| 编号 | 优先级 | 发现 | 证据 |
| --- | --- | --- | --- |
| F01 | P1 | 卡片 JIT 读取可越过当前项目目录 | A |
| F02 | P1 | 工具输出先丢内容，再声明 artifact 可恢复 | A+B |
| F03 | P1 | JIT 内容 hash 未绑定可变源，源更新不被检出 | A |
| F04 | P1 | Memory 目录绕过 eligibility；召回未传章节时点 | A |
| F05 | P1 | 压缩异步阶段可跨会话串写 artifact | A |
| F06 | P1 | Plan 将 Writer 的 incomplete 汇总成 done | A+B |
| F07 | P1 | 长篇 Writer 实际候选池仍退回最近一批事实 | A |
| F08 | P1 | 历史投影破坏完整 turn，摘要/校验输入覆盖不完整 | A+B |
| F09 | P2 | 字符分块不能保证符合 embedding token 窗口 | A |
| F10 | P2 | 向量缓存缺少模型身份，换模型可复用错误空间 | A |

### F01：卡片工具未守住项目读取边界

来源：[storage/cards.py](../backend/app/storage/cards.py) 第 17–22、77 行附近；[agents/tools.py](../backend/app/agents/tools.py) 第 352–369 行；[storage/base.py](../backend/app/storage/base.py) 第 178、316 行附近。

`get_project_path()` 验证的是项目 ID；之后再拼接的 `character_name`/`card_name` 没有得到等价的路径校验。Writer 的 `lookup_card` 将模型参数传给该读取路径，不能依赖 HTTP 层的校验保护工具内部调用。

局部复现：在临时 `inside` 与 `outside` 项目放置不同卡片，从 `inside` 的 WriterToolset 调用：

```json
{"name":"../../../outside/cards/characters/ForeignCard"}
```

工具返回了 `outside` 卡片的合成哨兵。该实验没有读取真实私人文件，但已经证明“当前工具 project_id”不能约束最终读取目标。

影响：错误或受注入影响的工具参数可能把其他项目内容送入当前模型上下文。本地优先降低了公网暴露面，但不能替代项目数据隔离；本次未验证外部攻击入口或实际泄露。

建议：在存储层统一解析卡片标识并拒绝越界输入，验证最终解析路径属于预期卡片目录；沿用拒绝式校验，不把非法 ID 静默改写为另一合法 ID。兼顾 Windows 分隔符、绝对路径及可行时的链接解析。

验收：有效中文名称仍可读；相对越界、绝对路径、混合分隔符不能读到其他项目；真实 WriterToolset 调用同样受限。`BaseStorage.get_project_path` 的既有单点策略应保留，但其保护范围必须覆盖拼接后的资产路径。

### F02：JIT 的“完整读取”与“可恢复”承诺不成立

来源：[agents/tools.py](../backend/app/agents/tools.py) 第 31、369、393、462、577–602 行；[agentic.py](../backend/app/agents/agentic.py) 第 586–607 行；[context_assembly_service.py](../backend/app/orchestrator/context_assembly_service.py) 第 633–634 行；[tool_artifact.py](../backend/app/context_engine/tool_artifact.py) 第 180–194 行。

卡片、Canon、Memory 等工具在返回时就执行固定字符截断。章节超过 3200 字符时只返回首尾各 1600 字符，没有范围/偏移参数。Agentic loop 随后才保存工具输出，因此保存的是已经缺失内容的版本。

局部复现：把唯一哨兵置于长卡片尾部和长章节中部，观察到卡片哨兵既不在工具响应，也不在保存的 artifact；章节中部哨兵也不在 `read_chapter` 返回值中，而两类工具仍声明结果可恢复。

此外，生产 Writer 工具集合未提供 tool artifact 读取或会话历史恢复工具。内部 `ToolArtifactStore.read()`/`exists()` 能证明产物存在，不代表模型拥有调用它的路径。当前“正文预算省略后调用 read_chapter 获取真实最新正文”的提示，也不能恢复再次被该工具省略的中段。

影响：这是数据到达模型前的可达性问题，不是模型是否愿意查资料的问题。搜索片段可以辅助检索，但不能替代任意原文范围的完整恢复；反复调用相同工具也不会找回固定丢失的部分。

建议：在裁剪前保留完整且版本固定的内容；响应给出轻量预览、范围和稳定引用；通过既有读取工具的分页/范围能力或最小恢复入口读取。只有“本轮工具权限下确实可恢复”才能标记 `recoverable=true`，否则必须显式报告不可恢复。不能仅把字符阈值调大。

验收：长卡片尾部、长章节中部、被折叠工具结果均能沿 Writer 实际可用工具恢复；恢复文本与登记的原始内容一致；引用过期/缺失时明确失败。验收应验证恢复动作，而不只断言 artifact 文件存在。

### F03：source closure 保住了载荷身份，尚未保住源版本

来源：[agents/tools.py](../backend/app/agents/tools.py) 第 310–333 行；[writing_service.py](../backend/app/orchestrator/writing_service.py) 第 194 行附近；[source_snapshot.py](../backend/app/context_engine/source_snapshot.py) 第 318–321 行。

JIT 登记使用 `register_source_content()`，记录返回内容 hash，但没有把所读卡片等资产登记为带路径/版本的 mutable source。全生产调用面中，`register_source_file()` 的接线集中在 Writer 当前正文；它并未覆盖所有 JIT 资产。验证器在没有 mutable source 时允许 `valid=true, checked=0`。

局部复现：真实 CardStorage 写入 OLD → WriterToolset 读取 OLD → 存储更新为 NEW → 准备下一次模型请求。请求仍获准携带 OLD，源校验返回：

```json
{"valid":true,"checked":0,"failures":[]}
```

这里的 `checked=0` 是隔离的工具探针结果，不表示每个正常写作 turn 都没有源校验；正常 turn 的当前正文可能已登记。问题是卡片更新没有成为待校验依赖。

影响：载荷确实“有来源条目”，但不能据此证明“引用的磁盘资产未变化”，与 `plan.md` §4 的源变化约束存在差距。

建议二选一并明确语义：读取时登记真实资产 revision/hash，并在下一请求前检测变化；或者使用固定版本、内容寻址且可恢复的不可变快照。前者对编辑及时响应，但需重读/重规划；后者便于复现，但必须向调用方明确快照版本。现有 payload hash 仍应保留，不能拿源路径替代它。

验收：分别在卡片、Canon、Memory、大纲读取后修改源；系统要么拒绝/重建旧请求，要么明确继续使用可验证的固定版本。不能只对“已登记的 mutable source”做单元测试，还要检查生产工具是否真的登记。

### F04：Memory 治理在目录层和时间维度上分叉

来源：[writing_service.py](../backend/app/orchestrator/writing_service.py) 第 723–757 行；[creative_memory.py](../backend/app/storage/creative_memory.py) 第 421–475、487–546 行；[agents/tools.py](../backend/app/agents/tools.py) 第 431–462 行；[context_assembly_service.py](../backend/app/orchestrator/context_assembly_service.py) 第 127–134 行。

目录调用 `list_headers()`，默认只按 active 状态选择；真正的 expiry、conflict、provenance 等可召回性判断在 `recall()` 的 `recall_block_reasons()` 中。目录又包含 name、description，并进入 system prompt，故仍是会影响生成的记忆内容。

局部复现得到两类不同问题：

- 已过期的 active 记录与存在冲突的 active 记录不能被 `recall()` 正文召回，但其描述仍进入 Writer system inventory。这里证明的是描述泄入上下文，不是被阻断的整篇正文仍然召回。
- chapter scope、`valid_from=V1C10` 的记录，在 `recall(as_of="V1C1")` 中被排除；V1C1 Writer 的 `query_memory` 却能返回该记忆正文，因为工具调用不传 `as_of`，也未显式传入本轮 scope。

影响：模型可能看到已失效的约束或提前知道未来章节决定。system prompt 中“不得违反已激活的约束”的文字还会放大目录与正文冲突造成的歧义。

建议：由现有 Memory owner 提供共享的 eligibility 选择，目录和正文仅在投影形式上不同；把项目、会话/章节作用域与 as-of 时点贯穿入口到召回。不要把完整治理谓词复制到 Writer 形成第二套规则。

验收：过期、冲突、撤销、缺少必要出处的记录在目录和正文中一致不可见；未来 chapter memory 不向过去章节泄漏；有效历史记忆仍可读。另应覆盖章节 ID 的结构化时间比较，而非假设普通字符串排序等于章节顺序。

### F05：后台压缩没有固定 conversation_id，可跨会话串写

来源：[session_history.py](../backend/app/storage/session_history.py) 第 64–90、268、388–390、440–445、480–495 行；[jobs/runtime.py](../backend/app/jobs/runtime.py) 第 27–31 行；[routers/session.py](../backend/app/routers/session.py) 第 309–320 行。

`compact()` 开始时固定了历史 projection 的路径，但 `_compact_dir()`、state、artifact/recovery 等后续操作重新读取项目的 active conversation。semantic verifier 等 `await` 期间活动会话可以改变。后台 job payload 与幂等 key 也只有 project_id/history_count，没有 conversation_id。

局部复现：A 会话启动 compact → 在 semantic verifier await 期间激活 B → 完成 A 的压缩。结果是：

```text
compact 返回成功
A 的 projection 出现摘要
A 的 artifact 不存在
A-summary 对应的 artifact 写入 B
在 B 根据该 artifact 恢复到的源事件数为 0
```

影响：会话隔离与压缩可恢复性同时破坏。异步任务开始前就切换活动会话，还可能使后台任务选择错误的目标；这一前置时序是源码风险，以上实际探针复现的是 await 期间切换。

建议：在用户请求/任务入队时解析并固定 conversation_id，贯穿任务 payload、幂等 key、历史加载、epoch、压缩、artifact、state 和恢复。active conversation 只能用于入口默认值，不能成为运行中的隐藏动态依赖。优先收紧现有 API，不需要新队列或新存储引擎。

验收：用同步屏障在摘要生成、语义校验、最终写回前分别切换 A/B；所有写入及恢复仍归属原会话。并发追加应保留，历史重写应触发既有冲突路径，不得通过“成功”返回掩盖错写。

### F06：Plan 把“调用没抛异常”当作“任务完成”

来源：[plan_execution_service.py](../backend/app/orchestrator/plan_execution_service.py) 第 127–149、208–209、237–249 行；[TaskDock.jsx](../frontend/src/components/agent/TaskDock.jsx) 第 19–32 行；[WritingSession.jsx](../frontend/src/pages/WritingSession.jsx) 第 2334–2338 行。

WritingService 的失败/未完成结果被 `_run_writing_step()` 转成普通字符串。`execute_plan()` 只要 runner 没抛异常，就写 `step.status=done`，随后可能写 `plan.status=done`、`success=true`。虽然 step 上保留了 `terminal_state`，任务卡主要按 status 判断。

局部复现：Fake Writer 返回合法形状的 `success=false, changed=false, terminal_state=incomplete, reason=max_iterations`，实际汇总为：

```json
{"plan_success":true,"plan_status":"done","step_status":"done","step_terminal_state":"incomplete"}
```

该实验确定证明服务层映射错误；前端成功文案的影响依据代码调用链判断，没有实际浏览器演示。analyze 分支把 `success` 转为字符串的方式也需要一起审查。

建议：步骤返回结构化结果并显式聚合，复用 `AgentRunResult` 四态，不添加新的 Agent 终态；保留未完成步骤已有提案，停止依赖该步骤的后续工作。“完成生成提案”与“用户已采纳”也应继续保持语义区分。

验收：completed/incomplete/cancelled/failed 穿过 Writer → plan store → HTTP/WS → 任务卡后不变义；无变更的合法回答与预算耗尽不能仅靠 `changed` 一个布尔值区分。状态逻辑通过后再验证进度与文案。

### F07：生产 Writer 的长篇召回在排序前已丢候选

来源：[writing_service.py](../backend/app/orchestrator/writing_service.py) 第 125、150–158 行；[agents/tools.py](../backend/app/agents/tools.py) 第 223、383 行；[select_engine.py](../backend/app/context_engine/select_engine.py) 第 256–277、459–477 行。

WritingService 已取得 `existing_chapters`，创建 WriterToolset 时却没有传 `total_chapters`。默认值 0 使候选上限回到每类型 50。Canon 先按章节倒序，过滤未来事实后截取候选，再进行 query 相关性计算。

局部复现：构造 80 章、80 条已可用事实，把唯一精确查询词 `EARLY_SECRET_PHRASE` 放在首章。默认 Writer 路径找不到该事实；同一语料与查询，显式传入 `total_chapters=80` 后能找回。

影响：后期创作可能漏掉早期伏笔、身份或约束，即使查询词精确命中。U11 调大语义 top-N 的比例只能影响已进入候选池的条目，不能补救前置遗漏。

建议：先修复章节数接线并加生产装配回归；再将全库轻量词法/索引候选召回置于最终裁剪之前。正确传参能改善当前实例，但在更大语料中依然存在按 recency 先裁剪的问题，不能当作彻底修复。维持既有词法命中优先规则，不默认引入重型向量服务。

验收：早、中、晚章节分别布置精确与语义目标；通过真实 WritingService 装配后的工具验证。分别记录候选池 recall 和最终 top-k recall，才能定位是“没进池”还是“排序落后”。

### F08：对话完整性在投影、摘要与验证之间再次丢失

来源：[context_assembly_service.py](../backend/app/orchestrator/context_assembly_service.py) 第 310–317、372–465 行；[orchestrator.py](../backend/app/orchestrator/orchestrator.py) 第 492–507、544–555 行；[session_history.py](../backend/app/storage/session_history.py) 第 250–276、357–390 行；[routers/session.py](../backend/app/routers/session.py) 第 316–320 行。

第一处是模型历史投影：按单条 message 逆序尝试塞入预算，不以完整 turn 为选择单位。较长 user 消息可以被跳过，而该轮较短 assistant 回复与更老消息仍留下。

局部复现使用 4000-token 历史预算：旧 user/assistant 各一条短消息；最近 user 为 `RECENT_USER_CONSTRAINT` 加 `user_constraint_token ` 重复 6000 次，最近 assistant 为 `RECENT_REPLY` 加 `assistant_reply ` 重复 400 次。结果保留了旧 user、旧 assistant 与最近 assistant，丢掉最近 user。该输入是刻意构造的预算竞争反例，不代表正常会话发生频率。

第二处是压缩输入覆盖：`_summarize_conversation()` 仅把 `text[:6000]` 送给摘要模型；`_verify_compact_artifact()` 仅把 `source[:60000]` 送给语义验证模型，但 artifact 的来源 hash/count 覆盖的是完整 source messages。

FakeGateway 捕获证明：6000 字符后的摘要哨兵不在摘要请求里；60000 字符后的验证哨兵不在验证请求里。Fake verifier 返回 valid 时会被接受。这证明“验证器看不到尾部”，不证明真实模型一定误判，也不否认结构校验本身对 hash/谱系的价值。

第三处是自动触发与恢复：compact 内有 token pressure 判断，但 history append 路由只按消息数量决定入队，少量超长消息未必触发压缩；历史投影又把省略标记为可恢复，引用固定 legacy 路径 `sessions/conversation.jsonl`，生产 Writer 没有相应历史恢复工具。HTTP 管理接口可恢复部分源事件，不等于 Agent 可恢复。

建议：统一完整 turn 的选择和预算投影；保留近期约束及未决事项；摘要/验证采用完整覆盖的分块或分层过程，并让 provenance 表达实际覆盖范围。自动触发同时考虑 token 压力；历史引用绑定 conversation/event range，并提供受权限控制的恢复路径。

验收：长 user + 短 assistant 不产生孤立回答；消息数少但 token 压力高时能触发正确路径；在摘要输入边界、验证输入边界后放置约束/更新哨兵，不能虚称已完整验证；压缩后可恢复原事件，而不仅是读回摘要。

### F09：600 字符分块不是 512-token 上界

来源：[retrieval_pipeline.py](../backend/app/context_engine/retrieval_pipeline.py) 第 22、39、156–165 行；[embeddings.py](../backend/app/context_engine/embeddings.py) 第 61–87 行；BGE 官方 tokenizer/config [R7]。

分块以 `_CHUNK_CHAR_LIMIT=600` 为界，小于该阈值的文本整块进入 encoder。对 `BAAI/bge-small-zh-v1.5` 固定版本 tokenizer 实测：

```text
输入："春江花月夜山水云风" 重复 60 次
字符数：540
代码分块数：1
tokenizer token 数（含特殊 token）：542
官方模型窗口：512
```

这足以否定 `plan.md` §9.3 中“只多切不少切，无误杀风险”的安全性表述。实验未运行模型权重，因此不把它包装成实际召回率下降测量；它证明的是上游没有保证 encoder 输入不越窗。

建议：按实际 tokenizer 与模型窗口切块，计算 special tokens 和必要前缀；保留句段边界，并为中文、英文、混合文本分别回归。若 tokenizer 不可用，只能声明近似降级，不能宣称不会截断。max-over-chunks 的局部匹配方案可以保留，是否需要 overlap/上下文化前缀再用语料评估。

验收：所有分块 token 数不超过实际模型限制；关键末尾字段有机会进入可评分分块；避免把“Fake embedder 支持长文本”误当成真实模型窗口证据。

### F10：向量缓存只绑定内容，没有绑定向量空间

来源：[retrieval_pipeline.py](../backend/app/context_engine/retrieval_pipeline.py) 第 168–207 行；[vector_store.py](../backend/app/context_engine/vector_store.py)。

缓存 key 是 chunk 文本 SHA1，持久化与加载未纳入 embedding 模型、revision、tokenizer、维度或分块版本。相同文本不代表在不同模型下有相同向量。

局部复现：先用合成模型 A 的 `[1,0]` 向量写缓存，再切换到同维度但空间不同的模型 B `[0,1]`。第二次调用只重新嵌入 query，没有重新嵌入文档，匹配得分从 1 变为 0。这里的数字来自构造向量，不代表真实模型换型的损失幅度。

建议：给派生缓存加模型空间指纹与 chunking version；不匹配时可重建。不能只检验维度，同维度不同模型也不可混用。保留内容 hash 用于同一空间内的去重。

验收：模型、revision、tokenizer/前缀策略或分块版本改变时失效重建；同一配置的重复查询继续命中缓存；旧缓存升级路径明确且不影响真相源。

## 6. 补充风险与已知边界

### 6.1 输出预留不是最终硬边界（P2，A+B）

[payload_accounting.py](../backend/app/llm_gateway/payload_accounting.py) 第 49–56 行及 [context_plan.py](../backend/app/context_engine/context_plan.py) 第 112–131 行有意将 input budget 作为软目标，硬检查仅比较输入点估计与 `max(input_budget, context_limit)`，输出则单独与 reserve 比较。注入固定 token accounting 的局部合同探针中，context=4096、input=3500、output reserve=1024 的组合仍被接受。

这是为减少估算误杀而作出的显式取舍，不应简单描述为“完全没做预算”。缺口是尚不能据本地检查宣称输入加输出满足 Provider 总窗口；真实失败率本次未测。建议按 Provider 能力明确总窗口语义，在精确 token 计数可用时验证 input + requested output；估算路径保留清晰的预警、输出缩减或结构化失败策略，不机械回到悲观上界一律硬拦。

### 6.2 选区正文在入口被丢弃（P2，B）

[WritingSession.jsx](../frontend/src/pages/WritingSession.jsx) 第 2388 行发送 `selection_text`，但 [chat_turn_service.py](../backend/app/orchestrator/chat_turn_service.py) 第 123 行将其删除，Writer 获得的主要是 `has_selection`。仅有布尔值无法唯一描述用户要编辑的文本范围。

建议明确选区合同：携带资产版本与范围/原文，并作为受预算管理的来源；若不支持则显式降级。需用真实入口验证“改这一段”，不能只测试前端把选区附上了。此次未模拟完整选区编辑 UI。

### 6.3 历史持久化依赖前端尽力追加（P2，B）

[WritingSession.jsx](../frontend/src/pages/WritingSession.jsx) 第 500–508 行对 `appendHistory()` 使用未等待的 `.catch(() => {})`；聊天执行与历史追加是分开的请求。直接调用聊天 API、网络失败或关闭页面可能使执行记录与持久会话不一致。

建议由后端 turn 入口/终态路径承担权威事件追加并使用稳定事件 ID 去重；前端只展示或提交必要交互事件。若保持现状，应明确“历史保存失败”及重试语义。本项为调用链风险，未做浏览器断网故障注入。

### 6.4 多资产写入仍非事务（已知接受边界，B）

[orchestrator.py](../backend/app/orchestrator/orchestrator.py) 第 243–337 行先检查全部 revision/original，再逐资产写入；journal 增加了可审计性，但记录失败可降级，且没有自动回滚或续做。因此“全部 preflight 通过才开始写”不能等同于跨文件原子事务或 exactly-once 完成。

这是 `plan.md` §9.3 已明确记录的问题，不是本次新发现，也不能把 U11 journal 描述为完全解决恢复。完整处理需独立设计并获批准：选择显式部分成功与人工恢复，或受版本约束的可续做协议；日志状态/hash 本身不足以安全恢复全部正文。

### 6.5 不应误判为缺陷的边界

- 一致性标注目前是词法相关事实与称呼核对提示，不是语义矛盾检测。它有审阅价值，但不能宣传为自动证明全书无矛盾；增加 NLI/LLM 判定需独立需求。
- 主 turn 跨重启续跑属于 `plan.md` 的需求触发项；后台任务有 durable queue 不等于交互式 Agent 已具备该能力。当前未实现不应自动判为架构失败。
- 不机械拆分大文件、不扩大 Agent 数量是合理选择。是否拆分应由依赖、测试隔离与变更扇出决定，不能仅凭文件长度。

## 7. 工程质量与本次检查结果

### 7.1 实际执行结果

本次使用声明支持范围内的 Python 3.12 执行后端检查。以下均为本次执行结果，不引用旧报告代替检查；测试数量等统一见 `plan.md` §3.2。未把下表等同于完整 release gate、真实网络测试或桌面发布证据。

| 检查 | 执行目录与命令/入口 | 本次结果 |
| --- | --- | --- |
| 后端全量测试 | `backend/`：`py -3.12 -m pytest -q` | 通过 |
| Python 依赖一致性 | `backend/`：`py -3.12 -m pip check` | 通过 |
| Python lint | `backend/`：`py -3.12 -m ruff check app evaluation tests scripts` | 通过 |
| 后端类型合同 | `backend/`：`py -3.12 scripts/type_contract_check.py`；另执行 `py -3.12 -m mypy` | 两者通过 |
| 架构门禁 | `backend/`：`scripts/architecture_profile.py --check` | 通过，未报告当前规则定义的违规 |
| 错误合同审计 | `backend/`：`scripts/error_contract_audit.py` | 当前规则的 unsafe/silent 列表为空 |
| requirements 同步、编码 | 项目根目录：`scripts/check_requirements_sync.py`、`scripts/check_encoding.py` | 通过 |
| 前端完整检查 | `frontend/`：`npm run check` | lint、typecheck、Vitest、build 通过 |

环境说明：Python 3.12 的 `pip check` 通过，不代表已修复 `plan.md` 所记录的其他全局 Python 环境污染。类型检查脚本内部通过 PATH 找 `mypy`，所以又执行绑定解释器的 `py -3.12 -m mypy` 排除工具链歧义。前端构建有 caniuse-lite 数据过旧警告，未升级依赖。

检查产生通常的测试缓存、日志和被忽略的 `frontend/dist/` 构建产物；没有生产代码修改、Git 提交或推送。

### 7.2 为什么全绿仍不足以证明这些合同

1. 架构可达性检查证明静态 import 图里的可达，不证明生产装配传了正确参数。F07 就是“组件正确、默认接线错误”。
2. source/artifact 测试若只覆盖“登记后可校验”“文件存在”，无法证明真实 JIT 读取进行了资产登记，也无法证明 Writer 能恢复原始内容。
3. 压缩若只有单会话串行测试，不能发现 await 边界活动会话变化。终态若只测 Agent，不经过 plan 汇总，也不能发现 F06。
4. [error_contract_audit.py](../backend/scripts/error_contract_audit.py) 第 75–81 行的 silent catch 规则主要识别纯 `pass/continue`；`except: value=[]` 等兜底不因此报错。审计为空不等于所有业务失败都可见。
5. [tsconfig.json](../frontend/tsconfig.json) 设置 `strict=false`、`checkJs=false`；大量 JSX 页面不受完整类型检查。渲染测试底座有价值，但现有叶子组件测试不能替代切章、SWR 回填、采纳、反问恢复与网络时序验证。

工程纪律与可测试性是项目的优点；需要补的是生产入口级的反例，而不是为了数字扩大低价值用例数量。

## 8. 建议的最小整改路线

以下是供负责人评审的分包建议，未实施，也不表示已获架构变更批准。每包应保持可独立验证与回滚，沿用既有 owner，Git 操作仍由负责人决定。

| 顺序 | 工作包与 owner | 目标与代价 |
| --- | --- | --- |
| 1 | 隔离与终态：Storage、Session/Jobs、Plan Runtime | F01/F04/F05/F06；优先解决跨项目读取、非 eligible 内容、跨会话串写与虚假完成。主要代价是补齐标识传递、结果类型与故障时序测试 |
| 2 | 上下文保真：Context、Writer tools、Conversation | F02/F03/F08；让来源、投影、恢复使用同一可验证合同。分页/恢复会增加少量工具往返，固定快照会增加存储，但这些代价应显式可测 |
| 3 | 检索正确性：WritingService、SelectEngine、VectorIndexAdapter | F07/F09/F10；先修接线、候选覆盖、tokenizer 与缓存身份，再校准比例/排名。全库轻量检索可能增加读取成本，可用已有派生索引逐步优化 |
| 4 | 产品级验收与发布证据：前后端联合合同、Evidence | 覆盖选区、持久历史、计划终态、反问恢复、切章采纳；补实际打包 smoke。取得 clean revision 后重跑门禁，按单一 owner 规则更新证据 |

多资产恢复应独立排期；不与上述修复混成一次大重构。真实模型小样本评价只能在获得授权后使用合适语料开展，不能将长时付费 Provider soak 自动加入常规门禁。

## 9. 建议补充的验收指标

确定性不变量与模型效果应分开。下表的“全部通过”指设计好的回归集，不是以有限样本宣称现实世界零风险。

| 指标 | 定义与最低验收方向 |
| --- | --- |
| 项目/会话隔离 | 非目标资产读取、压缩错写及错会话恢复的回归反例全部被阻断 |
| JIT 恢复成功率 | 所有声明 recoverable 的省略内容，经本轮可用工具恢复后与固定原文一致；过期引用显式失败 |
| 来源变更检出 | 每类可变资产读后更新均被检出，或明确使用可验证的旧版本；统计不能只覆盖已手工登记的源 |
| Memory 准入一致性 | 目录与正文使用相同 eligibility 集合；按时间、冲突、更新、作用域分别验证 |
| 候选池召回 | 目标是否进入候选池，与最终 top-k 是否命中分开；按章节位置、语料规模、词法/语义查询分层 |
| 对话保真 | turn 完整、关键决定与未决事项保留、来源覆盖诚实、压缩后原事件可恢复 |
| 终态一致性 | Agent、plan、HTTP/WS、UI 对 completed/incomplete/cancelled/failed 的表达不相互矛盾 |
| 效果与成本 | 授权语料上记录任务成功、约束违反、人工采纳及延迟/token/工具次数，不预设未经测量的 SLA |

长期记忆用例可借鉴 LongMemEval 的能力分类，但应改成小说领域：早期伏笔定位、跨会话作者决定、章节时点、旧设定被新设定取代、证据不足时不臆造。无需直接导入整套 benchmark，也不需要建立全局 Judge 排行榜。

建议每个工程回归至少穿过一个真实业务入口及两个相邻 owner；失败时能定位在 indexing/retrieval/reading/执行哪一层。真实写作质量再通过脱敏、授权的小样本人评或受控对照补充，不能用源码审阅代替。

## 10. 外部参考与适用范围

- R1：Anthropic，2025-09-29，[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)。依据：轻量索引 + JIT、渐进披露、compaction、结构化笔记；不是“上下文越多越好”。
- R2：Anthropic，2026-04-08，[Scaling Managed Agents: Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents)。依据：session 是独立、持久、可查询的事件记录，不等于模型 context window；不外推其云平台性能数据。
- R3：LangGraph 官方文档，[Stores](https://docs.langchain.com/oss/python/langgraph/stores)、[Use the functional API](https://docs.langchain.com/oss/python/langgraph/use-functional-api)、[Functional API](https://docs.langchain.com/oss/python/langgraph/functional-api)。依据：thread/namespace 隔离、持久执行、确定性与副作用/幂等边界；不构成迁移框架建议。
- R4：[LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813)，参阅 2025-03-04 修订版。依据：信息提取、跨会话推理、时间推理、知识更新与拒答，以及 indexing/retrieval/reading 分阶段分析；不把论文分数当作本项目基线。
- R5：Anthropic，2024-09-19，[Introducing Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)。依据：chunk 局部上下文、词法与 embedding 检索组合、rerank 与语料内测量；文中收益不可直接套用到本项目。
- R6：Anthropic，2024-12-19，[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)。依据：从简单可组合方案开始，按任务需要选择 workflow 或自治 Agent。该文提示生态已更新，故结合较新的 R2 解读。
- R7：BAAI，[bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)，实验绑定 revision `7999e1d3359715c523056ef9478215996d62a620`；核验 [tokenizer.json](https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/7999e1d3359715c523056ef9478215996d62a620/tokenizer.json)、[config.json](https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/7999e1d3359715c523056ef9478215996d62a620/config.json)、[tokenizer_config.json](https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/7999e1d3359715c523056ef9478215996d62a620/tokenizer_config.json)。依据：真实分词与模型窗口，不是模型推理质量测试。

最终判断：现有设计值得继续演进；优先投资应落在“身份、来源、恢复、准入、终态”穿透主链路的可信合同。只有这些合同与真实入口验收闭合后，才适合对长期记忆可靠性和自主任务完成度作更强承诺。
