# Agent Note: DSH-X routes behind one shared token guard

Status: implemented

English | [中文](2026-08-25-dsh-x-shared-http-token-guard.zh.md)

## Problem

Every DSH-X plugin route — `dsh-x-ui`, `notebooklm`, `x-command-center`, `live-agent-view` — served unauthenticated HTTP. The deployment binds a tailnet, so any tailnet peer could open an interactive PTY, add or toggle a Loader plugin (an arbitrary module load, and therefore remote code execution), create and delete cron schedules, add NotebookLM sources, and drive Agent Teams. The pages themselves are the mutation UI, so a page-only exemption would have left the whole surface open. The routes also had no concurrency or body-size bound, so one peer could exhaust PTYs or memory.

## Decision

`@deepseek-ai/dsh-x-auth` owns the single guard; each DSH-X plugin wraps every route it registers in `dshXAuth`. The package is a library — it registers no plugin, so nothing about the guard depends on mount order.

A request is authorized when its socket peer address is loopback, or when it presents the token. Loopback is read from `req.socket.remoteAddress` alone: `X-Forwarded-For` and every other client-supplied header is untrusted here, because a tailnet peer sets them freely. `::ffff:127.0.0.1` counts as loopback because Node reports IPv4 peers that way on a dual-stack listener.

The token comes from `DSH_X_TOKEN` when non-empty, otherwise from `~/.dsh-x/token` (32 random bytes as hex, directory `0700`, file `0600`). `dshXAuth` resolves it at route registration, so the file exists from DSH-X boot onward — it is the only place the tokenised link can be read from, and nothing logs the token or puts it in an error body. Comparison is `crypto.timingSafeEqual` over equal-length buffers.

The token is accepted as `Authorization: Bearer`, as a `dsh_x_token` cookie, or as a `?token=` query parameter. A query token on a `GET` is answered with a 302 to the same path without the parameter plus `Set-Cookie: dsh_x_token=…; HttpOnly; SameSite=Lax; Path=/`, so one tokenised link signs a phone in and takes the token out of the URL bar. An unauthorized request gets 401 and a fixed HTML page that does not reveal whether a token was presented.

`readDshXBody` caps a request body at 1 MiB and pauses the request past that, throwing `DshXBodyTooLargeError`; the routes map it to 413. Pausing rather than destroying matters: destroying the socket meant the client never received the 413 the cap exists to report, and Node closes the connection anyway once the response ends over an unconsumed request. `dsh-x-ui` refuses to spawn past `MAX_CONCURRENT_PTYS` running sessions with 429, `live-agent-view` drops an SSE client on `error` as well as `close`, and `findNlmBinary` clears its abort timer.

## Alternatives considered

**Per-plugin guards.** Four copies of the same decision drift, and the highest-severity routes are the ones most likely to be missed in a copy. One library keeps the loopback rule, the comparison, and the 401 body in one place.

**Guard only the mutating endpoints.** The DSH-X pages carry the mutation UI and the inventory of loaded plugins, so a readable page is already an information leak and a working control panel for anyone who can also reach the API. Guarding the page costs nothing because loopback is exempt.

**Trust `X-Forwarded-For` when a reverse proxy is in front.** A tailnet peer reaching DSH-X directly can send any header it likes, so honouring the header would hand every attacker a loopback exemption. A deployment that genuinely terminates a proxy in front needs an explicit trusted-proxy configuration, which no current consumer asks for.

**Bind the listener to loopback and let Tailscale forward.** That is the upstream web-app's current stance (`--host 0.0.0.0` is refused), but it does not describe the deployment in hand, and a forwarding hop reintroduces the same "who is the peer" question the guard already answers.

**A session cookie issued by a login form.** A form needs a password, storage, and a reset path; the shared token is one file the user already controls, and the query-parameter-to-cookie exchange gives the same "log in once on a phone" outcome.

## Testing

`packages/extensions/dsh-x-auth/tests/auth.spec.ts` and `packages/extensions/dsh-x-ui/tests/route-guard.spec.ts` drive the real registered handlers over a real HTTP server whose socket reports a tailnet peer address, so a remote caller is exercised without a second interface. The `dsh-x-ui` suite mounts the control page over the real PTY registry with a stub backend, so the concurrency count comes from the service rather than from the assertion.

## Consequences

Local use is unchanged: a loopback caller still reaches every route with no token, so the CLI, the browser on the machine itself, and the existing tests see the same surface they always did. Remote use costs one pasted link per device, and the cookie it sets is what keeps a phone signed in.

The guard is a decision each route opts into by wrapping its handler, not something the web server applies. A new DSH-X route is therefore unauthenticated until its author wraps it, which is the cost of not owning the server's dispatch.

## Deferred

One shared token for every route: there is no per-device credential, expiry, or revocation short of deleting `~/.dsh-x/token` and restarting. The token also travels in clear text unless the deployment terminates TLS; on a tailnet the tailnet's own encryption is what protects it. `notebooklm`, `x-command-center`, and `live-agent-view` have no package-level guard regression of their own — their wrapping is covered only by the assembled-application check.
