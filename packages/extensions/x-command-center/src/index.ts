/** Interactive DSH-X command center over Agent Teams and the live session log. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-team-gate'
import { TeamError, TeamTaskId } from '@deepseek-ai/dsh-agent-team-gate'
import type { TeamMemberView, TeamSessionEventMap, TeamTaskStatus, TeamTaskView } from '@deepseek-ai/dsh-agent-team-gate'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DshXBodyTooLargeError, dshXAuth, readDshXBody } from '@deepseek-ai/dsh-x-auth'

/** Command center configuration. */
export interface Config {
  /** Milliseconds after the latest session event before an agent is marked stale. */
  readonly staleAfterMs?: number
}

/** One project/team sidebar row. */
export interface CommandCenterTeamRow {
  readonly id: string
  readonly name: string
  readonly status: 'live' | 'idle'
  readonly timestamp: string
  readonly needsRomeCount: number
}

/** One actionable agent row. */
export interface CommandCenterAgentRow {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly status: TeamMemberView['status']
  readonly freshness: 'live' | 'stale'
  readonly currentTask: string
  readonly timestamp: string
}

/** One task row with its latest event timestamp. */
export interface CommandCenterTaskRow extends TeamTaskView {
  readonly timestamp: string
}

/** One recent Team mailbox row. */
export interface CommandCenterMessageRow {
  readonly id: string
  readonly sender: string
  readonly target: string
  readonly text: string
  readonly delivery: 'quiet' | 'wakeup'
  readonly status: 'queued' | 'delivered'
  readonly timestamp: string
}

/** One row in the top Needs Rome section. */
export interface CommandCenterNeedRow {
  readonly kind: 'blocked-task' | 'review-task' | 'lead-message'
  readonly id: string
  readonly label: string
  readonly timestamp: string
}

/** One team detail panel. */
export interface CommandCenterTeamDetail {
  readonly id: string
  readonly name: string
  readonly timestamp: string
  readonly actors: readonly string[]
  readonly agents: readonly CommandCenterAgentRow[]
  readonly tasks: Record<Exclude<TeamTaskStatus, 'deleted'>, readonly CommandCenterTaskRow[]>
  readonly messages: readonly CommandCenterMessageRow[]
  readonly needsRome: readonly CommandCenterNeedRow[]
}

/** JSON snapshot for the command center page. */
export interface CommandCenterSnapshot {
  readonly checkedAt: string
  readonly teams: readonly CommandCenterTeamRow[]
  readonly details: Record<string, CommandCenterTeamDetail>
}

const DEFAULT_STALE_AFTER_MS = 2 * 60_000
const ROUTE = '/dsh-x-command-center'
const JSON_ROUTE = `${ROUTE}.json`
const ACTION_ROUTE = `${ROUTE}/actions`
const TASK_STATES = ['pending', 'in_progress', 'in_review', 'blocked', 'completed'] as const

