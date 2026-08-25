/** Read-only live multi-agent HTTP page and JSON/SSE projection. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-team-gate'
import type { ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** One row displayed by the live-agent view. */
export interface LiveAgentRow {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly status: string
  readonly currentTask: string
  readonly mostRecentActivity: string
}

/** JSON response returned by the live-agent endpoint. */
export interface LiveAgentSnapshot {
  readonly checkedAt: string
  readonly agents: readonly LiveAgentRow[]
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live agents</title><style>
:root{color-scheme:light dark;font:16px system-ui,sans-serif;background:#f6f7fb;color:#171923}
body{max-width:900px;margin:0 auto;padding:1rem}h1{font-size:1.35rem}.meta{color:#5e6472}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.75rem}.card{border:1px solid #c8ccd8;border-radius:12px;padding:1rem;background:#fff}.card h2{font-size:1.1rem;margin:0 0 .5rem;overflow-wrap:anywhere}dl{margin:0}dt{font-weight:700;margin-top:.5rem}dd{margin:.1rem 0;overflow-wrap:anywhere}.status{font-weight:700;color:#16734b}
@media(max-width:520px){body{padding:.75rem}.grid{display:block}.card{margin:.75rem 0}}
@media(prefers-color-scheme:dark){:root{background:#111318;color:#f2f4f8}.meta{color:#aeb5c4}.card{background:#1b1e26;border-color:#3b4050}.status{color:#6ee7a5}}
</style></head><body><h1>Live agents</h1><p class="meta" id="checked">Loading…</p><main class="grid" id="agents"></main><script>
const checked=document.querySelector('#checked'), target=document.querySelector('#agents');
function render(data){checked.textContent='Live · refreshed '+data.checkedAt;target.replaceChildren();if(data.agents.length===0){target.textContent='No live agents';return}for(const a of data.agents){const card=document.createElement('article');card.className='card';const title=document.createElement('h2');title.textContent=a.name;card.append(title);for(const [label,value] of [['Provider',a.provider],['Status',a.status],['Current task',a.currentTask],['Most recent activity',a.mostRecentActivity]]){const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;if(label==='Status')dd.className='status';card.append(dt,dd)}target.append(card)}}
function load(){fetch('/live-agents.json').then(r=>r.json()).then(render).catch(e=>checked.textContent='Could not load agents: '+e)}load();new EventSource('/live-agents/events').onmessage=e=>render(JSON.parse(e.data));
</script></body></html>`

/** Read-only live-agent service. */
export class LiveAgentViewService extends Service {
  static inject = ['agents', 'webServer']

  private readonly clients = new Set<ServerResponse>()

  constructor(ctx: Context) {
    super(ctx, 'liveAgentView')
    ctx.on('agent/created', () => { this.broadcast() })
    ctx.on('agent/status', () => { this.broadcast() })
    ctx.on('agent/disposed', () => { this.broadcast() })
    ctx.on('session/event', () => { this.broadcast() })
    ctx.effect(() => () => {
      for (const client of this.clients) client.end()
      this.clients.clear()
    }, 'rome-live-agent-view: clients')
  }

  /**
   * Return the current live registry projection.
   * @returns The current live agent rows.
   */
  snapshot(): LiveAgentSnapshot {
    const team = this.ctx.get('agentTeams')
    const rows = new Map<string, LiveAgentRow>()
    for (const agent of this.ctx.agents.list()) {
      if (team === undefined) {
        rows.set(String(agent.id), rowForAgent(agent, String(agent.id), undefined))
        continue
      }
      const membership = team.tryMembership(agent)
      if (membership === undefined) {
        rows.set(String(agent.id), rowForAgent(agent, String(agent.id), undefined))
        continue
      }
      const tasks = team.listTasks(membership.root)
      for (const member of team.listMembers(membership.root)) {
        const live = this.ctx.agents.get(member.id)
        if (live === undefined) continue
        const task = tasks.find(candidate => candidate.ownerName === member.name
          && candidate.status !== 'completed' && candidate.status !== 'deleted')
        rows.set(String(member.id), rowForAgent(
          live,
          member.name,
          task === undefined ? undefined : `${task.subject} (${task.status})`,
          member.provider,
          member.status,
        ))
      }
    }
    return { checkedAt: new Date().toISOString(), agents: [...rows.values()] }
  }

  /** Register JSON, SSE, and HTML routes. */
  [Service.init](): void {
    const json: WebRoute = {
      kind: 'exact', path: '/live-agents.json',
      handler: (_req, res) => { sendJson(res, this.snapshot()) },
    }
    const events: WebRoute = {
      kind: 'exact', path: '/live-agents/events',
      handler: (_req, res) => { this.openEvents(res) },
    }
    const page: WebRoute = {
      kind: 'exact', path: '/live-agents',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(PAGE)
      },
    }
    this.ctx.effect(() => this.ctx.webServer.register(json), 'rome-live-agent-view: json')
    this.ctx.effect(() => this.ctx.webServer.register(events), 'rome-live-agent-view: events')
    this.ctx.effect(() => this.ctx.webServer.register(page), 'rome-live-agent-view: page')
  }

  private openEvents(res: ServerResponse): void {
    res.writeHead(200, {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    })
    this.clients.add(res)
    res.once('close', () => { this.clients.delete(res) })
    this.write(res)
  }

  private broadcast(): void {
    for (const client of this.clients) {
      if (client.writableEnded) {
        this.clients.delete(client)
        continue
      }
      this.write(client)
    }
  }

  private write(res: ServerResponse): void {
    res.write(`data: ${JSON.stringify(this.snapshot())}\n\n`)
  }
}

function rowForAgent(
  agent: Agent,
  name: string,
  currentTask: string | undefined,
  teamProvider?: string,
  teamStatus?: string,
): LiveAgentRow {
  const latest = agent.session.events.at(-1)
  return {
    id: String(agent.id),
    name,
    provider: teamProvider ?? agent.options.provider ?? 'unknown',
    status: teamStatus ?? agent.status,
    currentTask: currentTask ?? 'unknown',
    mostRecentActivity: latest === undefined ? 'unknown' : `${latest.type} @ ${new Date(latest.time).toISOString()}`,
  }
}

function sendJson(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export default LiveAgentViewService
