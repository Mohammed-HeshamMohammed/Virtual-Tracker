"use client"

import { useState } from "react"
import { ChevronDown, Check, CircleDashed, Copy, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FORM_GRID, useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { DatePickerField } from "@/shared/ui/forms/date-picker-field"
import { ExpandCollapse } from "@/shared/ui/motion/expand-collapse"
import { FormField } from "@/shared/ui/forms/form-field"
import { SelectField } from "@/shared/ui/forms/select-field"
import type { ProjectMemberLimitEntry } from "@/features/projects/api/project-details-api"

export type MemberOwnLimit = { daily: number; weekly: number }

const LIMIT_TYPES = ["Total cost", "Hours limit", "Amount limit"]
const RATE_OPTIONS = ["Bill rate", "Pay rate"]
const RESET_OPTIONS = ["Never", "Weekly", "Monthly"]

/** "Hours limit" is denominated in time; the other two are money. The backend
 * converts them differently (see loadProjectMemberLimitRemainderSeconds), so
 * the field must not label an hours cap with a "$". */
export function isHoursLimit(type: string): boolean {
  return type.toLowerCase().includes("hour")
}

/** A row only reaches the server once it has the fields the API requires -
 * syncProjectMemberLimits silently drops anything short of this, so the list
 * has to show which members are actually configured. */
export function isLimitComplete(row: ProjectMemberLimitEntry): boolean {
  return Boolean(row.type.trim() && row.basedOn.trim() && Number(row.cost) > 0)
}

function ownLimitLabel(own: MemberOwnLimit | undefined): string {
  if (!own || (own.daily <= 0 && own.weekly <= 0)) return "No personal cap set"
  return [own.daily > 0 ? `${own.daily}h/day` : null, own.weekly > 0 ? `${own.weekly}h/week` : null]
    .filter(Boolean)
    .join(" · ")
}

function summarize(row: ProjectMemberLimitEntry): string {
  if (!isLimitComplete(row)) return "No limit set"
  const amount = isHoursLimit(row.type) ? `${row.cost}h` : `$${row.cost}`
  const resets = row.resets && row.resets !== "Never" ? `, ${row.resets.toLowerCase()}` : ""
  return `${amount} · ${row.basedOn}${resets}`
}

interface MemberLimitsEditorProps {
  memberIds: string[]
  rows: Record<string, ProjectMemberLimitEntry>
  ownLimits: Record<string, MemberOwnLimit>
  memberLabels: Record<string, string>
  onChange: (memberId: string, patch: Partial<ProjectMemberLimitEntry>) => void
  onRemove: (memberId: string) => void
  onCopyToAll: (memberId: string) => void
}

/**
 * One member's limit at a time. The previous version rendered every selected
 * member as a full-size card stacked vertically, so picking six members meant
 * six identical five-field forms with nothing to tell them apart - unusable
 * for setting a limit "for each member alone". This is the same data as an
 * accordion: collapsed rows summarize each member's limit at a glance, and
 * exactly one is open for editing.
 */
export function MemberLimitsEditor({
  memberIds,
  rows,
  ownLimits,
  memberLabels,
  onChange,
  onRemove,
  onCopyToAll,
}: MemberLimitsEditorProps) {
  const theme = useClientFormTheme()
  // Opening the first unconfigured member on mount would fight the user's own
  // clicks as they fill rows in; start collapsed and let them choose.
  const [openId, setOpenId] = useState<string | null>(null)

  if (memberIds.length === 0) {
    return (
      <div className={cn("rounded-xl border px-4 py-5 text-center", theme.card)}>
        <p className={cn("text-sm", theme.mutedText)}>
          Pick members above, then set a limit for each one individually.
        </p>
      </div>
    )
  }

  const configuredCount = memberIds.filter((id) => rows[id] && isLimitComplete(rows[id]!)).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-medium", theme.mutedText)}>
          {configuredCount} of {memberIds.length} member{memberIds.length === 1 ? "" : "s"} configured
        </span>
        {configuredCount < memberIds.length ? (
          <span className={cn("text-xs", theme.hint)}>Members without a limit are simply not capped.</span>
        ) : null}
      </div>

      <div className={cn("divide-y overflow-hidden rounded-xl border", theme.card, theme.isDark ? "divide-[#2e3447]" : "divide-slate-200")}>
        {memberIds.map((memberId) => {
          const row = rows[memberId] ?? {
            memberId,
            type: "",
            basedOn: "",
            cost: "",
            resets: "Never",
            startDate: "",
          }
          const isOpen = openId === memberId
          const complete = isLimitComplete(row)
          const hours = isHoursLimit(row.type)

          return (
            <div key={memberId}>
              <div className="flex w-full items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : memberId)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      complete
                        ? theme.isDark
                          ? "bg-[#4be277]/15 text-[#4be277]"
                          : "bg-emerald-50 text-emerald-600"
                        : theme.isDark
                          ? "bg-[#2e3447] text-[#bccbb9]"
                          : "bg-slate-100 text-slate-400",
                    )}
                  >
                    {complete ? <Check className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", theme.modal.title)}>
                      {memberLabels[memberId] ?? "Member"}
                    </span>
                    <span className={cn("block truncate text-xs", theme.mutedText)}>
                      {summarize(row)} · own: {ownLimitLabel(ownLimits[memberId])}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform",
                      theme.mutedText,
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(memberId)}
                  title="Remove this member's limit"
                  aria-label={`Remove limit for ${memberLabels[memberId] ?? "member"}`}
                  className={cn(
                    "shrink-0 rounded-md p-1 transition-colors",
                    theme.isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-100",
                  )}
                >
                  <X className={cn("h-3.5 w-3.5", theme.mutedText)} />
                </button>
              </div>

              <ExpandCollapse show={isOpen}>
                <div className={cn("border-t px-4 py-4", theme.isDark ? "border-[#2e3447]" : "border-slate-200")}>
                  <p className={cn("mb-3 text-xs", theme.hint)}>
                    Their own cap is {ownLimitLabel(ownLimits[memberId])}. A limit here only tightens
                    that on this project — it can never raise it.
                  </p>
                  <div className={FORM_GRID}>
                    <FormField label="Type" required>
                      <SelectField
                        value={row.type}
                        onChange={(value) => onChange(memberId, { type: value })}
                        options={[
                          { value: "", label: "Select a type" },
                          ...LIMIT_TYPES.map((t) => ({ value: t, label: t })),
                        ]}
                      />
                    </FormField>
                    <FormField label="Based on" required>
                      <SelectField
                        value={row.basedOn}
                        onChange={(value) => onChange(memberId, { basedOn: value })}
                        options={[
                          { value: "", label: "Select a rate" },
                          ...RATE_OPTIONS.map((r) => ({ value: r, label: r })),
                        ]}
                      />
                    </FormField>
                    <FormField
                      label={hours ? "Hours" : "Amount"}
                      required
                      className="sm:col-span-2"
                    >
                      <div className="relative">
                        <span
                          className={cn(
                            "absolute left-3 top-1/2 -translate-y-1/2 text-sm",
                            theme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                          )}
                        >
                          {hours ? "h" : "$"}
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={row.cost}
                          placeholder={hours ? "e.g. 20" : "e.g. 500"}
                          onChange={(e) => onChange(memberId, { cost: e.target.value })}
                          className={cn(theme.control, "pl-7")}
                        />
                      </div>
                    </FormField>
                    <FormField label="Resets" required>
                      <SelectField
                        value={row.resets}
                        onChange={(value) => onChange(memberId, { resets: value })}
                        options={RESET_OPTIONS.map((r) => ({ value: r, label: r }))}
                      />
                    </FormField>
                    <FormField label="Start date">
                      <DatePickerField
                        value={row.startDate}
                        onChange={(date) => onChange(memberId, { startDate: date })}
                        placeholder="Select date"
                      />
                    </FormField>
                  </div>

                  {/* Filling five fields per member by hand does not scale
                      past a few people. Only offered once this row is
                      actually complete - copying a half-filled row would
                      spread the same gap everywhere. */}
                  {memberIds.length > 1 ? (
                    <div className="mt-3 flex items-center justify-end">
                      <button
                        type="button"
                        disabled={!complete}
                        onClick={() => onCopyToAll(memberId)}
                        title={
                          complete
                            ? `Give the other ${memberIds.length - 1} member${memberIds.length === 2 ? "" : "s"} these same values, replacing anything already set for them`
                            : "Fill in this member's limit first"
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                          complete
                            ? theme.isDark
                              ? "text-[#4be277] hover:bg-[#4be277]/10"
                              : "text-emerald-700 hover:bg-emerald-50"
                            : cn(theme.mutedText, "cursor-not-allowed opacity-50"),
                        )}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Apply to the other {memberIds.length - 1} member
                        {memberIds.length === 2 ? "" : "s"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </ExpandCollapse>
            </div>
          )
        })}
      </div>
    </div>
  )
}
