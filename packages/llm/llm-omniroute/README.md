# @deepseek-ai/dsh-llm-omniroute

English | [中文](README.zh.md)

OmniRoute adapter for the Harness LLM seam. The plugin registers one OpenAI-compatible provider route, defaults it to the local OmniRoute endpoint, and reads the model catalog from `GET /v1/models`.

## Config

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

`apiKeyEnv` is optional. Omit it for Rome's local OmniRoute; no Authorization header is sent. If a deployment sets `apiKeyEnv`, the request resolves that reference through `ctx.credentials`, then the launch environment, and a missing value fails with `MISSING_CREDENTIAL`.

`listModels()` fetches the live OmniRoute catalog instead of using a package list. Each entry's `context_length`, `max_output_tokens`, `capabilities.vision`, and `capabilities.effort_tiers` become exact-model metadata when the endpoint supplies them. Models without `vision: true` are text-only in DSH; models without `effort_tiers` do not expose a reasoning selector. Tool schemas are sent only to models that report `tool_calling: true`.

If OmniRoute is not running, catalog and request paths fail with `CATALOG_UNAVAILABLE` or `TRANSPORT` diagnostics naming the endpoint.

## Model Experience

### OmniRoute request

#### What the model sees

The selected OmniRoute model receives the harness system prompt, message history, supported image inputs as OpenAI `image_url` parts, tool schemas when the model reports tool support, stop sequences, and call config.

#### Token effect

Provider tokenization governs exact text and image-token input. Usage fields from OpenAI-compatible chunks are mapped into the harness usage counters when OmniRoute reports them.

#### KV Cache effect

Pass-through. OmniRoute and the selected upstream provider own cache reuse.

### OmniRoute response

#### What the model sees

Reasoning, text, and raw-string tool arguments are translated into harness stream chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the selected route and `maxTokens` value.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve any upstream cacheable prefix the selected route supports.

## Known Limitations and Deferred Work

- **Tool support is enforced at request time** — the Harness exact-model metadata has no tool-capability field, so a model that reports no `tool_calling` support rejects a request carrying tools instead of displaying that fact in selectors.
- **Reasoning selectors require `effort_tiers`** — a bare `reasoning: true` from OmniRoute is preserved by not inventing a selectable effort.
