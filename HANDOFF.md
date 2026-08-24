# HANDOFF — DSH-X manager seat

**You are the new manager (opencode). The old manager (Claude) got knocked out by repeated `529 Overloaded` API errors mid-job. Read this file, confirm the state below, then continue.**

Written 2026-08-24 from the live repo, not from memory.

---

## The job (one line)
Fork of DeepSeek Harness → **DSH-X**: an agent-team system with a verification gate, write-scope enforcement, task leases, and phone/tablet access over Tailscale.

## Where everything is
- **Repo:** `/Users/rome/Documents/DSH-work/deepseek-harness`
- **Branch:** `dsh-x/p1-gate`
- **How to run it:** see `DSH-X-RUN.md`. TL;DR:
  ```sh
  cd /Users/rome/Documents/DSH-work/deepseek-harness && node --import tsx/esm apps/cli/src/bin.ts web --patch ./dsh-x.patch.yml --port 3080
  ```
  Phone/tablet over Tailscale: `https://romes-mac-mini.tailc8d1df.ts.net`

## State right now (verified from git)
- **Last commits landed** (branch tip `be41b15a24`): the `agent-team` subsystem — verification gate mounted in the web UI, write-scope enforcement, task leases + thrash caps, task-authorship/provenance tracking, and phone/tablet Tailscale docs.
- **⚠️ UNCOMMITTED work in the tree — do NOT lose it.** Mostly docs (`config-catalog`, `event-producer-consumer`, `persistence-catalog`, `agent-team` subsystem docs, `tool-catalog`), plus `dsh-x.patch.yml` modified, `agent-team/README` modified, and `demo/gate-demo.ts` **deleted**. Run `git status` first thing. Decide with Rome whether to commit these before doing anything destructive.

## Todo list carried over (from the outgoing manager)
- ✅ 7 done — incl. *Inventory SQUADX/ADE capabilities & gaps vs DSH*, *Determinism plan for non-deterministic parts*, *Mine old SPEC-* docs for unimplemented changes*.
- ▶ in progress — **Fork DSH on GitHub and build out the plugins** (pick this up first).
- ☐ open — **SquadX phone dashboard over Tailscale** (Tailscale serve is already documented in `DSH-X-RUN.md`; likely the last mile only).

> The full per-item todo detail lived in the old Claude session. If it comes back online, get it to append the fine-grained list here before it stops (see "If the old manager wakes up" below).

## Rules you inherit (Rome's, non-negotiable)
1. **Manager coordinates, does NOT write code.** You write specs and delegate to a worker. Workers run all code.
2. **Inspector ≠ worker.** Whoever verifies must be a different runtime than whoever built it. No self-review.
3. **Verify with evidence, not vibes.** "Done" needs fail-then-pass proof or a real run — not "should work."
4. **Branch discipline.** Work on `dsh-x/p1-gate` (or a child). Commit only when Rome asks.
5. **Surgical changes.** Touch only what the task needs. Don't "improve" adjacent code.
6. **Talk to Rome short and blunt, plain English.** He's a beginner coder — no jargon dumps. TL;DR everything.

## Immediate next action
1. `cd` into the repo, run `git status` and `git log --oneline -5` — confirm this handoff matches reality.
2. Decide with Rome: commit the uncommitted docs, or stash them.
3. Resume the in-progress task: **Fork DSH on GitHub + build out the plugins.** Delegate the code to a worker; you spec + verify.

## If the old manager (Claude) wakes up
The 529s were Anthropic server overload, not a code bug. If that session comes back, before it stops have it paste its exact todo list and any half-finished reasoning into this file under "Todo list carried over" so nothing is lost.

---

## UPDATE 2026-08-24 — the Claude manager is ALIVE and is the active seat

The 529s cleared. The original Claude manager seat resumed and has been working
this repo continuously with Rome in the loop. **Two managers dispatching workers
into one checkout is a real hazard** — it already caused an interleaved-edit
collision here earlier today between two workers.

**Claude manager holds this repo unless Rome says otherwise.** opencode seat:
please do not dispatch workers into `/Users/rome/Documents/DSH-work/deepseek-harness`
without checking with Rome first.

### Landed since this handoff was written
- `4a3a0eddea` — **plugin refactor**: all gate code lifted out of DeepSeek's
  files into our own package `packages/extensions/agent-team-gate/`.
  `git diff upstream/master -- packages/experimental` is now EMPTY (was 21 files
  / +2318 lines). Upstream releases merge cleanly again. 124 tests green.
- `f95bd18b32` (in worktree `../wt-a2a`, awaiting cherry-pick) — **A2A**: an
  external CLI seated as a real Agent Team member. Proved end to end with a live
  `agy` process receiving a team message and replying through the existing
  durable mailbox. 138 tests green.
- unlazy Stop hook installed globally for Claude Code (ADE side only — it is
  deliberately NOT added to DSH-X, which already enforces a stronger gate in
  code; two copies of one rule drift apart).

### Open
- `packages/skill/skill-rome` — half-built plugin carrying Rome's 8 Matt Pocock
  skills. unlazy asset removed; src/tests/README still reference it and must be
  cleaned before it builds.
- Not started: quota/subscription tracking, multi-pane live view, Epic Mode
  (spec-gated permission escalation), OmniRoute (311 models, OpenAI-compatible
  at 127.0.0.1:20128/v1) as an LLM adapter plugin.
