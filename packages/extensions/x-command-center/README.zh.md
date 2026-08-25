# @deepseek-ai/dsh-x-command-center

[English](README.md) | 中文

DSH-X 的可交互 Agent Teams command center。插件读取 live Agent registry、`ctx.agentTeams` 和 Team Lead session log，并在 `ctx.webServer` 上注册 `/dsh-x-command-center`、`/dsh-x-command-center.json` 和 `/dsh-x-command-center/actions`。

页面左侧列出 Teams，主面板聚焦选中的 Team。它展示 Needs Rome 队列、Agents、按状态分组的 Tasks，以及最近的 Team messages。每一行都带 timestamp。动作调用既有 Team service 或 subagent continuation service：创建 task、claim、release、unblock、发送消息、interrupt，以及停止 teammate runtime。被 Team 规则拒绝的动作会返回原始 `TEAM_*` code。

## Model Experience

### Command center 页面

#### What the model sees

页面 route 本身不会向模型暴露内容。本包从 `/dsh-x-command-center.json` 提供浏览器数据，并从 `/dsh-x-command-center/actions` 处理用户触发的 actions；它不组装模型请求。

#### Token effect

无直接影响。发送 wakeup Team message 可能通过既有 mailbox 行为启动被寻址的 agent。

#### KV Cache effect

无直接影响。wakeup message 启动的任何模型请求都遵循被寻址 agent 的正常 cache 行为。

## Known Limitations and Deferred Work

- **进程内 HTTP 控制**——页面使用 host `ctx.webServer`，并用 exact live Agent objects 作为 action credentials。暴露到受信任的 Tailscale/local operator surface 之外前，需要增加产品认证。
- **Stop 表示 runtime drain**——Stop 会释放 live continuable teammate activation，但保留 durable roster row，所以之后仍可通过既有 Team machinery 继续该 teammate。
