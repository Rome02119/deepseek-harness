# @deepseek-ai/dsh-experimental-agent-team-external-cli

English | [中文](README.zh.md)

Experimental Agent Teams provider that seats a one-shot external CLI as a continuable teammate through a small in-process bridge. The Team roster and durable mailbox remain owned by `@deepseek-ai/dsh-experimental-agent-team`; this package only registers a continuable subagent provider and a child-scoped LLM adapter that invokes `agy -p` or `claude -p` for each teammate turn.

## Config

```yaml
- id: agy-team-provider
  name: '@deepseek-ai/dsh-experimental-agent-team-external-cli'
  config:
    providerName: agy-team
    command: agy
    cliKind: agy
    permissionMode: dontAsk
    disposeGraceMs: 3000
    stdoutMaxBytes: 1048576
    stderrMaxBytes: 65536
```

`providerName` is the name passed to `spawnTeammate()`. The provider supports only continuable children. One-shot `ctx.subagents.start()` calls fail visibly because Agent Teams needs a resident in-process child to own the roster identity. `command` may be a PATH name or absolute executable. `cliKind` selects the target argv form; `agy` is the proven path in this worktree. `permissionMode` is forwarded only for `claude`. The byte limits bound collected stdout and stderr for each invocation.

## Behavior

`spawnTeammate()` creates a normal continuable DSH child. For children whose descriptor uses this provider, the package installs an `agent/request` route that sends each accepted turn to the internal external-CLI LLM adapter. The adapter renders the teammate's derived DSH transcript, invokes:

```sh
agy -p=<rendered-prompt> --output-format text --dangerously-skip-permissions
```

and streams stdout back as the child's assistant message. For `claude`, the bridge uses `claude -p --output-format text --permission-mode <mode> <rendered-prompt>`. The bridge does not use native resume flags: current Claude CLI testing showed `--session-id` rejecting reuse from a second process and `--resume` hanging in this subprocess path; `agy --continue` was not verified through the Team path. Each turn sends the current user instruction from the DSH child session, with Team mailbox framing stripped before invoking the CLI. When the turn was triggered by Team mail, the same stdout is also sent as a quiet Team message back to the sender through the existing mailbox. Team peer messages therefore still flow through `team/message/queued`, target `user/message` delivery, target `assistant/message` reply, optional quiet reply delivery, and normal Team task author/verifier checks.

## Model Experience

### Teammate replies

#### What the model sees

Delivered Team messages remain user-role messages from `team/message/queued` delivery. CLI output becomes an ordinary assistant message from the rostered teammate and, for Team-mail turns, a quiet Team reply to the sender.

#### Token effect

Every CLI turn receives the current user instruction as text. Non-text blocks are summarized with stable labels.

#### KV Cache effect

The bridge invokes the CLI once per turn. Coherence beyond the current instruction is limited until a reliable native resume path is proven for the target CLI.

## Known Limitations and Deferred Work

- **Bridge, not true external continuation** — `startContinuable()` still creates an in-process DSH Agent. The external CLI is invoked once per turn and is not the owner of the DSH Activation.
- **`agy` proven, Claude configured** — the package proves `agy -p` through the Team path. Claude has an argv form but the real Team walkthrough did not complete reliably in this environment. Codex needs a separate adapter after its transcript-heavy non-interactive output and resume behavior are handled.
- **Text rendering only** — images and tool calls are represented as labels in the prompt sent to the CLI.
