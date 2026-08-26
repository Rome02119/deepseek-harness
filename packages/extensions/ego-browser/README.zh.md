# @deepseek-ai/dsh-ego-browser

[English](README.md) | 中文

通过本地 `ego-browser` CLI 为 DSH-X 提供 ego-browser (ego lite) 集成。该包在 `ctx.web` 上提供可选的 `WebFetchProvider`，在 `/ego-browser` 提供交互式浏览器管理页面，提供 JSON API 端点，并在 `ctx.tools` 上注册面向模型的智能体工具（`ego_browser_navigate`、`ego_browser_taskspaces`）。

## Web and API routes

- `GET /ego-browser` — 交互式浏览器管理页面，展示实时 CLI 状态、任务空间浏览器、提供商选择器和导航检查器。
- `GET /ego-browser/api/status` — JSON 状态端点，报告安装存在性、运行中进程状态、活动任务空间和 Web 能力缝隙注册情况。
- `POST /ego-browser/api/navigate` — 在隔离的任务空间中导航到目标 URL，并捕获渲染后的快照与 HTML。
- `POST /ego-browser/api/taskspaces` — 列出 ego-browser 中的所有活动任务空间。
- `POST /ego-browser/api/eval` — 在 ego-browser 中执行 Node.js 浏览器自动化脚本。
- `POST /ego-browser/api/select-provider` — 在 `ctx.web` 上选择 `ego-browser` 或 `http` 作为活动抓取提供商。

## Model Experience

### Browser navigation and task space tools

#### What the model sees

模型在 `ctx.tools` 上接收注册的工具定义 `ego_browser_navigate` 和 `ego_browser_taskspaces`。`ego_browser_navigate` 接收目标 URL 和可选的任务空间标识符，返回结构化的页面标题、地址和渲染后的语义快照。`ego_browser_taskspaces` 返回打开的任务空间列表及其所有权状态。

#### Token effect

工具定义在注册时计入提示词结构负载。执行调用后在工具结果块中返回渲染的页面快照与导航元数据。

#### KV Cache effect

工具架构在会话工具注册中占据稳定的前缀。执行调用会向对话追加标准的工具调用与工具结果消息轮次。

## Known Limitations and Deferred Work

- **Local CLI dependency** — 需要宿主机上安装有 `ego-browser` 命令行可执行文件且 `ego lite` 应用程序正在运行。
- **Task space persistence** — 任务空间在各轮次之间保持活跃于运行中的 ego lite 进程中，直到被显式完成或关闭。
- **Interactive handoff** — 在遇到验证码或登录提示时的用户接管工作流可在未来迭代中作为专用的交互式 UI 弹窗呈现。
