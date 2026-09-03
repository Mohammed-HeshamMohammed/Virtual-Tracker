export function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Virtual Tracker · Operations Monitor</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:       #111217;
      --bg2:      #181b1f;
      --panel:    #1f2128;
      --panel2:   #22252c;
      --border:   #2c3038;
      --border2:  #383c44;
      --text:     #d0d3d8;
      --text2:    #9fa6b0;
      --text3:    #6e7582;
      --accent:   #5794f2;
      --green:    #73bf69;
      --yellow:   #fade2a;
      --orange:   #ff780a;
      --red:      #f2495c;
      --purple:   #b877d9;
      --cyan:     #37872d;
      --font:     'Inter', system-ui, sans-serif;
      --mono:     'JetBrains Mono', 'Fira Code', monospace;
    }
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; overflow: hidden; }

    /* ── TOPBAR ── */
    .topbar {
      height: 40px; background: #161719; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 12px; gap: 8px; flex-shrink: 0; z-index: 100;
    }
    .topbar-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .topbar-logo { display: flex; align-items: center; gap: 6px; color: var(--accent); font-weight: 700; font-size: 14px; white-space: nowrap; }
    .topbar-logo svg { width: 20px; height: 20px; }
    .breadcrumb { display: flex; align-items: center; gap: 4px; color: var(--text2); font-size: 13px; }
    .breadcrumb a { color: var(--accent); text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .breadcrumb-sep { color: var(--text3); }
    .topbar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .tb-btn {
      display: flex; align-items: center; gap: 5px; padding: 3px 10px;
      background: var(--panel2); border: 1px solid var(--border2); border-radius: 3px;
      color: var(--text); font-size: 12px; cursor: pointer; white-space: nowrap;
      text-decoration: none; font-family: var(--font); transition: background .15s;
    }
    .tb-btn:hover { background: var(--border); }
    .tb-btn svg { width: 13px; height: 13px; }
    .tb-btn.danger { color: #f2495c; border-color: rgba(242,73,92,.3); }
    .tb-btn.danger:hover { background: rgba(242,73,92,.1); }
    .live-badge {
      display: flex; align-items: center; gap: 5px; padding: 3px 10px;
      background: rgba(115,191,105,.12); border: 1px solid rgba(115,191,105,.3);
      border-radius: 3px; color: var(--green); font-size: 12px;
    }
    .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    .time-range {
      display: flex; align-items: center; gap: 4px; padding: 3px 10px;
      background: var(--panel2); border: 1px solid var(--border2); border-radius: 3px;
      color: var(--text); font-size: 12px; cursor: pointer;
    }
    .time-range svg { width: 12px; height: 12px; color: var(--text2); }

    /* ── FILTER BAR ── */
    .filterbar {
      height: 36px; background: var(--bg2); border-bottom: 1px solid var(--border);
      display: flex; align-items: center; padding: 0 12px; gap: 8px; flex-shrink: 0; overflow-x: auto;
    }
    .filter-chip {
      display: flex; align-items: center; gap: 5px; padding: 3px 8px;
      background: var(--panel); border: 1px solid var(--border2); border-radius: 3px;
      font-size: 11px; white-space: nowrap; color: var(--text2); cursor: default;
    }
    .filter-chip strong { color: var(--text); }
    .filter-chip select {
      background: none; border: none; color: var(--accent); font-size: 11px;
      font-family: var(--font); cursor: pointer; outline: none;
    }
    .filter-sep { width: 1px; height: 20px; background: var(--border); flex-shrink: 0; }
    .filter-link {
      display: flex; align-items: center; gap: 4px; padding: 3px 8px;
      border: 1px solid var(--border2); border-radius: 3px; font-size: 11px;
      color: var(--text2); text-decoration: none; white-space: nowrap;
    }
    .filter-link svg { width: 11px; height: 11px; }

    /* ── MAIN SCROLL ── */
    .main { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 8px 24px; display: flex; flex-direction: column; gap: 0; }
    body { display: flex; flex-direction: column; height: 100vh; }

    /* ── SECTION COLLAPSE ── */
    .section-header {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 8px; margin: 4px 0 2px;
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: 3px; cursor: pointer; user-select: none;
    }
    .section-header:hover { background: var(--panel); }
    .section-header svg { width: 12px; height: 12px; color: var(--text3); transition: transform .2s; }
    .section-header.open svg { transform: rotate(90deg); }
    .section-header span { font-size: 12px; font-weight: 600; color: var(--text); }
    .section-header .section-count { font-size: 11px; color: var(--text3); margin-left: 4px; }
    .section-body { display: none; }
    .section-body.open { display: block; }

    /* ── PANEL GRID ── */
    .panel-row { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
    .panel-row.no-wrap { flex-wrap: nowrap; }
    .panel-full { flex: 1 1 100%; }
    .panel-half { flex: 1 1 calc(50% - 3px); min-width: 280px; }
    .panel-third { flex: 1 1 calc(33.33% - 4px); min-width: 160px; }
    .panel-quarter { flex: 1 1 calc(25% - 5px); min-width: 140px; }
    .panel-auto { flex: 1 1 auto; min-width: 100px; }

    /* ── PANEL BASE ── */
    .panel {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 3px; overflow: hidden; position: relative;
    }
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 10px 4px; border-bottom: 1px solid var(--border); min-height: 30px;
    }
    .panel-title { font-size: 12px; font-weight: 500; color: var(--text2); display: flex; align-items: center; gap: 6px; }
    .panel-title svg { width: 13px; height: 13px; color: var(--text3); }
    .panel-body { padding: 0; }

    /* ── GAUGE PANEL ── */
    .gauge-panel { display: flex; flex-direction: column; align-items: center; padding: 8px 4px 4px; min-height: 100px; }
    canvas.gauge-canvas { display: block; }
    .gauge-label { font-size: 11px; color: var(--text3); text-align: center; margin-top: 2px; }

    /* ── STAT PANEL ── */
    .stat-panel { padding: 10px 12px; min-height: 70px; display: flex; flex-direction: column; justify-content: center; }
    .stat-value { font-size: 26px; font-weight: 700; line-height: 1.1; font-family: var(--mono); }
    .stat-label2 { font-size: 11px; color: var(--text3); margin-top: 3px; }
    .stat-value.green { color: var(--green); }
    .stat-value.blue  { color: var(--accent); }
    .stat-value.orange{ color: var(--orange); }
    .stat-value.red   { color: var(--red); }
    .stat-value.text  { color: var(--text); font-size: 18px; }

    /* ── PRESSURE PANEL ── */
    .pressure-panel { padding: 8px 10px; min-height: 80px; }
    .pressure-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
    .pressure-name { font-size: 11px; color: var(--text3); width: 26px; flex-shrink: 0; }
    .pressure-bar-bg { flex: 1; height: 5px; background: var(--border); border-radius: 2px; overflow: hidden; }
    .pressure-bar-fill { height: 100%; border-radius: 2px; transition: width .5s; }
    .pressure-val { font-size: 10px; color: var(--text2); width: 34px; text-align: right; font-family: var(--mono); }

    /* ── TIME-SERIES PANEL ── */
    .ts-panel { padding: 6px; }
    canvas.ts-canvas { display: block; width: 100%; }
    .ts-legend { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 6px; border-top: 1px solid var(--border); }
    .ts-legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text3); cursor: pointer; }
    .ts-legend-dot { width: 8px; height: 2px; border-radius: 1px; flex-shrink: 0; }

    /* ── IDLE OVERLAY ── */
    #idle-warning {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,.75); backdrop-filter: blur(4px);
      z-index: 9999; align-items: center; justify-content: center;
    }
    #idle-warning.visible { display: flex; }
    .idle-card {
      background: var(--panel); border: 1px solid rgba(242,73,92,.5); border-radius: 6px;
      padding: 32px 40px; text-align: center; max-width: 360px;
    }
    .idle-card h2 { font-size: 18px; margin-bottom: 8px; }
    .idle-card p  { color: var(--text2); font-size: 13px; margin-bottom: 20px; }
    .idle-card button {
      padding: 8px 24px; background: var(--accent); color: #fff; border: none;
      border-radius: 3px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: var(--font);
    }

    /* ── SCROLLBAR ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

    /* ── EMPTY ── */
    .empty { text-align: center; color: var(--text3); font-size: 12px; padding: 20px 8px; }

    /* ── REQUEST TABLE ── */
    .vtable { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .vtable th { padding: 6px 10px; text-align: left; font-size: 10.5px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: .05em; background: var(--panel2); border-bottom: 1px solid var(--border); white-space: nowrap; }
    .vtable td { padding: 5px 10px; border-bottom: 1px solid rgba(44,48,56,.5); vertical-align: middle; }
    .vtable tr:last-child td { border-bottom: none; }
    .vtable tr:hover td { background: var(--panel2); }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 2px; font-size: 10.5px; font-weight: 600; font-family: var(--mono); }
    .bg { background: rgba(115,191,105,.15); color: var(--green); }
    .by { background: rgba(250,222,42,.12); color: var(--yellow); }
    .br { background: rgba(242,73,92,.15); color: var(--red); }
    .bb { background: rgba(87,148,242,.15); color: var(--accent); }
    .bx { background: rgba(158,166,176,.1);  color: var(--text3); }
  </style>
