# dsh-terminal-herdr

[English](README.md) | 中文

`dsh-terminal-herdr` 提供 DSH-X 消费的 `herdr` terminal backend。它为请求的 cwd 复用带标签的 herdr workspace，创建 tab pane，用 `herdr pane read` 读取，用 literal text 加 Enter 发送，并用 `herdr pane close` 关闭。

本包把 herdr 视为 terminal multiplexer。它只使用 argv 执行；连接被拒绝后只启动一次 `herdr server`；缺少可执行文件时报告配置的路径。

## Model Experience

### Terminal backend

#### What the model sees

无。本包在 `ctx.terminals` 上注册 backend，不添加 prompt text、model-visible tools 或 session events。

#### Token effect

零额外 token。

#### KV Cache effect

无 cache-specific effect。

## Known Limitations and Deferred Work

- `SIGINT` 映射为 `Ctrl-C`；其他 process signal 不是 pane-input 操作。
