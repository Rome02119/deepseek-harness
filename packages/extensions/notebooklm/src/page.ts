/** HTML / CSS / JS frontend page for Google NotebookLM view in DSH-X. */

export const NOTEBOOKLM_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>NotebookLM · DSH-X</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --border-hover: #cbd5e1;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --primary-light: #eff6ff;
      --badge-bg: #f1f5f9;
      --badge-text: #475569;
      --badge-accent-bg: #dbeafe;
      --badge-accent-text: #1e40af;
      --input-bg: #ffffff;
      --danger: #ef4444;
      --danger-bg: #fef2f2;
      --success: #10b981;
      --success-bg: #ecfdf5;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --code-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --radius: 12px;
      --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --card-bg: #1e293b;
        --border: #334155;
        --border-hover: #475569;
        --text: #f8fafc;
        --text-muted: #94a3b8;
        --primary: #3b82f6;
        --primary-hover: #60a5fa;
        --primary-light: #1e3a8a33;
        --badge-bg: #334155;
        --badge-text: #cbd5e1;
        --badge-accent-bg: #1e3a8a;
        --badge-accent-text: #93c5fd;
        --input-bg: #0f172a;
        --danger: #f87171;
        --danger-bg: #450a0a;
        --success: #34d399;
        --success-bg: #064e3b;
        --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.3);
        --shadow-lg: 0 10px 25px -5px rgb(0 0 0 / 0.5);
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.5;
      min-height: 100vh;
      padding: 1.25rem 1rem 3rem;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
    }

    header {
      margin-bottom: 1.5rem;
    }

    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .tag-cli {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      background: var(--badge-accent-bg);
      color: var(--badge-accent-text);
      font-family: var(--code-font);
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .actions-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1.25rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid var(--border);
    }

    .search-box {
      flex: 1;
      min-width: 240px;
      position: relative;
    }

    .search-input {
      width: 100%;
      padding: 0.55rem 0.85rem;
      font-size: 0.9rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--input-bg);
      color: var(--text);
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus {
      border-color: var(--primary);
    }

    .button-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.5rem 0.85rem;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .btn:hover {
      border-color: var(--border-hover);
      background: var(--badge-bg);
    }

    .btn-primary {
      background: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
    }

    .btn-primary:hover {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }

    .btn-sm {
      padding: 0.35rem 0.65rem;
      font-size: 0.8rem;
    }

    .status-alert {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1.25rem;
      display: none;
      font-size: 0.875rem;
    }

    .status-alert.error {
      display: block;
      background: var(--danger-bg);
      color: var(--danger);
      border: 1px solid var(--danger);
    }

    .status-alert.info {
      display: block;
      background: var(--badge-accent-bg);
      color: var(--badge-accent-text);
      border: 1px solid var(--badge-accent-text);
    }

    /* Grid */
    .notebooks-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }

    @media (max-width: 480px) {
      .notebooks-grid {
        grid-template-columns: 1fr;
      }
    }

    .notebook-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.1rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 0.85rem;
      box-shadow: var(--shadow);
      transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
      cursor: pointer;
    }

    .notebook-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
      box-shadow: var(--shadow-lg);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .card-title {
      font-size: 1.05rem;
      font-weight: 600;
      line-height: 1.35;
      color: var(--text);
      word-break: break-word;
    }

    .badge-count {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      background: var(--badge-bg);
      color: var(--badge-text);
      white-space: nowrap;
    }

    .badge-count.has-sources {
      background: var(--badge-accent-bg);
      color: var(--badge-accent-text);
    }

    .card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text-muted);
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .card-actions {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.25rem;
    }

    /* Modal / Drawer */
    .drawer-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1rem;
    }

    .drawer-overlay.active {
      display: flex;
    }

    .drawer-dialog {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 100%;
      max-width: 760px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      animation: popIn 0.15s ease-out;
    }

    @keyframes popIn {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }

    .drawer-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .drawer-title {
      font-size: 1.15rem;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 1.25rem;
      cursor: pointer;
      color: var(--text-muted);
      padding: 0.25rem;
      line-height: 1;
    }

    .close-btn:hover {
      color: var(--text);
    }

    .drawer-body {
      padding: 1.25rem;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .chat-history {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-height: 160px;
    }

    .chat-bubble {
      padding: 0.85rem 1rem;
      border-radius: 10px;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .chat-bubble.user {
      align-self: flex-end;
      background: var(--primary);
      color: #ffffff;
      max-width: 85%;
      border-bottom-right-radius: 2px;
    }

    .chat-bubble.bot {
      align-self: flex-start;
      background: var(--badge-bg);
      color: var(--text);
      max-width: 95%;
      border-bottom-left-radius: 2px;
      border: 1px solid var(--border);
    }

    .citations-box {
      margin-top: 0.6rem;
      padding-top: 0.6rem;
      border-top: 1px dashed var(--border);
      font-size: 0.8rem;
    }

    .citations-title {
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 0.25rem;
    }

    .citation-item {
      padding: 0.25rem 0.5rem;
      background: var(--bg);
      border-radius: 4px;
      margin-top: 0.25rem;
      font-family: var(--code-font);
      font-size: 0.75rem;
      word-break: break-all;
    }

    .drawer-input-row {
      display: flex;
      gap: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
    }

    .drawer-input {
      flex: 1;
      padding: 0.65rem 0.85rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--input-bg);
      color: var(--text);
      outline: none;
      font-size: 0.9rem;
    }

    .drawer-input:focus {
      border-color: var(--primary);
    }

    .quick-prompts {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-bottom: 0.5rem;
    }

    .quick-chip {
      font-size: 0.75rem;
      padding: 0.25rem 0.55rem;
      border-radius: 9999px;
      background: var(--badge-bg);
      color: var(--text-muted);
      border: 1px solid var(--border);
      cursor: pointer;
      transition: all 0.15s;
    }

    .quick-chip:hover {
      background: var(--badge-accent-bg);
      color: var(--badge-accent-text);
      border-color: var(--primary);
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Modal Form elements */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin-bottom: 0.85rem;
    }

    .form-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    .form-input, .form-textarea {
      padding: 0.55rem 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--input-bg);
      color: var(--text);
      outline: none;
      font-size: 0.9rem;
      font-family: inherit;
    }

    .form-textarea {
      min-height: 90px;
      resize: vertical;
    }

    .form-input:focus, .form-textarea:focus {
      border-color: var(--primary);
    }

    .sources-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      max-height: 200px;
      overflow-y: auto;
    }

    .source-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.4rem 0.6rem;
      background: var(--badge-bg);
      border-radius: 6px;
      font-size: 0.8rem;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
    }

    .empty-state h3 {
      font-size: 1.1rem;
      color: var(--text);
      margin-bottom: 0.25rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-top">
        <div class="title-group">
          <h1>NotebookLM</h1>
          <span class="tag-cli">local nlm CLI</span>
        </div>
        <div class="button-group">
          <button class="btn btn-sm" id="btn-doctor" onclick="openDoctor()">🩺 CLI Status</button>
          <button class="btn btn-sm" id="btn-refresh" onclick="fetchNotebooks(true)">↻ Refresh</button>
          <button class="btn btn-sm btn-primary" onclick="openNewNotebookModal()">+ New Notebook</button>
        </div>
      </div>
      <p class="subtitle">Your Google NotebookLM notebooks via the local nlm CLI. Pick a notebook and chat with its sources.</p>

      <div class="actions-bar">
        <div class="search-box">
          <input type="text" id="search-input" class="search-input" placeholder="Search notebooks by title..." oninput="filterNotebooks()">
        </div>
        <div id="stats-label" style="font-size: 0.85rem; color: var(--text-muted);">Loading notebooks...</div>
      </div>
    </header>

    <div id="status-banner" class="status-alert"></div>

    <main>
      <div id="notebooks-grid" class="notebooks-grid">
        <div class="empty-state">
          <span class="spinner" style="width:24px;height:24px;margin-bottom:0.5rem"></span>
          <p>Connecting to local nlm CLI...</p>
        </div>
      </div>
    </main>
  </div>

  <!-- Chat / Query Drawer -->
  <div id="chat-drawer" class="drawer-overlay">
    <div class="drawer-dialog">
      <div class="drawer-header">
        <div>
          <div class="drawer-title" id="chat-title">Notebook Chat</div>
          <div style="font-size:0.75rem; color:var(--text-muted)" id="chat-subtitle">Notebook ID</div>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <button class="btn btn-sm" onclick="openAddSourceModalCurrent()">+ Add Source</button>
          <button class="close-btn" onclick="closeChatDrawer()">✕</button>
        </div>
      </div>
      <div class="drawer-body">
        <div class="quick-prompts">
          <span class="quick-chip" onclick="askQuick('What is this notebook about?')">💡 Summarize</span>
          <span class="quick-chip" onclick="askQuick('What are the key points and main takeaways?')">📋 Key Points</span>
          <span class="quick-chip" onclick="askQuick('List the primary sources and their core arguments.')">📚 Sources</span>
        </div>
        <div id="chat-history" class="chat-history">
          <div class="chat-bubble bot">
            Ask any question about this notebook's sources. NotebookLM will answer with citations grounded in your uploaded documents.
          </div>
        </div>
        <form class="drawer-input-row" onsubmit="handleChatSubmit(event)">
          <input type="text" id="chat-input" class="drawer-input" placeholder="Ask a question about this notebook..." autocomplete="off">
          <button type="submit" id="chat-send-btn" class="btn btn-primary">Ask</button>
        </form>
      </div>
    </div>
  </div>

  <!-- New Notebook Modal -->
  <div id="new-notebook-modal" class="drawer-overlay">
    <div class="drawer-dialog" style="max-width:440px">
      <div class="drawer-header">
        <div class="drawer-title">Create Notebook</div>
        <button class="close-btn" onclick="closeNewNotebookModal()">✕</button>
      </div>
      <div class="drawer-body">
        <form onsubmit="handleCreateNotebook(event)">
          <div class="form-group">
            <label class="form-label" for="new-title">Notebook Title</label>
            <input type="text" id="new-title" class="form-input" placeholder="e.g. Research & Development" required>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
            <button type="button" class="btn" onclick="closeNewNotebookModal()">Cancel</button>
            <button type="submit" id="create-nb-btn" class="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- Add Source Modal -->
  <div id="add-source-modal" class="drawer-overlay">
    <div class="drawer-dialog" style="max-width:500px">
      <div class="drawer-header">
        <div class="drawer-title">Add Source to Notebook</div>
        <button class="close-btn" onclick="closeAddSourceModal()">✕</button>
      </div>
      <div class="drawer-body">
        <form onsubmit="handleAddSource(event)">
          <input type="hidden" id="source-nb-id">
          <div class="form-group">
            <label class="form-label">Source Type</label>
            <div style="display:flex; gap:0.5rem;">
              <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.875rem;">
                <input type="radio" name="source-type" value="text" checked onchange="toggleSourceType()"> Text / Note
              </label>
              <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.875rem;">
                <input type="radio" name="source-type" value="url" onchange="toggleSourceType()"> Web URL
              </label>
            </div>
          </div>
          <div class="form-group" id="group-source-title">
            <label class="form-label" for="source-title">Source Title (optional)</label>
            <input type="text" id="source-title" class="form-input" placeholder="e.g. Project Notes">
          </div>
          <div class="form-group" id="group-source-text">
            <label class="form-label" for="source-content">Content / Text</label>
            <textarea id="source-content" class="form-textarea" placeholder="Paste source text or research notes..."></textarea>
          </div>
          <div class="form-group" id="group-source-url" style="display:none">
            <label class="form-label" for="source-url">URL</label>
            <input type="url" id="source-url" class="form-input" placeholder="https://example.com/article">
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
            <button type="button" class="btn" onclick="closeAddSourceModal()">Cancel</button>
            <button type="submit" id="add-src-btn" class="btn btn-primary">Add Source</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- Doctor / Status Modal -->
  <div id="doctor-modal" class="drawer-overlay">
    <div class="drawer-dialog" style="max-width:540px">
      <div class="drawer-header">
        <div class="drawer-title">NLM CLI Status</div>
        <button class="close-btn" onclick="closeDoctorModal()">✕</button>
      </div>
      <div class="drawer-body">
        <div id="doctor-content" style="font-family:var(--code-font); font-size:0.8rem; background:var(--bg); padding:0.85rem; border-radius:6px; white-space:pre-wrap; overflow-x:auto;">
          Checking nlm doctor...
        </div>
      </div>
    </div>
  </div>

  <script>
    let allNotebooks = [];
    let activeNotebook = null;
    let activeConversationId = null;

    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function formatDate(dateStr) {
      if (!dateStr) return 'unknown';
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch {
        return dateStr;
      }
    }

    async function fetchNotebooks(force = false) {
      const banner = document.getElementById('status-banner');
      const stats = document.getElementById('stats-label');
      stats.textContent = 'Refreshing notebooks...';

      try {
        const res = await fetch('/notebooklm/api/notebooks' + (force ? '?refresh=1' : ''));
        const data = await res.json();

        if (data.error) {
          banner.className = 'status-alert error';
          banner.textContent = data.error;
        } else {
          banner.className = 'status-alert';
          banner.textContent = '';
        }

        allNotebooks = data.notebooks || [];
        stats.textContent = allNotebooks.length + ' notebooks · ' + (data.cached ? 'cached' : 'live');
        renderGrid(allNotebooks);
      } catch (err) {
        banner.className = 'status-alert error';
        banner.textContent = 'Could not load NotebookLM notebooks: ' + err.message;
        stats.textContent = 'Error loading';
      }
    }

    function renderGrid(notebooks) {
      const grid = document.getElementById('notebooks-grid');
      if (!notebooks || notebooks.length === 0) {
        grid.innerHTML = '<div class="empty-state"><h3>No Notebooks Found</h3><p>Create a notebook to get started.</p></div>';
        return;
      }

      grid.innerHTML = notebooks.map(nb => {
        const title = esc(nb.title || 'Untitled notebook');
        const count = nb.source_count || 0;
        const sourceLabel = count === 1 ? '1 source' : count + ' sources';
        const hasSources = count > 0;
        const updated = formatDate(nb.updated_at);

        return \`
          <article class="notebook-card" onclick="openChat('\${esc(nb.id)}')">
            <div class="card-header">
              <h2 class="card-title">\${title}</h2>
              <span class="badge-count \${hasSources ? 'has-sources' : ''}">\${sourceLabel}</span>
            </div>
            <div class="card-meta">
              <span>Updated \${updated}</span>
              <span style="font-family:var(--code-font); font-size:0.7rem; opacity:0.6;">\${esc(nb.id.slice(0, 8))}...</span>
            </div>
            <div class="card-actions" onclick="event.stopPropagation()">
              <button class="btn btn-sm btn-primary" onclick="openChat('\${esc(nb.id)}')">💬 Chat</button>
              <button class="btn btn-sm" onclick="openAddSourceModal('\${esc(nb.id)}')">+ Source</button>
            </div>
          </article>
        \`;
      }).join('');
    }

    function filterNotebooks() {
      const q = document.getElementById('search-input').value.toLowerCase().trim();
      const filtered = allNotebooks.filter(nb => (nb.title || '').toLowerCase().includes(q));
      renderGrid(filtered);
      document.getElementById('stats-label').textContent = filtered.length + ' of ' + allNotebooks.length + ' notebooks';
    }

    function openChat(notebookId) {
      const nb = allNotebooks.find(n => n.id === notebookId);
      if (!nb) return;
      activeNotebook = nb;
      activeConversationId = null;

      document.getElementById('chat-title').textContent = nb.title || 'Untitled notebook';
      document.getElementById('chat-subtitle').textContent = (nb.source_count || 0) + ' sources · ID: ' + nb.id;
      document.getElementById('chat-history').innerHTML = \`
        <div class="chat-bubble bot">
          Ready to answer questions about <strong>\${esc(nb.title || 'this notebook')}</strong> (\${nb.source_count || 0} sources). Ask a question below:
        </div>
      \`;
      document.getElementById('chat-drawer').classList.add('active');
      document.getElementById('chat-input').focus();
    }

    function closeChatDrawer() {
      document.getElementById('chat-drawer').classList.remove('active');
      activeNotebook = null;
    }

    function askQuick(prompt) {
      document.getElementById('chat-input').value = prompt;
      handleChatSubmit(new Event('submit'));
    }

    async function handleChatSubmit(e) {
      if (e) e.preventDefault();
      const input = document.getElementById('chat-input');
      const question = input.value.trim();
      if (!question || !activeNotebook) return;

      input.value = '';
      const history = document.getElementById('chat-history');

      // Append User message
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-bubble user';
      userBubble.textContent = question;
      history.appendChild(userBubble);

      // Append Loading Bot message
      const botBubble = document.createElement('div');
      botBubble.className = 'chat-bubble bot';
      botBubble.innerHTML = '<span class="spinner"></span> Thinking with notebook sources...';
      history.appendChild(botBubble);
      history.scrollTop = history.scrollHeight;

      const sendBtn = document.getElementById('chat-send-btn');
      sendBtn.disabled = true;

      try {
        const res = await fetch('/notebooklm/api/query', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            notebookId: activeNotebook.id,
            question: question,
            conversationId: activeConversationId,
          }),
        });
        const data = await res.json();
        if (data.error) {
          botBubble.innerHTML = '<span style="color:var(--danger)">Error: ' + esc(data.error) + '</span>';
        } else {
          activeConversationId = data.conversation_id || activeConversationId;
          let html = esc(data.answer).replace(/\\n/g, '<br>');

          if (data.references && data.references.length > 0) {
            html += '<div class="citations-box"><div class="citations-title">Sources & Citations:</div>';
            for (const ref of data.references) {
              html += '<div class="citation-item">[' + esc(ref.citation_number) + '] ' + esc(ref.cited_text) + '</div>';
            }
            html += '</div>';
          }
          botBubble.innerHTML = html;
        }
      } catch (err) {
        botBubble.innerHTML = '<span style="color:var(--danger)">Network error: ' + esc(err.message) + '</span>';
      } finally {
        sendBtn.disabled = false;
        history.scrollTop = history.scrollHeight;
      }
    }

    function openNewNotebookModal() {
      document.getElementById('new-title').value = '';
      document.getElementById('new-notebook-modal').classList.add('active');
    }

    function closeNewNotebookModal() {
      document.getElementById('new-notebook-modal').classList.remove('active');
    }

    async function handleCreateNotebook(e) {
      e.preventDefault();
      const title = document.getElementById('new-title').value.trim();
      if (!title) return;

      const btn = document.getElementById('create-nb-btn');
      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        const res = await fetch('/notebooklm/api/notebooks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        const data = await res.json();
        if (data.error) {
          alert('Error creating notebook: ' + data.error);
        } else {
          closeNewNotebookModal();
          await fetchNotebooks(true);
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create';
      }
    }

    function openAddSourceModalCurrent() {
      if (activeNotebook) openAddSourceModal(activeNotebook.id);
    }

    function openAddSourceModal(notebookId) {
      document.getElementById('source-nb-id').value = notebookId;
      document.getElementById('source-title').value = '';
      document.getElementById('source-content').value = '';
      document.getElementById('source-url').value = '';
      document.getElementById('add-source-modal').classList.add('active');
    }

    function closeAddSourceModal() {
      document.getElementById('add-source-modal').classList.remove('active');
    }

    function toggleSourceType() {
      const type = document.querySelector('input[name="source-type"]:checked').value;
      document.getElementById('group-source-text').style.display = type === 'text' ? 'flex' : 'none';
      document.getElementById('group-source-title').style.display = type === 'text' ? 'flex' : 'none';
      document.getElementById('group-source-url').style.display = type === 'url' ? 'flex' : 'none';
    }

    async function handleAddSource(e) {
      e.preventDefault();
      const nbId = document.getElementById('source-nb-id').value;
      const type = document.querySelector('input[name="source-type"]:checked').value;
      const title = document.getElementById('source-title').value.trim();
      const content = type === 'text'
        ? document.getElementById('source-content').value.trim()
        : document.getElementById('source-url').value.trim();

      if (!content) {
        alert('Please enter ' + (type === 'text' ? 'content' : 'a URL'));
        return;
      }

      const btn = document.getElementById('add-src-btn');
      btn.disabled = true;
      btn.textContent = 'Adding...';

      try {
        const res = await fetch('/notebooklm/api/sources', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            notebookId: nbId,
            type,
            content,
            title: title || undefined,
          }),
        });
        const data = await res.json();
        if (data.error) {
          alert('Error adding source: ' + data.error);
        } else {
          closeAddSourceModal();
          await fetchNotebooks(true);
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add Source';
      }
    }

    async function openDoctor() {
      document.getElementById('doctor-modal').classList.add('active');
      const content = document.getElementById('doctor-content');
      content.textContent = 'Checking nlm status...';

      try {
        const res = await fetch('/notebooklm/api/doctor');
        const data = await res.json();
        content.textContent = data.rawOutput || (data.installed ? 'Installed (' + data.version + ')' : 'CLI not found: ' + data.error);
      } catch (err) {
        content.textContent = 'Could not fetch status: ' + err.message;
      }
    }

    function closeDoctorModal() {
      document.getElementById('doctor-modal').classList.remove('active');
    }

    // Initial load
    fetchNotebooks()
  </script>
</body>
</html>`
