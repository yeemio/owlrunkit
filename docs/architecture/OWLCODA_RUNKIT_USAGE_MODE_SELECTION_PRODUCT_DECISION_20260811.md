# OwlCoda RunKit 使用模式选择：Sierac MES Dogfood 产品决议

状态：**0.18.3 已发布；本文主体保留既有产品决议，0.18.4 外部候选纳管决议另见同日架构文档**
日期：2026-08-11

## 已验证现场事实

以下结论来自对
一个真实 MES 项目的 `.owlcoda/runkit/` 只读检查，
不是体验推测：

- W1.6 留下四份 Quick Receipt V1。按回执生成时的 `exitResult` 与
  `mutationDecision` 分类，结果是 3 pass、1 fail、0 source mutation；四份均为
  `source_unchanged`。
- 旧版 `quick-metrics` 使用“当前 workspace 是否仍匹配历史回执”来统计历史结果。
  在后续源码变化后，它把四份回执全部错算为 `sourceMutated`，并输出
  `passed=0 / failed=0 / sourceMutated=4`。
- Quick 的实际测试命令发现了 W1.6 的 pytest 问题；RunKit 的价值是保留失败、
  绑定候选并阻止错误完成声明，不是替代项目测试发现业务缺陷。
- 三次相关 Quick 的机器耗时约九秒。主要摩擦来自人工选择模式、填写标识和
  时间戳、分别 checkpoint/integrate，以及排查不一致命令。
- Project Driver 对长线程、跨会话恢复、脏工作树和延期验收有实际价值。
- 现场成功回执长期携带 `quick_ignored_artifact_unbound`，但 attestation 仍可为
  GO；该 issue 目前缺少清晰、可行动的严重级别。

## 产品长期决策

RunKit 定位为“飞行记录仪和阶段控制器”，不是所有命令的审批系统。

用户看到五种模式，但内部不以单一枚举承担全部语义。路由始终保留两个正交维度：

| 用户模式 | continuity | assurance | 典型用途 |
| --- | --- | --- | --- |
| `off` | `none` | `none` | 分析、文档、一次性探索、无需复用证据的小任务 |
| `light` | `none` | `quick` | 单 writer、低风险、一个冻结候选、一条精确验证命令 |
| `managed` | `project_driver` | WorkItem 级 `none/quick/formal` | 跨会话目标、交接、checkpoint、gate |
| `formal` | 依连续性事实自动选择 | `formal` | 真正高风险或合同要求正式验收的边界 |
| `auto` | 按事实选择 | 按事实选择 | 默认推荐 |

模式只表达工作流偏好，不表达授权。任何模式都不得授予 Git、发布、部署、生产或
业务权限。

下列事实强制 Formal：多 writer、权限或安全边界、资金、不可逆变更、回滚不确定、
schema/data migration、明确 Formal acceptance。`off/light/managed` 不能覆盖这些
事实。

下列标签或事实单独出现时不强制 Formal：普通项目源码修改、`longRunning`、
`interruptionRecovery`、production、release、deployment。长周期和中断恢复主要
选择 Project Driver；单 writer、可回滚且有业务读回的普通源码变更可以是
`managed + quick`。风险被 containment 后必须重新路由，升级不具有粘性。

## 0.18.0 已有能力

- Quick Verification 保存 source-bound 命令回执、stdout/stderr 和失败状态。
- Project Driver 保存目标、WorkItem、依赖、checkpoint、handoff、decision、
  verification gate 和 takeover 状态。
- Formal Delivery 提供候选、lease、严格证据与正式验收边界。
- 所有这些能力都保持 `authorizationGranted=false`，验收与 Git/发布/部署/业务授权
  分离。

0.18.0 并没有提供五模式入口，也没有解决本次现场暴露的历史 metrics、Quick 后续
命令、`quick-attest --help` 和 Skill/Core 版本漂移诊断。

## 本轮 0.18.1 候选实现

### 使用模式只读入口

新增：

```bash
owlrunkit mode recommend --workspace "$PWD"
owlrunkit mode status --workspace "$PWD"
```

普通输出为人类可读文本；`--json` 提供严格机器结果。推荐结果包含：推荐模式、
continuity、assurance、触发原因、被拒绝的较轻模式、预计新增步骤和证据数、下一条
命令、降级是否允许，以及完整权限边界。

`mode status` 当前只报告 `default_auto`，不创建 `.owlcoda`，也不暗示已有持久化
设置。本轮没有实现 `mode set`。

