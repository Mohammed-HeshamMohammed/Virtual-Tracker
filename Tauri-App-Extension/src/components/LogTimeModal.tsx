import type { ProjectInfo, TeamMemberStatus } from "../types";

type LogTimeModalProps = {
  open: boolean;
  projects: ProjectInfo[];
  /** Empty unless the viewer leads a team - see TeamStatusCard. Their own
   *  entry is always available; teammates are only offered when the
   *  workspace actually sent a roster, so this never guesses at who exists. */
  teammates: TeamMemberStatus[];
  memberId: string;
  projectId: string;
  date: string;
  hours: string;
  description: string;
  busy: boolean;
  error: string | null;
  onMemberIdChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onHoursChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

// Manual time entry - time that was worked but never tracked live. Only
// rendered when the server says so (workspace.capabilities.canLogManualTime,
// which is Manager-and-above): hand-typed hours are an attestation, not
// something every member should be able to mint for themselves.
//
// Shares the .modal-* CSS with StopNoteModal / NewTaskModal.
export function LogTimeModal({
  open,
  projects,
  teammates,
  memberId,
  projectId,
  date,
  hours,
  description,
  busy,
  error,
  onMemberIdChange,
  onProjectIdChange,
  onDateChange,
  onHoursChange,
  onDescriptionChange,
  onCancel,
  onSave,
}: LogTimeModalProps) {
  if (!open) return null;
  const parsedHours = Number(hours);
  const canSave =
    !busy && Boolean(projectId) && Boolean(date) && Number.isFinite(parsedHours) && parsedHours > 0;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Log time">
        <h3 className="modal-title">Log time</h3>
        <p className="modal-sub">Time that was worked but never tracked.</p>

        {teammates.length > 0 ? (
          <div className="input-field-group">
            <label className="input-field-label" htmlFor="log-time-member">Member</label>
            <select
              id="log-time-member"
              className="modal-input"
              value={memberId}
              onChange={(e) => onMemberIdChange(e.target.value)}
            >
              {/* "" is resolved to the caller's own member id server-side. */}
              <option value="">Me</option>
              {teammates.map((m) => (
                <option key={m.memberId} value={m.memberId}>{m.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="input-field-group">
          <label className="input-field-label" htmlFor="log-time-project">Project</label>
          <select
            id="log-time-project"
            className="modal-input"
            value={projectId}
            onChange={(e) => onProjectIdChange(e.target.value)}
          >
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="modal-field-row">
          <div className="input-field-group">
            <label className="input-field-label" htmlFor="log-time-date">Date</label>
            <input
              id="log-time-date"
              className="modal-input"
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
            />
          </div>
          <div className="input-field-group">
            <label className="input-field-label" htmlFor="log-time-hours">Hours</label>
            <input
              id="log-time-hours"
              className="modal-input"
              type="number"
              min={0}
              step={0.25}
              inputMode="decimal"
              value={hours}
              placeholder="e.g. 1.5"
              onChange={(e) => onHoursChange(e.target.value)}
            />
          </div>
        </div>

        <div className="input-field-group">
          <label className="input-field-label" htmlFor="log-time-note">What was worked on</label>
          <input
            id="log-time-note"
            className="modal-input"
            type="text"
            maxLength={500}
            value={description}
            placeholder="Optional"
            onChange={(e) => onDescriptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSave();
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
          <button className="btn btn-primary" type="button" disabled={!canSave} onClick={onSave}>
            {busy ? "Saving…" : "Log time"}
          </button>
        </div>
      </div>
    </div>
  );
}
