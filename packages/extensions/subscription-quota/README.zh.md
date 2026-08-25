# @deepseek-ai/dsh-subscription-quota

[English](README.md) | 中文

这是 Claude Code、Codex、Antigravity 和本地 OmniRoute 的只读订阅/配额视图。它只报告提供方实际给出的值；无法取得的使用量、上限和剩余额度统一显示为字符串 `unknown`。插件在 `ctx.webServer` 上注册 `/subscription-quota.json` 和 `/subscription-quota`。

本包不统计 token、不调用提供方 API、不保存凭据，也不修改提供方状态。它与 DSH 的压缩压力 token meter 分开。

## Model Experience

### 配额页面

#### What the model sees

无。本包不组装或发送模型请求；它只通过 `ctx.webServer` 提供浏览器数据。

#### Token effect

无；页面仅读取提供方观测结果。

#### KV Cache effect

无；页面仅读取提供方观测结果。

## Known Limitations and Deferred Work

- **CLI 界面**——当前本地 CLI 的帮助信息没有配额命令。
- **OmniRoute 界面**——OmniRoute 的测试本地路由没有提供未经认证的使用量数据。
- **提供方适配器**——只有在存在经过认证且有文档的只读使用量来源时，才添加提供方适配器。
