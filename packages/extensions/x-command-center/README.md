# @deepseek-ai/dsh-x-command-center

English | [中文](README.zh.md)

Interactive DSH-X command center for Agent Teams. The plugin reads the live Agent registry, `ctx.agentTeams`, and the Team Lead session log, then registers `/dsh-x-command-center`, `/dsh-x-command-center.json`, and `/dsh-x-command-center/actions` on `ctx.webServer`.

The page lists Teams in a left sidebar and focuses the selected Team in the main panel. It shows the Needs Rome queue, Agents, Tasks grouped by state, and recent Team messages. Rows carry timestamps. Actions call the existing Team service or subagent continuation service: create task, claim, release, unblock, send message, interrupt, and stop teammate runtime. Refused Team actions return the original `TEAM_*` code.

## Model Experience

### Command center page

#### What the model sees

None from the page route itself. The package serves browser data from `/dsh-x-command-center.json` and user-triggered actions from `/dsh-x-command-center/actions`; it does not assemble model requests.

#### Token effect

None directly. Sending a wakeup Team message can start the addressed agent through the existing mailbox behavior.

#### KV Cache effect

None directly. Any model request started by a wakeup message follows the addressed agent's normal cache behavior.

## Known Limitations and Deferred Work

- **Process-local HTTP control** — The page uses the host `ctx.webServer` and exact live Agent objects as action credentials. Add product authentication before exposing it outside the trusted Tailscale/local operator surface.
- **Stop means runtime drain** — Stop releases a live continuable teammate activation but leaves the durable roster row intact, so the teammate can be continued later by the existing Team machinery.
