# Agent Note: Rome subscription and live-agent observability packages

Status: implemented

English | [中文](2026-08-24-rome-observability-packages.zh.md)

## Problem

The local Claude Code, Codex, and Antigravity CLIs do not expose subscription quota values through their help surfaces, and OmniRoute's tested local routes do not expose unauthenticated usage data. DSH already owns live Agent and Agent Teams state, but the existing browser client is organized around one conversation rather than a compact side-by-side phone view.

## Decision

Two Rome-owned packages provide read-only projections over the existing host web-server registration seam. `@rome/dsh-subscription-quota` exposes provider records with literal `unknown` values when a source cannot report usage, limit, or remaining quota. `@rome/dsh-live-agent-view` exposes an HTML page, JSON snapshot, and SSE stream derived from the live Agent registry, Agent Teams roster/task board, and session event log. The page has no mutation route and uses inline responsive CSS so it remains usable at 390px.

The projections do not edit DeepSeek-owned packages and do not reuse the compaction token meter as quota accounting. The live view treats missing task or activity data as `unknown` and broadcasts after agent lifecycle, status, and session-event changes.

## Alternatives considered

**Infer quota from token-meter data.** Rejected because token-meter is a compaction-pressure heuristic, not provider subscription accounting.

**Add routes to the existing API gateway or fork the browser application.** Rejected because the host web-server route registry already permits an independently mounted read-only page without changing DeepSeek-owned transport or client packages.

**Display zero when a provider refuses or omits usage.** Rejected because zero is an invented measurement and would mislead quota decisions.

## Consequences

The packages are immediately mountable on any composition that provides `ctx.webServer`; the live page works without Agent Teams and enriches rows when that service is present. Quota rows remain unknown until a documented authenticated provider usage source is available. The SSE fan-out is process-local and unauthenticated, so deployment access control remains the responsibility of the host/network configuration.
