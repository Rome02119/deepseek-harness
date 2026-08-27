/** Clickable DSH-X control surface for existing terminal, schedule, Loader services, and selectable browser options. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DshXBodyTooLargeError, dshXAuth, readDshXBody } from '@deepseek-ai/dsh-x-auth'
import {
  allocateScheduleId,
  createAfterScheduleRecord,
  foldScheduleEvents,
  ScheduleId,
  scheduleView,
} from '@deepseek-ai/dsh-schedule'
import { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  getBrowserSelectionState,
  launchBrowserUrl,
  selectBrowserOption,
} from './browser.ts'

export {
  getBrowserSelectionState,
  selectBrowserOption,
  launchBrowserUrl,
} from './browser.ts'
export type {
  BrowserOption,
  BrowserSelectionState,
  BrowserOptionsConfig,
} from './browser.ts'

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH-X controls</title>
<style>body{font:15px system-ui,sans-serif;max-width:1100px;margin:auto;padding:20px;background:#f6f7fb;color:#172033}nav{display:flex;gap:8px;margin:16px 0}button,select,input,textarea{font:inherit;padding:7px;border:1px solid #b9c1d0;border-radius:6px}button{cursor:pointer;background:#fff}button:hover{background:#eaf0ff}.tab{background:#172033;color:#fff}.panel{display:none;background:#fff;border:1px solid #d3d9e5;border-radius:10px;padding:16px}.panel.active{display:block}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.grow{flex:1;min-width:220px}pre{background:#111827;color:#d1fae5;padding:14px;min-height:180px;white-space:pre-wrap;border-radius:8px;overflow:auto}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #e1e5ed}code{font-size:12px}#message{min-height:20px;color:#526070}.danger{color:#b42318}.browser-card{border:1px solid #d3d9e5;border-radius:8px;padding:12px;margin:8px 0;width:100%;display:flex;justify-content:space-between;align-items:center;background:#fafbfc}.browser-card.selected{border-color:#2563eb;background:#eff6ff}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600}.badge.active{background:#dcfce7;color:#16a34a}.badge.disabled{background:#fee2e2;color:#dc2626}.badge.idle{background:#f1f5f9;color:#64748b}</style>
<h1>DSH-X controls</h1><p>Live controls over the services already mounted in this process.</p><nav><button class="tab" data-tab="terminal">Terminal</button><button data-tab="schedule">Schedule</button><button data-tab="plugins">Plugins</button><button data-tab="browser">Browser</button></nav><p id="message"></p>
<section class="panel active" id="terminal"><div class="row"><label>Agent <select id="agent"></select></label><button id="refresh-terminal">Refresh</button><button id="open-terminal">Open shell</button></div><div class="row"><label>Session <select id="terminal-session"></select></label><button id="close-terminal">Close</button></div><pre id="terminal-output">No terminal session selected.</pre><div class="row"><input class="grow" id="terminal-input" placeholder="Type into the live PTY, e.g. printf hello"><button id="send-terminal">Send</button></div></section>
<section class="panel" id="schedule"><div class="row"><label>Agent <select id="schedule-agent"></select></label><button id="refresh-schedule">Refresh</button></div><div class="row"><input class="grow" id="schedule-prompt" value="DSH-X browser reminder"><label>After seconds <input id="schedule-after" type="number" min="1" value="60"></label><button id="create-schedule">Create job</button></div><table><thead><tr><th>Prompt</th><th>State</th><th>Last run</th><th>Next run</th><th></th></tr></thead><tbody id="schedule-rows"></tbody></table></section>
<section class="panel" id="plugins"><div class="row"><input class="grow" id="plugin-name" value="@deepseek-ai/dsh-x-ui/demo"><button id="add-plugin">Add plugin</button><button id="refresh-plugins">Refresh</button></div><p>Use the bundled demo entry to verify add, disable, enable, and remove safely.</p><table><thead><tr><th>Entry</th><th>Module</th><th>Status</th><th></th></tr></thead><tbody id="plugin-rows"></tbody></table></section>
<section class="panel" id="browser"><h2>Browser Options</h2><p>Select which browser DSH-X uses for web tasks. The selection persists across restarts.</p><div id="browser-list"></div><div class="row" style="margin-top:18px"><input class="grow" id="browser-url" value="https://example.com" placeholder="Enter URL to test launch..."><button id="launch-browser">Launch in Selected Browser</button></div></section>
<script>
const $=s=>document.querySelector(s), msg=s=>$('#message').textContent=s, json=async(r)=>{const v=await r.json();if(!r.ok)throw Error(v.error||r.statusText);return v}, post=async(u,b)=>json(await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}));
let state={agents:[],plugins:[],browser:null}, selectedTerminal;
function agentOptions(id){return state.agents.map(a=>'<option value="'+a.id+'">'+a.id+' ('+a.status+')</option>').join('')}
function renderAgents(){for(const id of ['agent','schedule-agent']){$('#'+id).innerHTML=agentOptions($('#'+id).value||state.agents[0]?.id||'')}}
async function loadState(){state=await json(await fetch('/dsh-x/api/state'));renderAgents();renderTerminals();renderPlugins();renderBrowser()}
function renderTerminals(){const a=state.agents.find(x=>x.id==$('#agent').value);const rows=a?.terminals||[];$('#terminal-session').innerHTML=rows.map(x=>'<option value="'+x.sessionId+'">'+(x.name||x.sessionId)+' ['+x.status.kind+']</option>').join('');if(selectedTerminal&&!rows.some(x=>x.sessionId===selectedTerminal))selectedTerminal=rows[0]?.sessionId;selectedTerminal=selectedTerminal||rows[0]?.sessionId||''}
async function readTerminal(){const a=$('#agent').value;if(!selectedTerminal)return;const v=await json(await fetch('/dsh-x/api/terminal/read?agentId='+encodeURIComponent(a)+'&sessionId='+encodeURIComponent(selectedTerminal)));$('#terminal-output').textContent=v.text||'(no output)'}
function renderPlugins(){ $('#plugin-rows').innerHTML=state.plugins.map(p=>'<tr><td><code>'+p.entryId+'</code></td><td><code>'+p.moduleName+'</code></td><td>'+ (p.enabled?'enabled':'disabled')+' '+(p.fiberPhase||'')+'</td><td>'+(!p.protected?'<button data-toggle="'+p.entryId+'">'+(p.enabled?'Disable':'Enable')+'</button> <button class="danger" data-remove="'+p.entryId+'">Remove</button>':'protected')+'</td></tr>').join('') }
function renderBrowser(){ if(!state.browser) return; $('#browser-list').innerHTML=state.browser.options.map(o=>'<div class="browser-card '+(o.current?'selected':'')+'"><div><strong>'+o.name+'</strong> '+(o.current?'<span class="badge active">ACTIVE</span>':(o.available?'<span class="badge idle">AVAILABLE</span>':'<span class="badge disabled">DISABLED</span>'))+'<p style="margin:4px 0 0;font-size:13px;color:#526070">'+o.description+(o.reason?' — <span class="danger">'+o.reason+'</span>':'')+'</p>'+(o.path?'<code style="font-size:11px;color:#6b7280">'+o.path+'</code>':'')+'</div><div>'+(o.current?'<button disabled style="opacity:0.6">Selected</button>':(o.available?'<button data-select-browser="'+o.id+'">Select</button>':'<button disabled title="'+(o.reason||'Unavailable')+'" style="opacity:0.5;cursor:not-allowed">Unavailable</button>'))+'</div></div>').join('') }
async function loadSchedule(){const a=$('#schedule-agent').value;const rows=await json(await fetch('/dsh-x/api/schedule?agentId='+encodeURIComponent(a)));$('#schedule-rows').innerHTML=rows.map(x=>'<tr><td>'+x.prompt+'</td><td>'+x.state+'</td><td><code>'+(x.lastRun||'never')+'</code></td><td><code>'+x.scheduledAt+'</code></td><td><button data-delete="'+x.id+'">Delete</button></td></tr>').join('')}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('tab'));b.classList.add('tab');document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));$('#'+b.dataset.tab).classList.add('active');if(b.dataset.tab==='schedule')loadSchedule();if(b.dataset.tab==='browser')loadState()})
$('#agent').onchange=()=>{selectedTerminal=undefined;renderTerminals();readTerminal()};$('#schedule-agent').onchange=loadSchedule;$('#terminal-session').onchange=()=>{selectedTerminal=$('#terminal-session').value;readTerminal()};$('#refresh-terminal').onclick=async()=>{await loadState();await readTerminal()};$('#open-terminal').onclick=async()=>{const v=await post('/dsh-x/api/terminal/open',{agentId:$('#agent').value,name:'web'});selectedTerminal=v.sessionId;await loadState();await readTerminal();msg('Opened '+v.sessionId)};$('#close-terminal').onclick=async()=>{await post('/dsh-x/api/terminal/close',{agentId:$('#agent').value,sessionId:selectedTerminal});selectedTerminal=undefined;await loadState();$('#terminal-output').textContent='Closed.'};$('#send-terminal').onclick=async()=>{const text=$('#terminal-input').value;const v=await post('/dsh-x/api/terminal/send',{agentId:$('#agent').value,sessionId:selectedTerminal,text,submit:true});$('#terminal-input').value='';$('#terminal-output').textContent=v.viewport||'(no new output)';msg('Terminal wait: '+v.waitReason)};$('#refresh-schedule').onclick=loadSchedule;$('#schedule-rows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;await post('/dsh-x/api/schedule/delete',{agentId:$('#schedule-agent').value,id:b.dataset.delete});msg('Deleted '+b.dataset.delete);await loadSchedule()};$('#create-schedule').onclick=async()=>{const v=await post('/dsh-x/api/schedule',{agentId:$('#schedule-agent').value,prompt:$('#schedule-prompt').value,afterSeconds:Number($('#schedule-after').value)});msg('Created '+v.id+'; next run '+v.scheduledAt);await loadSchedule()};$('#refresh-plugins').onclick=async()=>{await loadState();msg('Plugin inventory refreshed')};$('#add-plugin').onclick=async()=>{const v=await post('/dsh-x/api/plugins/add',{name:$('#plugin-name').value});msg('Added '+v.entryId);await loadState()};$('#plugin-rows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.toggle||b.dataset.remove;if(b.dataset.toggle)await post('/dsh-x/api/plugins/toggle',{entryId:id,enabled:b.textContent==='Enable'});else await post('/dsh-x/api/plugins/remove',{entryId:id});await loadState()};
$('#browser-list').onclick=async e=>{const b=e.target.closest('button[data-select-browser]');if(!b)return;const browser=b.dataset.selectBrowser;try{const v=await post('/dsh-x/api/browser/select',{browser});msg('Switched active browser to '+v.selected);await loadState()}catch(err){msg('Selection error: '+err.message)}};
$('#launch-browser').onclick=async()=>{const url=$('#browser-url').value.trim();if(!url)return;try{msg('Launching '+url+'...');const v=await post('/dsh-x/api/browser/launch',{url});msg('Launched in '+v.browser)}catch(err){msg('Launch error: '+err.message)}};
setInterval(()=>{if($('#terminal').classList.contains('active')){loadState().then(readTerminal).catch(e=>msg(e.message))}},1500);loadState().catch(e=>msg(e.message));
</script>`

type JsonRecord = Record<string, unknown>

/** Maximum concurrently retained shell sessions across all agents. */
export const MAX_CONCURRENT_PTYS = 8

