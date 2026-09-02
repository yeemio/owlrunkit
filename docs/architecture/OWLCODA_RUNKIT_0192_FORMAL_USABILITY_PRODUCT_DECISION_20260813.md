# OwlRunKit 0.19.2 Formal Usability and Project Driver Honesty Product Decision

状态：**候选实施中；尚未发布、采用或激活**

## Decision

0.19.2 是一次整合型 Formal 可用性与 Project Driver 诚实状态补丁。它集中修正
OwlChen 与 OwlFootball 真实主线 dogfood 中已经复现的接入摩擦，不增加新的
Gate，也不放宽 Verification Envelope 的执行边界。

目标是让合法项目命令在执行前获得可行动的静态诊断，让失败回执区分源码
失败与环境不兼容，并允许同一源码候选的本地或联网补充验证被明确标记、绑定
和汇总。补充验证永远不是 Formal 门禁证据。

Project Driver 同时把“工单账完成”与“获准 Git、发布、部署或上线”拆成两个
不同事实，并把独立验收者、诊断后的范围修订和缺少绑定验证回执做成可执行
合同，而不是只留在 Agent 提示词里。

## Scope

### Formal envelope preflight

- 新增只读 `formal preflight --envelope <file>`；
- 输出 backend、阶段命令、已知隐式子进程、临时目录和 RunKit runtime 扫描
  冲突；
- 对必然失败的能力缺口返回 blocker，并给出最小 envelope 修正建议；
- `formal check --envelope` 在写入 candidate、check 或 evidence 前复用同一
  preflight，已知 blocker 零写入停止。

### Typed Formal failure

Formal Check V2 保留以下稳定分类词汇：

- `source_check_failed`；
- `envelope_capability_missing`；
- `toolchain_resolution_failed`；
- `network_policy_blocked`。

分类只能来自 RunKit runner/backend 的受信结构化事实，不能解析被测命令可伪造
的 stdout/stderr。当前 macOS backend 能证明 backend capability、launch/toolchain、
cleanup/source 失败；只有后续 backend 明确返回结构化 network-denial cause 时才发出
`network_policy_blocked`。无法归因的命令非零退出保守记为 `source_check_failed`。

旧 `OwlCodaRunKitFormalCheckV1` 字节和语义保持不变。新增字段通过 V2
合同发布，读取器同时支持 V1 与 V2。

### Source-bound supplemental evidence

新增：

```text
owlrunkit formal attach-evidence \
  --workspace <root> --run-id <id> --evidence-id <id> \
  --kind supplemental-local|networked --receipt <quick-receipt.json>
```

附件必须通过完整 Quick attestation，并与当前有效 Formal SourceCandidate
在同一 workspace 状态下绑定。它保存自己的 Quick workspace fingerprint，
同时绑定 Formal `sourceFingerprint`、candidate path 和 candidate hash。
Formal Core 使用运行时计算的当前 Core identity 调用被 Core manifest 绑定的
Quick attester；发布面中自引用的当前 identity 字段不参与该运行时信任判断。
`supplemental-local|networked` 是操作者声明的执行环境分类；Quick Receipt V3
并不证明网络是否被使用，因此附件和摘要必须同时写明
`classificationBasis=operator_declared_not_attested`，不得把该标签说成 attested fact。

`formal finish --decision accepted` 自动生成一份 Evidence Summary，列出当前源码的 Formal checks
与 supplemental evidence。只有 Formal-eligible checks 参与 acceptance；摘要必须
明确声明 supplemental evidence 为 non-gating，不能替代 sandbox、授权或业务验收。

### CLI and runtime-root guidance

- `formal finish --help` 展示 `--decision` 与 `--finalize-id`；
- `formal preflight` 和 `formal attach-evidence` 有 action-specific help；
- 已存在但缺 help 的 Project Driver actions 补齐；
- broad lint/format/test 命令可能扫描 `.owlcoda/runkit/**` 时，在 Formal
  preflight 中直接给出 ignore 修正，而不是等待 sandbox 执行失败。

### Project Driver honesty and first-use repair

- Project Status V3 与 Takeover V3 保留 `overall=completed` 的工单账语义，但在
  没有外部授权时固定输出
  `deliveryDisposition=code_complete_without_release_authority`、
  `dominantGap.kind=release_authority` 和一条非空外部授权下一动作；