### MVP 一致性修复

- `quick-metrics` 以历史回执自身的 `exitResult` 与 `mutationDecision` 统计 pass、
  fail 和 source mutation；当前 workspace 漂移不再改写历史结果。回执 schema、
  snapshot binding 和输出材料仍校验；Core/context 的信任结论继续由
  `quick-attest` 独立报告，不改写历史运行统计。
- Quick 结果的后续命令改为可执行的
  `owlrunkit quick-attest --workspace ... --receipt ...`。
- `quick-attest --help` 返回 action-specific help。
- assurance router 不再因普通 project mutation、long-running、interruption
  recovery 或 production/release/deployment 标签自动升级 Formal；真正强制事实仍
  fail closed，且解除后可以降级。
- Skill installer 的只读 `inspect` 同时检查受管文件完整性与运行包的
  Skill/config Core 版本；版本旧时明确返回 `version_mismatch`。
- 同一候选内的 profile 一致性修复不再为不存在、也无法从真实脚本/workspace
  推导出的 `src/**`、`tests/**` 制造阻塞项，并提供现有 profile 的原子 reconcile。

## 后续缺口

### P1：Quick warning 需要可行动语义

把 `quick_ignored_artifact_unbound` 区分为不影响当前决策的 maintenance note 与会
阻断复用的 issue。验收标准：GO 回执不再永久携带无法行动的高噪声告警；任何被
降级的提示仍在详细输出中可查，真实材料缺口继续 fail closed。

### P1：Project Driver 日常动作减负

自动生成安全的事件 ID 和时间戳，并提供一个原子“完成 WorkItem 并在条件满足时
integrate”动作；`completedUnits` 可从已声明的单工作项单位推导。验收标准：普通
单项完成不需要手填 ID/时间戳，也不需要两次独立命令，同时 append-only 事件和
重试幂等性不变。

### P1：验证指纹按真实路径范围绑定

Quick/coverage 应区分验证声明覆盖的源码、仅文档/空白变化和真正全局 gate。验收
标准：不相关文档或空白变化不会诱导重复大测试；声明范围内变化、lockfile 变化和
global gate 仍正确失效。

### P2：持久化模式偏好

只有在只读推荐经过更多 dogfood 后再评估
`owlrunkit mode set --mode auto|off|light|managed|formal`。验收标准：偏好具有明确
来源和审计读回，且永远不能覆盖强制 Formal 路由。

## 不能声称的内容

- 本文主体形成时记录的是 0.18.1 发布前候选；0.18.1 后续发布事实以
  `docs/PRODUCT-TRUTH.md` 和独立 release receipt 为准。本文本身不证明 npm、Core、
  Skill 或任何项目已升级。
- `mode recommend` 根据调用者提供的结构化事实路由；它不会自动发现所有业务、
  权限、资金或迁移风险。
- RunKit 降低进度、证据和完成状态幻觉，不直接解决 Sierac MES 业务问答幻觉。
  后者仍由 canonical 接口、schema、adapter 与 Answer Harness 负责。
- Quick 不是 Formal acceptance，Project Driver 不是测试执行器，任何 GO/accepted
  结果都不授予 Git、发布、部署、生产或业务权限。

## 版本建议

本组变更当时适合形成 `owlrunkit@0.18.1` 小版本候选：它保持 0.18 的 Project Driver
和回执合同，新增只读 CLI，并修复 dogfood 验证出的行为缺陷。候选只有在聚焦测试、
RunKit contract/package gate、Core 身份同步、pack 内容检查和安装 smoke 都通过后
才具备发布评审资格；发布、项目升级与运行时激活仍是之后的独立动作。

## 0.18.2 dogfood 补丁追加

0.18.1 发布后，Sierac MES 与 OwlChen 的项目级使用继续证明 `managed + quick` 是普通
跨会话源码 Wave 的合适默认，Formal 只应由真实高风险事实触发。OwlChen 已读回项目
本地 0.18.1 的 doctor、profiles、Formal、Quick、metrics 与模式选择器主路径；进程级
共享 Skill 因另一项目存在 active execution/lease 而停止升级，这是正确的安全边界，
不是缺陷。

这些后续 dogfood 暴露的缺口适合形成 0.18.2 patch，而不是新增平台能力：

- symlink workspace 拒绝时直接给出 canonical `--workspace`，包括 macOS
  `/tmp` 到 `/private/tmp`；
