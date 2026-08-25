# @rome/dsh-live-agent-view

[English](README.md) | 中文

这是只读的实时多代理视图。插件读取 live Agent registry、存在时读取 Agent Teams roster/task board，并读取每个 session 的最新事件。它在 `ctx.webServer` 上注册 `/live-agents.json`、`/live-agents/events`（SSE）和适合手机阅读的 `/live-agents` HTML 页面。

页面显示每个 live agent 的名称、提供方、状态、当前分配的 Team task 和最近的 session activity。缺少任务或活动数据时显示 `unknown`。本包没有修改路由。

## Model Experience

### 可观测页面

#### What the model sees

无。本包不组装或发送模型请求；它只通过 `ctx.webServer` 提供浏览器数据。

#### Token effect

无；页面仅读取运行时状态。

#### KV Cache effect

无；页面仅读取运行时状态。

## Known Limitations and Deferred Work

- **Agent Teams 任务来源**——当前任务来自 active Agent Teams task 的 owner；Agent Teams 之外的 agent 在该字段显示 `unknown`。
- **进程内传输**——页面使用内联 HTML 和进程内 SSE 广播；产品需要这些能力时再替换为浏览器 bundle 或带认证的远程传输。
