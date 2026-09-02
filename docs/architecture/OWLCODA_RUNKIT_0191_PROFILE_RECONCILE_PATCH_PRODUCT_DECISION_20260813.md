# OwlRunKit 0.19.1 Profile Reconcile Patch Product Decision

状态：**已发布；registry、私仓 tag、项目 adoption 与共享 Skill 激活均已读回**

## Decision

0.19.1 是 0.19.0 的兼容补丁，不扩展 RunKit 的产品范围。真实 OwlCoda
dogfood 发现，成熟项目已有 profile 持有 `npm-build`、`npm-test` 时，检测器
提出新的 `node-quality` profile 会重复这些全局 command ID，使 bootstrap 在
profile reconcile 阶段失败。

当检测出的 commands 只有一个现有 owner 时，reconcile 现在复用该 owner：
增加真实检测到的 paths，并以项目本地 authoritative tool binding 更新对应
command。它不会新增第二份重复 command，也不会削弱最终 profile 校验。

## Preserved Boundaries

- owner profile bytes 仍只通过原子 reconcile 事务更新，失败恢复原始 bytes；
- 多个不同 command owner 的歧义不会被静默合并；
- bootstrap、receipt 与 mode 仍不授予 Git、发布、部署、生产或业务权限；
- npm package 发布、项目 Core adoption 与 process-level shared Skill 激活仍是
  三个独立状态转换；bootstrap 只诊断 Skill drift，不静默刷新 fleet Skill；
- 0.19.0 的 continuity、assurance、Formal 和 predecessor-contract 边界不变。

## Release Truth

0.19.1 已通过成熟项目冲突回归、profile/bootstrap 聚焦测试、完整 RunKit
gate、Core identity、packed package/Skill、干净 consumer 和 npm registry
字节读回。发布源码是 `0367295c153ed36548a366633de39d5a1b832b3b`，tag
是 `owlrunkit-v0.19.1`，npm `latest` 是 `0.19.1`。

OwlCoda 项目已从官方 registry 精确采用 0.19.1，并得到 doctor `ready`、
profiles `valid`、inspect `idle` 与 Quick `GO`。process-level shared Skill 也在
完整 fleet 预检通过后原子升级到 0.19.1；58 个受管项目的 Core config 已生成
可回滚迁移回执。上述事实不授予 Git、部署、生产或业务权限。完整证据见
`docs/handoff/OWLCODA_RUNKIT_0191_PRIVATE_GIT_NPM_RELEASE_RECEIPT_20260813.md`。
