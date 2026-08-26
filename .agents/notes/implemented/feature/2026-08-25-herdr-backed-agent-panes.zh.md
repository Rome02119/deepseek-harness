# Agent Note: DSH-X 驱动 herdr-backed agent panes

Status: implemented

[English](2026-08-25-herdr-backed-agent-panes.md) | 中文

## Problem

DSH-X 可以打开自己的 persistent terminal sessions，但 Rome 的活跃 agent panes 已经在 herdr 里。进程内 terminal 页面无法列出这些 panes、读取输出、向它们发送输入，也无法在同一个 multiplexer 中创建另一个 pane。在 DSH-X 内重建这些 PTY 与 session 语义会重复 Rome 已经使用的默认 terminal。

## Decision

`@deepseek-ai/dsh-herdr-panes` 是由 `dsh-x.patch.yml` 挂载在 `/dsh-x/herdr` 的 Host extension。它的每个操作都调用已安装的 herdr CLI：用 `agent list` 获取 live agent rows，用 `pane read` 获取输出，用 `pane send-text` 与 `pane send-keys Enter` 发送输入，用 `tab create` 或 `workspace create` 创建 panes，并用 `agent start` 启动受支持的 agent CLIs。页面显示 herdr 报告的 status，但把 pane output 视为用户可以检查的可见证据。

本包没有 model-visible surface。它在 `ctx.webServer` 上注册 HTTP routes，只把 `ctx.herdrPanes` 暴露为拥有 route 的 service；herdr server 缺失时，它报告用户可运行的命令：`herdr server`。

## Alternatives considered

**扩展现有 DSH-X terminal tab。**拒绝，因为该 tab 围绕 DSH agents 拥有的 `ctx.terminals` sessions 构建。herdr panes 是外部 PTYs，拥有自己的 pane ids、workspace ids 与 agent detection lifecycle。

**用进程内 pane multiplexer 替换 herdr。**拒绝，因为 herdr 已经拥有 Rome 正在使用的 PTY、persistence 与 JSON control plane。DSH-X 应驱动该 control plane，而不是重建它。

**把 agent status 当作 completion 的权威。**拒绝，因为 herdr status 由 screen scraping 得到，可能陈旧。页面展示 status 便于扫描，而 `pane read` 提供佐证输出。

## Consequences

DSH-X 可以检查 Rome 的 live herdr panes 并向其中输入，而无需把 agents 移入 Harness terminal registry。本功能依赖正在运行的 herdr server 与已安装的 CLI path；该进程不可用时，页面会明确失败而不是挂起。丰富的 pane layout operations、完整 keybinding palettes 和认证保持在范围外，直到 DSH-X workflow 需要。
