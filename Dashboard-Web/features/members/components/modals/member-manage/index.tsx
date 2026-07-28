/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps */
"use client"

import { useEffect, useMemo, useRef, useState as useComponentState } from "react"
import { useAuth } from "@/shared/providers/app"
import { isSameMember } from "@/features/members/utils/member-utils"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronLeft } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { getMemberProfile, type MemberProfilePayload } from "@/features/members/api/member-api"
import {
  fetchMemberProfileSectionCached,
  isMemberProfileSectionFresh,
  isMemberProfileSectionLoaded,
  peekMemberProfileCache,
} from "@/features/members/services/member-profile-cache"
import { MANAGE_MODAL_TABS } from "@/features/members/config/members-config"
import type { Member, MemberEntryAction, MemberManageTab } from "@/features/members/models/member"
import { memberEntryToTab, splitMemberDisplayName, parseUsdHrPayment, weeklyLimitInputFromStored } from "@/features/members/utils/member-utils"
import { validateMemberFormStateForTabs } from "@/shared/validation/member-form"
import { listAssignableRoles } from "@/features/auth/permissions/role-hierarchy"
import { Avatar } from "@/shared/ui/avatar";
import { InfoTab, EmploymentTab, RolesTab, PayBillTab, WorkLimitsTab, SettingsTab } from "@/features/members/components/modals/member-manage/tabs"
import { MemberManageModalSkeleton } from "@/features/members/components/modals/member-manage/member-manage-modal-skeleton"
import type { MemberManageModalProps, MemberFormState } from "@/features/members/components/modals/member-manage/types"
import { initialFormState, normalizeMemberFormState } from "@/features/members/components/modals/member-manage/types"
import type { PhoneVerifyControlHandle } from "@/shared/ui/phone-verify-control"

function buildProfilePayload(
  formState: MemberFormState,
  tabsToSave: MemberManageTab[],
  options: { isSelfEdit?: boolean } = {},
): MemberProfilePayload {
  const allow = new Set(tabsToSave)
  const payload: MemberProfilePayload = {}
  const isSelfEdit = options.isSelfEdit === true

  if (allow.has("info")) {
    payload.info = {
      editFirst: formState.editFirst,
      editLast: formState.editLast,
      editEmail: formState.editEmail,
      editPersonalEmail: formState.editPersonalEmail,
      editPhone: formState.editPhone,
      ...(isSelfEdit && formState.phoneVerificationToken
        ? { phoneVerificationToken: formState.phoneVerificationToken }
        : {}),
      employeeId: formState.employeeId,
    }
  }
  if (allow.has("employment")) {
    payload.employment = {
      empJobTitle: formState.empJobTitle,
      empDepartment: formState.empDepartment,
      empJobType: formState.empJobType,
      empWorkAddress: formState.empWorkAddress,
      empMailing: formState.empMailing,
      empEmploymentType: formState.empEmploymentType,
      empEmployedThrough: formState.empEmployedThrough,
      empWorkplace: formState.empWorkplace,
      empOfficePct: formState.empOfficePct,
      empRemotePct: formState.empRemotePct,
      empTaxInfo: formState.empTaxInfo,
      empAccountCode: formState.empAccountCode,
      empTaxType: formState.empTaxType,
      empStartDate: formState.empStartDate,
      empEndDate: formState.empEndDate,
      empTermination: formState.empTermination,
      empComments: formState.empComments,
    }
  }
  if (allow.has("roles")) {
    payload.roles = { role: formState.role }
  }
  if (allow.has("payBill")) {
    payload.payBill = {
      paySegment: formState.paySegment,
      payRate: formState.payRate,
      payPeriod: formState.payPeriod,
    }
  }
  if (allow.has("workLimits")) {
    payload.workLimits = {
      weeklyLimit: formState.weeklyLimit,
      dailyLimit: formState.dailyLimit,
      disableTrackingSpecificDays: formState.disableTrackingSpecificDays,
      workDays: formState.workDays,
      ...(formState.useShiftsForLimits ? { useShiftsForLimits: true } : {}),
    }
  }
  if (allow.has("settings")) {
    payload.settings = {
      ableToTrack: formState.ableToTrack,
      idleMode: formState.idleMode,
      idleTimeout: formState.idleTimeout,
      manualTime: formState.manualTime,
      requireApproval: formState.requireApproval,
      manageEmployeeTeams: formState.manageEmployeeTeams,
    }
  }

  return payload
}

