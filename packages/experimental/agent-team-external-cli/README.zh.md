# @deepseek-ai/dsh-experimental-agent-team-external-cli

[English](README.md) | 中文

这是实验性 Agent Teams provider，通过一个很小的进程内桥接层把一次性外部 CLI 安排为 continuable teammate。Team roster 和 durable mailbox 仍由 `@deepseek-ai/dsh-experimental-agent-team` 拥有；本包只注册一个 continuable subagent provider，以及一个子作用域 LLM adapter，用于在每个 teammate turn 调用 `agy -p` 或 `claude -p`。

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

`providerName` 是传给 `spawnTeammate()` 的名称。该 provider 只支持 continuable child。一次性 `ctx.subagents.start()` 调用会明确失败，因为 Agent Teams 需要一个常驻的进程内 child 来拥有 roster identity。`command` 可以是 PATH 名称或绝对可执行文件。`cliKind` 选择目标 argv 形式；`agy` 是本 worktree 中已证明的路径。`permissionMode` 只会转发给 `claude`。字节限制会约束每次调用收集的 stdout 和 stderr。

## Behavior

`spawnTeammate()` 创建一个普通的 continuable DSH child。对于 descriptor 使用本 provider 的 child，本包会安装一条 `agent/request` 路由，把每个已接受的 turn 发送到内部 external-CLI LLM adapter。该 adapter 会渲染 teammate 的派生 DSH transcript，调用：

```sh
agy -p=<rendered-prompt> --output-format text --dangerously-skip-permissions
```

然后把 stdout 作为该 child 的 assistant message 流回。对于 `claude`，桥接层使用 `claude -p --output-format text --permission-mode <mode> <rendered-prompt>`。桥接层不使用原生 resume flags：当前 Claude CLI 测试显示，第二个进程复用 `--session-id` 会被拒绝，`--resume` 在这条 subprocess 路径上会挂起；`agy --continue` 尚未通过 Team 路径验证。每个 turn 会从 DSH child session 发送当前 user instruction，并在调用 CLI 前移除 Team mailbox framing。如果该 turn 由 Team mail 触发，同一段 stdout 也会通过现有 mailbox 作为 quiet Team message 发回发送者。Team peer message 因此仍然经过 `team/message/queued`、目标 `user/message` delivery、目标 `assistant/message` reply、可选 quiet reply delivery，以及普通的 Team task author/verifier 检查。

## Model Experience

### Teammate replies

#### What the model sees

已投递的 Team message 仍是来自 `team/message/queued` delivery 的 user-role message。CLI 输出会成为 rostered teammate 的普通 assistant message；对于 Team-mail turn，还会成为发给发送者的 quiet Team reply。

#### Token effect

每个 CLI turn 都会收到当前 user instruction 的文本形式。非文本 block 会用稳定标签概括。

#### KV Cache effect

桥接层每个 turn 调用一次 CLI。在为目标 CLI 证明可靠原生 resume 路径前，超出当前 instruction 的连贯性是有限的。

## Known Limitations and Deferred Work

- **这是桥接层，不是真正的外部 continuation** — `startContinuable()` 仍会创建进程内 DSH Agent。外部 CLI 每个 turn 调用一次，并不拥有 DSH Activation。
- **已证明 `agy`，已配置 Claude** — 本包通过 Team 路径证明 `agy -p`。Claude 有 argv 形式，但真实 Team walkthrough 在本环境中未能稳定完成。Codex 需要在处理其非交互 transcript 输出和 resume 行为后再添加单独 adapter。
- **只渲染文本** — image 和 tool call 会在发送给 CLI 的 prompt 中表示为标签。
