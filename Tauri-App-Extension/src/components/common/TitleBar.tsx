import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentNotification, ThemePreference } from "../../types";

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "Theme: follows system",
  light: "Theme: light",
  dark: "Theme: dark",
};

function ThemeGlyph({ theme }: { theme: ThemePreference }) {
  if (theme === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </g>
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M20 14.6A8.4 8.4 0 0 1 9.4 4a8.4 8.4 0 1 0 10.6 10.6Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="currentColor" d="M12 4a8 8 0 0 1 0 16V4Z" />
    </svg>
  );
}

export function TitleBar({
  title,
  showBrand = true,
  onClose,
  onCheckUpdate,
  checkingUpdate,
  theme,
  onCycleTheme,
  notifications = [],
  unreadCount = 0,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onNotificationUpdate,
  onReplyToMessage,
}: {
  title?: string;
  showBrand?: boolean;
  onClose: () => void;
  onCheckUpdate?: () => void;
  checkingUpdate?: boolean;
  theme?: ThemePreference;
  onCycleTheme?: (next: ThemePreference) => void;
  notifications?: AgentNotification[];
  unreadCount?: number;
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  onNotificationUpdate?: (notification: AgentNotification) => void;
  /** Replying to an Owner message from inside the tracker (Part A3). */
  onReplyToMessage?: (threadId: string, body: string) => Promise<void>;
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");
  const notificationRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notificationsOpen) return;
    const close = (event: MouseEvent) => {
      if (!notificationRootRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [notificationsOpen]);

  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        {showBrand ? (
          <>
            <img
              className="titlebar-logo-img"
              src="/app-icon.ico"
              width={16}
              height={16}
              alt=""
              draggable={false}
            />
            {title ? (
              <span className="titlebar-label" data-tauri-drag-region>
                {title}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="titlebar-controls">
        {theme && onCycleTheme ? (
          <button
            className="win-btn"
            type="button"
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
            onClick={() => onCycleTheme(NEXT_THEME[theme])}
          >
            <ThemeGlyph theme={theme} />
          </button>
        ) : null}
        {onCheckUpdate ? (
          <div className="titlebar-notifications" ref={notificationRootRef}>
            <button
              className="win-btn"
              type="button"
              title="Tracker notifications"
              aria-label={`Tracker notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.35-1.65h-4.7A2.5 2.5 0 0 0 12 22Zm7-5-1.8-2.25V10a5.2 5.2 0 0 0-4.2-5.1V4a1 1 0 1 0-2 0v.9A5.2 5.2 0 0 0 6.8 10v4.75L5 17v1h14v-1Z" />
              </svg>
              {unreadCount > 0 ? <span className="notification-badge">{Math.min(unreadCount, 99)}</span> : null}
            </button>
            {notificationsOpen ? (
              <div className="notification-dropdown" role="dialog" aria-label="Tracker notifications">
                <div className="notification-dropdown-head">
                  <strong>Tracker notifications</strong>
                  {unreadCount > 0 ? <button type="button" onClick={onMarkAllNotificationsRead}>Mark all read</button> : null}
                </div>
                <div className="notification-list">
                  {notifications.length ? notifications.map((notification) => (
                    <article
                      key={notification.id}
                      className={`notification-item${notification.read ? "" : " unread"}`}
                      onClick={() => { if (!notification.read) onMarkNotificationRead?.(notification.id); }}
                    >
                      <div className="notification-item-copy">
                        <strong>{notification.title}</strong>
                        <p>{notification.message}</p>
                        {notification.createdAt ? <time>{new Date(notification.createdAt).toLocaleString()}</time> : null}
                      </div>
                      {notification.targetVersion ? (
                        <button type="button" className="notification-update-btn" onClick={(event) => { event.stopPropagation(); onNotificationUpdate?.(notification); }}>
                          Update now
                        </button>
                      ) : null}
                      {notification.threadId && onReplyToMessage ? (
                        replyingTo === notification.threadId ? (
                          <div className="notification-reply" onClick={(event) => event.stopPropagation()}>
                            <textarea
                              value={replyText}
                              rows={2}
                              maxLength={2000}
                              autoFocus
                              placeholder="Write a reply…"
                              onChange={(event) => setReplyText(event.target.value)}
                            />
                            {replyError ? <p className="notification-reply-error">{replyError}</p> : null}
                            <div className="notification-reply-actions">
                              <button
                                type="button"
                                disabled={replyBusy || !replyText.trim()}
                                onClick={async () => {
                                  setReplyBusy(true);
                                  setReplyError("");
                                  try {
                                    await onReplyToMessage(notification.threadId!, replyText.trim());
                                    setReplyText("");
                                    setReplyingTo(null);
                                  } catch (error) {
                                    setReplyError(error instanceof Error ? error.message : "Could not send the reply.");
                                  } finally {
                                    setReplyBusy(false);
                                  }
                                }}
                              >
                                {replyBusy ? "Sending…" : "Send"}
                              </button>
                              <button type="button" className="ghost" onClick={() => { setReplyingTo(null); setReplyText(""); setReplyError(""); }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="notification-update-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setReplyingTo(notification.threadId!);
                              setReplyText("");
                              setReplyError("");
                            }}
                          >
                            Reply
                          </button>
                        )
                      ) : null}
                    </article>
                  )) : <p className="notification-empty">No tracker notifications</p>}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {onCheckUpdate ? (
          <button
            className="win-btn"
            type="button"
            title="Check for updates"
            aria-label="Check for updates"
            disabled={checkingUpdate}
            onClick={onCheckUpdate}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
              />
            </svg>
          </button>
        ) : null}
        <button
          className="win-btn"
          type="button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void invoke("minimize_current")}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="win-btn win-close"
          type="button"
          title="Close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M1.5 1.5l9 9M10.5 1.5l-9 9"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
