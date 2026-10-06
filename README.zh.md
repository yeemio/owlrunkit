# OwlRunKit

[English](README.md) · **中文**

[![npm](https://img.shields.io/npm/v/owlrunkit)](https://www.npmjs.com/package/owlrunkit)
[![license](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.19.0-339933)](package.json)

> **别问 AI 做完没有，看候选、证据、责任人和剩余权限。**

OwlRunKit 是面向 AI Agent 交付的证据型 Project Driver。它把当前目标、
WorkItem、候选身份、验证回执、交接、返工和交付阶段保存在项目里，让工作跨
Agent、跨会话、跨 worktree 后仍可恢复、可核对。

RunKit 不是 Agent 启动器，也不是包裹每条命令的审批系统。普通开发应保持轻量；
只有真实连续性需求或风险事实出现时，才增加治理强度。

## 它解决什么问题

AI 写完代码之后，真正昂贵的错误通常是：

- 新会话不知道当前目标和候选到底是哪一个；
- 源码已经变化，却继续复用旧的绿色测试；
- 把实现完成误说成已获 Git、发布、部署或业务授权；
- 交接时丢失责任人、证据和唯一合法下一步；
- 把工单账完成误说成产品已经上线并通过业务验收。

OwlRunKit 把这些边界变成本地、可检查的工程事实。它记录发生了什么、还缺什么，
但不替业务产品解释结果的业务含义。

## 只使用需要的重量

RunKit 把两个问题正交拆开：

- **连续性（continuity）**：`none` 或 `project_driver`
- **验收强度（assurance）**：`none`、`quick` 或 `formal`

用户看到五种模式：

| 模式 | 适合场景 | 实际行为 |
|---|---|---|
| `off` | 分析、文档、一次性探索 | 不创建 RunKit execution 或 receipt |
| `light` | 一个低风险冻结候选 | 一次聚焦 Quick 验证 |
| `managed` | 跨会话或多阶段交付 | Project Driver，加每个 WorkItem 自己需要的证据 |
| `formal` | 不可逆、迁移、安全、权限、资金或明确正式验收 | 严格候选、lease 与 evidence 合同 |
| `auto` | 默认推荐 | 根据当前事实选择，但不授予任何外部权限 |

周期长不等于必须 Formal；出现 production 或 release 标签也不等于必须 Formal。
真正决定强度的是风险、可回滚性、writer/authority 数量、迁移、安全、资金和明确
验收合同。

## 产品边界

RunKit 管交付连续性与证据：

```text
目标 + WorkItems
  -> 候选身份
  -> 验证证据
  -> 交接 / 返工 / 恢复
  -> 源码验收
  -> 集成
  -> 部署
  -> 线上读回
  -> 产品验收
```

每一层都独立。除非另一个有授权的系统真正执行外部动作，所有结果始终保持
`authorizationGranted=false`。

RunKit **不负责**：

- 领域产品的 Business Truth、WorkCase、业务语义或最终决策；
- 执行器的 Attempt 或 Session 身份；
- Git、发布、部署、生产、自动化、资金或 BusinessAction 权限；
- 自动选模型或自动派发 Agent。

在 OwlCoda 产品家族中，[OwlCoda](https://github.com/yeemio/owlcoda) 负责受治理的
业务执行架构，可替换执行器负责实际执行，OwlRunKit 让交付进度可验证、可移交、
可恢复，但不会成为业务产品的 Business Truth。

## 当前版本

当前公开版本是 `owlrunkit@0.24.0`，主要公开能力包括：

- Project Driver 和类型化交付生命周期；
- Quick / Formal 验证及源码绑定回执；
- 控制 worktree 与冻结目标 worktree 分离；
- Team Delivery 只读建议与可移植交接包；
- 严格有界的会话压缩恢复投影；
- 可选的 RunKit 文件事件触发 Codex 原生 Stop hook 继续机制；
- 完成项目的后续漂移识别和只读 successor 草案；
- bootstrap、profile、registry、Core 和共享 Skill 的 fail-closed 诊断。

本仓库是 OwlRunKit 的公开对应源码、文档、Issue、Release 和信任入口。日常开发
仍在私有源码仓库进行；每个受 GPL 覆盖的 npm 版本都必须对应一个精确公开源码
Tag。

## 可选的文件事件触发

0.24.0 默认关闭这项功能。显式配置并绑定现有任务后，Codex 在同步 Stop
hook 中等待；匹配的 RunKit checkpoint 文件写入会触发原会话继续处理交付。
等待使用操作系统文件通知，不定时调用模型。

绑定包含 workspace、项目定义、WorkItem、assignment、冻结候选、事件和原会话。
关闭绑定、任务被替代、候选不匹配或重复事件均不会触发继续。继续请求只是通知，
不代表交付已验收，也不授予新的权限。

原会话必须仍在 Stop hook 中等待。这项功能不能重新启动已完全结束的空闲桌面
回合；等待超过显式时限会退出。真实探针使用 Codex 0.160.1 与离线响应源验证了
原生继续路径，没有调用付费模型。安装包本身不会启用 hook、改全局配置或升级
其他项目。

完整配置、原生 `/hooks` 信任确认、关闭和恢复步骤见
[英文设置说明](README.md#optional-codex-file-event-stop-hook)。

## 安装

请在项目中精确锁定版本，并始终使用项目本地 CLI：

```bash
npm install --save-exact owlrunkit@0.24.0
npx --no-install owlrunkit --version
```

首次接入或跨版本升级，先做只读预检，再应用：

```bash
npx --no-install owlrunkit bootstrap --workspace "$PWD" \
  --exact owlrunkit@0.24.0 --dry-run
npx --no-install owlrunkit bootstrap --workspace "$PWD" \
  --exact owlrunkit@0.24.0 --apply
npx --no-install owlrunkit doctor --workspace "$PWD"
npx --no-install owlrunkit mode recommend --workspace "$PWD"
```

不要用可能指向旧版本的裸全局 `owlrunkit` 命令解释项目真值。

## 最小日常用法

普通低风险候选可以只跑一次 Quick：

```bash
npx --no-install owlrunkit quick-verify \
  --workspace "$PWD" --attest -- npm test
```

跨会话项目先看紧凑状态：

```bash
npx --no-install owlrunkit inspect --workspace "$PWD" --json --compact
npx --no-install owlrunkit project status --workspace "$PWD"
```

完整命令、合同和安全边界见英文 README 后续章节，以及
[`docs/architecture`](docs/architecture/) 下的公共合同。

## 许可证与安全

OwlRunKit 按 [`GPL-3.0-or-later`](LICENSE) 发布。安全问题请按
[SECURITY.md](SECURITY.md) 私下报告；贡献方式见
[CONTRIBUTING.md](CONTRIBUTING.md)。
