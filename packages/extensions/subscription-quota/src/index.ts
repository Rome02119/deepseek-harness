/** Read-only subscription/quota projection for local provider CLIs. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** One quota field; unavailable provider data stays explicitly unknown. */
export type QuotaValue = number | 'unknown'

/** One provider source shown by the read-only view. */
export interface SubscriptionQuotaSource {
  readonly id: 'claude-code' | 'codex' | 'antigravity' | 'omniroute'
  readonly name: string
  readonly usage: QuotaValue
  readonly limit: QuotaValue
  readonly remaining: QuotaValue
  readonly evidence: string
}

/** JSON response returned by the quota endpoint. */
export interface SubscriptionQuotaSnapshot {
  readonly checkedAt: string
  readonly sources: readonly SubscriptionQuotaSource[]
}

const SOURCES: readonly SubscriptionQuotaSource[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    usage: 'unknown',
    limit: 'unknown',
    remaining: 'unknown',
    evidence: 'claude --help exposes no usage, status, limits, or quota command',
  },
  {
    id: 'codex',
    name: 'Codex',
    usage: 'unknown',
    limit: 'unknown',
    remaining: 'unknown',
    evidence: 'codex --help exposes no usage, status, limits, or quota command',
  },
  {
    id: 'antigravity',
    name: 'Antigravity (agy)',
    usage: 'unknown',
    limit: 'unknown',
    remaining: 'unknown',
    evidence: 'agy --help exposes no usage, status, limits, or quota command',
  },
  {
    id: 'omniroute',
    name: 'OmniRoute',
    usage: 'unknown',
    limit: 'unknown',
    remaining: 'unknown',
    evidence: '127.0.0.1:20128/v1/usage and /usage returned 404; /dashboard redirected to /login',
  },
]

/**
 * Build a fresh response without inventing numeric values.
 * @param now Timestamp to place in the response.
 * @returns The observed quota sources.
 */
export function subscriptionQuotaSnapshot(now = new Date()): SubscriptionQuotaSnapshot {
  return { checkedAt: now.toISOString(), sources: SOURCES }
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subscription quota</title><style>
:root{color-scheme:light dark;font:16px system-ui,sans-serif;background:#f6f7fb;color:#171923}
body{max-width:720px;margin:0 auto;padding:1rem}h1{font-size:1.35rem}.card{border:1px solid #c8ccd8;border-radius:12px;padding:1rem;margin:.75rem 0;background:#fff}
@media(prefers-color-scheme:dark){:root{background:#111318;color:#f2f4f8}.card{background:#1b1e26;border-color:#3b4050}}
dt{font-weight:700;margin-top:.6rem}dd{margin:.15rem 0 0;overflow-wrap:anywhere}.unknown{color:#b96b00}
</style></head><body><h1>Subscription quota</h1><p id="checked">Loading…</p><main id="sources"></main><script>
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(data){document.querySelector('#checked').textContent='Checked '+data.checkedAt;document.querySelector('#sources').innerHTML=data.sources.map(s=>'<article class="card"><h2>'+esc(s.name)+'</h2><dl><dt>Usage</dt><dd class="unknown">'+esc(s.usage)+'</dd><dt>Limit</dt><dd class="unknown">'+esc(s.limit)+'</dd><dt>Remaining</dt><dd class="unknown">'+esc(s.remaining)+'</dd><dt>Evidence</dt><dd>'+esc(s.evidence)+'</dd></dl></article>').join('')}
fetch('/subscription-quota.json').then(r=>r.json()).then(render).catch(e=>document.querySelector('#checked').textContent='Could not load quota data: '+e);
</script></body></html>`

/** Read-only HTTP quota service. */
export class SubscriptionQuotaService extends Service {
  static inject = ['webServer']

  constructor(ctx: Context) {
    super(ctx, 'subscriptionQuota')
  }

  /**
   * Return the current provider observations.
   * @returns The observed quota sources.
   */
  snapshot(): SubscriptionQuotaSnapshot {
    return subscriptionQuotaSnapshot()
  }

  /** Register the JSON endpoint and its small browser view. */
  [Service.init](): void {
    const json: WebRoute = {
      kind: 'exact', path: '/subscription-quota.json',
      handler: (_req, res) => { sendJson(res, this.snapshot()) },
    }
    const page: WebRoute = {
      kind: 'exact', path: '/subscription-quota',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(PAGE)
      },
    }
    this.ctx.effect(() => this.ctx.webServer.register(json), 'rome-subscription-quota: json')
    this.ctx.effect(() => this.ctx.webServer.register(page), 'rome-subscription-quota: page')
  }
}

function sendJson(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export default SubscriptionQuotaService
