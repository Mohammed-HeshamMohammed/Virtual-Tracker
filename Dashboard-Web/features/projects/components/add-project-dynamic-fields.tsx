"use client"

import type { ProjectFormField, ProjectFormOption } from "@/features/projects/api/project-form-api"
import type { Team } from "@/features/teams/api/team-api"
import { memberMatchesProjectFormRoleFilter } from "@/features/projects/utils/project-form-member-filter"
import { cn } from "@/shared/utils/utils"
import { FORM_STACK, useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { Skeleton } from "@/shared/ui/skeleton"
import { FormField } from "@/shared/ui/forms/form-field"
import { MultiSelectField } from "@/shared/ui/forms/multi-select-field"
import { QuickAddClientPopover } from "@/features/projects/components/quick-add-client-popover"

export type AddProjectRelationFields = {
  clientIds: string[]
  managers: string[]
  users: string[]
  viewers: string[]
  teams: string[]
  memberLimitMembers: string[]
}

type AddProjectDynamicFieldsProps = {
  fields: ProjectFormField[]
  tab: string
  budgetSubTab?: string
  values: AddProjectRelationFields
  onChange: <K extends keyof AddProjectRelationFields>(key: K, value: AddProjectRelationFields[K]) => void
  clientOptions: ProjectFormOption[]
  memberOptions: ProjectFormOption[]
  availableTeams: Team[]
  teamsLoading: boolean
  teamsLoadError: string | null
  /** Called with the new client's id right after a quick-add succeeds (see quick-add-client-popover.tsx). */
  onClientAdded?: (clientId: string) => void
}

function memberOptionsToSelect(options: ProjectFormOption[]) {
  return options.map((m) => ({
    label: m.label,
    value: m.id,
    meta: (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600 dark:bg-[#2e3447] dark:text-[#bccbb9]">
        {m.initials ?? m.label.slice(0, 2).toUpperCase()}
      </span>
    ),
  }))
}

export function AddProjectDynamicFields({
  fields,
  tab,
  budgetSubTab,
  values,
  onChange,
  clientOptions,
  memberOptions,
  availableTeams,
  teamsLoading,
  teamsLoadError,
  onClientAdded,
}: AddProjectDynamicFieldsProps) {
  const theme = useClientFormTheme()
  const visible = fields.filter((f) => {
    if (f.tab !== tab) return false
    if (f.budgetSubTab && f.budgetSubTab !== budgetSubTab) return false
    return true
  })

  if (visible.length === 0) return null

  function memberSelectOptionsForField(field: ProjectFormField, selectedIds: string[]) {
    const eligible = memberOptions.filter((m) =>
      memberMatchesProjectFormRoleFilter(m.role, field.roleFilter),
    )
    const eligibleIds = new Set(eligible.map((m) => m.id))
    const preserved = memberOptions.filter((m) => selectedIds.includes(m.id) && !eligibleIds.has(m.id))
    return memberOptionsToSelect([...eligible, ...preserved])
  }

  return (
    <div className={FORM_STACK}>
      {visible.map((field) => {
        const key = field.key as keyof AddProjectRelationFields

        if (field.type === "multiselect" && field.optionsSource === "clients") {
          const clientSelectOptions = clientOptions.map((c) => ({ value: c.id, label: c.label }))
          return (
            <FormField
              key={field.key}
              label={field.label}
              hint={clientSelectOptions.length === 0 ? "No clients yet" : undefined}
            >
              <MultiSelectField
                placeholder={
                  clientSelectOptions.length === 0
                    ? "No clients available"
                    : (field.placeholder ?? "Select clients")
                }
                options={clientSelectOptions}
                selected={values.clientIds}
                onChange={(next) => onChange("clientIds", next)}
                visibleOptionRows={3}
              />
              <div className="mt-1.5">
                <QuickAddClientPopover
                  onAdded={(clientId) => onClientAdded?.(clientId)}
                />
              </div>
            </FormField>
          )
        }

        if (field.type === "multiselect" && field.optionsSource === "teams") {
          return (
            <FormField key={field.key} label={field.label}>
              {teamsLoading ? (
                <Skeleton
                  className={cn(
                    "h-10 w-full rounded-lg",
                    theme.isDark ? "bg-[#2e3447]" : "bg-slate-200",
                  )}
                  aria-hidden
                />
              ) : teamsLoadError ? (
                <p className="text-sm text-red-500">{teamsLoadError}</p>
              ) : (
                <MultiSelectField
                  placeholder={
                    availableTeams.length === 0
                      ? "No teams available"
                      : (field.placeholder ?? "Select teams")
                  }
                  options={availableTeams.map((team) => ({ label: team.name, value: team.id }))}
                  selected={values.teams}
                  onChange={(next) => onChange("teams", next)}
                />
              )}
            </FormField>
          )
        }

        if (field.type === "multiselect" && field.optionsSource === "members") {
          const selected = values[key] as string[]
          return (
            <FormField key={field.key} label={field.label} hint={field.helper}>
              <MultiSelectField
                placeholder={field.placeholder ?? "Select members"}
                options={memberSelectOptionsForField(field, selected)}
                selected={selected}
                onChange={(next) => onChange(key, next)}
              />
            </FormField>
          )
        }

        return null
      })}
    </div>
  )
}