</head>
<body>
  <!-- IDLE OVERLAY -->
  <div id="idle-warning">
    <div class="idle-card">
      <h2>⏱ Session Idle</h2>
      <p>You've been idle for 14 minutes. Your session will expire in 1 minute.</p>
      <button onclick="resetIdle()">Stay Signed In</button>
    </div>
  </div>

  <!-- TOPBAR -->
  <div class="topbar">
    <div class="topbar-left">
      <div class="topbar-logo">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        Dashboards
      </div>
      <div class="breadcrumb">
        <span class="breadcrumb-sep">›</span>
        <span>Virtual Tracker Backend</span>
      </div>
    </div>
    <div class="topbar-right">
      <div class="live-badge"><div class="live-dot"></div> Live</div>
      <div class="time-range">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Last 2 minutes
      </div>
      <span style="color:var(--text3);font-size:11px">Refresh <span style="color:var(--text)">3s</span></span>
      <div id="spin-wrap" style="color:var(--text3);font-size:11px">
        <span id="last-refresh">–</span>
      </div>
      <a class="tb-btn danger" href="/monitor/logout" title="Sign out">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        Sign Out
      </a>
    </div>
  </div>

  <!-- FILTER BAR -->
  <div class="filterbar">
    <div class="filter-chip">Backend: <strong style="margin-left:4px;color:var(--accent)">Node.js</strong></div>
    <div class="filter-chip">Port: <strong style="margin-left:4px;color:var(--accent)" id="fb-port">5712</strong></div>
    <div class="filter-chip">Uptime: <strong style="margin-left:4px;color:var(--green)" id="fb-uptime">–</strong></div>
    <div class="filter-sep"></div>
    <div class="filter-chip">P50: <strong style="margin-left:4px" id="fb-p50">–</strong></div>
    <div class="filter-chip">P95: <strong style="margin-left:4px" id="fb-p95">–</strong></div>
    <div class="filter-chip">P99: <strong style="margin-left:4px" id="fb-p99">–</strong></div>
    <div class="filter-sep"></div>
    <div class="filter-chip">Sessions: <strong style="margin-left:4px;color:var(--accent)" id="fb-sessions">–</strong></div>
  </div>

  <!-- MAIN -->
  <div class="main">

    <!-- ── SECTION: Quick Stats ── -->
    <div class="section-header open" onclick="toggleSection(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span>Quick Stats</span>
    </div>
    <div class="section-body open">
      <div class="panel-row">
        <!-- Pressure mini bars -->
        <div class="panel panel-auto" style="min-width:130px;max-width:160px">
          <div class="panel-header"><div class="panel-title">Pressure</div></div>
          <div class="pressure-panel">
            <div class="pressure-row">
              <div class="pressure-name">RPS</div>
              <div class="pressure-bar-bg"><div class="pressure-bar-fill" id="pbar-rps" style="width:0%;background:var(--accent)"></div></div>
              <div class="pressure-val" id="pval-rps">0</div>
            </div>
            <div class="pressure-row">
              <div class="pressure-name">Err%</div>
              <div class="pressure-bar-bg"><div class="pressure-bar-fill" id="pbar-err" style="width:0%;background:var(--red)"></div></div>
              <div class="pressure-val" id="pval-err">0%</div>
            </div>
            <div class="pressure-row">
              <div class="pressure-name">Heap</div>
              <div class="pressure-bar-bg"><div class="pressure-bar-fill" id="pbar-heap" style="width:0%;background:var(--green)"></div></div>
              <div class="pressure-val" id="pval-heap">0%</div>
            </div>
          </div>
        </div>

        <!-- Gauge: P95 Latency -->
        <div class="panel panel-auto" style="min-width:130px;max-width:170px">
          <div class="panel-header"><div class="panel-title">P95 Latency</div></div>
          <div class="gauge-panel">
            <canvas class="gauge-canvas" id="gauge-p95" width="120" height="72"></canvas>
            <div class="gauge-label" id="glabel-p95">– ms</div>
          </div>
        </div>

        <!-- Gauge: Heap Used -->
        <div class="panel panel-auto" style="min-width:130px;max-width:170px">
          <div class="panel-header"><div class="panel-title">Heap Used</div></div>
          <div class="gauge-panel">
            <canvas class="gauge-canvas" id="gauge-heap" width="120" height="72"></canvas>
            <div class="gauge-label" id="glabel-heap">– MB / – MB</div>
          </div>
        </div>

        <!-- Gauge: Error Rate -->
        <div class="panel panel-auto" style="min-width:130px;max-width:170px">
          <div class="panel-header"><div class="panel-title">Error Rate</div></div>
          <div class="gauge-panel">
            <canvas class="gauge-canvas" id="gauge-err" width="120" height="72"></canvas>
            <div class="gauge-label" id="glabel-err">0.0%</div>
          </div>
        </div>

        <!-- Gauge: Auth Failures -->
        <div class="panel panel-auto" style="min-width:130px;max-width:170px">
          <div class="panel-header"><div class="panel-title">Auth Fails</div></div>
          <div class="gauge-panel">
            <canvas class="gauge-canvas" id="gauge-auth" width="120" height="72"></canvas>
            <div class="gauge-label" id="glabel-auth">0 fails</div>
          </div>
        </div>

        <!-- Stat: Total Requests -->
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">Total Req</div></div>
          <div class="stat-panel">
            <div class="stat-value blue" id="s-total">–</div>
            <div class="stat-label2">all-time this session</div>
          </div>
        </div>

        <!-- Stat: RSS -->
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">RSS</div></div>
          <div class="stat-panel">
            <div class="stat-value green" id="s-rss">–</div>
            <div class="stat-label2">resident set size</div>
          </div>
        </div>

        <!-- Stat: Active Sessions -->
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">Admin Sessions</div></div>
          <div class="stat-panel">
            <div class="stat-value text" id="s-sessions">–</div>
            <div class="stat-label2">monitor logins</div>
          </div>
        </div>

        <!-- Stat: Uptime -->
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">Uptime</div></div>
          <div class="stat-panel">
            <div class="stat-value text" id="s-uptime">–</div>
            <div class="stat-label2">since last restart</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION: Traffic / Net / Latency ── -->
    <div class="section-header open" onclick="toggleSection(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span>Traffic / Latency / Memory</span>
    </div>
    <div class="section-body open">
      <div class="panel-row">
        <div class="panel panel-half">
          <div class="panel-header">
            <div class="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Requests / Second
            </div>
          </div>
          <div class="ts-panel">
            <canvas class="ts-canvas" id="ts-rps" height="110"></canvas>
          </div>
          <div class="ts-legend">
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--accent)"></div>req/s</div>
          </div>
        </div>
        <div class="panel panel-half">
          <div class="panel-header">
            <div class="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Response Latency (ms)
            </div>
          </div>
          <div class="ts-panel">
            <canvas class="ts-canvas" id="ts-lat" height="110"></canvas>
          </div>
          <div class="ts-legend">
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--green)"></div>p50</div>
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--yellow)"></div>p95</div>
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--red)"></div>p99</div>
          </div>
        </div>
      </div>
      <div class="panel-row">
        <div class="panel panel-half">
          <div class="panel-header">
            <div class="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Error Rate (%)
            </div>
          </div>
          <div class="ts-panel">
            <canvas class="ts-canvas" id="ts-err" height="110"></canvas>
          </div>
          <div class="ts-legend">
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--red)"></div>5xx error %</div>
          </div>
        </div>
        <div class="panel panel-half">
          <div class="panel-header">
            <div class="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/></svg>
              Memory (MB)
            </div>
          </div>
          <div class="ts-panel">
            <canvas class="ts-canvas" id="ts-mem" height="110"></canvas>
          </div>
          <div class="ts-legend">
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--yellow)"></div>RSS</div>
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--green)"></div>Heap Used</div>
            <div class="ts-legend-item"><div class="ts-legend-dot" style="background:var(--accent)"></div>Heap Total</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION: Request Log ── -->
    <div class="section-header open" onclick="toggleSection(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span>Request Log</span>
      <span class="section-count" id="req-count">(0)</span>
    </div>
    <div class="section-body open">
      <div class="panel panel-full">
        <div class="panel-body" style="overflow-x:auto;max-height:220px;overflow-y:auto">
          <table class="vtable">
            <thead><tr><th>Time</th><th>Method</th><th>Endpoint</th><th>Status</th><th>Latency</th><th>IP</th><th>User-Agent</th></tr></thead>
            <tbody id="req-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── SECTION: Security ── -->
    <div class="section-header open" onclick="toggleSection(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span>Security Events</span>
      <span class="section-count" id="sec-count">(0)</span>
    </div>
    <div class="section-body open">
      <div class="panel-row">
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">Auth Failures</div></div>
          <div class="stat-panel"><div class="stat-value red" id="ss-authfail">–</div><div class="stat-label2">401 / 403 total</div></div>
        </div>
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">Auth OK</div></div>
          <div class="stat-panel"><div class="stat-value green" id="ss-authok">–</div><div class="stat-label2">verified tokens</div></div>
        </div>
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">4xx Errors</div></div>
          <div class="stat-panel"><div class="stat-value orange" id="ss-4xx">–</div><div class="stat-label2">client errors</div></div>
        </div>
        <div class="panel panel-auto" style="min-width:100px">
          <div class="panel-header"><div class="panel-title">5xx Errors</div></div>
          <div class="stat-panel"><div class="stat-value red" id="ss-5xx">–</div><div class="stat-label2">server errors</div></div>
        </div>
      </div>
      <div class="panel panel-full">
        <div class="panel-body" style="overflow-x:auto;max-height:180px;overflow-y:auto">
          <table class="vtable">
            <thead><tr><th>Time</th><th>Event</th><th>IP</th><th>Detail</th></tr></thead>
            <tbody id="sec-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>

  </div><!-- /main -->

