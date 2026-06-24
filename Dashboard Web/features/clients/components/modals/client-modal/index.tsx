/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/js-combine-iterations, react-doctor/no-derived-state */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useEffect, useMemo, useState as useComponentState, type ComponentProps } from "react"
import { motion, AnimatePresence, LayoutGroup, MotionConfig } from "framer-motion"
import {
  X,
  ChevronDown,
  ChevronUp,
  MapPin,
  Phone,
  Building2,
  FolderOpen,
  DollarSign,
  FileText,
  UserPlus,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { getClientFormConfig } from "@/features/clients/api/client-form-api"
import type { Member } from "@/features/members/models/member"
import { getMemberContactFromFieldData, memberDetailsFromRecord } from "@/features/clients/utils/member-contact"
import { BUDGET_BASES, BUDGET_RESETS, BUDGET_TYPES, MODAL_TABS, type ModalTab } from "@/features/projects/constants"
import { type ClientFormData } from "@/features/clients/models/client"
import type { Client as ApiClient } from "@/features/clients/api/client-api"
import { clientFormFromApi, emptyClient } from "@/features/clients/utils"
import { validateClientForm } from "@/shared/validation/client-form"
import { FORM_FIELD, FORM_GRID, FORM_STACK, useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { FormField } from "@/shared/ui/forms/form-field";
import { Input } from "@/shared/ui/forms/input";
import { PreviewField } from "@/shared/ui/forms/preview-field";
import { SelectField } from "@/shared/ui/forms/select-field";
import { Toggle } from "@/shared/ui/forms/toggle";
import { ClientMemberSelector } from "@/features/clients/selectors/client-member-selector"
import { LineItemsDropdown } from "@/features/clients/selectors/line-items-dropdown"
import { ProjectsSelector, type ProjectOption } from "@/features/clients/selectors/projects-selector"
import {
  ClientMemberInvitePanel,
  clientMemberDraftDisplayName,
  clientMemberDraftEmail,
  emptyClientMemberDraft,
  isClientMemberDraftComplete,
  type ClientMemberDraft,
} from "@/features/clients/components/modals/client-modal/client-member-invite-panel"
import {
  CrossfadePanel,
  DualPanelSwap,
  ExpandCollapse,
} from "@/features/clients/components/modals/client-modal/animated-primitives"
import {
  CLIENT_MODAL_CROSSFADE,
  CLIENT_MODAL_EASE,
  CLIENT_MODAL_LAYOUT,
} from "@/features/clients/components/modals/client-modal/client-modal-motion"

const TABS_AFTER_GENERAL = MODAL_TABS.slice(1)

const CLIENT_MEMBER_TAB = "Member" as const
type ClientModalTab = ModalTab | typeof CLIENT_MEMBER_TAB

const SCROLL_HIDDEN =
  "overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"

const TAB_BAR_SCROLL =
  "overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"

export type ClientSaveMeta = {
  mode: "create" | "edit"
  clientId?: string
  budgetId?: string
  invoicingId?: string
  newClientMember?: ClientMemberDraft
}
const TAB_ICONS: Record<ClientModalTab, React.ReactNode> = {
    "General": <Building2 className="w-3.5 h-3.5" />,
    "Member": <UserPlus className="w-3.5 h-3.5" />,
    "Contact info": <Phone className="w-3.5 h-3.5" />,
    "Projects": <FolderOpen className="w-3.5 h-3.5" />,
    "Budget": <DollarSign className="w-3.5 h-3.5" />,
    "Invoicing": <FileText className="w-3.5 h-3.5" />,
  }

export function ClientModal({
  onClose,
  onSave,
  members,
  initialMemberId,
  mode = "create",
  initialData,
  editClientId,
}: {
  onClose: () => void
  onSave: (c: ClientFormData, meta: ClientSaveMeta) => void | Promise<void>
  members: Member[]
  initialMemberId?: string
  mode?: "create" | "edit"
  initialData?: ApiClient
  editClientId?: string
}) {
  const isEdit = mode === "edit"
  const [tab, setTab] = useComponentState<ClientModalTab>("General")
  const [addNewClientMember, setAddNewClientMember] = useComponentState(false)
  const [memberDraft, setMemberDraft] = useComponentState<ClientMemberDraft>(() => emptyClientMemberDraft())
  const [form, setForm] = useComponentState<ClientFormData>(() =>
    initialData ? clientFormFromApi(initialData) : emptyClient(),
  )
  const [addressExpanded, setAddressExpanded] = useComponentState(false)
  const [projectOptions, setProjectOptions] = useComponentState<ProjectOption[]>([])
  const [saving, setSaving] = useComponentState(false)
  const [saveError, setSaveError] = useComponentState<string | null>(null)

  const eligibleMembers = useMemo(() => {
    return members // Allow any member to be selected as a client
  }, [members])

  useEffect(() => {
    if (!addNewClientMember) return
    const displayName = clientMemberDraftDisplayName(memberDraft)
    const email = clientMemberDraftEmail(memberDraft)
    setForm((prev) => ({
      ...prev,
      clientMember: "",
      name: displayName || prev.name,
      email: email || prev.email,
    }))
  }, [addNewClientMember, memberDraft])

  useEffect(() => {
    let cancelled = false
    getClientFormConfig()
      .then((config) => {
        if (cancelled) return
// eslint-disable-next-line react-doctor/js-combine-iterations
        setProjectOptions(
          config.options.projects
            .filter((p) => p.id)
            .map((p) => ({ id: p.id!, name: p.label })),
        )
      })
      .catch(() => {
        if (!cancelled) setProjectOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!initialData) return
    setForm(clientFormFromApi(initialData))
  }, [initialData])

  useEffect(() => {
    if (isEdit || !initialMemberId) return
    const member = members.find((m) => m.id === initialMemberId)
    if (!member) return
    void handleMemberSelect(initialMemberId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preset member when modal opens
  }, [initialMemberId, members])

  async function handleMemberSelect(memberId: string) {
    const member = members.find((m) => m.id === memberId)
    if (!member) {
      set("clientMember", memberId)
      return
    }
    const fromRow = memberDetailsFromRecord(member)
    let email = fromRow.email
    let phone = fromRow.phone
    try {
      const fromFieldData = await getMemberContactFromFieldData(member)
      if (fromFieldData.email) email = fromFieldData.email
      if (fromFieldData.phone) phone = fromFieldData.phone
    } catch {
      // Fall back to member row fields only.
    }
    setForm((prev) => ({
      ...prev,
      clientMember: memberId,
      name: member.name,
      email: email || prev.email,
      phone: phone || prev.phone,
    }))
  }

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  function setBudget<K extends keyof NonNullable<typeof form.budget>>(key: K, val: any) {
    setForm((prev) => ({ ...prev, budget: prev.budget ? { ...prev.budget, [key]: val } : prev.budget }))
  }

  function setInvoicing<K extends keyof typeof form.invoicing>(key: K, val: any) {
    setForm((prev) => ({ ...prev, invoicing: { ...prev.invoicing, [key]: val } }))
  }

  function handleAddNewClientMemberToggle(enabled: boolean) {
    setAddNewClientMember(enabled)
    if (enabled) {
      setMemberDraft(emptyClientMemberDraft())
      setForm((prev) => ({ ...prev, clientMember: "", name: "", email: "" }))
      return
    }
    setMemberDraft(emptyClientMemberDraft())
    if (tab === CLIENT_MEMBER_TAB) setTab("General")
  }

  function handleMemberDraftChange(next: ClientMemberDraft) {
    setMemberDraft(next)
  }

  const memberDraftComplete = isClientMemberDraftComplete(memberDraft)
  const canSaveClient =
    addNewClientMember && !isEdit ? memberDraftComplete : Boolean(form.name.trim())

  async function handleSave() {
    if (saving) return
    if (addNewClientMember && !isEdit && !memberDraftComplete) {
      setSaveError("Complete the Member tab with a valid email before saving.")
      setTab(CLIENT_MEMBER_TAB)
      return
    }
    const validationError = validateClientForm(form)
    if (validationError) {
      setSaveError(validationError)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await Promise.resolve(
        onSave(form, {
          mode,
          clientId: editClientId,
          budgetId: form.budgetId ?? initialData?.budgetId,
          invoicingId: form.invoicingId ?? initialData?.invoicingId,
          newClientMember: addNewClientMember && !isEdit ? memberDraft : undefined,
        }),
      )
      onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save client")
    } finally {
      setSaving(false)
    }
  }

  const theme = useClientFormTheme()

  function renderTabButton(
    t: ClientModalTab,
    motionProps?: Pick<
      ComponentProps<typeof motion.button>,
      "initial" | "animate" | "exit" | "transition"
    >,
  ) {
    return (
      <motion.button
        layout
        key={t}
        type="button"
        onClick={() => setTab(t)}
        transition={{ layout: CLIENT_MODAL_LAYOUT, opacity: CLIENT_MODAL_CROSSFADE }}
        {...motionProps}
        className={cn(
          "flex items-center gap-1.5 px-3 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors duration-200",
          tab === t ? theme.tab.active : theme.tab.inactive,
          t === CLIENT_MEMBER_TAB && !memberDraftComplete ? "relative" : undefined,
        )}
      >
        {TAB_ICONS[t]}
        {t.toUpperCase()}
        {t === CLIENT_MEMBER_TAB && !memberDraftComplete ? (
          <motion.span
            layout
            className={cn(
              "ml-0.5 h-1.5 w-1.5 rounded-full",
              theme.isDark ? "bg-amber-400" : "bg-amber-500",
            )}
            aria-hidden
          />
        ) : null}
      </motion.button>
    )
  }

  function renderFooterDot(
    t: ClientModalTab,
    motionProps?: Pick<
      ComponentProps<typeof motion.div>,
      "initial" | "animate" | "exit" | "transition"
    >,
  ) {
    return (
      <motion.div
        layout
        key={t}
        transition={{ layout: CLIENT_MODAL_LAYOUT, opacity: CLIENT_MODAL_CROSSFADE }}
        {...motionProps}
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-colors duration-200",
          tab === t ? theme.accent.dot : theme.footer.dotInactive,
        )}
      />
    )
  }

  function renderCreateModeTabs() {
    const tabMotion = {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    } as const

    return (
      <>
        {renderTabButton("General")}
        <AnimatePresence initial={false} mode="popLayout">
          {addNewClientMember ? renderTabButton(CLIENT_MEMBER_TAB, tabMotion) : null}
        </AnimatePresence>
        {TABS_AFTER_GENERAL.map((t) => renderTabButton(t))}
      </>
    )
  }

  function renderCreateModeFooterDots() {
    const dotMotion = {
      initial: { opacity: 0, scale: 0.6 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.6 },
    } as const

    return (
      <>
        {renderFooterDot("General")}
        <AnimatePresence initial={false} mode="popLayout">
          {addNewClientMember ? renderFooterDot(CLIENT_MEMBER_TAB, dotMotion) : null}
        </AnimatePresence>
        {TABS_AFTER_GENERAL.map((t) => renderFooterDot(t))}
      </>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn("fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6", theme.modal.overlay)}
      onClick={onClose}
    >
      <MotionConfig transition={{ layout: CLIENT_MODAL_LAYOUT, opacity: CLIENT_MODAL_CROSSFADE }}>
      <motion.div
        layout
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{
          opacity: { duration: 0.18, ease: CLIENT_MODAL_EASE },
          scale: { duration: 0.18, ease: CLIENT_MODAL_EASE },
          y: { duration: 0.18, ease: CLIENT_MODAL_EASE },
          layout: CLIENT_MODAL_LAYOUT,
        }}
        className={cn(
          "flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-2xl",
          theme.modal.panel,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className={cn("flex shrink-0 items-center justify-between border-b px-5 py-4", theme.modal.headerBorder)}>
          <div>
            <h2 className={cn("text-lg font-bold", theme.modal.title)}>
              {isEdit ? "Edit client" : "New client"}
            </h2>
            <p className={cn("mt-0.5 text-sm", theme.modal.subtitle)}>
              {isEdit ? "Update client details and linked projects" : "Fill in the details to create a new client"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded-lg p-2 transition-colors",
              theme.isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-100",
            )}
          >
            <X className={cn("h-5 w-5", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
          </button>
        </div>

        {/* Tab bar */}
        <LayoutGroup id="client-modal-tabs">
          <div className={cn("flex shrink-0 gap-1 border-b px-5", TAB_BAR_SCROLL, theme.modal.headerBorder)}>
            {isEdit ? MODAL_TABS.map((t) => renderTabButton(t)) : renderCreateModeTabs()}
          </div>
        </LayoutGroup>

        {/* Tab content */}
        <motion.div
          layout
          transition={{ layout: CLIENT_MODAL_LAYOUT }}
          className={cn(
            "min-h-[320px] max-h-[55vh] px-5 py-5",
            tab === "Projects" ? "flex flex-col overflow-hidden" : SCROLL_HIDDEN,
          )}
        >
          <CrossfadePanel
            panelKey={tab}
            variant="fade"
            className={cn(tab === "Projects" && "flex min-h-0 flex-1 flex-col")}
          >
              {tab === "General" && (
                <motion.div layout className={FORM_STACK} transition={{ layout: CLIENT_MODAL_LAYOUT }}>
                  {!isEdit ? (
                    <div className={cn("flex items-center justify-between gap-4 rounded-xl border p-4", theme.card)}>
                      <div className="min-w-0">
                        <p className={cn("text-sm font-medium", theme.bodyText)}>Add new client member</p>
                        <p className={cn("mt-1 text-xs leading-relaxed", theme.hint)}>
                          Invite someone with the Client role or create their account, then link them to this client.
                        </p>
                      </div>
                      <Toggle
                        checked={addNewClientMember}
                        onChange={handleAddNewClientMemberToggle}
                      />
                    </div>
                  ) : null}

                  {isEdit ? (
                    <ClientMemberSelector
                      selected={form.clientMember}
                      onChange={(memberId) => void handleMemberSelect(memberId)}
                      members={eligibleMembers}
                      disabled={isEdit}
                    />
                  ) : (
                    <DualPanelSwap
                      showSecondary={addNewClientMember}
                      primary={
                        <ClientMemberSelector
                          selected={form.clientMember}
                          onChange={(memberId) => void handleMemberSelect(memberId)}
                          members={eligibleMembers}
                          disabled={false}
                        />
                      }
                      secondary={
                        <div className={cn("rounded-xl border px-4 py-3 text-sm", theme.card)}>
                          <p className={theme.bodyText}>
                            {memberDraftComplete
                              ? "Member details captured — review other tabs, then save the client."
                              : "Open the Member tab to send an invite or create a Client account."}
                          </p>
                          <ExpandCollapse show={memberDraftComplete}>
                            <p className={cn("mt-1 text-xs", theme.hint)}>
                              {clientMemberDraftDisplayName(memberDraft) || "New client member"} · {clientMemberDraftEmail(memberDraft)}
                            </p>
                          </ExpandCollapse>
                          {!memberDraftComplete ? (
                            <button
                              type="button"
                              onClick={() => setTab(CLIENT_MEMBER_TAB)}
                              className={cn("mt-2 text-xs font-semibold hover:underline", theme.accent.link)}
                            >
                              Go to Member tab
                            </button>
                          ) : null}
                        </div>
                      }
                    />
                  )}

                  <FormField
                    label="Name"
                    required
                    hint={
                      addNewClientMember && !isEdit
                        ? "Filled from the Member tab"
                        : "Filled from the selected client member"
                    }
                  >
                    <PreviewField value={form.name} placeholder={addNewClientMember ? "Complete the Member tab" : "Select a client member"} />
                  </FormField>
                  <div className={FORM_FIELD}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className={theme.label}>Address</span>
                      <button
                        type="button"
                        onClick={() => setAddressExpanded((v) => !v)}
                        className={cn(
                          "flex items-center gap-1 text-xs transition-colors",
                          theme.isDark ? "text-[#bccbb9] hover:text-[#dce1fb]" : "text-slate-400 hover:text-slate-600",
                        )}
                      >
                        <MapPin className="w-3 h-3" />
                        {addressExpanded ? "Collapse" : "Expand"}
                        {addressExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>
                    {addressExpanded ? (
                      <div className={FORM_STACK}>
                        <Input value={form.address} onChange={(v) => set("address", v)} placeholder="Street address" />
                        <div className={FORM_GRID}>
                          <Input value={form.city} onChange={(v) => set("city", v)} placeholder="City" />
                          <Input value={form.state} onChange={(v) => set("state", v)} placeholder="State / Province" />
                        </div>
                        <div className={FORM_GRID}>
                          <Input value={form.zip} onChange={(v) => set("zip", v)} placeholder="ZIP / Postal code" />
                          <Input value={form.country} onChange={(v) => set("country", v)} placeholder="Country" />
                        </div>
                      </div>
                    ) : (
                      <Input value={form.address} onChange={(v) => set("address", v)} placeholder="Full address (click expand for fields)" />
                    )}
                  </div>
                </motion.div>
              )}

              {tab === CLIENT_MEMBER_TAB && (
                <ClientMemberInvitePanel draft={memberDraft} onChange={handleMemberDraftChange} />
              )}

              {tab === "Contact info" && (
                <div className={FORM_STACK}>
                  <FormField label="Phone number">
                    <div className="relative">
                      <Phone
                        className={cn(
                          "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                          theme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                        )}
                      />
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => set("phone", e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className={cn(theme.control, "pl-9")} aria-label="Interactive control"
                      />
                    </div>
                  </FormField>
                  <FormField
                    label="Email addresses"
                    hint={
                      addNewClientMember && !isEdit
                        ? "Preview from the Member tab; not editable here"
                        : "Preview from member profile; not editable here"
                    }
                  >
                    <PreviewField
                      value={form.email}
                      placeholder={addNewClientMember ? "Complete the Member tab" : "Select a client member"}
                    />
                  </FormField>
                </div>
              )}

              {tab === "Projects" && (
                <div className="flex-1 min-h-0">
                  <ProjectsSelector
                    projects={projectOptions}
                    selected={form.projects}
                    onChange={(v) => set("projects", v)}
                    fillHeight
                  />
                </div>
              )}

              {tab === "Budget" && (
                <div className={FORM_STACK}>
                  <div className={FORM_GRID}>
                    <FormField label="Type" required>
                      <SelectField value={form.budget?.type ?? "none"} onChange={(v) => setBudget("type", v)} options={BUDGET_TYPES} />
                    </FormField>
                    <FormField label="Based on" required>
                      <SelectField value={form.budget?.basedOn ?? "per_project"} onChange={(v) => setBudget("basedOn", v)} options={BUDGET_BASES} />
                    </FormField>
                  </div>
                  <div className={FORM_GRID}>
                    <FormField label="Cost" required>
                      <div className="relative">
                        <span className={cn("absolute left-3 top-1/2 -translate-y-1/2 text-sm", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>$</span>
                        <input
                          type="number"
                          min={0}
                          value={form.budget?.cost ?? 0}
                          onChange={(e) => setBudget("cost", parseFloat(e.target.value) || 0)}
                          className={cn(theme.control, "pl-7")}
                        />
                      </div>
                    </FormField>
                    <FormField label="Notify at">
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={form.budget?.notifyAt ?? 80}
                          onChange={(e) => setBudget("notifyAt", parseFloat(e.target.value) || 0)}
                          className={cn(theme.control, "pr-8")}
                        />
                        <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-sm", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>%</span>
                      </div>
                    </FormField>
                  </div>
                  <FormField label="Resets" required>
                    <SelectField value={form.budget?.resets ?? "monthly"} onChange={(v) => setBudget("resets", v)} options={BUDGET_RESETS} />
                  </FormField>
                </div>
              )}

              {tab === "Invoicing" && (
                  <motion.div
                    layout
                    transition={{ layout: CLIENT_MODAL_LAYOUT }}
                    className={cn(FORM_STACK, "pr-1")}
                  >
                  {/* Custom toggle */}
                  <div className={cn("flex items-center justify-between", theme.card)}>
                    <div>
                      <p className={cn("font-medium", theme.bodyText)}>Custom for this client</p>
                      <p className={cn("mt-0.5 text-xs", theme.hint)}>Override global invoicing settings</p>
                    </div>
                    <Toggle checked={form.invoicing.custom} onChange={() => setInvoicing("custom", !form.invoicing.custom)} />
                  </div>

                  <ExpandCollapse show={form.invoicing.custom}>
                    <div className={FORM_STACK}>
                        <FormField label="Notes (shown on invoices)">
                          <textarea
                            value={form.invoicing.notes}
                            onChange={(e) => setInvoicing("notes", e.target.value)}
                            placeholder="Payment terms, special instructions..."
                            rows={2}
                            className={theme.textarea}
                          />
                        </FormField>
                        <div className={FORM_GRID}>
                          <FormField label="Net terms">
                            <div className="relative">
                              <input
                                type="number"
                                min={0}
                                value={form.invoicing.netTerms}
                                onChange={(e) => setInvoicing("netTerms", parseInt(e.target.value) || 0)}
                                className={cn(theme.control, "pr-12")}
                              />
                              <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-xs", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>days</span>
                            </div>
                          </FormField>
                          <FormField label="Tax rate">
                            <div className="relative">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={form.invoicing.taxRate}
                                onChange={(e) => setInvoicing("taxRate", parseFloat(e.target.value) || 0)}
                                className={cn(theme.control, "pr-8")}
                              />
                              <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-sm", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>%</span>
                            </div>
                          </FormField>
                        </div>
                    </div>
                  </ExpandCollapse>

                  {/* Auto invoicing */}
                  <div className={cn("border-t pt-4", theme.modal.headerBorder)}>
                    <div className="mb-1 flex items-center justify-between">
                      <div>
                        <p className={cn("font-medium", theme.bodyText)}>Auto invoicing</p>
                        <p className={cn("mt-0.5 text-xs", theme.hint)}>
                          <a href="/settings/invoicing" className={cn(theme.accent.link, "hover:underline")}>
                            Set up auto-invoicing for all your clients at once.
                          </a>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs", theme.hint)}>{form.invoicing.autoInvoicing ? "Custom" : "Off"}</span>
                        <Toggle checked={form.invoicing.autoInvoicing} onChange={() => setInvoicing("autoInvoicing", !form.invoicing.autoInvoicing)} />
                      </div>
                    </div>

                    <ExpandCollapse show={form.invoicing.autoInvoicing}>
                      <div className={cn(FORM_STACK, "pt-4")}>

                          {/* Amount based on */}
                          <FormField label="Amount based on">
                            <div className="flex gap-2">
                              {([
                                { value: "hourly", label: "Hourly" },
                                { value: "fixed", label: "Fixed price" },
                              ] as const).map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setInvoicing("autoAmountBasis", opt.value)}
                                  className={cn(
                                    "flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors",
                                    form.invoicing.autoAmountBasis === opt.value
                                      ? theme.segment.active
                                      : theme.segment.inactive
                                  )}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            <ExpandCollapse show={form.invoicing.autoAmountBasis === "fixed"}>
                              <div className="mt-2 flex items-center gap-2">
                                <div className="relative flex-1">
                                  <span className={cn("absolute left-3 top-1/2 -translate-y-1/2 text-sm", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>$</span>
                                  <input
                                    type="number"
                                    min={0}
                                    value={form.invoicing.autoFixedAmount}
                                    onChange={(e) => setInvoicing("autoFixedAmount", parseFloat(e.target.value) || 0)}
                                    placeholder="0.00"
                                    className={cn(theme.control, "pl-7")}
                                  />
                                </div>
                                <span className={cn("shrink-0 text-sm", theme.hint)}>USD</span>
                              </div>
                            </ExpandCollapse>
                          </FormField>

                          {/* Frequency */}
                          <FormField label="Frequency">
                            <SelectField
                              value={form.invoicing.autoFrequency}
                              onChange={(v) => setInvoicing("autoFrequency", v)}
                              options={[
                                { value: "monthly", label: "Monthly" },
                                { value: "weekly", label: "Weekly" },
                                { value: "biweekly", label: "Bi-weekly" },
                              ]}
                            />
                          </FormField>

                          {/* Delay sending + Reminder */}
                          <div className={FORM_GRID}>
                            <FormField label="Delay sending">
                              <div className="relative">
                                <input
                                  type="number"
                                  min={0}
                                  value={form.invoicing.autoDelaySending}
                                  onChange={(e) => setInvoicing("autoDelaySending", parseInt(e.target.value) || 0)}
                                  className={cn(theme.control, "pr-12")}
                                />
                                <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-xs", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>days</span>
                              </div>
                            </FormField>
                            <FormField label="Send reminder after due">
                              <div className="relative">
                                <input
                                  type="number"
                                  min={0}
                                  value={form.invoicing.autoReminderDays}
                                  onChange={(e) => setInvoicing("autoReminderDays", parseInt(e.target.value) || 0)}
                                  className={cn(theme.control, "pr-12")}
                                />
                                <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-xs", theme.isDark ? "text-[#bccbb9]" : "text-slate-400")}>days</span>
                              </div>
                            </FormField>
                          </div>

                          {/* Line items */}
                          <FormField label="Line items">
                            <LineItemsDropdown value={form.invoicing.autoLineItems} onChange={(v) => setInvoicing("autoLineItems", v)} />
                          </FormField>

                          {/* Toggles */}
                          <div className="space-y-3 pt-1">
                            <div className="flex items-center justify-between">
                              <span className={theme.mutedText}>Include non-billable time</span>
                              <Toggle checked={form.invoicing.autoIncludeNonBillable} onChange={() => setInvoicing("autoIncludeNonBillable", !form.invoicing.autoIncludeNonBillable)} />
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={theme.mutedText}>Include expenses</span>
                              <Toggle checked={form.invoicing.autoIncludeExpenses} onChange={() => setInvoicing("autoIncludeExpenses", !form.invoicing.autoIncludeExpenses)} />
                            </div>
                          </div>

                      </div>
                    </ExpandCollapse>
                  </div>
                  </motion.div>
              )}

            </CrossfadePanel>
        </motion.div>

        {/* Footer */}
        {saveError ? (
          <motion.div className="mx-5 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {saveError}
          </motion.div>
        ) : null}
        <div className={cn("flex shrink-0 items-center justify-between border-t px-5 py-4", theme.footer.border, theme.modal.footerBg)}>
          <LayoutGroup id="client-modal-footer-dots">
            <div className="flex gap-1">
            {isEdit ? MODAL_TABS.map((t) => renderFooterDot(t)) : renderCreateModeFooterDots()}
            </div>
          </LayoutGroup>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", theme.footer.cancel)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSaveClient || saving}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                theme.accent.primarySolid,
              )}
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : addNewClientMember ? "Save client & member" : "Save client"}
            </button>
          </div>
        </div>
      </motion.div>
      </MotionConfig>
    </motion.div>
  )
}