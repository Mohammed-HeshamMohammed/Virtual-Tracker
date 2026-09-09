import type { TaskDetail } from "../../types";

export function TaskDetailPanel({ detail, loading }: { detail: TaskDetail | null; loading?: boolean }) {
  if (loading) {
    return (
      <section className="stat-panel page-content-swap is-loading" style={{ animationDelay: "0.05s" }} aria-busy="true">
        <div className="stat-panel-head">
          <h3 className="stat-panel-title">This task</h3>
          <span className="skeleton-bar" style={{ width: 50, height: 14, borderRadius: 999 }} />
        </div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="skeleton-bar" style={{ width: "85%", height: 13, borderRadius: 4 }} />
          <span className="skeleton-bar" style={{ width: "65%", height: 13, borderRadius: 4 }} />
        </div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="skeleton-bar" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
            <span className="skeleton-bar" style={{ width: "70%", height: 12, borderRadius: 4 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="skeleton-bar" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
            <span className="skeleton-bar" style={{ width: "50%", height: 12, borderRadius: 4 }} />
          </div>
        </div>
      </section>
    );
  }
  if (!detail) return null;
  const done = detail.subtasks.filter((s) => s.completed).length;
  const hasBody = Boolean(detail.description) || detail.subtasks.length > 0;
  // Priority now has its own badge on the primary task card above this one
  // (TaskProgressPanel) - showing it a second time here would just repeat
  // it, so this panel's own metadata row is down to the due date.
  const hasMeta = Boolean(detail.dueDate);
  if (!hasBody && !hasMeta) return null;

  return (
    <section className="stat-panel page-content-swap" style={{ animationDelay: "0.05s" }}>
      <div className="stat-panel-head">
        <h3 className="stat-panel-title">This task</h3>
        {detail.subtasks.length > 0 ? (
          <span className="stat-panel-hint">
            {done}/{detail.subtasks.length} done
          </span>
        ) : null}
      </div>

      {hasMeta ? (
        <div className="badge-row" style={{ marginBottom: 10 }}>
          {detail.dueDate ? <span className="badge warn">Due {detail.dueDate}</span> : null}
        </div>
      ) : null}

      {detail.description ? <p className="task-detail-text">{detail.description}</p> : null}

      {detail.subtasks.length > 0 ? (
        <ul className="task-subtasks">
          {detail.subtasks.map((sub) => (
            <li key={sub.id} className={`task-subtask${sub.completed ? " done" : ""}`}>
              <span className="task-subtask-box" aria-hidden="true">
                {sub.completed ? "✓" : ""}
              </span>
              <span>{sub.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
