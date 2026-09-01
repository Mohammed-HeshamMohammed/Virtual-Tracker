import type { TimeOffBalance } from "../types";

type TimeOffRequestModalProps = {
  open: boolean;
  /** The viewer's own policies, straight from the workspace payload - each
   *  carries the policyId a request is filed against, so this needs no
   *  separate policy fetch. */
  policies: TimeOffBalance[];
  policyId: string;
  startDate: string;
  endDate: string;
  note: string;
  busy: boolean;
  error: string | null;
  onPolicyIdChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

// Requesting leave from the tray, next to the balance the agent already
// shows. Clients are refused server-side (they have no policy and nobody to
// approve them), and they never have policies here either, so the control
// simply never renders for them.
export function TimeOffRequestModal({
  open,
  policies,
  policyId,
  startDate,
  endDate,
  note,
  busy,
  error,
  onPolicyIdChange,
  onStartDateChange,
  onEndDateChange,
  onNoteChange,
  onCancel,
  onSubmit,
}: TimeOffRequestModalProps) {
  if (!open) return null;
  // End before start is the one combination the server rejects outright, so
  // it's worth catching here rather than round-tripping for it.
  const rangeValid = Boolean(startDate) && Boolean(endDate) && endDate >= startDate;
  const canSubmit = !busy && Boolean(policyId) && rangeValid;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Request time off">
        <h3 className="modal-title">Request time off</h3>
        <p className="modal-sub">Goes to whoever approves leave for you.</p>

        <div className="input-field-group">
          <label className="input-field-label" htmlFor="time-off-policy">Policy</label>
          <select
            id="time-off-policy"
            className="modal-input"
            value={policyId}
            onChange={(e) => onPolicyIdChange(e.target.value)}
          >
            <option value="">Select a policy…</option>
            {policies.map((p) => (
              <option key={p.policyId} value={p.policyId}>
                {p.policyName}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-field-row">
          <div className="input-field-group">
            <label className="input-field-label" htmlFor="time-off-start">From</label>
            <input
              id="time-off-start"
              className="modal-input"
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
            />
          </div>
          <div className="input-field-group">
            <label className="input-field-label" htmlFor="time-off-end">To</label>
            <input
              id="time-off-end"
              className="modal-input"
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
            />
          </div>
        </div>

        {startDate && endDate && !rangeValid ? (
          <p className="modal-sub warn">The end date can&apos;t be before the start date.</p>
        ) : null}

        <div className="input-field-group">
          <label className="input-field-label" htmlFor="time-off-note">Note</label>
          <input
            id="time-off-note"
            className="modal-input"
            type="text"
            maxLength={500}
            value={note}
            placeholder="Optional"
            onChange={(e) => onNoteChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) onSubmit();
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
          <button className="btn btn-primary" type="button" disabled={!canSubmit} onClick={onSubmit}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
