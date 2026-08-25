# Agent Note: OmniRoute LLM adapter

Status: implemented

English | [中文](2026-08-24-omniroute-llm-adapter.zh.md)

## Problem

DSH-X needs access to the local OmniRoute gateway as one Harness model provider. Pointing an existing adapter at the gateway can route requests, but it cannot expose OmniRoute's live multi-provider catalog or its per-model capabilities to model selection.

## Decision

`@deepseek-ai/dsh-llm-omniroute` is a separate adapter package that registers the `omniroute` provider route. It reads `GET /v1/models` from the configured OpenAI-compatible base URL, exposes those entries through `ctx.llm.listModels()`, and resolves exact model metadata from the same live catalog.

The adapter maps only capabilities OmniRoute reports. `context_length` becomes context metadata, `max_output_tokens` becomes the adapter default output cap, `capabilities.vision` controls image input metadata, and `capabilities.effort_tiers` controls selectable reasoning efforts. `capabilities.tool_calling` has no field in Harness exact-model metadata, so it is enforced when a request carries tools.

The default endpoint is `http://127.0.0.1:20128/v1` and no API key is required. A deployment may configure `apiKeyEnv`; when it does, missing credentials fail before provider I/O instead of silently falling back to unauthenticated requests.

## Alternatives considered

**Configure `@deepseek-ai/dsh-llm-deepseek` against OmniRoute.** This would reuse the OpenAI-shaped streaming transport, but its catalog is configuration-owned and defaults to DeepSeek models. DSH-X would not see OmniRoute's 311-model live catalog unless another mechanism copied that list into settings.

**Hardcode the OmniRoute model list.** Rejected because the gateway is already the source of truth and can change with Rome's subscriptions and routes. A checked-in list would drift immediately.

**Register one DSH provider per upstream OmniRoute prefix.** Rejected for the initial package because OmniRoute model ids already include their route prefixes, and the Models page can show the full catalog under one provider without multiplying settings rows.

## Consequences

The Models page and session model selector can list every model OmniRoute currently advertises, while ordinary requests still go through a single provider route. The package depends on OmniRoute being reachable for catalog reads; when it is down, the failure names the local `/models` endpoint instead of returning an empty catalog.

Bare `reasoning: true` and `tool_calling` booleans are not inventively projected into selector fields the Harness type system does not have. Reasoning is selectable only when OmniRoute reports concrete effort tiers, and tool support is checked at request time.