- `authorizationGranted` 始终为 `false`，Project Driver 不能自行授予 Git、发布、
  部署、生产或业务权限；
- 进入 `verifying` 前必须由另一 Agent 接管当前 assignment，同一实现者直接把
  自己标为 verifying 时零写入拒绝，并返回可复制的 handoff/assignment 修正路径；
- 新增 append-only Event V5 `project work-item revise-scope`，允许当前 Owner 在
  诊断后 supersede `ownedPaths` 与 measurable 合同；原 definition 和历史事件不被
  改写，范围修订后旧 checkpoint 不再证明新范围已完成；
- `verifying` 或 `completed` checkpoint 未引用可识别的 Quick/Formal 回执时，
  Status V3 输出 `no_bound_verification_receipt` warning。该 warning 只证明缺少引用，
  不证明引用本身已经通过 attestation；
- 已存在 Project Driver definition 时，`mode recommend --mode auto` 保持
  `managed + assurance none|quick`，不再把已初始化的总控账本劝回 `off`；
- Project Driver 时间戳接受 ISO-8601 UTC 秒精度或最多三位小数，并以 `.sssZ`
  规范化保存；action help 展示必填 measured checkpoint 与 scope revision 参数；
- 对已通过 gate 的 defer 仍 fail-closed，但错误必须同时给出新 gate 或
  `project successor` 的可行动路径。

## Preserved Boundaries

- supplemental evidence 永远 `gating=false`、`authorizationGranted=false`；
- accepted Formal 仍要求当前源码至少一条有效 Formal-eligible passed check；
- preflight、attachment、summary 不授予 Git、发布、部署、生产、凭据或业务权限；
- 不自动修改项目 lint/format 配置，不扩大 writable paths、network 或 subprocess
  allowlist；
- Linux backend 仍 fail-closed，本轮不新增执行器；
- 已发布 V1 schema 不原地重解释；破坏性变化使用 successor schema；
- SourceCandidateV2 文档支持上限为 64 MiB、2,000,000 个 JSON value；freeze
  在任何该候选 payload 或 candidate 写入前使用与 reader 相同的上限检查；
- 0.19.2 package、Git、tag、npm、项目 adoption 与 shared Skill activation 是独立
  状态转换，本文不能证明其中任何一个已完成。

## Acceptance Scenarios

1. backend 缺失、已知 subprocess 缺口或 broad scan 冲突在 Formal 写入前阻止执行；
2. 正常 source assertion 失败分类为 `source_check_failed`；
3. launch/toolchain 与 sandbox capability 由结构化事实分类；命令输出中的同名文本
   不能改变分类，未被 backend 证明的 network cause 不冒充 policy fact；
4. source drift、失败 Quick receipt、材料漂移或不同 workspace 的附件 fail-closed；
5. 合法 supplemental-local/networked receipt 可被当前 candidate 绑定；
6. source 改变后旧附件保留但不进入当前 Evidence Summary；
7. accepted finish 的摘要同时展示门禁 Formal checks 和 non-gating attachments；
8. 没有 passed Formal check 时，attachments 再多也不能 accepted finish；
9. 新旧 FormalCheck 合同都可读取，V1 输出不变；
10. 所有新增结果保持 `authorizationGranted=false`。
11. 工单账全部完成后，Status/Takeover 仍醒目显示未获发布授权，且下一动作不为
    `none`；
12. 同一 Agent 直接进入 verifying 零写入拒绝，另一 Agent 完成 handoff/assignment
    后可进入 verifying；
13. scope revision 不改写 definition，旧 revision/checkpoint 不能证明新范围；
14. `...ssZ` 时间戳被接受并规范为 `...ss.000Z`，所有 action help 可直接执行；
15. 已初始化 Project Driver 的 auto mode 推荐 managed，缺绑定回执只产生 warning，
    不自动升级 Formal。

## Release Truth

当前只授权形成和验证 0.19.2 source candidate。未授权 commit、push、tag、npm
publish、项目升级或 shared Skill 更新。候选必须先通过聚焦合同测试、相关 RunKit
gate、Core identity 与真实 packed-consumer dogfood，之后才能单独决定发布。
