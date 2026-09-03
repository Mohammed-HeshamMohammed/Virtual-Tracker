type StopNoteModalProps = {
  open: boolean;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onKeepTracking: () => void;
  onStop: () => void;
};

export function StopNoteModal({ open, draft, busy, onDraftChange, onKeepTracking, onStop }: StopNoteModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="What did you work on?">
        <h3 className="modal-title">What did you work on?</h3>
        <p className="modal-sub">This project asks for a short note before the timer stops.</p>
        <textarea
          className="modal-input"
          autoFocus
          rows={3}
          maxLength={1000}
          value={draft}
          placeholder="e.g. Called 12 leads, 3 follow-ups booked"
          onChange={(e) => onDraftChange(e.target.value)}
        />
        <div className="modal-actions">
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={onKeepTracking}>
            Keep tracking
          </button>
          <button className="btn btn-danger" type="button" disabled={busy || !draft.trim()} onClick={onStop}>
            {busy ? "Stopping…" : "Stop tracking"}
          </button>
        </div>
      </div>
    </div>
  );
}