- `project checkpoint --help` 和 measured WorkItem 缺参错误给出完整命令；
- Quick 顶层返回有界 stdout/stderr 摘要，同时完整日志继续由回执绑定；
- doctor 对 registry transport 做一次重试、每次保留原有超时上限，并区分 DNS、连接、
  超时、HTTP、认证和版本缺失；
- `quick-verify --help` 可用，risk category 的帮助与错误列出同一组规范值；
- profile 纯格式规范化计划显式返回 `normalizationOnly: true`；
- package README 与五模式、profile reconcile 的已实现真值一致。

上述 0.18.2 内容已经发布；准确 Git/npm 身份以 `docs/PRODUCT-TRUTH.md` 和独立发布
回执为准。发布本身没有更新全局 Skill、迁移外部项目或授予业务权限。

## 0.18.3 Sierac recovery dogfood 修复（已发布）

### 新增现场事实

Sierac MES 三轮 0.18.2 实测继续支持“普通小任务少用、跨窗口使用 Project Driver、
高价值状态转换使用 Quick”的模式决议。冷启动 takeover 约 0.4 秒恢复了当前 truth，
并正确识别陈旧 handoff；一次 W1.8 回滚与 W1.9 恢复在串行读回后留下 GO Quick
attestation，且没有扩大到 Formal、生产、Git 或业务验收。

同一轮暴露了五个可复现的 Quick 产品缺口：

- 为把远端脚本精确交给 SSH，操作者只能把 base64 放进 argv；单个参数达到
  14,469 bytes，整条 argv 约 14,539 bytes，receipt 为 79,591 bytes。
- 顶层摘要只保留最后三行，无法同时展示前半段 W1.8 回滚与后半段 W1.9 恢复。
- 项目现存 13/13 Quick 都携带固定 `quick_ignored_artifact_unbound`，没有可行动差异。
- 日常 Quick 仍需第二次调用 `quick-attest`。
- `quick-metrics --help` 返回通用 invalid-input，默认结果无条件展开全部 receipt 路径。

### 本轮实现

- `quick-verify --stdin-file <file>` 将最多 1 MiB 的 regular non-symlink 输入复制到
  receipt store，以路径、大小和 SHA-256 生成 `OwlCodaQuickVerificationReceiptV2`，
  再把已保存字节作为 exact stdin；脚本内容不进入 argv 或 receipt JSON。
- `outputSummary` 同时返回有界 head 与 tail，完整 stdout/stderr 仍是唯一证据材料。
- 新 Quick 不再生成固定 ignored-artifact issue；历史 receipt 仍严格可读，但 attest
  不再把该推测性代码作为问题输出。未声明 ignored output 仍不属于 Quick 证明范围。
- `quick-verify --attest` 在一个高层调用中返回独立 attestation 对象，不把 Quick
  提升为 Formal。
- `quick-metrics --local` 默认只返回聚合；`--verbose` 才返回 receipt 路径，并新增
  action-specific help。
- 后续真实候选复核证明 RunKit 能保存“测试全绿但版本合同错误”的 rejection、Quick
  receipt、源码未变事实和重新责任人。`project reject-and-return` 因此作为同一
  0.18.3 候选的原子 Project Driver 动作：只接受当前显式 failed checkpoint，保留
  失败事件，记录 reviewer/reason/evidence，并创建新的 rework assignment。新记录使用
  Event V2，不改写 Event V1 合同。
- standalone npm 构建把 Contract v0.1/v0.2 的权威字节复制到 Skill 自身的
  `references/`，使发布包内相对链接和之后的 managed Skill 安装保持一致。

### 后续缺口

`project takeover` stale-handoff 与外部候选 delta 已进入未发布的 0.18.4 源码候选；
recovery evidence 的 `captured_before` / `restores_to` 语义字段仍未实现。Project Driver 自动 ID、时间戳、
单项完成与 integrate 合并，以及路径范围指纹仍保留在既有 backlog。

### 不能声称

`0.18.3` 已在后续独立发布 Gate 中完成 commit、tag、npm publication 与 registry
consumer smoke；安装、项目 adoption、共享 Skill 激活和业务结果仍是不同事实。
`0.18.4` 的 controller/target 分离与外部 DeliveryPacket 纳管边界见
`OWLCODA_RUNKIT_0184_EXTERNAL_DELIVERY_INTAKE_PRODUCT_DECISION_20260812.md`；该版本当前仍只是源码候选。