<script>
// ── SECTION TOGGLE ────────────────────────────────────────────────────────────
function toggleSection(hdr) {
  hdr.classList.toggle('open');
  hdr.nextElementSibling.classList.toggle('open');
}

// ── IDLE ─────────────────────────────────────────────────────────────────────
const IDLE_WARN = 14 * 60 * 1000, IDLE_KILL = 15 * 60 * 1000;
let lastActivity = Date.now(), idleWarnShown = false;
function resetIdle() {
  lastActivity = Date.now(); idleWarnShown = false;
  document.getElementById('idle-warning').classList.remove('visible');
  fetch('/monitor/api/ping').catch(()=>{});
}
['mousemove','keydown','click','scroll'].forEach(e => document.addEventListener(e, resetIdle, { passive: true }));
setInterval(() => {
  const idle = Date.now() - lastActivity;
  if (idle >= IDLE_KILL) { window.location.href = '/monitor/logout?reason=idle'; return; }
  if (idle >= IDLE_WARN && !idleWarnShown) { idleWarnShown = true; document.getElementById('idle-warning').classList.add('visible'); }
}, 10000);

// ── GAUGE ─────────────────────────────────────────────────────────────────────
function drawGauge(id, pct, color) {
  const c = document.getElementById(id); if (!c) return;
  const ctx = c.getContext('2d'), W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H - 8, r = Math.min(W, H * 2 - 16) / 2 - 8;
  const start = Math.PI, end = 2 * Math.PI;
  // Track
  ctx.beginPath(); ctx.arc(cx, cy, r, start, end);
  ctx.strokeStyle = '#2c3038'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke();
  // Fill
  if (pct > 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + pct * Math.PI);
    ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke();
  }
  // Value text
  const displayPct = Math.round(pct * 100);
  ctx.fillStyle = color; ctx.font = 'bold 17px Inter, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(displayPct + '%', cx, cy + 2);
}

