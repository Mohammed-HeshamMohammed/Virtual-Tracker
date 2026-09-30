import { useEffect, useState } from "react";
import { Pause, Play, Stop } from "@phosphor-icons/react";
import { projects, statTiles } from "../../data/work";

type Status = "idle" | "tracking" | "paused";

function fmtClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

/** The tracking pane: a live clock, a timer that actually ticks while "tracking" is on, and
 *  Start/Pause/Stop. Local state only - nothing here is sent anywhere or persisted, matching
 *  the rest of this prototype. */
export function WorkHome({ projectId, taskId }: { projectId: string; taskId: string | null }) {
  const project = projects.find(p => p.id === projectId);
  const task = project?.tasks.find(t => t.id === taskId);
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (status !== "tracking") return;
    const id = window.setInterval(() => setSeconds(value => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    setStatus("idle");
    setSeconds(0);
  }, [projectId, taskId]);

  const label = status === "tracking" ? "Tracking" : status === "paused" ? "On a break" : "Not tracking";

  return (
    <main className="work-home">
      <header className="work-header">
        <span className="work-clock">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<small>{now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</small></span>
        <span className="lounge-header-rule" />
        <span className="work-header-title"><strong>{task?.title ?? "Pick a task to start tracking"}</strong><small>{project?.name ?? "No project selected"}</small></span>
      </header>

      <section className="work-timer-pane">
        <span className={`work-timer-value status-${status}`}>{fmtClock(seconds)}</span>
        <span className="work-timer-label">{label}</span>
        <div className="work-timer-actions">
          {status === "tracking" ? (
            <button className="work-btn" onClick={() => setStatus("paused")}><Pause weight="fill" /><span>Pause</span></button>
          ) : (
            <button className="work-btn primary" disabled={!task} onClick={() => setStatus("tracking")}><Play weight="fill" /><span>{status === "paused" ? "Resume" : "Start"}</span></button>
          )}
          <button className="work-btn danger" disabled={status === "idle"} onClick={() => setStatus("idle")}><Stop weight="fill" /><span>Stop</span></button>
        </div>
      </section>

      <section className="work-stats">
        {statTiles.map(tile => (
          <div className="work-stat-tile" key={tile.label}>
            <span className="work-stat-label">{tile.label}</span>
            <span className="work-stat-value">{tile.value}</span>
            <span className="work-stat-note">{tile.note}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
