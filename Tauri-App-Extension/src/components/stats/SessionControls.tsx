type SessionControlsProps = {
  tracking: boolean;
  paused: boolean;
  busy: boolean;
  /** Whether a session could start right now - a selection is in place and
   *  no limit has been reached. Only consulted while nothing is running. */
  canStart: boolean;
  /** Why starting is blocked, shown as the button's tooltip. */
  blockedReason?: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
};

/**
 * One round play/pause button plus Stop, for the tracking card. The circle
 * takes its colour from the session state: ready, tracking, or on a break.
 * Each icon is keyed so swapping play for pause remounts it and replays the
 * pop-in animation.
 */
export function SessionControls({
  tracking,
  paused,
  busy,
  canStart,
  blockedReason,
  onStart,
  onPause,
  onResume,
  onStop,
}: SessionControlsProps) {
  const state = tracking ? "tracking" : paused ? "paused" : "idle";
  const label = tracking ? "Pause tracking" : paused ? "Resume tracking" : "Start tracking";
  const disabled = busy || (state === "idle" && !canStart);

  return (
    <div className="session-controls">
      <button
        type="button"
        className={`session-toggle is-${state}`}
        aria-label={label}
        title={state === "idle" && !canStart && blockedReason ? blockedReason : label}
        disabled={disabled}
        onClick={tracking ? onPause : paused ? onResume : onStart}
      >
        {tracking ? (
          <svg key="pause" className="session-toggle-icon" viewBox="0 0 320 512" aria-hidden="true">
            <path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z" />
          </svg>
        ) : (
          <svg key="play" className="session-toggle-icon is-play" viewBox="0 0 384 512" aria-hidden="true">
            <path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z" />
          </svg>
        )}
      </button>
      {tracking || paused ? (
        <button
          type="button"
          className="session-stop"
          aria-label="Stop tracking"
          title="Stop tracking"
          disabled={busy}
          onClick={onStop}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2.5" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
