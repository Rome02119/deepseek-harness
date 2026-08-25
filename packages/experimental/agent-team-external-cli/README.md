# @deepseek-ai/dsh-experimental-agent-team-external-cli

English | [中文](README.zh.md)

Experimental Agent Teams provider that seats a one-shot external CLI as a continuable teammate through a small in-process bridge. The Team roster and durable mailbox remain owned by `@deepseek-ai/dsh-experimental-agent-team`; this package only registers a continuable subagent provider and a child-scoped LLM adapter that invokes `agy`, `claude`, or `codex` for each teammate turn.

## Config

```yaml
- id: agy-team-provider
  name: '@deepseek-ai/dsh-experimental-agent-team-external-cli'
  config:
    providerName: agy-team
    command: agy
    cliKind: agy
    permissionMode: dontAsk
    codexSandbox: danger-full-access
    disposeGraceMs: 3000
    stdoutMaxBytes: 1048576
    stderrMaxBytes: 65536
```

`providerName` is the name passed to `spawnTeammate()`. The provider supports only continuable children. One-shot `ctx.subagents.start()` calls fail visibly because Agent Teams needs a resident in-process child to own the roster identity. `command` may be a PATH name or absolute executable. `cliKind` selects the target argv form: `agy`, `claude`, or `codex`. `permissionMode` is forwarded only for `claude`; `codexSandbox` is forwarded only for `codex`. The byte limits bound collected stdout and stderr for each invocation.

## Behavior

`spawnTeammate()` creates a normal continuable DSH child. For children whose descriptor uses this provider, the package installs an `agent/request` route that sends each accepted turn to the internal external-CLI LLM adapter. The adapter renders the teammate's derived DSH transcript, invokes:

```sh
agy -p=<rendered-prompt> --output-format text --dangerously-skip-permissions
claude -p --output-format text --permission-mode <mode> <rendered-prompt>
codex exec --skip-git-repo-check --sandbox <codexSandbox> --output-last-message <temp-file> <rendered-prompt>
```

and streams the CLI reply back as the child's assistant message. The Codex path prefers the last-message file and falls back to collected stdout. The bridge does not use native resume flags; each turn sends the current user instruction from the DSH child session, with Team mailbox framing stripped before invoking the CLI. When the turn was triggered by Team mail, the same reply is also sent as a quiet Team message back to the sender through the existing mailbox. Team peer messages therefore still flow through `team/message/queued`, target `user/message` delivery, target `assistant/message` reply, optional quiet reply delivery, and normal Team task author/verifier checks.

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
- **One-shot CLI coherence** — the bridge sends only the rendered current instruction to the external CLI. Native CLI resume support needs a separately proven non-interactive path for each provider.
- **Text rendering only** — images and tool calls are represented as labels in the prompt sent to the CLI.
