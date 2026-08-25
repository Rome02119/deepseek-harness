# @deepseek-ai/dsh-live-agent-view

English | [中文](README.zh.md)

Read-only live multi-agent view. The plugin reads the live Agent registry, the Agent Teams roster/task board when present, and each session's latest event. It registers `/live-agents.json`, `/live-agents/events` (SSE), and `/live-agents` (mobile-readable HTML) on `ctx.webServer`.

The page shows each live agent's name, provider, status, current assigned Team task, and most recent session activity. Missing task or activity data is `unknown`. The package has no mutation routes.

## Model Experience

### Observability page

#### What the model sees

None. The package does not assemble or send model requests; it only serves browser data from `ctx.webServer`.

#### Token effect

None; the page reads runtime state only.

#### KV Cache effect

None; the page reads runtime state only.

## Known Limitations and Deferred Work

- **Agent Teams task source** — The current task is derived from an active Agent Teams task owner; agents outside Agent Teams show `unknown` for that field.
- **Process-local transport** — The page uses inline HTML and one process-local SSE fan-out; a browser bundle or authenticated remote transport can replace it when the product needs those capabilities.
