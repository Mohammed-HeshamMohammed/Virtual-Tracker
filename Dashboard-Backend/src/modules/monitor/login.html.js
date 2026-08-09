/** Returns the login page HTML for the /monitor dashboard. */
export function getLoginHtml(error = "") {
  const errBlock = error
    ? `<div class="error-box"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>${error}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Virtual Tracker · Monitor Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0e1a;
      --surface: #111827;
      --surface2: #1a2235;
      --border: #1e2d45;
      --accent: #3b82f6;
      --accent-glow: rgba(59,130,246,.35);
      --danger: #ef4444;
      --text: #e2e8f0;
      --muted: #64748b;
      --font: 'Inter', system-ui, sans-serif;
    }
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .bg-orb {
      position: fixed; border-radius: 50%; filter: blur(80px); pointer-events: none; z-index: 0;
    }
    .bg-orb-1 { width: 500px; height: 500px; background: rgba(59,130,246,.12); top: -100px; left: -100px; }
    .bg-orb-2 { width: 400px; height: 400px; background: rgba(139,92,246,.08); bottom: -80px; right: -80px; }
    .card {
      position: relative; z-index: 1;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 48px 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04) inset;
    }
    .logo {
      display: flex; align-items: center; gap: 12px; margin-bottom: 32px;
    }
    .logo-icon {
      width: 44px; height: 44px; background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 12px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 20px var(--accent-glow);
    }
    .logo-icon svg { width: 22px; height: 22px; color: #fff; }
    .logo-text { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.2; }
    .logo-text small { display: block; font-size: 11px; font-weight: 400; color: var(--muted); margin-top: 2px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .subtitle { color: var(--muted); font-size: 14px; margin-bottom: 28px; }
    label { display: block; font-size: 13px; font-weight: 500; color: #94a3b8; margin-bottom: 6px; }
    .input-wrap { position: relative; margin-bottom: 16px; }
    .input-wrap svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--muted); pointer-events: none; }
    input[type=text], input[type=password] {
      width: 100%; background: var(--surface2); border: 1px solid var(--border);
      border-radius: 10px; padding: 12px 14px 12px 40px;
      color: var(--text); font-family: var(--font); font-size: 14px;
      outline: none; transition: border-color .2s, box-shadow .2s;
    }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    .toggle-pwd {
      position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer; color: var(--muted); padding: 0;
    }
    .toggle-pwd:hover { color: var(--text); }
    .toggle-pwd svg { width: 16px; height: 16px; display: block; }
    button[type=submit] {
      width: 100%; padding: 13px; margin-top: 8px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff; border: none; border-radius: 10px; font-family: var(--font);
      font-size: 15px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 20px var(--accent-glow);
      transition: opacity .2s, transform .15s;
    }
    button[type=submit]:hover { opacity: .9; transform: translateY(-1px); }
    button[type=submit]:active { transform: translateY(0); }
    .error-box {
      display: flex; align-items: center; gap: 8px;
      background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.3);
      border-radius: 10px; padding: 12px 14px; margin-bottom: 20px;
      color: #fca5a5; font-size: 13px;
    }
    .error-box svg { width: 16px; height: 16px; flex-shrink: 0; }
    .security-note {
      margin-top: 20px; text-align: center; font-size: 12px; color: var(--muted);
      display: flex; align-items: center; justify-content: center; gap: 5px;
    }
    .security-note svg { width: 13px; height: 13px; }
  </style>
</head>
<body>
  <div class="bg-orb bg-orb-1"></div>
  <div class="bg-orb bg-orb-2"></div>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
        </svg>
      </div>
      <div class="logo-text">
        Virtual Tracker
        <small>Operations Monitor</small>
      </div>
    </div>
    <h1>Secure Access</h1>
    <p class="subtitle">This dashboard is restricted to administrators only.</p>
    ${errBlock}
    <form method="POST" action="/monitor/login" autocomplete="off">
      <div>
        <label for="username">Username</label>
        <div class="input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <input type="text" id="username" name="username" placeholder="admin" required autofocus />
        </div>
      </div>
      <div>
        <label for="password">Password</label>
        <div class="input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          <input type="password" id="password" name="password" placeholder="••••••••" required />
          <button type="button" class="toggle-pwd" onclick="togglePwd()" title="Toggle visibility">
            <svg id="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
      <button type="submit">Sign In to Monitor</button>
    </form>
    <div class="security-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      Session expires after 15 minutes of inactivity
    </div>
  </div>
  <script>
    function togglePwd() {
      const inp = document.getElementById('password');
      const ico = document.getElementById('eye-icon');
      const isPass = inp.type === 'password';
      inp.type = isPass ? 'text' : 'password';
      ico.innerHTML = isPass
        ? '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
        : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  </script>
</body>
</html>`;
}
