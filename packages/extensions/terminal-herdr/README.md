# dsh-terminal-herdr

English | [中文](README.zh.md)

`dsh-terminal-herdr` provides the `herdr` terminal backend consumed by DSH-X. It reuses a labeled herdr workspace for the requested cwd, creates a tab pane, reads with `herdr pane read`, sends literal text plus Enter, and closes with `herdr pane close`.

The package treats herdr as the terminal multiplexer. It uses argv execution only, starts `herdr server` once after a connection refusal, and reports a missing executable with its configured path.

## Model Experience

### Terminal backend

#### What the model sees

None. This package registers the backend on `ctx.terminals` and adds no prompt text, model-visible tools, or session events.

#### Token effect

Zero additional tokens.

#### KV Cache effect

No cache-specific effect.

## Known Limitations and Deferred Work

- `SIGINT` maps to `Ctrl-C`; other process signals are not pane-input operations.
