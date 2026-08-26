# @deepseek-ai/dsh-notebooklm

[English](README.md) | 中文

通过本地 `nlm` CLI 实现的 Google NotebookLM 与 DSH-X 集成。本包提供位于 `/notebooklm` 的浏览器管理页面、JSON API 端点，以及在 `ctx.tools` 上注册的模型侧智能体工具（`notebooklm_query`、`notebooklm_list`）。

该页面提供远程笔记本创建和源文件变更端点。除回环请求外，每条路由都要求 DSH-X 令牌；打开一次带令牌的 DSH-X 链接即可建立其 HttpOnly cookie。

## Web 与 API 路由

- `GET /notebooklm` — 交互式笔记本卡片网格、搜索筛选、响应式问答抽屉、源查看器以及新建笔记本功能。
- `GET /notebooklm/api/notebooks` — 带有缓存与更新时间戳的用户笔记本 JSON 快照。
- `POST /notebooklm/api/query` — 与笔记本源进行对话与查询，返回基于源文件的引用回答。
- `POST /notebooklm/api/notebooks` — 创建新笔记本。
- `POST /notebooklm/api/sources` — 向笔记本添加 URL 或文本源。
- `GET /notebooklm/api/doctor` — CLI 状态与身份认证诊断。

## 模型体验

### NotebookLM 查询与列表工具

#### 模型看到的内容

模型在 `ctx.tools` 上接收已注册的工具定义 `notebooklm_query` 与 `notebooklm_list`。`notebooklm_query` 接收笔记本标识符和问题字符串，返回基于已索引源的回答及引用记录。`notebooklm_list` 返回可用笔记本目录及其源数量和时间戳。

#### Token 影响

工具定义在注册时计入提示词 schema 负载。调用时在工具结果块中返回结构化回答与引用片段。

#### KV 缓存影响

工具 schema 在会话工具注册中占据稳定的前缀。执行时向会话追加标准的工具调用与工具结果轮次。

## 已知局限与后续工作

- **本地 CLI 依赖** — 需要主机上安装有 `nlm` 命令行可执行文件并具有有效的 Google 认证 cookie。
- **同步子进程派发** — 查询通过本地 CLI 进程调用进行通信，具有可配置的超时时间。
- **音频与 Studio 生成** — 高级 Studio 产物生成（音频播客、信息图表等）可在后续迭代中作为独立操作提供。