function mergeProfileForm(base: MemberFormState, profile?: Partial<MemberFormState>): MemberFormState {
  if (!profile) return normalizeMemberFormState(base)
  const defined = Object.fromEntries(
    Object.entries(profile).filter((entry): entry is [string, MemberFormState[keyof MemberFormState]] => entry[1] !== undefined),
  ) as Partial<MemberFormState>
  return normalizeMemberFormState({ ...base, ...defined })
}

function buildFormFromProfileResponse(
  form: Partial<MemberFormState>,
  loadedMember: Member,
  currentMember: Member,
  currentOpenEntry: MemberEntryAction | null,
  prevRole: Member["role"],
  fallbackRole: Member["role"],
): Partial<MemberFormState> {
  const { firstName: fName, lastName: lName } = splitMemberDisplayName(currentMember.name)
  return {
    ...form,
    editFirst: form.editFirst ?? fName,
    editLast: form.editLast ?? lName,
    editEmail: form.editEmail ?? loadedMember.email ?? currentMember.email,
    editPersonalEmail: form.editPersonalEmail ?? loadedMember.personalEmail ?? "",
    editPhone: form.editPhone ?? loadedMember.phone ?? currentMember.phone ?? "",
    phoneVerified: form.phoneVerified ?? loadedMember.phoneVerified ?? currentMember.phoneVerified ?? false,
    phoneVerificationToken: form.phoneVerificationToken ?? "",
    role: prevRole !== fallbackRole ? prevRole : ((form.role as Member["role"]) ?? loadedMember.role ?? currentMember.role),
    payRate: String(form.payRate ?? parseUsdHrPayment(loadedMember.payment || currentMember.payment) ?? ""),
    weeklyLimit:
      form.weeklyLimit ??
      weeklyLimitInputFromStored(loadedMember.weeklyLimit || loadedMember.limits || currentMember.limits),
    ableToTrack:
      form.ableToTrack ??
      (currentOpenEntry === "disable-tracking" ? false : loadedMember.trackingStatus !== "offline"),
    manageEmployeeTeams:
      form.manageEmployeeTeams ?? loadedMember.privileges?.manage_employee_teams === true,
    lastIp: form.lastIp ?? loadedMember.lastIp ?? currentMember.lastIp ?? "",
  }
}