/** Host services required by the control page. */
export const inject = ['agents', 'loader', 'sessions', 'terminals', 'webServer']

/** Host service backing the DSH-X browser control page. */
export class DshXUiService extends Service {
  static inject = inject

  constructor(ctx: Context) {
    super(ctx, 'dshXUi')
  }

  /** Register the page and JSON actions. */
  [Service.init](): void {
    const routes: WebRoute[] = [
      { kind: 'exact', path: '/dsh-x', handler: dshXAuth((_req, res) => { this.page(res) }) },
      { kind: 'exact', path: '/dsh-x/api/state', handler: dshXAuth((_req, res) => { this.state(res) }) },
      { kind: 'exact', path: '/dsh-x/api/terminal/read', handler: dshXAuth((req, res) => { this.readTerminal(req, res) }) },
      { kind: 'exact', path: '/dsh-x/api/terminal/open', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.openTerminal(body))) },
      { kind: 'exact', path: '/dsh-x/api/terminal/send', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.sendTerminal(body))) },
      { kind: 'exact', path: '/dsh-x/api/terminal/close', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.closeTerminal(body))) },
      { kind: 'exact', path: '/dsh-x/api/schedule', handler: dshXAuth((req, res) => {
        if (req.method === 'POST') return this.jsonAction(req, res, body => this.createSchedule(body))
        this.scheduleList(req, res)
      }) },
      { kind: 'exact', path: '/dsh-x/api/schedule/delete', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.deleteSchedule(body))) },
      { kind: 'exact', path: '/dsh-x/api/plugins/add', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.addPlugin(body))) },
      { kind: 'exact', path: '/dsh-x/api/plugins/toggle', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.togglePlugin(body))) },
      { kind: 'exact', path: '/dsh-x/api/plugins/remove', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.removePlugin(body))) },
      { kind: 'exact', path: '/dsh-x/api/browser', handler: dshXAuth((_req, res) => { this.browserState(res) }) },
      { kind: 'exact', path: '/dsh-x/api/browser/select', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.selectBrowser(body))) },
      { kind: 'exact', path: '/dsh-x/api/browser/launch', handler: dshXAuth((req, res) => this.jsonAction(req, res, body => this.launchBrowser(body))) },
    ]
    this.ctx.effect(() => {
      const disposers = routes.map(route => this.ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-x-ui routes')
  }

  private page(res: ServerResponse): void { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(PAGE) }

  private state(res: ServerResponse): void {
    sendJson(res, {
      agents: this.agents().map(agent => ({
        id: String(agent.id), status: agent.status, terminals: this.ctx.terminals.list(agent),
      })),
      plugins: this.plugins(),
      browser: getBrowserSelectionState(),
    })
  }

  private browserState(res: ServerResponse): void {
    sendJson(res, getBrowserSelectionState())
  }

  private selectBrowser(body: JsonRecord): unknown {
    const browser = stringField(body, 'browser')
    const state = selectBrowserOption(browser)
    return {
      success: true,
      selected: state.selected,
      options: state.options,
      persistedAt: state.persistedAt,
    }
  }

  private async launchBrowser(body: JsonRecord): Promise<unknown> {
    const url = stringField(body, 'url')
    const browser = optionalString(body, 'browser')
    return launchBrowserUrl(url, { ...browser !== undefined ? { browserId: browser } : {} })
  }

  private agents(): Agent[] { return this.ctx.agents.list() }

  private agent(body: JsonRecord): Agent {
    const id = stringField(body, 'agentId')
    const agent = this.ctx.agents.get(id as Agent['id'])
    if (agent === undefined) throw new Error(`unknown agent ${id}`)
    return agent
  }

  private plugins(): Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null; protected: boolean }> {
    return [...this.ctx.loader.entries()].filter(entry => !entry.options.group).map(entry => ({
      entryId: entry.id,
      moduleName: entry.options.name,
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : String(entry.fiber.state),
      protected: entry.options.name === '@deepseek-ai/dsh-x-ui',
    }))
  }

  private async openTerminal(body: JsonRecord): Promise<unknown> {
    if (this.agents().flatMap(agent => this.ctx.terminals.list(agent)).filter(session => session.status.kind === 'running').length >= MAX_CONCURRENT_PTYS) {
      const error = Object.assign(new Error('too many open PTYs'), { status: 429 })
      throw error
    }
    const name = optionalString(body, 'name')
    const type = optionalString(body, 'type') ?? (this.ctx.terminals.listBackends().includes('herdr') ? 'herdr' : 'shell')
    return this.ctx.terminals.spawn(this.agent(body), { type, ...name === undefined ? {} : { name } })
  }

  private async sendTerminal(body: JsonRecord): Promise<unknown> {
    const agent = this.agent(body)
    const operation = this.ctx.terminals.startSend(agent, TerminalSessionId(stringField(body, 'sessionId')), { text: stringField(body, 'text'), submit: body.submit !== false })
    return operation.done
  }

  private async closeTerminal(body: JsonRecord): Promise<unknown> { return { closed: await this.ctx.terminals.kill(this.agent(body), TerminalSessionId(stringField(body, 'sessionId')), 'browser') } }

  private readTerminal(req: IncomingMessage, res: ServerResponse): void {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams
    const agent = this.ctx.agents.get(query.get('agentId') as Agent['id'])
    if (agent === undefined) throw new Error('unknown agent')
    sendJson(res, this.ctx.terminals.read(agent, TerminalSessionId(query.get('sessionId') ?? '')))
  }

  private scheduleList(req: IncomingMessage, res: ServerResponse): void {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams
    sendJson(res, this.listSchedules(this.ctx.agents.get(query.get('agentId') as Agent['id'])))
  }

  private listSchedules(agent: Agent | undefined): unknown {
    if (agent === undefined) throw new Error('unknown agent')
    const folded = foldScheduleEvents(agent.session.events, agent.session.header.seedLength ?? 0)
    return folded.active.map(record => ({ ...scheduleView(record, Date.now()), lastRun: this.lastRun(agent, record.id) }))
  }

  private lastRun(agent: Agent, id: string): string | null {
    let last: string | null = null
    for (const event of agent.session.events) {
      if (event.type === 'schedule/change' && event.data.operation === 'dispatch' && event.data.id === id) last = new Date(event.time).toISOString()
    }
    return last
  }

  private async createSchedule(body: JsonRecord): Promise<unknown> {
    const agent = this.agent(body)
    const prompt = stringField(body, 'prompt').trim()
    const seconds = numberField(body, 'afterSeconds')
    if (!prompt || !Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('prompt and a positive afterSeconds are required')
    await this.flush(agent)
    const folded = foldScheduleEvents(agent.session.events, agent.session.header.seedLength ?? 0)
    const record = createAfterScheduleRecord(allocateScheduleId(folded), prompt, seconds, Date.now())
    agent.session.append('schedule/change', { version: 1, operation: 'create', schedule: record })
    await this.flush(agent)
    return scheduleView(record, Date.now())
  }

  private async deleteSchedule(body: JsonRecord): Promise<unknown> {
    const agent = this.agent(body)
    const id = ScheduleId(stringField(body, 'id'))
    await this.flush(agent)
    const active = foldScheduleEvents(agent.session.events, agent.session.header.seedLength ?? 0).active
    if (!active.some(record => record.id === id)) return { id, deleted: false }
    agent.session.append('schedule/change', { version: 1, operation: 'delete', id })
    await this.flush(agent)
    return { id, deleted: true }
  }

  private async flush(agent: Agent): Promise<void> { if (!await this.ctx.sessions.flush(agent.session)) throw new Error('schedule persistence did not complete') }

  private async addPlugin(body: JsonRecord): Promise<unknown> {
    const name = stringField(body, 'name').trim()
    if (!name || name === '@deepseek-ai/dsh-x-ui') throw new Error('choose a plugin module, not the control page')
    return { entryId: await this.ctx.loader.create({ name }) }
  }

  private async togglePlugin(body: JsonRecord): Promise<unknown> {
    const entry = this.entry(body)
    const enabled = body.enabled === true
    if (entry.options.name === '@deepseek-ai/dsh-x-ui') throw new Error('the control page cannot be disabled')
    await this.ctx.loader.update(entry.id, { disabled: !enabled })
    return { entryId: entry.id, enabled }
  }

  private async removePlugin(body: JsonRecord): Promise<unknown> {
    const entry = this.entry(body)
    if (entry.options.name === '@deepseek-ai/dsh-x-ui') throw new Error('the control page cannot be removed')
    await this.ctx.loader.remove(entry.id)
    return { entryId: entry.id, removed: true }
  }

  private entry(body: JsonRecord): Entry { const id = stringField(body, 'entryId'); return this.ctx.loader.resolve(id) }

  private async jsonAction(req: IncomingMessage, res: ServerResponse, action: (body: JsonRecord) => unknown): Promise<void> {
    try { sendJson(res, await action(await readJson(req))) } catch (error: unknown) { res.writeHead(error instanceof DshXBodyTooLargeError ? 413 : (error as { status?: number }).status ?? 400, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }
  }
}

function stringField(body: JsonRecord, key: string): string { const value = body[key]; if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`); return value }
function optionalString(body: JsonRecord, key: string): string | undefined {
  const value = body[key]
  return value === undefined ? undefined : stringField(body, key)
}
function numberField(body: JsonRecord, key: string): number { const value = body[key]; if (typeof value !== 'number') throw new Error(`${key} must be a number`); return value }
async function readJson(req: IncomingMessage): Promise<JsonRecord> { const value: unknown = JSON.parse((await readDshXBody(req)).toString('utf8')); if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('request body must be an object'); return value as JsonRecord }
function sendJson(res: ServerResponse, value: unknown): void { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }

/** Loader plugin entry point. */
export const name = 'dsh-x-ui'
/** Mount the DSH-X control page. */
export function apply(ctx: Context): void { new DshXUiService(ctx) }
export default DshXUiService
