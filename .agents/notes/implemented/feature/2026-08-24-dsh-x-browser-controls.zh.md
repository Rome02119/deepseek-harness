# Agent Note: DSH-X 浏览器控制

Status: implemented

[English](2026-08-24-dsh-x-browser-controls.md) | 中文

## 问题

仓库已有按所有者隔离的终端会话、写入 session 日志的 Schedule 记录和 Loader 插件清单，但 Web 应用没有把这些能力变成用户可执行的操作。已挂载的插件清单有意保持只读，因此浏览器不能添加、启用、禁用或删除进程中的条目。

## 决策

自有包 `@deepseek-ai/dsh-x-ui` 挂载本地 `/dsh-x` 页面和 JSON 路由，直接使用已有服务。Terminal 控件打开、轮询、发送文本到并关闭 Agent 所有的 PTY；页面明确这是实时 shell，而不是接管 agent 模型会话的终端。Schedule 控件追加并持久化已有的 `schedule/change` 记录，列出带有最近派发时间和下一目标时间的活动记录，并删除记录。插件控件调用 Loader 的 `create`、`update` 和 `remove`，控制页自身的条目受到保护。

Patch 先挂载 Schedule 和 Terminal，再挂载页面，使组合之后创建的 agent 获得对应的运行时监听器。CLI 清单只为让 patch 中的裸模块名通过 profile fallback 可解析而包含这个自有包；运行时挂载仍由 `dsh-x.patch.yml` 完成。

已有的 Settings → Plugins 页面仍是已挂载的清单和配置页面，负责显示 Loader 状态并配置支持的包；`/dsh-x` 是插件条目的变更入口。

## 曾考虑的替代方案

**把控件加入现有设置清单。** 否决，因为该包的文档职责是只读 Loader 视图，而终端和 Schedule 控件需要不同服务依赖的宿主页面。

**重新实现终端。** 否决，因为 `ctx.terminals` 已拥有 PTY 生命周期、所有者检查、轮询和发送操作；复制它会产生第二套会话注册表。

**声称可以完整接管 agent 会话。** 否决，因为 `tool-terminal` 是模型侧工具，现有终端服务提供的是 PTY，而不是 agent loop 的交互式 stdin。页面提供真实的实时 PTY 交互，并在文档中说明这个限制。

## 后果

三个能力现在都能从 `/dsh-x` 直接点击，并作用于进程中真实的 Loader、session 日志和终端服务。Schedule 状态仍是 session-local，一次性记录派发后会离开活动清单；因此页面在记录尚未派发时显示 `never`，并始终为活动记录显示下一目标。页面保持本地属性，除 Web server 的部署边界外不增加认证层。

## 测试

在 3087 端口上通过浏览器验证：`/dsh-x` 返回 HTTP 200；打开 PTY，发送 `printf 'DSH-X_TERMINAL_OK\\n'`，并显示结果。创建了下一目标为 `2026-08-25T01:39:55.138Z` 的 `schedule-2`，显示 `last run: never`，删除后显示零条 Schedule 记录。添加了 `@deepseek-ai/dsh-x-ui/demo` 的 Loader 条目 `05df0cb3`，执行禁用、启用和删除。
