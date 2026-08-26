# dsh-x-ui

English | [中文](README.zh.md)

The DSH-X control page at `/dsh-x` makes the existing PTY, session-log Schedule, and Cordis Loader services usable from a browser. The Terminal tab opens, reads, and sends text to an Agent-owned persistent PTY; it does not attach to the agent loop's model-session stdin. The Schedule tab creates, lists, and deletes session-local reminders with their durable last-dispatch and next-target timestamps. The Plugins tab uses Loader `create`, `update`, and `remove` for real add/enable/disable/remove operations. The Browser tab keeps the system browser as the default and can persist an available local `ego-browser` selection; an absent executable is disabled with its reason.

The page is intentionally a same-origin Host surface. It is for the local DSH-X deployment and does not claim to provide a remote authentication layer.

## Model Experience

### Browser control page

#### What the model sees

This package adds only the `/dsh-x` Host control page; it adds no prompt text, model-visible tools, or session events.

#### Token effect

Zero additional tokens.

#### KV Cache effect

No cache-specific effect.

## Known Limitations and Deferred Work

- The Terminal tab controls the existing Agent-owned PTY, not the agent loop's model-session stdin; a future interactive model-session transport would be a separate capability.
- One-shot Schedule records leave the active list after dispatch; recurring schedules and dispatch history remain owned by the Schedule package.
- The page assumes the web server's local deployment boundary and adds no authentication layer of its own.
