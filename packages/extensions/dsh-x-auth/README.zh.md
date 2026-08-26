# @deepseek-ai/dsh-x-auth

[English](README.md) | 中文

这是 DSH-X 页面共用的 HTTP 守卫。每个 DSH-X 插件路由——`dsh-x-ui`、`notebooklm`、`x-command-center` 和 `live-agent-view`——都用 `dshXAuth` 包装其 handler，因此 tailnet 上的对端在没有令牌时无法访问 shell、Loader 插件变更、cron 计划或 Team 操作。

## 授权

当请求的 socket 对端地址是回环地址（`127.0.0.1`、`::1`、`::ffff:127.0.0.1`），或请求出示了 DSH-X 令牌时，该请求获得授权。回环判定只依据 socket 对端地址；`X-Forwarded-For` 和其他所有客户端提供的 header 都被忽略，因为 tailnet 对端可以随意设置它们。

令牌可来自 `Authorization: Bearer <token>`、`dsh_x_token` cookie，或 `?token=` 查询参数。比较使用 `crypto.timingSafeEqual` 在等长 buffer 上进行，令牌绝不出现在日志行或错误响应体中。

对于 `GET` 上以 `?token=` 到达的令牌，响应是指向同一路径（不含该参数）的 302，并带上 `Set-Cookie: dsh_x_token=...; HttpOnly; SameSite=Lax; Path=/`。因此打开一次带令牌的链接即可让浏览器保持登录，并把令牌从地址栏中移除。未授权的请求得到 401 和一个固定的 HTML 页面，该页面不会透露请求是否出示过令牌。

## 令牌来源

`DSH_X_TOKEN` 设为非空值时优先于其他一切来源。否则令牌从 `~/.dsh-x/token` 读取；该文件在首次使用时以 32 个随机字节的十六进制创建，目录模式为 `0700`，文件模式为 `0600`。该文件绝不写入仓库内部。

## 请求体上限

`readDshXBody` 读取请求体，上限为 `MAX_REQUEST_BODY_BYTES`（1 MiB），一旦超过便销毁该请求并抛出 `DshXBodyTooLargeError`。DSH-X 路由将该错误映射为 HTTP 413。

## Model Experience

### HTTP 守卫

#### What the model sees

无。本包不组装或发送模型请求；它只决定进入的 HTTP 请求能否到达 DSH-X 插件注册在 `ctx.webServer` 上的 handler。

#### Token effect

无；守卫完全运行在模型请求路径之外。

#### KV Cache effect

无；守卫完全运行在模型请求路径之外。

## Known Limitations and Deferred Work

- **单一共享令牌**——每个 DSH-X 路由都接受同一个令牌；没有按设备区分的凭据、过期或撤销机制，只能删除 `~/.dsh-x/token` 并重启。
- **传输不保密**——除非部署在 DSH-X 前面终止 TLS，否则令牌以明文传输；在 tailnet 上保护它的是 tailnet 自身的加密。
