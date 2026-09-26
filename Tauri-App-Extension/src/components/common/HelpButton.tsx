import { setHelpMode, useHelpMode } from "../../utils/helpMode";

/** The circled "?" in the title bar. Pressed, everything on screen explains what it is for. */
export function HelpButton() {
  const helping = useHelpMode();
  return (
    <div className="titlebar-help">
      <button
        className={`win-btn${helping ? " active" : ""}`}
        type="button"
        data-tip={helping ? "Leave help mode" : "Help: hover anything to see what it is for"}
        aria-label="Help"
        aria-pressed={helping}
        onClick={() => setHelpMode(!helping)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M9.4 9.4a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1-1.3 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
