import { useCallback, useEffect, useState } from "react";
import type { CaptureStatus, CaptureSummary, OwnExclusion } from "../../types";
import { PanelBackHeader } from "../common/PanelBackHeader";
import { toast } from "../../Toast";
import { fmtHours } from "../../utils/formatters";
import { invokeWithTimeout } from "../../utils/invoke-timeout";
import {
  breakLabel,
  breakOptions,
  defaultBreakMinutes,
  canStartBreak,
  describeCollection,
  exclusionLabel,
  formatRemaining,
  isOnBreak,
} from "../../utils/privacy";

type Props = {
  status: CaptureStatus;
  timeZone: string;
  onStatusChanged: () => void;
  onBack: () => void;
};

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}

export function PrivacyPanel({ status, timeZone, onStatusChanged, onBack }: Props) {
  const [summary, setSummary] = useState<CaptureSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [exclusions, setExclusions] = useState<OwnExclusion[] | null>(null);
  const [listFailed, setListFailed] = useState(false);

  const [chosenMinutes, setMinutes] = useState<number>(defaultBreakMinutes(breakOptions(status.breakLimitSec)));
  const [reason, setReason] = useState("");
  const [breakBusy, setBreakBusy] = useState(false);

  const [matchType, setMatchType] = useState<"app" | "domain">("app");
  const [pattern, setPattern] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    invokeWithTimeout<CaptureSummary>("get_my_capture_summary", { timeZone })
      .then((value) => !cancelled && setSummary(value))
      .catch(() => !cancelled && setSummaryFailed(true));
    invokeWithTimeout<OwnExclusion[]>("list_my_exclusions")
      .then((rows) => !cancelled && setExclusions(rows))
      .catch(() => !cancelled && setListFailed(true));
    return () => {
      cancelled = true;
    };
  }, [timeZone]);

  const changeBreak = useCallback(
    async (nextMinutes: number | null) => {
      setBreakBusy(true);
      setError("");
      try {
        await invokeWithTimeout("set_private_break", { minutes: nextMinutes, reason: reason.trim() });
        if (nextMinutes !== null) {
          setReason("");
          toast.success("Private break started");
        }
      } catch (e) {
        // Starting still worked locally when recording failed, so say what actually
        // happened rather than implying nothing changed.
        setError(
          nextMinutes === null
            ? `Could not end the break: ${messageOf(e)}`
            : `Your break has started on this device, but it could not be recorded: ${messageOf(e)}`,
        );
      } finally {
        onStatusChanged();
        setBreakBusy(false);
      }
    },
    [reason, onStatusChanged],
  );

  const addExclusion = useCallback(async () => {
    const value = pattern.trim();
    if (!value) return;
    setAddBusy(true);
    setError("");
    try {
      const added = await invokeWithTimeout<OwnExclusion>("add_my_exclusion", { matchType, pattern: value });
      setExclusions((prev) => [added, ...(prev ?? [])]);
      setPattern("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setAddBusy(false);
    }
  }, [matchType, pattern]);

  const removeExclusion = useCallback(async (id: string) => {
    setError("");
    try {
      await invokeWithTimeout("remove_my_exclusion", { id });
      setExclusions((prev) => (prev ?? []).filter((row) => row.id !== id));
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  const onBreak = isOnBreak(status);
  const options = breakOptions(status.breakLimitSec);
  // The limit can arrive after the choice was made, or change with the project.
  const minutes = options.some((o) => o.minutes === chosenMinutes) ? chosenMinutes : defaultBreakMinutes(options);

  return (
    <>
      <PanelBackHeader title="Privacy" onBack={onBack} />

      <div className="content settings-content">
        {error ? (
          <p className="settings-message settings-message-warning" role="alert">
            {error}
          </p>
        ) : null}

        <section data-help="Private break: pauses your timer and stops all capture for the time you choose. Your manager sees that you took a break and your reason." className="settings-card">
          <h3 className="settings-section-label">Private break</h3>
          {onBreak ? (
            <>
              <span className="settings-row-sub">
                Your timer is paused and nothing is being captured. {formatRemaining(status.breakUntilMs)}.
              </span>
              <button data-tip="End your private break. The timer resumes and capture starts again"
                type="button"
                className="btn btn-secondary"
                disabled={breakBusy}
                onClick={() => void changeBreak(null)}
              >
                End break
              </button>
            </>
          ) : (
            <>
              <span className="settings-row-sub">
                Pauses your timer and stops all capture. Your manager can see that you took a break and the reason you give.
                {status.breakLimitSec > 0
                  ? ` This project allows breaks of up to ${breakLabel(Math.floor(status.breakLimitSec / 60))}.`
                  : ""}
              </span>
              <div data-help="How long the break lasts. Only the lengths this project allows are offered." className="segmented" role="group" aria-label="Break length">
                {options.map((option) => (
                  <button data-tip={`Take a ${option.label} break`}
                    key={option.minutes}
                    type="button"
                    className={`segmented-btn${minutes === option.minutes ? " active" : ""}`}
                    aria-pressed={minutes === option.minutes}
                    onClick={() => setMinutes(option.minutes)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="input-field-group">
                <label className="input-field-label" htmlFor="break-reason">
                  Reason
                </label>
                <input data-help="Why you are taking the break. Your manager can see it."
                  id="break-reason"
                  className="text-input"
                  value={reason}
                  maxLength={200}
                  placeholder="e.g. Doctor's appointment"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <button data-tip="Pause your timer and stop all capture for the chosen time. A reason is required"
                type="button"
                className="btn btn-primary"
                disabled={!canStartBreak(reason, breakBusy)}
                onClick={() => void changeBreak(minutes)}
              >
                Start break
              </button>
            </>
          )}
        </section>

        <section data-help="Collected today: exactly what has been collected about you so far today." className="settings-card">
          <h3 className="settings-section-label">Collected today</h3>
          {summary ? (
            <>
              <span className="settings-row-title">{describeCollection(summary)}</span>
              <span className="settings-row-sub">{fmtHours(summary.activeSeconds)} active</span>
            </>
          ) : (
            <span className="settings-row-sub">
              {summaryFailed ? "Could not load this right now." : "Loading…"}
            </span>
          )}
        </section>

        <section data-help="Never capture: apps and websites you add are never captured. This can only reduce what is collected about you." className="settings-card">
          <h3 className="settings-section-label">Never capture</h3>
          <span className="settings-row-sub">
            Apps and websites you add here are never captured. It can only reduce what is collected about you.
          </span>
          <div className="privacy-add">
            <select data-help="Whether the rule is for an app or for a website."
              className="text-input privacy-type"
              value={matchType}
              aria-label="Type"
              onChange={(e) => setMatchType(e.target.value === "domain" ? "domain" : "app")}
            >
              <option value="app">App</option>
              <option value="domain">Website</option>
            </select>
            <input data-help="The app or website to never capture, for example mybank.com. A website rule covers its subdomains too."
              className="text-input"
              value={pattern}
              placeholder={matchType === "app" ? "e.g. KeePass" : "e.g. mybank.com"}
              aria-label="Name"
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addExclusion();
              }}
            />
            <button data-tip="Never capture this app or website"
              type="button"
              className="btn btn-secondary"
              disabled={addBusy || !pattern.trim()}
              onClick={() => void addExclusion()}
            >
              Add
            </button>
          </div>
          {exclusions === null ? (
            <span className="settings-row-sub">{listFailed ? "Could not load your list." : "Loading…"}</span>
          ) : exclusions.length === 0 ? (
            <span className="settings-row-sub">Nothing added yet.</span>
          ) : (
            <ul className="privacy-list">
              {exclusions.map((row) => (
                <li key={row.id} className="privacy-item">
                  <span>
                    <span className="privacy-kind">{exclusionLabel(row.matchType)}</span> {row.pattern}
                  </span>
                  <button data-tip={`Stop excluding ${row.pattern}`}
                    type="button"
                    className="btn btn-tertiary"
                    aria-label={`Remove ${row.pattern}`}
                    onClick={() => void removeExclusion(row.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
