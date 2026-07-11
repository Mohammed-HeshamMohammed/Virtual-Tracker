function callApi(methodName, ...args) {
  if (window.pywebview && window.pywebview.api) {
    const method = window.pywebview.api[methodName];
    if (typeof method === "function") {
      return Promise.resolve(method(...args));
    }
  }
  return Promise.reject(new Error(`API method '${methodName}' is not ready`));
}

function initialsFromName(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
}

function updateProfile(profile) {
  const nameEl = document.getElementById("session-name");
  const imgEl = document.getElementById("avatar-img");
  const fallbackEl = document.getElementById("avatar-fallback");
  const signInLabel = document.getElementById("btn-signin-label");
  if (!nameEl || !imgEl || !fallbackEl) return;

  const name = profile?.name || "Not signed in";
  nameEl.textContent = name;

  const avatarUrl = profile?.avatarUrl || "";
  if (avatarUrl) {
    imgEl.src = avatarUrl;
    imgEl.hidden = false;
    fallbackEl.hidden = true;
  } else {
    imgEl.hidden = true;
    imgEl.removeAttribute("src");
    fallbackEl.hidden = false;
    fallbackEl.textContent = profile?.signedIn ? initialsFromName(name) : "?";
  }

  if (signInLabel) {
    signInLabel.textContent = profile?.signedIn ? "Re-link Account" : "Sign In";
  }
}

function updateLinkStatus(link) {
  const badge = document.getElementById("link-badge");
  const badgeText = document.getElementById("link-badge-text");
  const serverEl = document.getElementById("link-server");
  const hintEl = document.getElementById("link-hint");
  if (!badge || !badgeText || !serverEl) return;

  const connected = Boolean(link?.connected);
  badge.classList.toggle("offline", !connected);
  badgeText.textContent = connected ? "Connected" : "Offline";
  serverEl.textContent = link?.serverLabel || "Ext-Server: —";

  if (hintEl) {
    hintEl.textContent = connected
      ? "Syncing telemetry data in real-time."
      : "Waiting for the backend server to come online.";
  }
}

window.updateStatus = function updateStatus(statusText) {
  const normalized = (statusText || "").toLowerCase();
  let hint = "Syncing telemetry data in real-time.";
  if (normalized.includes("not signed in")) {
    hint = "Sign in to link this desktop agent to your account.";
  } else if (normalized.includes("linking")) {
    hint = "Complete sign-in in your browser to link your account.";
  } else if (normalized.includes("waiting")) {
    hint = "Connected. Start the tracker timer in the dashboard.";
  } else if (normalized.includes("active")) {
    hint = "Desktop monitoring is running and uploading activity.";
  } else if (normalized.includes("paused") || normalized.includes("idle")) {
    hint = "Web timer is idle — desktop capture is paused.";
  }
  const hintEl = document.getElementById("link-hint");
  if (hintEl) hintEl.textContent = hint;

  refreshProfile().catch(() => {});
};

async function refreshProfile() {
  const [profile, link] = await Promise.all([
    callApi("get_profile").catch(() => null),
    callApi("get_link_status").catch(() => null),
  ]);
  if (profile) updateProfile(profile);
  if (link) updateLinkStatus(link);
}

function animateVizBars() {
  const bars = document.querySelectorAll(".viz-bar");
  bars.forEach((bar) => {
    const height = Math.floor(Math.random() * 75) + 15;
    bar.style.height = `${height}%`;
  });
}

function bindUi() {
  document.getElementById("btn-signin")?.addEventListener("click", () => {
    callApi("sign_in").catch((err) => console.error(err));
  });
  document.getElementById("btn-session-login")?.addEventListener("click", () => {
    callApi("sign_in").catch((err) => console.error(err));
  });
  document.getElementById("btn-open-app")?.addEventListener("click", () => {
    callApi("open_web_app").catch((err) => console.error(err));
  });
  document.getElementById("btn-hide")?.addEventListener("click", () => {
    callApi("hide_to_tray").catch((err) => console.error(err));
  });
  const minBtn = document.getElementById("btn-minimize");
  const closeBtn = document.getElementById("btn-close");
  if (minBtn) {
    minBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      callApi("minimize_window").catch(() => callApi("hide_to_tray").catch(() => {}));
    };
  }
  if (closeBtn) {
    closeBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      callApi("close_window").catch((err) => console.error(err));
    };
  }
  document.getElementById("btn-settings")?.addEventListener("click", () => {
    callApi("open_launcher_setup").catch((err) => console.error(err));
  });
  document.getElementById("btn-help")?.addEventListener("click", () => {
    callApi("open_web_app").catch((err) => console.error(err));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindUi();

  const boot = () => {
    callApi("get_status")
      .then((status) => window.updateStatus(status))
      .catch(() => {});
    callApi("get_version")
      .then((ver) => {
        const el = document.getElementById("footer-version");
        if (el && ver) el.textContent = `v${ver}`;
      })
      .catch(() => {});
    refreshProfile().catch(() => {});
  };

  const onReady = () => {
    setTimeout(boot, 100);
  };

  if (window.pywebview?.api) {
    onReady();
  } else {
    window.addEventListener("pywebviewready", onReady);
    setTimeout(onReady, 400);
  }

  setInterval(() => animateVizBars(), 800);
  setInterval(() => refreshProfile().catch(() => {}), 5000);
});