type TeamLogEvent = {
  [K in keyof TeamSessionEventMap]: {
    readonly type: K
    readonly time: number
    readonly data: TeamSessionEventMap[K]
  }
}[keyof TeamSessionEventMap]

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH-X Command Center</title><style>
:root{color-scheme:light dark;font:14px system-ui,sans-serif;background:#f5f7fb;color:#111827;--panel:#fff;--line:#cbd5e1;--muted:#64748b;--accent:#0f766e;--bad:#b91c1c;--warn:#a16207}
*{box-sizing:border-box}body{margin:0}.shell{display:grid;grid-template-columns:260px 1fr;min-height:100vh}.side{border-right:1px solid var(--line);padding:.75rem;background:var(--panel);position:sticky;top:0;height:100vh;overflow:auto}.main{padding:1rem;min-width:0}h1{font-size:1.15rem;margin:.25rem 0 1rem}h2{font-size:1rem;margin:1rem 0 .5rem}h3{font-size:.9rem;margin:.9rem 0 .4rem;color:var(--muted);text-transform:uppercase}button,input,select,textarea{font:inherit}button{border:1px solid var(--line);background:var(--panel);color:inherit;border-radius:6px;padding:.35rem .55rem;cursor:pointer}button:hover{border-color:var(--accent)}input,select,textarea{border:1px solid var(--line);background:var(--panel);color:inherit;border-radius:6px;padding:.4rem;max-width:100%}textarea{min-height:4.5rem;resize:vertical}.team{width:100%;display:grid;grid-template-columns:auto 1fr;gap:.4rem;text-align:left;margin:.35rem 0}.team strong,.row strong{overflow-wrap:anywhere}.dot{width:.7rem;height:.7rem;border-radius:999px;margin-top:.2rem;background:#94a3b8}.dot.live{background:#16a34a}.meta,.time{color:var(--muted);font-size:.78rem}.needs{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:.75rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.75rem}.row{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:.65rem;margin:.45rem 0;display:grid;gap:.45rem}.actions{display:flex;flex-wrap:wrap;gap:.35rem}.split{display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:start}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:.12rem .4rem;font-size:.75rem}.stale{color:var(--warn)}.error{color:var(--bad);white-space:pre-wrap}.ok{color:var(--accent);white-space:pre-wrap}.forms{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.75rem}.forms label{display:grid;gap:.25rem}.hidden{display:none!important}
@media(max-width:720px){.shell{display:block}.side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.main{padding:.75rem}.split{display:block}.actions button{flex:1 1 auto}}
@media(prefers-color-scheme:dark){:root{background:#0f172a;color:#e5e7eb;--panel:#111827;--line:#334155;--muted:#94a3b8;--accent:#2dd4bf;--bad:#f87171;--warn:#facc15}}
</style></head><body><div class="shell"><aside class="side"><h1>DSH-X</h1><div id="teams"></div></aside><main class="main"><div class="split"><div><h2 id="title">Command Center</h2><p class="meta" id="stamp">Loading...</p></div><label>Acting as <select id="actor"></select></label></div><section class="needs"><h2>Needs Rome</h2><div id="needs"></div></section><section class="forms"><form id="taskForm"><h2>Create Task</h2><label>Subject<input name="subject" required></label><label>Description<textarea name="description" required></textarea></label><button>Create</button></form><form id="messageForm"><h2>Send Message</h2><label>Target<select name="target"></select></label><label>Message<textarea name="message" required></textarea></label><button>Send</button></form></section><section><h2>Agents</h2><div id="agents" class="grid"></div></section><section><h2>Tasks</h2><div id="tasks"></div></section><section><h2>Messages</h2><div id="messages"></div></section><h2>Action Result</h2><pre id="result" class="meta"></pre></main></div><script>
let data,selected;const $=s=>document.querySelector(s),teams=$('#teams'),actor=$('#actor'),result=$('#result');
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function post(body){const r=await fetch('${ACTION_ROUTE}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({teamId:selected,actor:actor.value,...body})});const text=await r.text();let json;try{json=JSON.parse(text)}catch{json={raw:text}};result.className=r.ok?'ok':'error';result.textContent=JSON.stringify(json,null,2);await load()}
function render(){const d=data.details[selected]??data.details[data.teams[0]?.id];if(!d)return;selected=d.id;$('#title').textContent=d.name;$('#stamp').textContent='Refreshed '+data.checkedAt+' · team row '+d.timestamp;teams.innerHTML=data.teams.map(t=>'<button class="team" data-team="'+esc(t.id)+'"><span class="dot '+t.status+'"></span><span><strong>'+esc(t.name)+'</strong><br><span class="time">'+esc(t.timestamp)+'</span><br><span class="meta">'+t.needsRomeCount+' needs Rome</span></span></button>').join('');teams.querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.team;render()});actor.innerHTML=d.actors.map(a=>'<option>'+esc(a)+'</option>').join('');$('#messageForm select[name=target]').innerHTML=d.agents.map(a=>'<option>'+esc(a.name)+'</option>').join('');$('#needs').innerHTML=d.needsRome.length?d.needsRome.map(n=>'<div class="row"><div><strong>'+esc(n.label)+'</strong> <span class="pill">'+n.kind+'</span></div><div class="time">'+esc(n.timestamp)+'</div><div class="actions">'+(n.kind==='blocked-task'?'<button data-action="unblockTask" data-task="'+esc(n.id)+'">Unblock</button>':'')+'<button data-fill="'+esc(n.label)+'">Message</button></div></div>').join(''):'<p class="meta">Nothing waiting on Rome.</p>';$('#needs').querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>post({action:b.dataset.action,taskId:b.dataset.task}));$('#needs').querySelectorAll('[data-fill]').forEach(b=>b.onclick=()=>{$('#messageForm textarea').value=b.dataset.fill});
$('#agents').innerHTML=d.agents.map(a=>'<article class="row"><div><strong>'+esc(a.name)+'</strong> <span class="pill">'+esc(a.provider)+'</span> <span class="'+(a.freshness==='stale'?'stale':'')+'">'+a.freshness+'</span></div><div>'+esc(a.currentTask)+'</div><div class="time">'+esc(a.timestamp)+'</div><div class="actions"><button data-target="'+esc(a.name)+'" data-kind="message">Message</button><button data-target="'+esc(a.name)+'" data-action="interruptAgent">Interrupt</button><button data-target="'+esc(a.name)+'" data-action="stopAgent">Stop</button></div></article>').join('');$('#agents').querySelectorAll('[data-kind=message]').forEach(b=>b.onclick=()=>{$('#messageForm select[name=target]').value=b.dataset.target;$('#messageForm textarea').focus()});$('#agents').querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>post({action:b.dataset.action,target:b.dataset.target}));
$('#tasks').innerHTML=Object.entries(d.tasks).map(([state,rows])=>'<h3>'+state+'</h3>'+(rows.length?rows.map(t=>'<div class="row"><div><strong>'+esc(t.id)+'</strong> '+esc(t.subject)+' <span class="pill">'+esc(t.revision)+'</span></div><div>'+esc(t.description)+'</div><div class="meta">owner '+esc(t.ownerName??'unowned')+' · ready '+t.ready+'</div><div class="time">'+esc(t.timestamp)+'</div><div class="actions"><button data-action="claimTask" data-task="'+esc(t.id)+'">Claim</button><button data-action="releaseTask" data-task="'+esc(t.id)+'">Release</button><button data-action="unblockTask" data-task="'+esc(t.id)+'">Unblock</button></div></div>').join(''):'<p class="meta">No rows.</p>').join('');$('#tasks').querySelectorAll('button').forEach(b=>b.onclick=()=>post({action:b.dataset.action,taskId:b.dataset.task}));
$('#messages').innerHTML=d.messages.length?d.messages.map(m=>'<div class="row"><div><strong>'+esc(m.sender)+'</strong> → '+esc(m.target)+' <span class="pill">'+m.status+'</span></div><div>'+esc(m.text)+'</div><div class="time">'+esc(m.timestamp)+'</div><div class="actions"><button data-reply="'+esc(m.sender)+'">Reply</button></div></div>').join(''):'<p class="meta">No messages.</p>';$('#messages').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('#messageForm select[name=target]').value=b.dataset.reply;$('#messageForm textarea').focus()})}
async function load(){data=await fetch('${JSON_ROUTE}').then(r=>r.json());selected=selected??data.teams[0]?.id;render()}setInterval(load,5000);load();
$('#taskForm').onsubmit=e=>{e.preventDefault();post({action:'createTask',subject:e.target.subject.value,description:e.target.description.value})};
$('#messageForm').onsubmit=e=>{e.preventDefault();post({action:'sendMessage',target:e.target.target.value,message:e.target.message.value})};
</script></body></html>`

/** Interactive DSH-X command center service. */
export class DshXCommandCenterService extends Service {
  static inject = ['agents', 'agentTeams', 'subagents', 'webServer']

  static Config: z<Config> = z.object({
    staleAfterMs: z.number().step(1).min(1).default(DEFAULT_STALE_AFTER_MS),
  })

  private readonly staleAfterMs: number

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'dshXCommandCenter')
    this.staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  }

  /**
   * Return the current Team command-center projection.
   * @returns Teams and per-team actionable rows.
   */
  snapshot(): CommandCenterSnapshot {
    const checkedAt = new Date().toISOString()
    const details: Record<string, CommandCenterTeamDetail> = {}
    for (const root of this.roots()) {
      const detail = this.detail(root, checkedAt)
      details[detail.id] = detail
    }
    const teams = Object.values(details).map((detail): CommandCenterTeamRow => ({
      id: detail.id,
      name: detail.name,
      status: detail.agents.some(agent => agent.status === 'running' || agent.status === 'provisioning') ? 'live' : 'idle',
      timestamp: detail.timestamp,
      needsRomeCount: detail.needsRome.length,
    }))
    return { checkedAt, teams, details }
  }

  /** Register HTML, JSON, and action routes. */
  [Service.init](): void {
    const page: WebRoute = {
      kind: 'exact', path: ROUTE,
      handler: dshXAuth((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(PAGE)
      }),
    }
    const json: WebRoute = {
      kind: 'exact', path: JSON_ROUTE,
      handler: dshXAuth((_req, res) => { sendJson(res, 200, this.snapshot()) }),
    }
    const actions: WebRoute = {
      kind: 'exact', path: ACTION_ROUTE,
      handler: dshXAuth((req, res) => { void this.handleAction(req, res) }),
    }
    this.ctx.effect(() => this.ctx.webServer.register(page), 'dsh-x-command-center: page')
    this.ctx.effect(() => this.ctx.webServer.register(json), 'dsh-x-command-center: json')
    this.ctx.effect(() => this.ctx.webServer.register(actions), 'dsh-x-command-center: actions')
  }

  private async handleAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST required', timestamp: nowIso() })
      return
    }
    try {
      const body = await readJson(req)
      const output = await this.runAction(body)
      sendJson(res, 200, { ok: true, timestamp: nowIso(), ...output })
    } catch (error: unknown) {
      const { code, message } = errorInfo(error)
      sendJson(res, error instanceof DshXBodyTooLargeError ? 413 : 409, { ok: false, code, message, timestamp: nowIso() })
    }
  }

  private async runAction(body: unknown): Promise<{ action: string; result: unknown }> {
    const input = record(body)
    const action = stringField(input, 'action')
    const root = this.rootById(stringField(input, 'teamId'))
    const actor = this.memberAgent(root, stringField(input, 'actor', 'lead'))
    switch (action) {
      case 'createTask':
        return {
          action,
          result: await this.ctx.agentTeams.createTask(actor, {
            subject: stringField(input, 'subject'),
            description: stringField(input, 'description'),
          }),
        }
      case 'claimTask': {
        const task = this.ctx.agentTeams.getTask(actor, TeamTaskId(stringField(input, 'taskId')))
        return { action, result: await this.ctx.agentTeams.updateTask(actor, { taskId: task.id, expectedRevision: task.revision, action: 'claim' }) }
      }
      case 'releaseTask': {
        const task = this.ctx.agentTeams.getTask(actor, TeamTaskId(stringField(input, 'taskId')))
        return { action, result: await this.ctx.agentTeams.updateTask(actor, { taskId: task.id, expectedRevision: task.revision, action: 'release' }) }
      }
      case 'unblockTask': {
        const task = this.ctx.agentTeams.getTask(actor, TeamTaskId(stringField(input, 'taskId')))
        return { action, result: await this.ctx.agentTeams.updateTask(actor, { taskId: task.id, expectedRevision: task.revision, action: 'unblock' }) }
      }
      case 'sendMessage':
        return {
          action,
          result: await this.ctx.agentTeams.sendMessage(actor, {
            target: stringField(input, 'target'),
            content: [{ type: 'text', text: stringField(input, 'message') }],
            delivery: 'wakeup',
            signal: AbortSignal.timeout(30_000),
          }),
        }
      case 'interruptAgent':
        return { action, result: this.ctx.agentTeams.interrupt(actor, stringField(input, 'target')) }
      case 'stopAgent':
        return { action, result: await this.stopAgent(root, actor, stringField(input, 'target')) }
      default:
        throw new TeamError(`unsupported action "${action}"`, 'COMMAND_CENTER_INVALID_ACTION')
    }
  }

  private async stopAgent(root: Agent, actor: Agent, targetName: string): Promise<{ stopped: true; target: string }> {
    if (this.ctx.agentTeams.membership(actor).role !== 'lead') {
      throw new TeamError('only the Team Lead can stop teammates', 'TEAM_LEAD_REQUIRED')
    }
    const target = this.ctx.agentTeams.listMembers(root).find(member => member.name === targetName)
    if (target === undefined || target.role !== 'teammate') {
      throw new TeamError(`teammate "${targetName}" not found`, 'TEAM_MEMBER_NOT_FOUND')
    }
    await this.ctx.subagents.drainContinuableChildren(root, [target.id])
    return { stopped: true, target: target.name }
  }

  private detail(root: Agent, checkedAt: string): CommandCenterTeamDetail {
    const members = this.ctx.agentTeams.listMembers(root)
    const taskTimes = eventTimes(root.session.events)
    const tasks = TASK_STATES.reduce<Record<(typeof TASK_STATES)[number], CommandCenterTaskRow[]>>((acc, status) => {
      acc[status] = []
      return acc
    }, { pending: [], in_progress: [], in_review: [], blocked: [], completed: [] })
    for (const task of this.ctx.agentTeams.listTasks(root)) {
      if (task.status === 'deleted') continue
      tasks[task.status].push({ ...task, timestamp: iso(taskTimes.get(task.id) ?? root.session.header.createdAt) })
    }
    const messages = this.messages(root, members)
    const agents = this.agents(root, members, Object.values(tasks).flat(), checkedAt)
    const needsRome = [
      ...tasks.blocked.map(task => need('blocked-task', task.id, task.subject, task.timestamp)),
      ...tasks.in_review.map(task => need('review-task', task.id, task.subject, task.timestamp)),
      ...messages.filter(message => message.target === 'lead').map(message =>
        need('lead-message', message.id, `${message.sender}: ${message.text}`, message.timestamp)),
    ].sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    return {
      id: String(root.id),
      name: root.session.header.cwd ?? `Team ${root.id}`,
      timestamp: iso(root.session.events.at(-1)?.time ?? root.session.header.createdAt),
      actors: members.map(member => member.name),
      agents,
      tasks,
      messages,
      needsRome,
    }
  }

  private agents(
    root: Agent,
    members: readonly TeamMemberView[],
    tasks: readonly CommandCenterTaskRow[],
    checkedAt: string,
  ): CommandCenterAgentRow[] {
    const now = Date.parse(checkedAt)
    return members.map((member): CommandCenterAgentRow => {
      const live = member.id === root.id ? root : this.ctx.agents.get(member.id)
      const latest = live?.session.events.at(-1)
      const timestampMs = latest?.time ?? root.session.header.createdAt
      const current = tasks.find(task =>
        task.ownerName === member.name && task.status !== 'completed' && task.status !== 'deleted')
      return {
        id: String(member.id),
        name: member.name,
        provider: member.provider ?? live?.options.provider ?? 'unknown',
        status: member.status,
        freshness: now - timestampMs > this.staleAfterMs ? 'stale' : 'live',
        currentTask: current === undefined ? 'none' : `${current.subject} (${current.status})`,
        timestamp: iso(timestampMs),
      }
    })
  }

  private messages(root: Agent, members: readonly TeamMemberView[]): CommandCenterMessageRow[] {
    const names = new Map<SessionId, string>(members.map(member => [member.id, member.name]))
    const teamEvents = asTeamEvents(root.session.events)
    const delivered = new Set(teamEvents
      .filter(event => event.type === 'team/message/delivered')
      .map(event => event.data.messageId))
    const rows: CommandCenterMessageRow[] = []
    for (const event of teamEvents) {
      if (event.type !== 'team/message/queued') continue
      rows.push({
        id: event.data.message.id,
        sender: event.data.message.senderName,
        target: names.get(event.data.message.targetId) ?? String(event.data.message.targetId),
        text: event.data.message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join(' '),
        delivery: event.data.message.delivery,
        status: delivered.has(event.data.message.id) ? 'delivered' : 'queued',
        timestamp: iso(event.time),
      })
    }
    return rows.sort((left, right) => right.timestamp.localeCompare(left.timestamp)).slice(0, 30)
  }

  private roots(): Agent[] {
    const roots = new Map<string, Agent>()
    for (const agent of this.ctx.agents.list()) {
      const membership = this.ctx.agentTeams.tryMembership(agent)
      if (membership !== undefined) roots.set(String(membership.root.id), membership.root)
    }
    return [...roots.values()]
  }

  private rootById(id: string): Agent {
    const root = this.roots().find(candidate => String(candidate.id) === id)
    if (root === undefined) throw new TeamError(`team "${id}" not found`, 'TEAM_NOT_FOUND')
    return root
  }

  private memberAgent(root: Agent, name: string): Agent {
    if (name === 'lead') return root
    const member = this.ctx.agentTeams.listMembers(root).find(candidate => candidate.name === name)
    const agent = member === undefined ? undefined : this.ctx.agents.get(member.id)
    if (agent === undefined) throw new TeamError(`active teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
    return agent
  }
}

function need(kind: CommandCenterNeedRow['kind'], id: string, label: string, timestamp: string): CommandCenterNeedRow {
  return { kind, id, label, timestamp }
}

function eventTimes(events: readonly SessionEvent[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const event of asTeamEvents(events)) {
    if (event.type === 'team/task') out.set(event.data.task.id, event.time)
  }
  return out
}

function asTeamEvents(events: readonly SessionEvent[]): readonly TeamLogEvent[] {
  return events as unknown as readonly TeamLogEvent[]
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TeamError('JSON body must be an object', 'COMMAND_CENTER_INVALID_JSON')
  }
  return value as Record<string, unknown>
}

function stringField(record: Record<string, unknown>, key: string, fallback?: string): string {
  const value = record[key] ?? fallback
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TeamError(`${key} must be a non-empty string`, 'COMMAND_CENTER_INVALID_ARGUMENT')
  }
  return value
}

function errorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN'
    return { code, message: error.message }
  }
  return { code: 'UNKNOWN', message: String(error) }
}

function iso(time: number): string {
  return new Date(time).toISOString()
}

function nowIso(): string {
  return new Date().toISOString()
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return JSON.parse((await readDshXBody(req)).toString('utf8')) as unknown
}

export default DshXCommandCenterService
