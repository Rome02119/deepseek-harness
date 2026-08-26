# Agent Note: DSH-X routes behind one shared token guard

Status: implemented

[English](2026-08-25-dsh-x-shared-http-token-guard.md) | 中文

## Problem

每一条 DSH-X 插件路由——`dsh-x-ui`、`notebooklm`、`x-command-center`、`live-agent-view`——都以未认证方式提供 HTTP 服务。该部署绑定在 tailnet 上，因此 tailnet 上的任意对端都可以打开交互式 PTY、添加或切换 Loader 插件（即任意模块加载，也就是远程代码执行）、创建和删除 cron 计划、添加 NotebookLM 源，以及驱动 Agent Teams。页面本身就是变更 UI，所以「只放行页面」会让整个面暴露。这些路由也没有并发或请求体大小的上限，因此一个对端就能耗尽 PTY 或内存。

## Decision

`@deepseek-ai/dsh-x-auth` 拥有唯一的守卫；每个 DSH-X 插件都用 `dshXAuth` 包装它注册的每一条路由。该包是一个库——它不注册插件，因此守卫的任何行为都不依赖挂载顺序。

当请求的 socket 对端地址是回环地址，或请求出示了令牌时，该请求获得授权。回环判定只读取 `req.socket.remoteAddress`：`X-Forwarded-For` 和其他所有客户端提供的 header 在这里都不可信，因为 tailnet 对端可以随意设置它们。`::ffff:127.0.0.1` 也算回环，因为在双栈监听器上 Node 就是这样报告 IPv4 对端的。

令牌在 `DSH_X_TOKEN` 非空时取自它，否则取自 `~/.dsh-x/token`（32 个随机字节的十六进制，目录 `0700`，文件 `0600`）。`dshXAuth` 在注册路由时解析令牌，因此该文件自 DSH-X 启动起就存在——它是唯一能读出带令牌链接的地方，并且没有任何位置记录该令牌或把它放进错误响应体。比较使用 `crypto.timingSafeEqual` 在等长 buffer 上进行。

令牌可作为 `Authorization: Bearer`、`dsh_x_token` cookie，或 `?token=` 查询参数被接受。`GET` 上的查询令牌会得到一个指向同一路径（不含该参数）的 302，并带上 `Set-Cookie: dsh_x_token=…; HttpOnly; SameSite=Lax; Path=/`，因此一条带令牌的链接就能让手机登录，并把令牌移出地址栏。未授权的请求得到 401 和一个固定的 HTML 页面，该页面不会透露请求是否出示过令牌。

`readDshXBody` 将请求体上限设为 1 MiB，超过后暂停该请求并抛出 `DshXBodyTooLargeError`；路由把它映射为 413。暂停而非销毁很重要：销毁 socket 会让客户端收不到这个上限本该报告的 413，而且请求未被完整消费时，Node 本来就会在响应结束后关闭连接。`dsh-x-ui` 在运行中的会话达到 `MAX_CONCURRENT_PTYS` 后以 429 拒绝再次 spawn，`live-agent-view` 在 `error` 和 `close` 上都移除 SSE 客户端，`findNlmBinary` 会清除它的 abort 定时器。

## Alternatives considered

**每个插件各写一份守卫。** 同一个决定复制四份会走样，而且最容易在复制中被漏掉的，正是severity 最高的那些路由。一个库把回环规则、比较方式和 401 响应体收在一处。

**只守卫会产生变更的端点。** DSH-X 页面承载变更 UI 和已加载插件的清单，因此一个可读的页面本身就是信息泄露，对同时能访问 API 的人来说更是一个可用的控制面板。守卫页面不付出任何代价，因为回环是豁免的。

**当前面有反向代理时信任 `X-Forwarded-For`。** 直接够到 DSH-X 的 tailnet 对端可以发送任意 header，因此采信该 header 等于把回环豁免直接交给每个攻击者。真正在前面终止代理的部署需要显式的可信代理配置，而当前没有任何消费者提出这个需求。

**把监听器绑定在回环上，由 Tailscale 转发。** 这是上游 web-app 目前的立场（`--host 0.0.0.0` 被拒绝），但它并不描述手上这个部署，而且转发一跳会重新引入守卫已经回答过的「对端是谁」这个问题。

**由登录表单签发会话 cookie。** 表单需要密码、存储和重置路径；共享令牌只是用户本来就掌握的一个文件，而查询参数换 cookie 的做法给出了同样的「在手机上登录一次」效果。

## Testing

`packages/extensions/dsh-x-auth/tests/auth.spec.ts` 和 `packages/extensions/dsh-x-ui/tests/route-guard.spec.ts` 通过真实 HTTP 服务器驱动真实注册的 handler，而该服务器的 socket 报告一个 tailnet 对端地址，因此无需第二个网络接口就能演练远程调用方。`dsh-x-ui` 套件把控制页挂载在真实的 PTY 注册表加 stub backend 之上，因此并发计数来自服务本身而不是断言。

## Consequences

本地使用保持不变：回环调用方仍然无需令牌即可到达每一条路由，因此 CLI、本机上的浏览器以及现有测试看到的面和以前完全一样。远程使用的代价是每台设备粘贴一次链接，而它设置的 cookie 就是让手机保持登录的东西。

守卫是每条路由通过包装自己的 handler 主动选择的决定，而不是 web 服务器统一施加的。因此新增的 DSH-X 路由在其作者包装它之前仍是未认证的——这是不接管服务器 dispatch 所付出的代价。

## Deferred

所有路由共用一个令牌：没有按设备区分的凭据、过期或撤销机制，只能删除 `~/.dsh-x/token` 并重启。除非部署终止 TLS，令牌也以明文传输；在 tailnet 上保护它的是 tailnet 自身的加密。`notebooklm`、`x-command-center` 和 `live-agent-view` 没有各自的包级守卫回归测试——它们的包装只由装配后的应用检查覆盖。
