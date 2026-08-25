# Agent Note: 外部 CLI Team teammate

Status: implemented

[English](2026-08-25-external-cli-team-teammates.md) | 中文

## Problem

Agent Teams 需要把真实外部 coding CLI 安排为 rostered teammate，同时不让这些 CLI 拥有 DSH Session、roster、mailbox 或 child Activation。桥接层必须保留既有的持久 Team message flow，并适配每个产品的非交互命令行。

## Decision

`@deepseek-ai/dsh-experimental-agent-team-external-cli` 注册一个 continuable subagent provider 和一个子作用域 LLM adapter。每个已配置 provider 实例拥有一个 `command`、一个 `cliKind` 和一个 provider name，因此一次 Team run 可以并排挂载独立的 `agy`、`claude` 与 `codex` teammate。

`agy` 调用为 `agy -p=<prompt> --output-format text --dangerously-skip-permissions`。`claude` 调用为 `claude -p --output-format text --permission-mode <mode> <prompt>`。`codex` 调用为 `codex exec --skip-git-repo-check --sandbox <codexSandbox> --output-last-message <temp-file> <prompt>`，adapter 会优先使用该 last-message 文件，而不是收集到的 stdout。

桥接层会为每个已接受的 Team turn 调用一次外部 CLI。它会从渲染后的 user instruction 中移除 Team mailbox framing，把 CLI 回复记录为该 teammate 的 assistant message；当该 turn 来自 Team mail 时，同一段文本也会作为 quiet Team reply 发回。

## Alternatives considered

**原生 CLI resume。** 本桥接层拒绝该方案，因为每个产品都需要分别证明一条会可靠退出的非交互 resume 路径。一次性 turn 能保留持久 DSH mailbox 行为，而不依赖另一个产品的 session ownership model。

**一个 provider 按消息选择 command。** 拒绝该方案，因为 provider name 是 Team roster 的 routing identity。为每个外部 CLI 挂载一个已配置 provider，可让 command、argv、environment 与 model metadata 在进程注册表中保持显式。

**解析 Codex transcript output。** 拒绝该方案，因为 `codex exec --output-last-message` 会把 assistant text 写入文件。读取该文件可避免依赖可能包含运行 metadata 的 presentation output。

## Consequences

Team service 继续拥有 roster state 与 mailbox delivery。外部 CLI 是可替换的进程 adapter，而不是 harness 外部的持久 Team peer。在证明并配置 provider-specific resume 路径之前，CLI 原生 session 之间的多轮连贯性仍刻意缺席。

## Testing

Package tests 使用 fake process 覆盖 Team seating、mailbox delivery、failure propagation、dispose，以及 Codex last-message path。`packages/experimental/agent-team-external-cli/demo/agy-team-demo.ts` 中的真实 demo 会一起挂载已安装的 `agy`、`claude` 和 `codex` binary，并打印每个 teammate 的 CLI path、roster entry、accepted inbound message、assistant reply 与 Team reply。
