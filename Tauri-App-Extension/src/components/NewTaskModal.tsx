type NewTaskModalProps = {
  open: boolean;
  projectName: string;
  title: string;
  estimateHours: string;
  busy: boolean;
  error: string | null;
  onTitleChange: (value: string) => void;
  onEstimateHoursChange: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
};

// "+ New task" from a ProjectsList row (see side-task-row-add) - same
// position:fixed dialog shape as StopNoteModal, sharing its .modal-* CSS.
// Title is required; the estimate is optional - left blank, the task simply
// has no estimate yet (same as one created on the web with the field
// skipped), same as it always could.
export function NewTaskModal({
  open,
  projectName,
  title,
  estimateHours,
  busy,
  error,
  onTitleChange,
  onEstimateHoursChange,
  onCancel,
  onCreate,
}: NewTaskModalProps) {
  if (!open) return null;
  const canCreate = title.trim().length > 0 && !busy;
  return (
    <div className="modal-backdrop">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="New task">
        <h3 className="modal-title">New task</h3>
        <p className="modal-sub">Adding a task to {projectName || "this project"}.</p>
        <input
          className="modal-input"
          type="text"
          autoFocus
          maxLength={200}
          value={title}
          placeholder="Task title"
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) onCreate();
          }}
        />
        <div className="input-field-group">
          <label className="input-field-label" htmlFor="new-task-estimate">
            Estimate (hours, optional)
          </label>
          <input
            id="new-task-estimate"
            className="modal-input"
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            value={estimateHours}
            placeholder="e.g. 4"
            onChange={(e) => onEstimateHoursChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) onCreate();
            }}
          />
        </div>
        {error ? (
          <div className="auth-error-banner">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={!canCreate} onClick={onCreate}>
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}
