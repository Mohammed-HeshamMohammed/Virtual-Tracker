export interface Team {
  id: string
  name: string
  schedule_weekly_report?: boolean
  created_at?: string
  created_by?: string
  updated_by?: string
}

export interface TeamMember {
  id: string
  name: string
  avatar?: string
  avatarUrl?: string
  color?: string
  role?: string
  is_lead?: boolean
}

export interface TeamProject {
  id: string
  name: string
}

export interface TeamWithRelations extends Team {
  members: TeamMember[]
  projects: TeamProject[]
  leads: string[]
}