export function MemberManageModal({
  open,
  openEntry,
  member,
  onClose,
  onPatchMember,
  onSaveProfile,
  onRemoveMember,
  onNavigate,
  allowedTabs,
  canSave = true,
  actorRole = "",
  limitedSelfManage = false,
}: MemberManageModalProps) {
  const { memberId: actorMemberId, user } = useAuth()
  const isSelfEdit = isSameMember(member, actorMemberId, user?.uid, user?.email ?? undefined)
  const assignableRoles = useMemo(() => listAssignableRoles(actorRole), [actorRole])
  const actorRoleContext = useMemo(() => ({ assignableRoles }), [assignableRoles])
  const [activeTab, setActiveTab] = useComponentState<MemberManageTab>("info")
  const [busy, setBusy] = useComponentState(false)
  const [loadingTabs, setLoadingTabs] = useComponentState<Set<MemberManageTab>>(() => new Set())
  const [loadedTabs, setLoadedTabs] = useComponentState<Set<MemberManageTab>>(() => new Set())
  const [failedTabs, setFailedTabs] = useComponentState<Set<MemberManageTab>>(() => new Set())
  const [saveError, setSaveError] = useComponentState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useComponentState(false)
  const [formState, setFormState] = useComponentState<MemberFormState>(initialFormState)
  const phoneVerifyRef = useRef<PhoneVerifyControlHandle>(null)

  const visibleTabs = useMemo(
    () =>
      allowedTabs && allowedTabs.length > 0
        ? MANAGE_MODAL_TABS.filter((t) => allowedTabs.includes(t.id))
        : MANAGE_MODAL_TABS,
    [allowedTabs],
  )

  const activeTabReady =
    loadedTabs.has(activeTab) ||
    isMemberProfileSectionLoaded(member.id, activeTab)
  const showProfileSkeleton = loadingTabs.has(activeTab) && !activeTabReady
  const canSaveProfile = canSave && !failedTabs.has(activeTab) && activeTabReady

  const [prevId, setPrevId] = useComponentState<string | null>(null)
  const [prevOpen, setPrevOpen] = useComponentState(false)
  const [prevOpenEntry, setPrevOpenEntry] = useComponentState<MemberEntryAction | null>(null)
  // If the exit animation's deferred unmount ever stalls, this invisible fixed-inset-0
  // backdrop would keep intercepting every click/hover on the dashboard underneath it.
  const [isClosing, setIsClosing] = useComponentState(false)
  const handleClose = () => {
    setIsClosing(true)
    onClose()
  }

  const { firstName, lastName } = splitMemberDisplayName(member.name)
  const fallback = useMemo<MemberFormState>(() => ({
    ...initialFormState,
    editFirst: firstName,
    editLast: lastName,
    editEmail: member.email,
    editPersonalEmail: member.personalEmail ?? "",
    editPhone: member.phone ?? "",
    phoneVerified: member.phoneVerified === true,
    phoneVerificationToken: "",
    role: member.role,
    payRate: parseUsdHrPayment(member.payment),
    weeklyLimit: weeklyLimitInputFromStored(member.weeklyLimit || member.limits),
    ableToTrack: openEntry === "disable-tracking" ? false : member.trackingStatus !== "offline",
    lastIp: member.lastIp ?? "",
  }), [firstName, lastName, member.email, member.personalEmail, member.phone, member.role, member.payment, member.weeklyLimit, member.limits, openEntry, member.trackingStatus, member.lastIp])

  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback
  const memberRef = useRef(member)
  memberRef.current = member
  const openEntryRef = useRef(openEntry)
  openEntryRef.current = openEntry

  if (open !== prevOpen || member.id !== prevId || openEntry !== prevOpenEntry) {
    setPrevOpen(open)
    setPrevId(member.id)
    setPrevOpenEntry(openEntry)
    if (open) {
      setIsClosing(false)
      setSaveError(null)
      const wantedTab = memberEntryToTab(openEntry)
      const canShowWanted = visibleTabs.some((t) => t.id === wantedTab)
      setActiveTab(canShowWanted ? wantedTab : (visibleTabs[0]?.id ?? "info"))
      setRemoveConfirm(openEntry === "remove-member")
      setFailedTabs(new Set())
      setLoadingTabs(new Set())
      setLoadedTabs(new Set())

      const cached = peekMemberProfileCache(member.id)
      if (cached) {
        setFormState(
          mergeProfileForm(normalizeMemberFormState(fallback), {
            ...buildFormFromProfileResponse(
              cached.form as Partial<MemberFormState>,
              cached.member,
              member,
              openEntry,
              fallback.role,
              fallback.role,
            ),
          }),
        )
        setLoadedTabs(new Set(cached.loadedSections))
      } else {
        setFormState(normalizeMemberFormState(fallback))
      }
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const tab = activeTab
    const cacheFresh = isMemberProfileSectionFresh(member.id, tab)
    const cached = peekMemberProfileCache(member.id)

    if (cacheFresh && cached?.loadedSections.includes(tab)) {
      setLoadedTabs((prev) => new Set([...prev, tab]))
      setFormState((prev) =>
        mergeProfileForm(prev, {
          ...buildFormFromProfileResponse(
            cached.form as Partial<MemberFormState>,
            cached.member,
            memberRef.current,
            openEntryRef.current,
            prev.role,
            fallbackRef.current.role,
          ),
        }),
      )
      return
    }

    setLoadingTabs((prev) => new Set(prev).add(tab))

    void fetchMemberProfileSectionCached(
      member.id,
      tab,
      () => getMemberProfile(member.id, [tab]),
      { force: !cacheFresh },
    )
      .then(({ form, member: loadedMember }) => {
        if (cancelled) return
        const currentMember = memberRef.current
        const currentOpenEntry = openEntryRef.current
        setFormState((prev) =>
          mergeProfileForm(prev, {
            ...buildFormFromProfileResponse(
              form as Partial<MemberFormState>,
              loadedMember,
              currentMember,
              currentOpenEntry,
              prev.role,
              fallbackRef.current.role,
            ),
          }),
        )
        setFailedTabs((prev) => {
          const next = new Set(prev)
          next.delete(tab)
          return next
        })
        setLoadedTabs((prev) => new Set([...prev, tab]))
      })
      .catch(() => {
        if (cancelled) return
        setFailedTabs((prev) => new Set(prev).add(tab))
        setSaveError("Could not load this tab from the server. Try switching tabs or reopen this dialog.")
      })
      .finally(() => {
        if (cancelled) return
        setLoadingTabs((prev) => {
          const next = new Set(prev)
          next.delete(tab)
          return next
        })
      })

    return () => {
      cancelled = true
    }
  }, [open, member.id, activeTab])

  const saveValidationError = useMemo(
    () => validateMemberFormStateForTabs([activeTab], formState, { memberRole: member.role, isSelfEdit }),
    [activeTab, formState, member.role, isSelfEdit],
  )

  async function handleSave() {
    if (!canSaveProfile) {
      setSaveError(
        failedTabs.has(activeTab)
          ? "Could not load this tab from the server. Switch tabs or close and reopen this dialog."
          : "Still loading this tab. Wait a moment and try again.",
      )
      return
    }

    let workingState = formState
    if (isSelfEdit && activeTab === "info" && phoneVerifyRef.current?.requiresVerification()) {
      try {
        const token = await phoneVerifyRef.current.confirmPendingVerification()
        if (token) {
          workingState = { ...formState, phoneVerificationToken: token, phoneVerified: true }
          setFormState(workingState)
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Phone verification failed.")
        return
      }
      if (workingState.editPhone.trim() && !workingState.phoneVerificationToken.trim()) {
        setSaveError("Send a verification code, enter it, then click Save changes.")
        return
      }
    }

    const saveValidationError = validateMemberFormStateForTabs([activeTab], workingState, { memberRole: member.role, isSelfEdit })
    if (saveValidationError) {
      setSaveError(saveValidationError)
      return
    }
    const payload = buildProfilePayload(workingState, [activeTab], { isSelfEdit })
    if (Object.keys(payload).length === 0) {
      setSaveError("Nothing to save on this tab.")
      return
    }

    setBusy(true)
    setSaveError(null)
    try {
      if (onSaveProfile) {
        await onSaveProfile(member.id, payload)
      } else {
        await onPatchMember(member.id, {
          name: [formState.editFirst, formState.editLast].filter(Boolean).join(" ").trim() || undefined,
          email: formState.editEmail.trim() || undefined,
          payRate: Number.isFinite(Number(formState.payRate)) ? Number(formState.payRate) : undefined,
          weeklyLimit: formState.weeklyLimit.trim() ? formState.weeklyLimit : "No limit",
          role: formState.role,
          trackingStatus: formState.ableToTrack ? "online" : "offline",
        })
      }
      handleClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await Promise.resolve(onRemoveMember(member.id))
      handleClose()
    } finally {
      setBusy(false)
    }
  }

  const tabProps = {
    member,
    state: formState,
    setState: setFormState,
    onNavigate,
    onClose,
    actorRole: actorRoleContext,
    isSelfEdit,
    phoneVerifyRef,
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            "fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-3 sm:p-6",
            isClosing && "pointer-events-none",
          )}
          onClick={() => !busy && handleClose()}
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-h-[min(90vh,52rem)] w-full max-w-208 flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <button type="button" onClick={() => !busy && handleClose()} className="flex shrink-0 items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100">
                  <ChevronLeft className="h-4 w-4" />
                  Members
                </button>
                <span className="hidden text-slate-300 dark:text-slate-700 sm:inline">/</span>
                <h1 className="truncate text-base font-bold text-slate-900 dark:text-slate-100 sm:text-lg">{member.name}</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !canSaveProfile || !!saveValidationError}
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-blue-500 dark:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 dark:hover:bg-emerald-500 disabled:opacity-60"
                >
                  {busy ? "Saving…" : !canSaveProfile && showProfileSkeleton ? "Loading…" : "Save changes"}
                </button>
              </div>
            </motion.div>

            <div className="shrink-0 overflow-x-auto border-b border-slate-200 dark:border-slate-800 px-4">
              <motion.div className="flex min-w-max gap-1">
                {visibleTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      "border-b-2 px-3 py-3 text-xs font-semibold tracking-wide transition-colors sm:px-4 sm:text-sm",
                      activeTab === t.id ? "border-blue-500 dark:border-emerald-500 text-blue-600 dark:text-emerald-400" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </motion.div>
            </div>

            <div className="flex shrink-0 items-center gap-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40 px-5 py-3.5">
              <Avatar initials={member.avatar} color={member.avatarColor} imageUrl={member.avatarUrl} alt={member.name} size="lg" />
              <motion.div className="hidden h-10 w-px shrink-0 bg-slate-200 dark:bg-slate-700 sm:block" aria-hidden />
              <div className="min-w-0 flex-1 text-sm leading-snug">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {splitMemberDisplayName(member.name).firstName.trim() || member.name.trim().split(/\s+/)[0] || "—"}
                </span>
                <span className="text-slate-400 dark:text-slate-500"> , </span>
                <span className="break-all text-slate-600 dark:text-slate-300">{member.email}</span>
              </div>
            </div>

            <div className="h-120 overflow-y-auto px-5 py-5 sm:px-6 [&::-webkit-scrollbar]:hidden" style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}>
              {saveError && <div className="mb-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/60 px-3 py-2 text-sm text-red-800 dark:text-red-300">{saveError}</div>}
              {showProfileSkeleton ? (
                <MemberManageModalSkeleton activeTab={activeTab} />
              ) : (
              <AnimatePresence mode="wait">
                  {activeTab === "info" && (
                    <motion.div key="info" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                      <InfoTab {...tabProps} />
                    </motion.div>
                  )}
                  {activeTab === "employment" && (
                    <motion.div key="employment" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                      <EmploymentTab {...tabProps} />
                    </motion.div>
                  )}
                  {activeTab === "roles" && (
                    <motion.div key="roles" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                      <RolesTab {...tabProps} />
                    </motion.div>
                  )}
                  {activeTab === "payBill" && (
                    <motion.div key="payBill" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                      <PayBillTab {...tabProps} />
                    </motion.div>
                  )}
                  {activeTab === "workLimits" && (
                    <motion.div key="workLimits" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                      <WorkLimitsTab {...tabProps} />
                    </motion.div>
                  )}
                  {activeTab === "settings" && (
                    <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                      <SettingsTab
                        {...tabProps}
                        removeConfirm={removeConfirm}
                        setRemoveConfirm={setRemoveConfirm}
                        busy={busy}
                        onRemove={handleRemove}
                        limitedSelfManage={limitedSelfManage}
                      />
                    </motion.div>
                  )}
              </AnimatePresence>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export type { MemberManageModalProps }
