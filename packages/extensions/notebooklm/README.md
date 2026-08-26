# @deepseek-ai/dsh-notebooklm

English | [中文](README.zh.md)

Google NotebookLM integration for DSH-X via the local `nlm` CLI. The package provides a browser management page at `/notebooklm`, JSON API endpoints, and model-facing agent tools (`notebooklm_query`, `notebooklm_list`) registered on `ctx.tools`.

The page exposes remote notebook creation and source-mutation endpoints. Every route requires the DSH-X token outside loopback; open the tokenised DSH-X link once to establish its HttpOnly cookie.

## Web and API routes

- `GET /notebooklm` — Interactive notebook cards, search filter, responsive Q&A chat drawer, source viewer, and notebook creation.
- `GET /notebooklm/api/notebooks` — JSON snapshot of user notebooks with caching and update timestamps.
- `POST /notebooklm/api/query` — Chat and query notebook sources with grounded citation responses.
- `POST /notebooklm/api/notebooks` — Create a new notebook.
- `POST /notebooklm/api/sources` — Add URL or text sources to a notebook.
- `GET /notebooklm/api/doctor` — CLI status and authentication diagnostics.

## Model Experience

### NotebookLM query and list tools

#### What the model sees

The model receives the registered tool definitions `notebooklm_query` and `notebooklm_list` on `ctx.tools`. `notebooklm_query` accepts a notebook identifier and a question string, returning an answer grounded in the indexed sources with citation records. `notebooklm_list` returns the catalog of available notebooks with their source counts and timestamps.

#### Token effect

Tool definitions contribute to the prompt schema payload when registered. Invocation returns the structured answer and citation snippets in the tool result block.

#### KV Cache effect

Tool schemas occupy a stable prefix in session tool registration. Executions append standard tool-call and tool-result message turns to the conversation.

## Known Limitations and Deferred Work

- **Local CLI dependency** — Requires the `nlm` command-line executable installed on the host with valid Google authentication cookies.
- **Synchronous subprocess dispatch** — Queries communicate through local CLI invocations with a configurable timeout.
- **Audio and Studio generation** — Advanced studio artifact creation (audio podcasts, infographics) can be exposed in future iterations as dedicated actions.
