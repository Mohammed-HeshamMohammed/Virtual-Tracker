import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./TrayMenu.css";
import {
  EMPTY_TRAY_STATE,
  trayGroups,
  trayHeadline,
  trayTone,
  traySubline,
  type TrayAction,
  type TrayRow,
  type TrayState,
} from "./trayMenuModel";

function RowIcon({ name }: { name: TrayRow["icon"] }) {
  const p = {
    className: "tm-icon",
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "pause":
      return (
        <svg {...p}>
          <path d="M7.5 5v10M12.5 5v10" />
        </svg>
      );
    case "play":
      return (
        <svg {...p}>
          <path d="M7 4.8v10.4a.6.6 0 0 0 .9.5l8-5.2a.6.6 0 0 0 0-1l-8-5.2a.6.6 0 0 0-.9.5Z" />
        </svg>
      );
    case "stop":
      return (
        <svg {...p}>
          <rect x="5" y="5" width="10" height="10" rx="2" />
        </svg>
      );
    case "app":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="14" height="12" rx="2.2" />
          <path d="M3 8h14" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...p}>
          <path d="M8.5 4.5H5.2A1.7 1.7 0 0 0 3.5 6.2v8.6a1.7 1.7 0 0 0 1.7 1.7h8.6a1.7 1.7 0 0 0 1.7-1.7v-3.3" />
          <path d="M11.5 3.5h5v5M16.5 3.5 9.5 10.5" />
        </svg>
      );
    case "sign-in":
      return (
        <svg {...p}>
          <path d="M8 4.5H5.7A1.7 1.7 0 0 0 4 6.2v7.6a1.7 1.7 0 0 0 1.7 1.7H8" />
          <path d="M10 7l3 3-3 3M13 10H7" />
        </svg>
      );
    case "quit":
      return (
        <svg {...p}>
          <path d="M10 3.5v6" />
          <path d="M6 5.8a6 6 0 1 0 8 0" />
        </svg>
      );
  }
}

export function TrayMenu() {
  const [state, setState] = useState<TrayState>(EMPTY_TRAY_STATE);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // The window is created once and shown/hidden, so state has to be re-read on every open: it
  // may have changed while nothing here was listening.
  const refresh = useCallback(() => {
    void invoke<TrayState>("get_tray_state")
      .then((next) => setState(next))
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("tray-menu-window");
    refresh();
    const unlisten = [
      listen<TrayState>("tray-status", (event) => setState(event.payload)),
      listen("tray-opened", () => {
        refresh();
        setActive(0);
        rootRef.current?.focus();
      }),
    ];
    return () => {
      for (const u of unlisten) void u.then((fn) => fn());
    };
  }, [refresh]);

  // Tell the window how tall the menu is, so it is exactly that tall.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const report = () => void invoke("tray_menu_resize", { height: el.offsetHeight }).catch(() => {});
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const run = useCallback((action: TrayAction) => {
    void invoke("tray_action", { action }).catch(() => {});
  }, []);

  const groups = trayGroups(state);
  const rows = groups.flatMap((g) => g.rows);
  const tone = trayTone(state);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      run("close");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const row = rows[active];
      if (row) run(row.action);
    }
  };

  let index = -1;
  return (
    <div className="tm-frame" ref={frameRef}>
      <div className="tm-card" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} role="menu">
        <div className={`tm-head tm-${tone}`}>
          <img className="tm-logo" src="/app-icon.ico" width={30} height={30} alt="" draggable={false} />
          <div className="tm-head-text">
            <span className="tm-title">
              <span className="tm-dot" />
              {trayHeadline(state)}
            </span>
            <span className="tm-sub" title={traySubline(state)}>
              {traySubline(state)}
            </span>
          </div>
        </div>

        {groups.map((group, g) => (
          <div className="tm-group" key={g}>
            {group.rows.map((row) => {
              index += 1;
              const i = index;
              return (
                <button
                  key={row.action}
                  type="button"
                  role="menuitem"
                  data-tip={row.label}
                  className={`tm-row${row.tone ? ` tm-${row.tone}` : ""}${i === active ? " tm-active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(row.action)}
                >
                  <RowIcon name={row.icon} />
                  <span className="tm-label">{row.label}</span>
                  {row.hint ? <kbd className="tm-hint">{row.hint}</kbd> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
