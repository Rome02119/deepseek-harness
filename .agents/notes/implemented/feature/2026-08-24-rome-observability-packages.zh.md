# Agent Note: Rome 订阅与实时 Agent 可观测包

Status: implemented

[English](2026-08-24-rome-observability-packages.md) | 中文

## Problem

本地 Claude Code、Codex 和 Antigravity CLI 的帮助信息没有提供订阅配额值，OmniRoute 的测试本地路由也没有提供未经认证的使用量数据。DSH 已经拥有 live Agent 和 Agent Teams 状态，但现有浏览器客户端围绕单个对话组织，缺少适合手机并排查看的紧凑视图。

## Decision

两个 Rome 自有包通过现有 host web-server 注册扩展点提供只读投影。`@rome/dsh-subscription-quota` 在来源不能报告使用量、上限或剩余额度时使用字面值 `unknown`。`@rome/dsh-live-agent-view` 根据 live Agent registry、存在时的 Agent Teams roster/task board 以及 session event log 提供 HTML 页面、JSON 快照和 SSE 流。页面没有修改路由，并使用内联响应式 CSS 以适应 390px 宽度。

这些投影不修改 DeepSeek 自有包，也不把压缩 token meter 当作配额统计。实时视图将缺少的任务或活动数据显示为 `unknown`，并在 Agent 生命周期、状态和 session event 变化后广播。

## Alternatives considered

**根据 token-meter 推断配额。** 否决，因为 token-meter 是压缩压力启发式，不是提供方订阅计量。

**向现有 API gateway 添加路由或复制浏览器应用。** 否决，因为 host web-server 已经提供独立挂载只读页面的注册表，无需修改 DeepSeek 自有传输或客户端包。

**提供方拒绝或省略使用量时显示零。** 否决，因为零是虚构的测量值，会误导配额决策。

## Consequences

只要组合提供 `ctx.webServer`，两个包即可挂载；没有 Agent Teams 时实时页面仍可工作，存在该服务时会补充 roster/task 信息。只有出现有文档且经过认证的提供方使用量来源后，配额行才会变为已知值。SSE 广播为进程内且无认证，因此部署访问控制仍由 host/网络配置负责。
