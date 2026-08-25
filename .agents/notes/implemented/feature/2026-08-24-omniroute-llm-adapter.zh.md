# Agent Note: OmniRoute LLM 适配器

Status: implemented

[English](2026-08-24-omniroute-llm-adapter.md) | 中文

## 问题

DSH-X 需要把本机 OmniRoute gateway 作为一个 Harness 模型 provider 使用。把既有适配器指向该 gateway 可以转发请求，但不能把 OmniRoute 的 live multi-provider catalog 及其 per-model capabilities 暴露给模型选择。

## 决策

`@deepseek-ai/dsh-llm-omniroute` 是独立的适配器包，注册 `omniroute` provider route。它从已配置的 OpenAI-compatible base URL 读取 `GET /v1/models`，通过 `ctx.llm.listModels()` 暴露这些条目，并从同一份 live catalog 解析 exact model metadata。

适配器只映射 OmniRoute 报告的 capabilities。`context_length` 成为 context metadata，`max_output_tokens` 成为 adapter default output cap，`capabilities.vision` 控制 image input metadata，`capabilities.effort_tiers` 控制 selectable reasoning efforts。`capabilities.tool_calling` 在 Harness exact-model metadata 中没有字段，因此带工具请求会在请求时校验它。

默认 endpoint 是 `http://127.0.0.1:20128/v1`，且不要求 API key。部署可以配置 `apiKeyEnv`；一旦配置，缺失 credential 会在 provider I/O 前失败，而不是静默退回 unauthenticated requests。

## Alternatives considered

**把 `@deepseek-ai/dsh-llm-deepseek` 配置到 OmniRoute。** 这样可以复用 OpenAI-shaped streaming transport，但它的 catalog 由配置拥有，默认是 DeepSeek 模型。除非另一个机制把该列表复制进 settings，否则 DSH-X 看不到 OmniRoute 的 311-model live catalog。

**硬编码 OmniRoute 模型列表。** 否决，因为 gateway 已经是 source of truth，并且会随 Rome 的 subscriptions 与 routes 改变。签入列表会立刻漂移。

**按 OmniRoute 上游 prefix 注册多条 DSH provider。** 初始包不采用，因为 OmniRoute model ids 已经包含 route prefixes，而 Models page 可以在一个 provider 下显示完整 catalog，不需要扩增 settings rows。

## 后果

Models page 与 session model selector 可以列出 OmniRoute 当前公布的每个模型，而普通请求仍通过单一 provider route。该包依赖 OmniRoute 可达来读取 catalog；它停机时，失败会点名本机 `/models` endpoint，而不是返回空 catalog。

裸 `reasoning: true` 与 `tool_calling` booleans 不会被虚构投射到 Harness 类型系统没有的 selector fields。只有 OmniRoute 报告具体 effort tiers 时，reasoning 才可选择；tool support 在请求时校验。
