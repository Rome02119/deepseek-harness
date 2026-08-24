# Agent Note: Agent Team external CLI teammate bridge

Status: implemented

[English](2026-08-24-agent-team-external-cli-bridge.md) | 中文

## Problem

Agent Teams 可以把进程内 DSH continuable child 保留在 durable roster 上，但从 DSH 视角看，Claude Code、Codex 或 Antigravity 这样的外部 CLI agent 都是一次性进程调用。`startContinuable()` 只向 provider 请求 seed data，然后由自身创建 child Agent，因此外部进程不能拥有 Agent Team roster identity 或 Activation。Team mailbox 已经拥有 peer-message queueing、delivery 和 de-duplication；为 CLI teammate 再增加第二个 message log 会把同一条规则拆到两个存储里。

## Decision

`@deepseek-ai/dsh-experimental-agent-team-external-cli` 是单独的 experimental package，会为 rostered CLI teammate 注册 continuable subagent provider 和子作用域 LLM route。该 provider 不提供一次性 start capability，只通过 Agent Teams 的 continuable path 工作；在这条路径上，DSH 仍会创建 durable child Agent，而桥接层会在每个已接受的 turn 调用一次已配置的 CLI。

已证明的路径会把当前 DSH child user instruction 发送给 `agy -p=<prompt> --output-format text --dangerously-skip-permissions`，并把 stdout 记录为该 child 的 assistant message。本包也有 Claude argv 形式，但不使用 Claude 原生 session flags：当前 CLI 在这条 subprocess 路径上使用 `--session-id` 可能挂起，并且会拒绝另一个进程复用同一个 `--session-id`。在为每个目标 CLI 证明可靠原生 resume 路径前，超出当前 instruction 的连贯性仍然有限。当 turn 由 Team mail 触发时，同一段 stdout 会通过 `ctx.agentTeams.sendMessage` 作为 quiet Team message 发回发送者，因此现有 `team/message/queued` 和 `team/message/delivered` 记录仍是唯一的 mailbox state。

## Alternatives considered

- **让 `startContinuable()` 返回外部进程 handle** — continuation manager 当前拥有 child Agent、inbox、Activation lifecycle、cold resume 和 settlement reporting；把这些替换成 provider-owned process handle 是更大的 capability redesign，不是把 CLI teammate 安排入座的最小真实方案。
- **为 CLI agent 写 sidecar `.dsh/messages.jsonl` 文件** — 这会创建第二个 durable mailbox，并带有不同的 delivery 和 de-duplication 规则，因此 Team message 可能在 root session log 和 sidecar 之间漂移。
- **立刻添加 Codex 原生 resume** — Codex 的非交互输出包含 transcript wrapper，resume 行为也需要单独的 Team-path 证明，才能不只是一个单 turn generator。

## Consequences

这是桥接层，不是真正的外部 continuation。DSH 仍拥有 roster member、child session、mailbox event、author/verifier check 和 disposal；外部 CLI 只拥有每个 turn 的文本生成。该设计让 Team durability 保持集中，并让 CLI failure 成为普通的 teammate turn failure，但代价是每次调用都要渲染 transcript context，并且首个 package 只支持文本形式的 `agy` turn。
