# @deepseek-ai/dsh-skill-rome

English | [中文](README.zh.md)

Optional bundled skill provider that contributes Rome's engineering skills (`ask-matt`, `grilling`, `grill-me`, `grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `wayfinder`, `unlazy`) to `ctx.skills`.

Mount the plugin to enable the provider. It contributes bundled workflow, specification, testing, and execution discipline skills with package-relative resource bases.

## Model Experience

### Skill catalog and loader

#### What the model sees

The model-invocable skills in this package (`grilling`, `unlazy`) are rendered into model context by [`@deepseek-ai/dsh-tool-skill`](../tool-skill) as catalog summaries and loaded `<skill_content>` instruction blocks. User-only skills (`disable-model-invocation: true`) remain hidden from model discovery and enter context only upon explicit user slash-command invocation.

#### Token effect

Catalog summaries add prompt tokens proportional to the names and descriptions of enabled model-invocable skills. A loaded skill body consumes prompt tokens only when selected or invoked.

#### KV Cache effect

Disabled by default, the plugin changes no request. When enabled, catalog summaries and loaded skill bodies affect the provider KV prefix at their insertion points.

## Known Limitations and Deferred Work

- The provider contributes a fixed set of bundled skills and does not watch external directories for runtime updates.
- User-only skills require explicit user slash-command invocation to enter model context.
