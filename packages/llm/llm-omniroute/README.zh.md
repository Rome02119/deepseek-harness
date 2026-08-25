# @deepseek-ai/dsh-llm-omniroute

[English](README.md) | 中文

Harness LLM seam 的 OmniRoute 适配器。插件注册一条 OpenAI-compatible provider route，默认指向本机 OmniRoute endpoint，并从 `GET /v1/models` 读取模型 catalog。

## 配置

```yaml
- id: llm-omniroute
  name: '@deepseek-ai/dsh-llm-omniroute'
  config:
    provider: omniroute
    displayName: OmniRoute
    baseURL: http://127.0.0.1:20128/v1
    catalogTimeoutMs: 10000
    streamIdleTimeoutMs: 300000
```

`apiKeyEnv` 是可选项。Rome 本机 OmniRoute 应省略它；请求不会发送 Authorization header。部署若设置 `apiKeyEnv`，请求会先通过 `ctx.credentials` 解析该引用，再查启动环境；没有值时以 `MISSING_CREDENTIAL` 失败。

`listModels()` 读取 OmniRoute live catalog，而不是使用包内模型列表。endpoint 提供的 `context_length`、`max_output_tokens`、`capabilities.vision` 与 `capabilities.effort_tiers` 会成为 exact-model metadata。没有 `vision: true` 的模型在 DSH 中为 text-only；没有 `effort_tiers` 的模型不显示 reasoning selector。只有模型报告 `tool_calling: true` 时，带工具的请求才会发送 tool schema。

如果 OmniRoute 未运行，catalog 与请求路径会以 `CATALOG_UNAVAILABLE` 或 `TRANSPORT` 诊断失败，并点名 endpoint。

## Model Experience

### OmniRoute request

#### What the model sees

所选 OmniRoute 模型会收到 harness system prompt、message history、以 OpenAI `image_url` part 表达的受支持图片输入、模型报告支持工具时的 tool schema、stop sequence 与 call config。

#### Token effect

精确的文本与图片 token 输入由 provider tokenizer 决定。OmniRoute 报告 OpenAI-compatible usage chunk 时，适配器会把这些字段映射为 harness usage counters。

#### KV Cache effect

Pass-through。缓存复用由 OmniRoute 与所选上游 provider 拥有。

### OmniRoute response

#### What the model sees

Reasoning、text 与 raw-string tool arguments 会被转换成 harness stream chunks，供 loop 记录与组装。

#### Token effect

输出 token 遵循所选 route 与 `maxTokens`。

#### KV Cache effect

Loop 保留的 response blocks 会追加到下一次请求中，并保留所选 route 支持的上游 cacheable prefix。

## Known Limitations and Deferred Work

- **工具支持在请求时校验** — Harness exact-model metadata 没有 tool-capability 字段，因此未报告 `tool_calling` 支持的模型会拒绝带工具请求，而不是在 selector 中显示该事实。
- **Reasoning selector 需要 `effort_tiers`** — OmniRoute 只报告 `reasoning: true` 时，适配器不会虚构 selectable effort。
