import type { ScreenshotRef } from "../../types";

type ScreenshotsCardProps = {
  screenshots: ScreenshotRef[];
  images: Record<string, string>;
  onSelect: (id: string) => void;
  selectedId: string | null;
};

function capturedLabel(capturedAt: string | null): string {
  if (!capturedAt) return "";
  const d = new Date(capturedAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ScreenshotsCard({ screenshots, images, onSelect, selectedId }: ScreenshotsCardProps) {
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
            title={capturedLabel(shot.capturedAt) || "Screenshot"}
          >
            {capturedLabel(shot.capturedAt) || "—"}
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
