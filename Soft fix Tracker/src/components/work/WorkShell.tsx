import { useState } from "react";
import { projects } from "../../data/work";
import { WorkHome } from "./WorkHome";
import { WorkSidebar } from "./WorkSidebar";
import { WorkTeamPane } from "./WorkTeamPane";

/** Work mode: time tracking, restyled from Tauri-App-Extension's real screens into the Soft
 *  Fix design system. UI only - the clock and timer run locally, nothing is tracked or sent. */
export function WorkShell() {
  const [projectId, setProjectId] = useState(projects[0].id);
  const [taskId, setTaskId] = useState<string | null>(projects[0].tasks[0]?.id ?? null);

  function selectProject(id: string) {
    setProjectId(id);
    setTaskId(projects.find(project => project.id === id)?.tasks[0]?.id ?? null);
  }

  return (
    <>
      <WorkSidebar activeProjectId={projectId} activeTaskId={taskId} onSelectProject={selectProject} onSelectTask={setTaskId} />
      <WorkHome projectId={projectId} taskId={taskId} />
      <WorkTeamPane />
    </>
  );
}