// ── TIME-SERIES CHART ─────────────────────────────────────────────────────────
const GRID_COLOR = 'rgba(44,48,56,0.8)';
const LABEL_COLOR = '#6e7582';
function drawTS(id, datasets, maxOverride) {
  const c = document.getElementById(id); if (!c) return;
  const W = c.offsetWidth || c.parentElement.offsetWidth || 400;
  const H = c.height; c.width = W;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const PAD = { t: 8, r: 8, b: 22, l: 38 };
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;

  // Find max across all datasets
  let maxVal = maxOverride ?? 0;
  datasets.forEach(d => d.data.forEach(v => { if (v > maxVal) maxVal = v; }));
  if (maxVal === 0) maxVal = 1;

  // Grid lines
  const gridN = 4;
  ctx.strokeStyle = GRID_COLOR; ctx.lineWidth = 1;
  for (let i = 0; i <= gridN; i++) {
    const y = PAD.t + ph - (i / gridN) * ph;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
    ctx.fillStyle = LABEL_COLOR; ctx.font = '9px Inter,system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const label = ((maxVal * i / gridN)).toFixed(maxVal < 10 ? 1 : 0);
    ctx.fillText(label, PAD.l - 3, y);
  }

  // Draw datasets
  datasets.forEach(({ data, color }) => {
    if (!data || data.length < 2) return;
    const step = pw / (data.length - 1);
    // Area fill
    const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ph);
    grad.addColorStop(0, color + '30'); grad.addColorStop(1, color + '00');
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t + ph);
    data.forEach((v, i) => ctx.lineTo(PAD.l + i * step, PAD.t + ph - (v / maxVal) * ph));
    ctx.lineTo(PAD.l + (data.length - 1) * step, PAD.t + ph);
    ctx.fillStyle = grad; ctx.fill();
    // Line
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = PAD.l + i * step, y = PAD.t + ph - (v / maxVal) * ph;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
  });

  // X axis labels (just start and end)
  if (datasets[0]?.data?.length > 1) {
    ctx.fillStyle = LABEL_COLOR; ctx.font = '9px Inter,system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('2m ago', PAD.l, PAD.t + ph + 5);
    ctx.fillText('now', PAD.l + pw, PAD.t + ph + 5);
  }
}

