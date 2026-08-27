# @deepseek-ai/dsh-subscription-quota

English | [中文](README.zh.md)

Read-only subscription/quota projection for Claude Code, Codex, Antigravity, and a local OmniRoute instance. It reports provider-owned values only; unavailable usage, limits, and remaining quota are the literal string `unknown`. The plugin registers `/subscription-quota.json` and `/subscription-quota` on `ctx.webServer`.

Both routes use the DSH-X token guard for non-loopback peers.

The package does not count tokens, call provider APIs, store credentials, or mutate provider state. It is separate from DSH's compaction token meter.

## Model Experience

### Quota page

#### What the model sees

None. The package does not assemble or send model requests; it only serves browser data from `ctx.webServer`.

#### Token effect

None; the page reads provider observations only.

#### KV Cache effect

None; the page reads provider observations only.

## Known Limitations and Deferred Work

- **CLI surface** — The current local CLI versions expose no quota command in their help surfaces.
- **OmniRoute surface** — OmniRoute's tested local routes expose no unauthenticated usage data.
- **Provider adapter** — A provider-specific read-only adapter can be added when an authenticated, documented usage source exists.
