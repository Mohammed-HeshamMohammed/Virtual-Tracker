"use client"

import { ProjectManagementOverview, ProjectsPage as Projects } from "@/features/projects"
import { TasksPage as Tasks } from "@/features/tasks"
import { ClientsPage as Clients } from "@/features/clients"
import { TimeOffRequestsPage } from "@/features/time-off"
import type { PageChunkProps } from "@/app/routes/types"

export default function ProjectsChunk({ pageId, onNavigate }: PageChunkProps) {
  switch (pageId) {
    case "pm-overview":
      return <ProjectManagementOverview onNavigate={onNavigate} />
    case "pm-projects":
      return <Projects />
    case "pm-tasks":
      return <Tasks />
    case "pm-clients":
      return <Clients />
    case "calendar-timeoff":
      return <TimeOffRequestsPage onNavigate={onNavigate} />
    default:
      return <ProjectManagementOverview onNavigate={onNavigate} />
  }
}
