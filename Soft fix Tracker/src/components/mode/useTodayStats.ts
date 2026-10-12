import { useWorkspace } from "../../workspace";
import { dateKey } from "../work/WorkHome";

/** What the compact modes show about today: time worked (saved sessions plus the running timer)
 *  against the daily goal, and the tasks still open. */
export function useTodayStats(runningSeconds: number) {
  const { sessions, projects, preferences } = useWorkspace();
  const today = dateKey(new Date());
  const todaySeconds =
    sessions
      .filter((session) => session.memberId === "me" && dateKey(new Date(session.startedAt)) === today)
      .reduce((sum, session) => sum + session.seconds, 0) + runningSeconds;
  const goalSeconds = Math.max(1, preferences.dailyGoal * 3600);
  const openTasks = projects.flatMap((project) =>
    project.tasks.filter((task) => !task.done).map((task) => ({ ...task, projectId: project.id, projectName: project.name, color: project.color })),
  );
  return {
    todaySeconds,
    goalHours: preferences.dailyGoal,
    progress: Math.min(100, (todaySeconds / goalSeconds) * 100),
    openTasks,
  };
}
