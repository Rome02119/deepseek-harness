# Agent Note: External CLI Team teammates

Status: implemented

English | [中文](2026-08-25-external-cli-team-teammates.zh.md)

## Problem

Agent Teams needs to seat real external coding CLIs as rostered teammates without giving those CLIs ownership of the DSH Session, roster, mailbox, or child Activation. The bridge must preserve the existing durable Team message flow while adapting each product's non-interactive command line.

## Decision

`@deepseek-ai/dsh-experimental-agent-team-external-cli` registers a continuable subagent provider and a child-scoped LLM adapter. Each configured provider instance owns one `command`, one `cliKind`, and one provider name, so a Team run can mount separate `agy`, `claude`, and `codex` teammates side by side.

The `agy` invocation is `agy -p=<prompt> --output-format text --dangerously-skip-permissions`. The `claude` invocation is `claude -p --output-format text --permission-mode <mode> <prompt>`. The `codex` invocation is `codex exec --skip-git-repo-check --sandbox <codexSandbox> --output-last-message <temp-file> <prompt>`, and the adapter prefers that last-message file over collected stdout.

The bridge invokes the external CLI once per accepted Team turn. It strips Team mailbox framing from the rendered user instruction, records the CLI reply as the teammate's assistant message, and sends the same text as a quiet Team reply when the turn came from Team mail.

## Alternatives considered

**Native CLI resume.** Rejected for this bridge because each product needs a separately proven non-interactive resume path that exits reliably. One-shot turns preserve the durable DSH mailbox behavior without depending on another product's session ownership model.

**One provider with per-message command selection.** Rejected because provider names are the Team roster's routing identity. Mounting one configured provider per external CLI keeps command, argv, environment, and model metadata explicit at the process registry.

**Parse Codex transcript output.** Rejected because `codex exec --output-last-message` provides the assistant text as a file. Reading that file avoids depending on presentation output that can include run metadata.

## Consequences

The Team service continues to own roster state and mailbox delivery. External CLIs are replaceable process adapters, not durable Team peers outside the harness. Multi-turn coherence across CLI-native sessions remains intentionally absent until a provider-specific resume path is proved and configured.

## Testing

The package tests cover Team seating, mailbox delivery, failure propagation, disposal, and the Codex last-message path with a fake process. The real demo in `packages/experimental/agent-team-external-cli/demo/agy-team-demo.ts` mounts the installed `agy`, `claude`, and `codex` binaries together and prints each teammate's CLI path, roster entry, accepted inbound message, assistant reply, and Team reply.
