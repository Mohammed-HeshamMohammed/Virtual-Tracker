import { fmtCapturedAt } from "../../utils/formatters";
import type { ScreenshotRef } from "../../types";

type ScreenshotsCardProps = {
  screenshots: ScreenshotRef[];
  images: Record<string, string>;
  onSelect: (id: string) => void;
  selectedId: string | null;
  /** The member's own zone, so a capture time never contradicts the clock in
   *  the header - see fmtCapturedAt. */
  timeZone?: string;
};

export function ScreenshotsCard({ screenshots, images, onSelect, selectedId, timeZone }: ScreenshotsCardProps) {
  if (screenshots.length === 0) return null;
  const selected = selectedId ? images[selectedId] : "";

  return (
    <section className="settings-card">
      <h3 className="settings-section-label">Your recent screenshots</h3>
      <p className="settings-row-sub">
        Captured from this account while tracking. Only you and whoever your organization allows can see these.
      </p>

      <div className="shot-strip">
        {screenshots.map((shot) => (
          <button
            key={shot.id}
            type="button"
            className={`shot-chip${shot.id === selectedId ? " active" : ""}`}
            onClick={() => onSelect(shot.id)}
            title={fmtCapturedAt(shot.capturedAt, timeZone) || "Screenshot"}
          >
            {fmtCapturedAt(shot.capturedAt, timeZone) || "—"}
          </button>
        ))}
      </div>

      {selectedId ? (
        <div className="shot-preview">
          {selected ? (
            <img className="shot-preview-img" src={selected} alt="Your captured screenshot" draggable={false} />
          ) : (
            <span className="skeleton-bar shot-preview-loading" />
          )}
        </div>
      ) : null}
    </section>
  );
}
