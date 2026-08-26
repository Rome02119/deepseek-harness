# @deepseek-ai/dsh-x-auth

English | [中文](README.zh.md)

Shared HTTP guard for the DSH-X pages. Every DSH-X plugin route — `dsh-x-ui`, `notebooklm`, `x-command-center`, and `live-agent-view` — wraps its handler in `dshXAuth` so a tailnet peer cannot reach a shell, a Loader plugin mutation, a cron schedule, or a Team action without the token.

## Authorization

A request is authorized when its socket peer address is loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), or when it presents the DSH-X token. Loopback is decided from the socket peer address alone; `X-Forwarded-For` and every other client-supplied header is ignored, because a tailnet peer sets them freely.

The token is accepted from `Authorization: Bearer <token>`, from a `dsh_x_token` cookie, or from a `?token=` query parameter. It is compared with `crypto.timingSafeEqual` over equal-length buffers, and never appears in a log line or an error body.

A token arriving as `?token=` on a `GET` is answered with a 302 to the same path without the parameter, carrying `Set-Cookie: dsh_x_token=...; HttpOnly; SameSite=Lax; Path=/`. Opening one tokenised link therefore leaves a browser signed in and takes the token out of the URL bar. An unauthorized request is answered with 401 and a fixed HTML page that does not reveal whether a token was presented.

## Token source

`DSH_X_TOKEN` overrides everything when set to a non-empty value. Otherwise the token is read from `~/.dsh-x/token`. `dshXAuth` resolves it when a route is registered, so the file exists from DSH-X boot onward and the tokenised link can be built from it; it holds 32 random bytes as hex, under directory mode `0700` and file mode `0600`. The file is never written inside the repository.

## Request-body cap

`readDshXBody` reads a request body up to `MAX_REQUEST_BODY_BYTES` (1 MiB) and stops reading as soon as that is passed, pausing the request and throwing `DshXBodyTooLargeError`. DSH-X routes map that error to HTTP 413; the socket survives until that response ends, then Node closes it because the request was never fully consumed.

## Model Experience

### HTTP guard

#### What the model sees

None. The package does not assemble or send model requests; it only decides whether an incoming HTTP request reaches the handler a DSH-X plugin registered on `ctx.webServer`.

#### Token effect

None; the guard runs entirely outside the model request path.

#### KV Cache effect

None; the guard runs entirely outside the model request path.

## Known Limitations and Deferred Work

- **One shared token** — Every DSH-X route accepts the same token; there is no per-device credential, expiry, or revocation short of deleting `~/.dsh-x/token` and restarting.
- **No transport confidentiality** — The token travels in clear text unless the deployment terminates TLS in front of DSH-X; on a tailnet the tailnet's own encryption is what protects it.
