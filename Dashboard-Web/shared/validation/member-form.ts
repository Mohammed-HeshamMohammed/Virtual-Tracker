import type { MemberFormState } from "@/features/members/components/modals/member-manage/types"
import type { MemberManageTab } from "@/features/members/models/member"
import { validateOwnerRoleChange } from "@/features/auth/permissions/role-hierarchy"
import {
  firstValidationError,
  parseNonNegativeNumber,
  parsePercentage,
  validateEmailField,
  validateNamePart,
  validatePayRate,
  validatePhoneField,
} from "@/shared/validation"
import { validateWorkLimitsMutualExclusion } from "@/shared/validation/work-limits"

export type MemberFormValidationContext = {
  /** Canonical role from the member record (not the in-form draft). */
  memberRole?: string
  /** True when the signed-in user is editing their own member record. */
  isSelfEdit?: boolean
}

export function validateMemberFormState(state: MemberFormState): string | null {
  return validateMemberFormStateForTabs(
    ["info", "employment", "roles", "payBill", "workLimits", "settings"],
    state,
  )
}

/** Validates only the member-manage tabs included in a save request. */
export function validateMemberFormStateForTabs(
  tabs: MemberManageTab[],
  state: MemberFormState,
  context: MemberFormValidationContext = {},
): string | null {
  const allow = new Set(tabs)
  const memberRole = context.memberRole ?? state.role
  const isSelfEdit = context.isSelfEdit === true
  return firstValidationError(
    allow.has("info") ? validateEmailField(state.editEmail, { label: "Work email" }) : null,
    allow.has("info")
      ? firstValidationError(
          validateNamePart(state.editFirst, "First name"),
          validateNamePart(state.editLast, "Last name"),
        )
      : null,
    allow.has("info") && state.editPersonalEmail.trim()
      ? validateEmailField(state.editPersonalEmail, { label: "Personal email" })
      : null,
    allow.has("info") && state.editPhone.trim()
      ? validatePhoneField(state.editPhone, { label: "Phone number" })
      : null,
    allow.has("payBill") ? validatePayRate(state.payRate) : null,
    allow.has("employment") && state.empOfficePct.trim() && parsePercentage(state.empOfficePct) === null
      ? "Office percentage must be between 0 and 100."
      : null,
    allow.has("employment") && state.empRemotePct.trim() && parsePercentage(state.empRemotePct) === null
      ? "Remote percentage must be between 0 and 100."
      : null,
    allow.has("settings") && state.idleTimeout.trim() && parseNonNegativeNumber(state.idleTimeout) === null
      ? "Idle timeout must be a valid number."
      : null,
    allow.has("roles") && !state.role?.trim() ? "Role is required." : null,
    allow.has("roles") ? validateOwnerRoleChange(memberRole, state.role) : null,
    allow.has("workLimits")
      ? validateWorkLimitsMutualExclusion(
          state.weeklyLimit,
          state.dailyLimit,
          state.useShiftsForLimits,
        )
      : null,
  )
}
