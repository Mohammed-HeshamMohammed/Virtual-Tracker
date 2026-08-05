import { invoke } from "@tauri-apps/api/core";

export function TitleBar({
  title,
  showBrand = true,
  onClose,
  onCheckUpdate,
  checkingUpdate,
}: {
  title?: string;
  showBrand?: boolean;
  onClose: () => void;
  onCheckUpdate?: () => void;
  checkingUpdate?: boolean;
}) {
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
