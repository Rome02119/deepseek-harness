# Agent Note: DSH-X drives herdr-backed agent panes

Status: implemented

English | [中文](2026-08-25-herdr-backed-agent-panes.zh.md)

## Problem

DSH-X could open its own persistent terminal sessions, but Rome's active agent panes already lived in herdr. The in-process terminal page could not list those panes, read their output, send input to them, or create another pane in the same multiplexer. Rebuilding those PTY and session semantics inside DSH-X would duplicate the default terminal Rome already uses.

## Decision

`@deepseek-ai/dsh-herdr-panes` is a Host extension mounted by `dsh-x.patch.yml` at `/dsh-x/herdr`. It calls the installed herdr CLI for every operation: `agent list` for live agent rows, `pane read` for output, `pane send-text` and `pane send-keys Enter` for input, `tab create` or `workspace create` for panes, and `agent start` for supported agent CLIs. The page displays herdr's reported status but treats pane output as the visible evidence for what a user can inspect.

The package has no model-visible surface. It registers HTTP routes on `ctx.webServer`, exposes `ctx.herdrPanes` only as the route-owning service, and reports a missing herdr server with the command users can run: `herdr server`.

## Alternatives considered

**Extend the existing DSH-X terminal tab.** Rejected because that tab is built around `ctx.terminals` sessions owned by DSH agents. herdr panes are external PTYs with their own pane ids, workspace ids, and agent detection lifecycle.

**Replace herdr with an in-process pane multiplexer.** Rejected because herdr already owns the PTY, persistence, and JSON control plane that Rome uses. DSH-X should drive that control plane rather than recreate it.

**Use agent status as the authority for completion.** Rejected because herdr status is screen-scraped and can be stale. The page shows status for scanning, while `pane read` provides the corroborating output.

## Consequences

DSH-X can inspect and type into Rome's live herdr panes without moving agents into the Harness terminal registry. The feature depends on a running herdr server and the installed CLI path; when that process is unavailable, the page fails explicitly instead of hanging. Rich pane layout operations, full keybinding palettes, and authentication remain out of scope until a DSH-X workflow needs them.
