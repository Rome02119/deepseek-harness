# Agent Note: DSH-X browser controls over mounted services

Status: implemented

English | [中文](2026-08-24-dsh-x-browser-controls.zh.md)

## Problem

The repository already contained owner-scoped terminal sessions, session-log Schedule records, and a Loader plugin inventory, but the web application did not expose those capabilities as user actions. The mounted plugin inventory was intentionally read-only, so an entry that existed in the process could not be added, enabled, disabled, or removed from the browser.

## Decision

The owned `@deepseek-ai/dsh-x-ui` package mounts a local `/dsh-x` page and JSON routes over the existing services. Terminal controls open, poll, send text to, and close an Agent-owned PTY; the page identifies the result as a live shell rather than an agent-model terminal takeover. Schedule controls append and persist the existing `schedule/change` records, list active records with last-dispatch and next-target timestamps, and delete records. Plugin controls call Loader `create`, `update`, and `remove`; the control page entry itself is protected.

The patch mounts Schedule and Terminal before the page so agents created after composition receive their runtime listeners. The CLI manifest includes the owned package only to make the patch's bare module name resolvable through the profile fallback; the runtime mount remains in `dsh-x.patch.yml`.

The existing Settings → Plugins page remains the mounted inventory and configuration view. It reports Loader state and configures supported package settings; `/dsh-x` is the mutation surface for plugin entries.

## Alternatives considered

**Add controls to the existing settings inventory.** Rejected because that package's documented role is a read-only Loader view, while terminal and Schedule controls need a host page with different service dependencies.

**Build a separate terminal implementation.** Rejected because `ctx.terminals` already owns PTY lifecycle, owner checks, polling, and send operations; duplicating it would create a second session registry.

**Claim full agent-session takeover.** Rejected because `tool-terminal` is a model-facing tool and the existing terminal service exposes a PTY, not the agent loop's interactive stdin. The page provides real live PTY interaction and states that limitation in its documentation.

## Consequences

The three capabilities are directly clickable from `/dsh-x` and operate on the process's real Loader, session log, and terminal services. Schedule state remains session-local and one-shot records leave the active list after dispatch; the page therefore shows `never` until a record dispatches and always shows the next target for active records. The page is intentionally local and has no additional authentication layer beyond the web server's deployment boundary.

## Testing

Browser verification on port 3087 fetched `/dsh-x` with HTTP 200, opened a PTY, sent `printf 'DSH-X_TERMINAL_OK\\n'`, and displayed the resulting output. It created `schedule-2` with next target `2026-08-25T01:39:55.138Z`, displayed `last run: never`, deleted it, and displayed zero schedule rows. It added Loader entry `05df0cb3` for `@deepseek-ai/dsh-x-ui/demo`, disabled it, enabled it, and removed it.
