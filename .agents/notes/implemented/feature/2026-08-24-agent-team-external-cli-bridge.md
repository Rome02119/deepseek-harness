# Agent Note: Agent Team external CLI teammate bridge

Status: implemented

English | [中文](2026-08-24-agent-team-external-cli-bridge.zh.md)

## Problem

Agent Teams can keep in-process DSH continuable children on a durable roster, but an external CLI agent such as Claude Code, Codex, or Antigravity is a one-shot process invocation from DSH's point of view. `startContinuable()` asks a provider only for seed data and then creates the child Agent itself, so an external process cannot own the Agent Team roster identity or Activation. The Team mailbox already owns peer-message queueing, delivery, and de-duplication; adding a second message log for CLI teammates would split one rule across two stores.

## Decision

`@deepseek-ai/dsh-experimental-agent-team-external-cli` is a separate experimental package that registers a continuable subagent provider and a child-scoped LLM route for rostered CLI teammates. The provider contributes no one-shot start capability and only works through Agent Teams' continuable path, where DSH still creates the durable child Agent and the bridge invokes the configured CLI once per accepted turn.

The proven path sends the current DSH child user instruction to `agy -p=<prompt> --output-format text --dangerously-skip-permissions` and records stdout as the child's assistant message. The package also has a Claude argv form, but it does not use Claude's native session flags: the current CLI can hang with `--session-id` in this subprocess path and rejects reusing the same `--session-id` from another process. Continuity beyond the current instruction remains limited until a reliable native resume path is proven for each target CLI. When the turn was caused by Team mail, the same stdout is sent back to the sender as a quiet Team message through `ctx.agentTeams.sendMessage`, so the existing `team/message/queued` and `team/message/delivered` records remain the only mailbox state.

## Alternatives considered

- **Teach `startContinuable()` to return an external process handle** — the continuation manager currently owns the child Agent, inbox, Activation lifecycle, cold resume, and settlement reporting; replacing that with a provider-owned process handle is a larger capability redesign, not the smallest truthful way to seat a CLI teammate.
- **Write a sidecar `.dsh/messages.jsonl` file for CLI agents** — that creates a second durable mailbox with different delivery and de-duplication rules, so Team messages can drift between the root session log and the sidecar.
- **Add Codex native resume immediately** — Codex's non-interactive output includes a transcript wrapper and its resume behavior needs separate Team-path proof before it can be more than a one-turn generator.

## Consequences

This is a bridge, not true external continuation. DSH still owns the roster member, child session, mailbox events, author/verifier checks, and disposal; the external CLI owns only the text generation for each turn. The design keeps Team durability centralized and makes CLI failure an ordinary failed teammate turn, but it pays for that by rendering transcript context on every invocation and by limiting the first package to text-only `agy` turns.
