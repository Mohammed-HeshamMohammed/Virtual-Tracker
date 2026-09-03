import { apiPath } from "@/infrastructure/api/path"
import { extractApiError, apiFetch, fetchJsonWithRetry } from "@/infrastructure/api/http"

type Envelope<T> = { success?: boolean; error?: string; data?: T }

export type ProjectTeamOption = {
  id: string
  name: string
}

export async function getProjectTeams(projectId: string): Promise<ProjectTeamOption[]> {
  const { res, json } = await fetchJsonWithRetry<Envelope<ProjectTeamOption[]>>(
    apiPath(`/api/projects/${encodeURIComponent(projectId)}/teams`),
    {},
    { retries: 1 },
  )

  if (!res.ok) {
    throw extractApiError(res.status, "Failed to fetch project teams", json)
  }
  if (!json?.success) {
    throw new Error(json?.error || "Failed to fetch project teams")
  }

  return (json.data ?? [])
    .map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? "Unnamed team"),
    }))
    .filter((team) => team.id)
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function ensureTeamLinkedToProject(
  teamId: string,
  projectId: string,
): Promise<void> {
  const linked = await getProjectTeams(projectId)
  if (linked.some((team) => team.id === teamId)) return

  const res = await apiFetch(
    apiPath("/api/team-projects"),
    {
      method: "POST",
      body: JSON.stringify({
        team_id: teamId,
        project_id: projectId,
      }),
    },
    { json: true },
  )
  const json = (await res.json().catch(() => null)) as Envelope<unknown>
  if (!res.ok) {
    throw extractApiError(res.status, "Failed to link team to project", json)
  }
  if (json && json.success === false) {
    throw new Error(json.error || "Failed to link team to project")
  }
}
