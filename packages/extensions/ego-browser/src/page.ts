/**
 * Interactive DSH-X UI page for ego-browser.
 *
 * @module @deepseek-ai/dsh-ego-browser/page
 */

export const EGO_BROWSER_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ego-browser · DSH-X</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --success: #16a34a;
      --success-bg: #dcfce7;
      --warning: #ca8a04;
      --warning-bg: #fef9c3;
      --danger: #dc2626;
      --danger-bg: #fee2e2;
      --code-bg: #1e293b;
      --code-text: #f8fafc;
      --radius: 10px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0f19;
        --card-bg: #131b2e;
        --text: #f1f5f9;
        --text-muted: #94a3b8;
        --border: #243048;
        --primary: #3b82f6;
        --primary-hover: #60a5fa;
        --code-bg: #060911;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .header-title h1 {
      font-size: 1.5rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge.ready { background: var(--success-bg); color: var(--success); }
    .badge.warning { background: var(--warning-bg); color: var(--warning); }
    .badge.error { background: var(--danger-bg); color: var(--danger); }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .card h2 {
      font-size: 1.1rem;
      margin-bottom: 14px;
      color: var(--text);
    }
    .status-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-size: 0.9rem;
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .status-item:last-child { border-bottom: none; }
    .label { color: var(--text-muted); }
    .value { font-weight: 500; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 0.875rem;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--primary);
      background: var(--primary);
      color: #fff;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn.outline {
      background: transparent;
      color: var(--text);
      border-color: var(--border);
    }
    .btn.outline:hover {
      background: rgba(0,0,0,0.05);
    }
    .input-group {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    input[type="text"] {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 0.875rem;
      background: var(--bg);
      color: var(--text);
    }
    pre {
      background: var(--code-bg);
      color: var(--code-text);
      padding: 14px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.85rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      max-height: 350px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      margin-top: 10px;
    }
    th, td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th { color: var(--text-muted); font-weight: 600; }
    .full-width { grid-column: 1 / -1; }
    .alert {
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.9rem;
    }
    .alert.info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
    @media (prefers-color-scheme: dark) {
      .alert.info { background: #1e293b; color: #93c5fd; border-color: #3b82f6; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-title">
      <h1>ego-browser</h1>
      <span id="header-badge" class="badge warning">Checking...</span>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn outline" id="btn-refresh">Refresh Status</button>
      <a href="/dsh-x" class="btn outline" style="text-decoration:none;">DSH-X Hub</a>
    </div>
  </header>

  <div id="alert-box" style="display:none;" class="alert info"></div>

  <div class="grid">
    <section class="card">
      <h2>Environment & Integration</h2>
      <div class="status-list">
        <div class="status-item">
          <span class="label">Ego Lite Binary</span>
          <span class="value" id="status-bin">Checking...</span>
        </div>
        <div class="status-item">
          <span class="label">App Process</span>
          <span class="value" id="status-app">Checking...</span>
        </div>
        <div class="status-item">
          <span class="label">Web Seam Provider ID</span>
          <span class="value">ego-browser</span>
        </div>
        <div class="status-item">
          <span class="label">Active Fetch Provider</span>
          <span class="value" id="status-active-provider">Checking...</span>
        </div>
        <div class="status-item">
          <span class="label">Provider Selection</span>
          <div>
            <button class="btn" id="btn-select-ego" style="padding: 4px 10px; font-size: 0.8rem;">Select ego-browser</button>
            <button class="btn outline" id="btn-select-http" style="padding: 4px 10px; font-size: 0.8rem;">Select http</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Live Browser Navigation</h2>
      <p style="font-size: 0.875rem; color: var(--text-muted);">Drive ego-browser in an isolated task space and observe page structure.</p>
      <div class="input-group">
        <input type="text" id="input-url" value="https://example.com" placeholder="Enter target URL...">
        <button class="btn" id="btn-navigate">Navigate</button>
      </div>
      <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center;">
        <span class="label" style="font-size: 0.8rem;">Task Space:</span>
        <input type="text" id="input-taskspace" value="dsh-interactive" style="max-width: 160px; padding: 4px 8px; font-size: 0.8rem;">
      </div>
    </section>
  </div>

  <div class="grid">
    <section class="card full-width">
      <h2>Active Task Spaces</h2>
      <div id="taskspaces-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Ownership</th>
            </tr>
          </thead>
          <tbody id="taskspaces-tbody">
            <tr><td colspan="3" style="color: var(--text-muted);">No task spaces open or loading...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card full-width">
      <h2>Page Observation & Snapshot</h2>
      <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span id="nav-summary" style="font-size: 0.9rem; font-weight: 500;">No navigation performed yet.</span>
        <span id="nav-time" style="font-size: 0.8rem; color: var(--text-muted);"></span>
      </div>
      <pre id="output-snapshot">Semantic snapshot and page info will appear here after navigation.</pre>
    </section>
  </div>

  <script>
    const $ = s => document.querySelector(s);
    let currentStatus = null;

    async function loadStatus() {
      try {
        const res = await fetch('/ego-browser/api/status');
        const data = await res.json();
        currentStatus = data;

        const badge = $('#header-badge');
        if (data.installed && data.running) {
          badge.className = 'badge ready';
          badge.textContent = 'Active & Ready';
        } else if (data.installed) {
          badge.className = 'badge warning';
          badge.textContent = 'Installed (Idle)';
        } else {
          badge.className = 'badge error';
          badge.textContent = 'Not Found';
        }

        $('#status-bin').textContent = data.cliPath || '(Not found in PATH)';
        $('#status-app').textContent = data.running ? 'Running' : 'Not running';
        $('#status-active-provider').textContent = data.currentFetchProvider + (data.activeInWebSeam ? ' (Active)' : '');

        const tbody = $('#taskspaces-tbody');
        if (data.taskSpaces && data.taskSpaces.length > 0) {
          tbody.innerHTML = data.taskSpaces.map(ts =>
            '<tr><td><code>' + ts.id + '</code></td><td><strong>' + (ts.name || 'Unnamed') + '</strong></td><td>' + (ts.ownership || 'agent') + '</td></tr>'
          ).join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="3" style="color: var(--text-muted);">No task spaces active.</td></tr>';
        }

        if (data.error) {
          showAlert('Notice: ' + data.error);
        }
      } catch (err) {
        $('#header-badge').className = 'badge error';
        $('#header-badge').textContent = 'Error';
        showAlert('Could not reach status API: ' + err.message);
      }
    }

    function showAlert(msg) {
      const box = $('#alert-box');
      box.textContent = msg;
      box.style.display = 'block';
    }

    async function setProvider(providerId) {
      try {
        const res = await fetch('/ego-browser/api/select-provider', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerId }),
        });
        const data = await res.json();
        if (data.success) {
          showAlert('Active web fetch provider switched to: ' + providerId);
          await loadStatus();
        } else {
          showAlert('Error: ' + (data.error || 'Failed to switch provider'));
        }
      } catch (err) {
        showAlert('Request failed: ' + err.message);
      }
    }

    async function navigate() {
      const url = $('#input-url').value.trim();
      const taskSpace = $('#input-taskspace').value.trim() || 'dsh-interactive';
      if (!url) return;

      const btn = $('#btn-navigate');
      btn.disabled = true;
      btn.textContent = 'Navigating...';
      $('#output-snapshot').textContent = 'Connecting to ego-browser and rendering ' + url + '...';

      const startTime = performance.now();
      try {
        const res = await fetch('/ego-browser/api/navigate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, taskSpace }),
        });
        const data = await res.json();
        const duration = Math.round(performance.now() - startTime);

        if (data.success) {
          $('#nav-summary').textContent = (data.title ? data.title + ' — ' : '') + data.url;
          $('#nav-time').textContent = 'Completed in ' + duration + 'ms (Task Space #' + data.taskSpaceId + ')';
          $('#output-snapshot').textContent = data.snapshot || data.html || '(Page rendered with empty text)';
        } else {
          $('#nav-summary').textContent = 'Navigation Failed';
          $('#nav-time').textContent = 'Duration ' + duration + 'ms';
          $('#output-snapshot').textContent = 'Error: ' + (data.error || 'Unknown navigation failure');
        }
        await loadStatus();
      } catch (err) {
        $('#output-snapshot').textContent = 'Network / Execution Error: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Navigate';
      }
    }

    $('#btn-refresh').onclick = loadStatus;
    $('#btn-select-ego').onclick = () => setProvider('ego-browser');
    $('#btn-select-http').onclick = () => setProvider('http');
    $('#btn-navigate').onclick = navigate;
    $('#input-url').onkeydown = (e) => { if (e.key === 'Enter') navigate(); };

    loadStatus();
  </script>
</body>
</html>
`
