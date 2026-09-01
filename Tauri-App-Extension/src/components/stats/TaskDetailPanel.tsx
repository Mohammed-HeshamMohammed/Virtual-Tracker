import type { TaskDetail } from "../../types";

/** Priority is a level, so it gets a tone that matches the level rather than
 *  one flat badge. Deliberately not `neutral` for the high end: in the dark
 *  theme .badge.neutral resolves to --c-primary, which is the same green as
 *  --c-good, so a neutral "HIGH" read as reassuring - the opposite of what it
 *  means. Only `urgent` is red; `high` is amber; everything calmer stays
 *  neutral, where green reads correctly as "nothing to worry about". */
function priorityTone(priority: string): string {
  const key = priority.trim().toLowerCase();
  if (key === "urgent" || key === "critical") return "bad";
  if (key === "high") return "warn";
  return "neutral";
}

// The open task's own detail. The agent could name the task you were
// tracking but never say what it actually asked for, so "what am I meant to
// be doing" meant opening the web app mid-session. Renders nothing at all
// when there is no task in play (a calling/task-less session) or when the
// task carries no detail worth a panel.
export function TaskDetailPanel({ detail }: { detail: TaskDetail | null }) {
  if (!detail) return null;
  const done = detail.subtasks.filter((s) => s.completed).length;
  const hasBody = Boolean(detail.description) || detail.subtasks.length > 0;
  const hasMeta = Boolean(detail.priority) || Boolean(detail.dueDate);
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
          {detail.priority ? (
            <span className={`badge ${priorityTone(detail.priority)}`}>{detail.priority}</span>
          ) : null}
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
