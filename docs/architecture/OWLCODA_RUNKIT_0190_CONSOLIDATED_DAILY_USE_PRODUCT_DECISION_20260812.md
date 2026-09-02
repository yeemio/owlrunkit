# OwlRunKit 0.19.0 Consolidated Daily-Use Product Decision

状态：**七个 Wave 已实现；私仓、tag、npm 与 exact-registry consumer 发布闭环已完成**

## Decision

0.19.0 是一次整合型小版本后的次版本升级。它不会继续拆出多个 0.18.x，
而是在一个 release candidate 中收敛 0.18.4 明确留下、且已被 OwlChen、MES、
OwlFootball 和 MERM dogfood 重复验证的十类摩擦。

长期产品原则保持不变：RunKit 默认轻、必要时重。它是飞行记录仪和阶段控制器，
不是每条研发命令的审批系统。

## Product Axes

用户可见 mode 继续只是两个正交维度的 preset：

- continuity：`none | project_driver`
- assurance：`none | quick | formal`

长周期、跨会话和多阶段主要提高 continuity。只有多 authority、多 writer、资金、
权限、安全、不可逆变更、回滚不确定、schema/data migration 或明确 Formal
acceptance 才强制 Formal。风险解除后允许降级，升级不成为粘性状态。

## 0.19.0 Scope

### Wave 1 — Atomic onboarding

- 一条可预览、可原子应用、失败可回滚的 bootstrap；
- `init --help` 与空 profile 首次接入死锁；
- project-local exact binding 和 shared Skill drift 的明确诊断。

### Wave 2 — Isolated verification

- 临时 dependency consumer 和工具缓存隔离；
- 源码、ignored cache、dependency environment 三类变化分离；
- 只有任务明确需要时才哈希绑定 ignored paths。

### Wave 3 — Evidence reuse

- 旧 receipt + 小范围允许 delta 的复用规划与精确增量 gate；
- 大 artifact 以 content-addressed hash/reference 去重，保留可恢复性。

### Wave 4 — Runtime and recovery truth

- `workspaceMutation`、`externalMutation`、`rollbackPerformed`、
  `finalExternalState`、`failedStage`、`lastPassedStage`、`rollbackOutcome`；
- recovery evidence 明确 `capturedBefore`、`restoresTo` 等语义。

### Wave 5 — Rework lifecycle

- 原生 reopen/invalidate upstream WorkItem；
- downstream waiting propagation；
- 原子 transfer/reject-and-return 高层动作，同时保留不可变底层事件。

### Wave 6 — Human outcome and economics

- 收据先展示业务阶段结果、验收层级和未证明边界；
- 统计重复命令、误阻塞、人工介入、handoff 等待和 time-to-acceptable-result；
- 指标用于约束 RunKit 自身摩擦，不以 receipt 数量冒充价值。

### Wave 7 — Release closure

- predecessor contracts 精确兼容或显式版本化 successor；
- 独立风险审查、Core identity、packed Skill/package、registry consumer；
- 一次性发布 `owlrunkit@0.19.0`。

## Safety And Authority Boundaries

- 用户 mode 是偏好，不是授权；较轻 mode 不能绕过强制 Formal 事实；
- RunKit 结果始终保持 `authorizationGranted=false`；
- receipt acceptance 不等于 commit、push、tag、publish、deploy、production 或业务验收；
- controller/target 必须是分离的真实目录，冻结 target 不接受控制 artifacts 注入；
- 已发布 strict schema 不原地重解释，破坏性变化必须新建版本并让 predecessor 共存；
- bootstrap 不静默刷新用户级/fleet Skill，不静默修改 Git，不联网执行发布动作。

## Evidence Layers

界面与 receipt 必须依次区分：

1. candidate file identity；
2. workspace/overlay attestation；
3. verification command/test result；
4. UX 或独立产品验收；
5. deployment/runtime activation；
6. production 或业务有效性。

低层证据不得自动提升为高层结论。

## Release Truth And What Cannot Be Claimed

- `owlrunkit@0.19.0` 已由私仓 release commit `830aa91c` 发布，npm
  `latest` 已读回为 `0.19.0`；精确 registry consumer 已完成原子
  bootstrap、doctor、profile、inspect、Quick 与 metrics 验证；
- 发布不等于 fleet/shared Skill 激活、OwlCoda 项目 Core 迁移或任何外部项目
  adoption；这些仍需要各自安全边界和独立读回；
- 本文记录产品决策和已发布能力，完整 registry 字节、测试与未触碰边界见
  `docs/handoff/OWLCODA_RUNKIT_0190_PRIVATE_GIT_NPM_RELEASE_RECEIPT_20260813.md`；
- public mirror、官网、8019、全局 Skill、生产与业务验收不属于本次授权，不能
  从本次 package release 推导为已完成。
