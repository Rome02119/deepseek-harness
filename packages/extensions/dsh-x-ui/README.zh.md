# dsh-x-ui

[English](README.md) | 中文

DSH-X 控制页位于 `/dsh-x`，把现有 PTY、Session 日志 Schedule 和 Cordis Loader 服务变成浏览器中可操作的界面。Terminal 页可打开、读取并向 Agent 所有的持久 PTY 发送文本，但不会接入 agent loop 的模型会话 stdin；Schedule 页可创建、列出和删除 session-local 提醒并显示最近派发和下一次目标时间；Plugins 页使用 Loader 的 `create`、`update` 和 `remove` 执行真实的添加、启用、禁用和删除。

该页面是同源 Host 页面，面向本地 DSH-X 部署，不声称提供远程认证层。

## Model Experience

### Browser control page

#### What the model sees

本包只增加 `/dsh-x` Host 控制页，不增加提示词文本、模型可见工具或 session 事件。

#### Token effect

无。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- Terminal 页控制的是现有 Agent 所有的 PTY，而不是 agent loop 的模型会话 stdin；未来的交互式模型会话传输属于另一项能力。
- 一次性 Schedule 记录派发后会离开活动清单；周期 Schedule 和派发历史仍由 Schedule 包负责。
- 页面依赖 Web server 的本地部署边界，自身不增加认证层。
