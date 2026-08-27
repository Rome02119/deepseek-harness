# @deepseek-ai/dsh-ego-browser

English | [中文](README.zh.md)

ego-browser (ego lite) integration for DSH-X via the local `ego-browser` CLI. The package provides a selectable `WebFetchProvider` on `ctx.web`, an interactive browser management page at `/ego-browser`, JSON API endpoints, and model-facing agent tools (`ego_browser_navigate`, `ego_browser_taskspaces`) registered on `ctx.tools`.

Every HTTP route uses the DSH-X token guard for non-loopback peers. This includes `/ego-browser/api/eval`, which executes browser automation JavaScript.

## Web and API routes

- `GET /ego-browser` — Interactive browser management page with live CLI status, task space browser, provider selector, and navigation inspector.
- `GET /ego-browser/api/status` — JSON status endpoint reporting installation presence, running process state, active task spaces, and web seam registration.
- `POST /ego-browser/api/navigate` — Navigate to a target URL in an isolated task space and capture the rendered snapshot and HTML.
- `POST /ego-browser/api/taskspaces` — List all active task spaces in ego-browser.
- `POST /ego-browser/api/eval` — Execute a Node.js browser automation script in ego-browser.
- `POST /ego-browser/api/select-provider` — Select `ego-browser` or `http` as the active fetch provider on `ctx.web`.

## Model Experience

### Browser navigation and task space tools

#### What the model sees

The model receives the registered tool definitions `ego_browser_navigate` and `ego_browser_taskspaces` on `ctx.tools`. `ego_browser_navigate` accepts a target URL and optional task space identifier, returning the structured page title, address, and rendered semantic snapshot. `ego_browser_taskspaces` returns the list of open task spaces and their ownership states.

#### Token effect

Tool definitions contribute to the prompt schema payload when registered. Execution returns the rendered page snapshot and navigation metadata in the tool result block.

#### KV Cache effect

Tool schemas occupy a stable prefix in session tool registration. Executions append standard tool-call and tool-result message turns to the conversation.

## Known Limitations and Deferred Work

- **Local CLI dependency** — Requires the `ego-browser` command-line executable installed on the host and the `ego lite` application running.
- **Task space persistence** — Task spaces remain active in the running ego lite process across rounds until explicitly completed or closed.
- **Interactive handoff** — User-takeover workflows during captchas or login prompts can be surfaced as dedicated interactive UI modals in future iterations.
