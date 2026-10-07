type SessionControlsProps = {
  tracking: boolean;
  paused: boolean;
  /** The timer is stopped for a Break rather than a Pause. */
  onBreak?: boolean;
  busy: boolean;
  /** Whether a session could start right now - a selection is in place and
   *  no limit has been reached. Only consulted while nothing is running. */
  canStart: boolean;
  /** Why starting is blocked, shown as the button's tooltip. */
  blockedReason?: string;
  onStart: () => void;
  onPause: () => void;
  /** Away from everything; offered next to Stop while tracking. */
  onStartBreak?: () => void;
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
  onBreak = false,
  busy,
  canStart,
  blockedReason,
  onStart,
  onPause,
  onStartBreak,
  onResume,
  onStop,
}: SessionControlsProps) {
  const state = tracking ? "tracking" : paused ? "paused" : "idle";
  const label = tracking ? "Pause tracking" : paused ? "Resume tracking" : "Start tracking";
  const hint = tracking
    ? "Pause tracking - you are still at your desk"
    : paused && onBreak
      ? "Resume tracking - back from your break"
      : label;
  const disabled = busy || (state === "idle" && !canStart);

  return (
    <div className="session-controls">
      <button
        type="button"
        className={`session-toggle is-${state}`}
        aria-label={label}
        title={state === "idle" && !canStart && blockedReason ? blockedReason : hint}
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
      {tracking && onStartBreak ? (
        <button
          type="button"
          className="session-break"
          aria-label="Take a break - away from your desk"
          title="Take a break - away from your desk. The timer stops and nothing is captured"
          disabled={busy}
          onClick={onStartBreak}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a2 2 0 0 1 0 4h-2V9ZM7 3h2v3H7V3Zm4 0h2v3h-2V3Z" />
          </svg>
        </button>
      ) : null}
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
