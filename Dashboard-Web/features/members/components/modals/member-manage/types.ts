import type { RefObject } from "react"
import type { PhoneVerifyControlHandle } from "@/shared/ui/phone-verify-control"
import type { Member, MemberEntryAction, MemberPatchBody, MemberManageTab, MemberRole } from "@/features/members/models/member"

export interface MemberManageModalProps {
  open: boolean
  openEntry: MemberEntryAction
  member: Member
  onClose: () => void
  onPatchMember: (id: string, body: MemberPatchBody) => Promise<Member | undefined>
  onSaveProfile?: (
    id: string,
    payload: import("@/features/members/api/member-api").MemberProfilePayload,
    expectedUpdatedAt?: string,
  ) => Promise<Member>
  onRemoveMember: (id: string) => void | Promise<void>
  onNavigate?: (id: string) => void
  allowedTabs?: MemberManageTab[]
  canSave?: boolean
  actorRole?: string
  /** Employee L2 and below managing their own profile — info + reset password only. */
  limitedSelfManage?: boolean
}

export interface TabProps {
  member: Member
  state: MemberFormState
  setState: React.Dispatch<React.SetStateAction<MemberFormState>>
  onNavigate?: (id: string) => void
  onClose?: () => void
  actorRole?: string | { assignableRoles: MemberRole[] }
  /** True when the signed-in user is editing their own member record. */
  isSelfEdit?: boolean
  phoneVerifyRef?: RefObject<PhoneVerifyControlHandle | null>
}

export interface MemberFormState {
  editFirst: string
  editLast: string
  editEmail: string
  editPersonalEmail: string
  editPhone: string
  phoneVerified: boolean
  phoneVerificationToken: string
  employeeId: string
  role: Member["role"]
  payRate: string
  weeklyLimit: string
  paySegment: "pay" | "bill"
  payPeriod: string
  ableToTrack: boolean
  idleMode: "Prompt" | "Always" | "Never"
  idleTimeout: string
  manualTime: string
  requireApproval: boolean
  manageEmployeeTeams: boolean
  lastIp: string
  empJobTitle: string
  empDepartment: string
  empJobType: string
  empWorkAddress: string
  empMailing: boolean
  empEmploymentType: string
  empEmployedThrough: string
  empWorkplace: string
  empOfficePct: string
  empRemotePct: string
  empTaxInfo: string
  empAccountCode: string
  empTaxType: string
  empStartDate: string
  empEndDate: string
  empTermination: string
  empComments: string
  disableTrackingSpecificDays: boolean
  useShiftsForLimits: boolean
  workDays: number[]
  dailyLimit: string
  /** Optimistic-concurrency tokens (§6.9) - sent back unchanged on save.
   * See MemberProfileForm in member-api.ts for what each is checked
   * against. */
  infoUpdatedAt?: string
  employmentUpdatedAt?: string
  rolesUpdatedAt?: string
  payBillUpdatedAt?: string
  workLimitsUpdatedAt?: string
  settingsUpdatedAt?: string
}

/** Keep controlled inputs on stable string values (never null/undefined). */
export function normalizeMemberFormState(state: MemberFormState): MemberFormState {
  const workDays = Array.isArray(state.workDays)
    ? state.workDays.filter((d): d is number => Number.isInteger(d))
    : [0, 1, 2, 3, 4]

  return {
    ...state,
    role: (typeof state.role === "string" ? state.role : "Viewer") as MemberFormState["role"],
    payRate: state.payRate == null ? "" : String(state.payRate),
    payPeriod: state.payPeriod || "None",
    weeklyLimit: state.weeklyLimit ?? "",
    dailyLimit: state.dailyLimit ?? "",
    workDays: workDays.length > 0 ? workDays : [0, 1, 2, 3, 4],
  }
}

export const initialFormState: MemberFormState = {
  editFirst: "",
  editLast: "",
  editEmail: "",
  editPersonalEmail: "",
  editPhone: "",
  phoneVerified: false,
  phoneVerificationToken: "",
  employeeId: "",
  role: "Viewer",
  payRate: "",
  weeklyLimit: "",
  paySegment: "pay",
  payPeriod: "None",
  ableToTrack: true,
  idleMode: "Never",
  idleTimeout: "5 min",
  manualTime: "Off",
  requireApproval: false,
  manageEmployeeTeams: false,
  lastIp: "",
  empJobTitle: "",
  empDepartment: "",
  empJobType: "",
  empWorkAddress: "",
  empMailing: false,
  empEmploymentType: "",
  empEmployedThrough: "",
  empWorkplace: "",
  empOfficePct: "",
  empRemotePct: "",
  empTaxInfo: "",
  empAccountCode: "",
  empTaxType: "",
  empStartDate: "",
  empEndDate: "",
  empTermination: "",
  empComments: "",
  disableTrackingSpecificDays: false,
  useShiftsForLimits: false,
  workDays: [0, 1, 2, 3, 4],
  dailyLimit: "",
}