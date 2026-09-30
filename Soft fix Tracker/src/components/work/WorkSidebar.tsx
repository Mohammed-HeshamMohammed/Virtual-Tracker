import { useState } from "react";
import { CaretDown, CheckCircle, Circle, MagnifyingGlass } from "@phosphor-icons/react";
import { projects } from "../../data/work";

type Props = { activeProjectId: string; activeTaskId: string | null; onSelectProject: (id: string) => void; onSelectTask: (id: string) => void };

/** Project and task picker for Work mode - the same job Tauri-App-Extension's
 *  ProjectsList/TasksList do, restyled to the Soft Fix token set. Mock data only. */
export function WorkSidebar({ activeProjectId, activeTaskId, onSelectProject, onSelectTask }: Props) {
  const [query, setQuery] = useState("");
  const visible = projects.filter(project => project.name.toLowerCase().includes(query.toLowerCase()));
  const activeProject = projects.find(project => project.id === activeProjectId);

  return (
    <aside className="work-sidebar">
      <label className="people-search"><MagnifyingGlass /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter projects" /></label>
      <div className="work-project-list">
        {visible.map(project => (
          <button
            key={project.id}
            className={`work-project-row ${project.id === activeProjectId ? "active" : ""}`}
            onClick={() => onSelectProject(project.id)}
          >
            <span className={`work-project-dot ${project.color}`} />
            <span className="work-project-name">{project.name}</span>
            <b>{project.tasks.length}</b>
          </button>
        ))}
      </div>

      {activeProject ? (
        <>
          <div className="section-label"><span><CaretDown /> TASKS</span></div>
          <div className="work-task-list">
            {activeProject.tasks.map(task => (
              <button
                key={task.id}
                className={`work-task-row ${task.id === activeTaskId ? "active" : ""}`}
                onClick={() => onSelectTask(task.id)}
              >
                {task.done ? <CheckCircle weight="fill" className="work-task-done" /> : <Circle />}
                <span>{task.title}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </aside>
  );
}