// ── STATE ─────────────────────────────────────────────────────────────────────
const HISTORY = 80; // data points stored per series
const hist = { rps: [], p50: [], p95: [], p99: [], err: [], rss: [], heap: [], heapTotal: [] };
function push(arr, val) { arr.push(val); if (arr.length > HISTORY) arr.shift(); }

// ── HELPERS ───────────────────────────────────────────────────────────────────
const fmtMs = v => v == null ? '–' : v.toFixed(0) + 'ms';
const fmtMb = v => v == null ? '–' : (v / 1048576).toFixed(1) + ' MB';
const fmtUptime = s => {
  if (s == null) return '–';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? h + 'h ' + m + 'm' : m > 0 ? m + 'm ' + sec + 's' : sec + 's';
};
const fmtTime = ts => ts ? new Date(ts).toTimeString().slice(0, 8) : '–';
const methBadge = m => {
  const map = { GET:'bb', POST:'bg', PUT:'by', PATCH:'by', DELETE:'br' };
  return '<span class="badge ' + (map[m]||'bx') + '">' + m + '</span>';
};
const statusBadge = s => '<span class="badge ' + (s < 300 ? 'bg' : s < 400 ? 'bb' : s < 500 ? 'by' : 'br') + '">' + s + '</span>';
const secBadge = e => '<span class="badge ' + (e.includes('fail')||e.includes('lock') ? 'br' : e.includes('ok') ? 'bg' : 'bx') + '">' + e + '</span>';
function gaugeColor(pct) {
  if (pct < 0.5) return '#73bf69';
  if (pct < 0.8) return '#fade2a';
  return '#f2495c';
}

// ── RENDER ────────────────────────────────────────────────────────────────────
async function refresh() {
  try {
    const r = await fetch('/monitor/api/metrics');
    if (r.status === 401 || r.status === 403) { window.location.href = '/monitor/login'; return; }
    const d = await r.json();
    const ts = d.timeSeries || [];
    const lastTs = ts[ts.length - 1] || {};

    // Push time-series history
    push(hist.rps, lastTs.rps || 0);
    push(hist.p50, d.latency.p50 || 0);
    push(hist.p95, d.latency.p95 || 0);
    push(hist.p99, d.latency.p99 || 0);
    push(hist.err, lastTs.err_rate || 0);
    push(hist.rss, d.memory.rss / 1048576);
    push(hist.heap, d.memory.heapUsed / 1048576);
    push(hist.heapTotal, d.memory.heapTotal / 1048576);

    // Filter bar
    document.getElementById('fb-uptime').textContent = fmtUptime(d.uptime);
    document.getElementById('fb-p50').textContent    = fmtMs(d.latency.p50);
    document.getElementById('fb-p95').textContent    = fmtMs(d.latency.p95);
    document.getElementById('fb-p99').textContent    = fmtMs(d.latency.p99);
    document.getElementById('fb-sessions').textContent = d.activeSessions ?? '–';

    // Pressure bars (normalised)
    const maxRps = Math.max(...hist.rps, 1);
    const rpsNow = hist.rps[hist.rps.length - 1] || 0;
    const errNow = lastTs.err_rate || 0;
    const heapPct = d.memory.heapUsed / d.memory.heapTotal * 100;
    function setBar(id, pid, pct, val) {
      const bar = document.getElementById(id), lbl = document.getElementById(pid);
      if (bar) bar.style.width = Math.min(100, pct).toFixed(1) + '%';
      if (lbl) lbl.textContent = val;
    }
    setBar('pbar-rps', 'pval-rps', rpsNow / maxRps * 100, rpsNow.toFixed(2));
    setBar('pbar-err', 'pval-err', Math.min(errNow * 10, 100), errNow.toFixed(1) + '%');
    setBar('pbar-heap','pval-heap', heapPct, heapPct.toFixed(0) + '%');

    // Gauges
    const latPct = Math.min(d.latency.p95 / 2000, 1);
    drawGauge('gauge-p95', latPct, gaugeColor(latPct));
    document.getElementById('glabel-p95').textContent = fmtMs(d.latency.p95);

    const hPct = d.memory.heapUsed / d.memory.heapTotal;
    drawGauge('gauge-heap', hPct, gaugeColor(hPct));
    document.getElementById('glabel-heap').textContent = fmtMb(d.memory.heapUsed) + ' / ' + fmtMb(d.memory.heapTotal);

    const ePct = Math.min((lastTs.err_rate || 0) / 100, 1);
    drawGauge('gauge-err', ePct, ePct > 0 ? gaugeColor(Math.max(ePct * 3, 0.5)) : '#2c3038');
    document.getElementById('glabel-err').textContent = (lastTs.err_rate || 0).toFixed(1) + '%';

    const aMax = Math.max(d.counters.total, 1);
    const aPct = Math.min(d.counters.auth_fail / aMax, 1);
    drawGauge('gauge-auth', aPct, aPct > 0 ? '#f2495c' : '#2c3038');
    document.getElementById('glabel-auth').textContent = d.counters.auth_fail + ' fails';

    // Stats
    document.getElementById('s-total').textContent   = d.counters.total.toLocaleString();
    document.getElementById('s-rss').textContent      = fmtMb(d.memory.rss);
    document.getElementById('s-sessions').textContent = d.activeSessions ?? '–';
    document.getElementById('s-uptime').textContent   = fmtUptime(d.uptime);

    // Time-series charts
    drawTS('ts-rps', [{ data: hist.rps,  color: '#5794f2' }]);
    drawTS('ts-lat', [
      { data: hist.p50, color: '#73bf69' },
      { data: hist.p95, color: '#fade2a' },
      { data: hist.p99, color: '#f2495c' },
    ]);
    drawTS('ts-err', [{ data: hist.err, color: '#f2495c' }], 100);
    drawTS('ts-mem', [
      { data: hist.rss,      color: '#fade2a' },
      { data: hist.heap,     color: '#73bf69' },
      { data: hist.heapTotal,color: '#5794f2' },
    ]);

    // Request log
    document.getElementById('req-count').textContent = '(' + (d.recentRequests?.length || 0) + ')';
    const rb = document.getElementById('req-tbody');
    rb.innerHTML = (!d.recentRequests?.length)
      ? '<tr><td colspan="7" class="empty">No requests yet</td></tr>'
      : d.recentRequests.map(r =>
          '<tr>' +
            '<td style="font-family:var(--mono);font-size:10.5px;white-space:nowrap">' + fmtTime(r.ts) + '</td>' +
            '<td>' + methBadge(r.method) + '</td>' +
            '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:11px">' + (r.path||'–') + '</td>' +
            '<td>' + statusBadge(r.status) + '</td>' +
            '<td style="font-family:var(--mono);font-size:10.5px">' + (r.ms != null ? r.ms.toFixed(0) + 'ms' : '–') + '</td>' +
            '<td style="font-family:var(--mono);font-size:10.5px">' + (r.ip||'–') + '</td>' +
            '<td style="font-size:10px;color:var(--text3);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.ua||'–') + '</td>' +
          '</tr>'
        ).join('');

    // Security
    document.getElementById('ss-authfail').textContent = d.counters.auth_fail;
    document.getElementById('ss-authok').textContent   = d.counters.auth_ok;
    document.getElementById('ss-4xx').textContent     = d.counters.client_error;
    document.getElementById('ss-5xx').textContent     = d.counters.server_error;
    document.getElementById('sec-count').textContent  = '(' + (d.securityEvents?.length || 0) + ')';
    const sb = document.getElementById('sec-tbody');
    sb.innerHTML = (!d.securityEvents?.length)
      ? '<tr><td colspan="4" class="empty">No security events</td></tr>'
      : d.securityEvents.map(e =>
          '<tr>' +
            '<td style="font-family:var(--mono);font-size:10.5px;white-space:nowrap">' + fmtTime(e.ts) + '</td>' +
            '<td>' + secBadge(e.event) + '</td>' +
            '<td style="font-family:var(--mono);font-size:10.5px">' + (e.ip||'–') + '</td>' +
            '<td style="color:var(--text3);font-size:11px">' + (e.detail||'') + '</td>' +
          '</tr>'
        ).join('');

    // Last refresh
    document.getElementById('last-refresh').textContent = new Date().toTimeString().slice(0,8);
  } catch(e) { console.warn('refresh err', e); }
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
}
