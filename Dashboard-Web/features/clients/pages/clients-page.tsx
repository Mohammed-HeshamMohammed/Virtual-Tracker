/* eslint-disable react-doctor/use-lazy-motion, react-doctor/js-combine-iterations */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useEffect, useMemo, useState as useComponentState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Building2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme, useAuth } from "@/shared/providers/app"
import { canManageClients } from "@/features/auth"
import { usePageSearch } from "@/shared/ui/layout"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import {
  fetchClientForEdit,
  getClients,
  getProjects,
} from "@/infrastructure/api"
import type { Project } from "@/features/projects/api/project-api"
import { getMembers } from "@/features/members/api/member-api"
import type { Member } from "@/features/members/models/member"
import { PEOPLE_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { useCachedMultiList } from "@/features/members/hooks"
import { changedEvent } from "@/infrastructure/api/change-events"
import { readMembersListCache } from "@/shared/tables/hooks/list-cache-registry"
import type { Client, ClientStatus } from "@/features/clients/models/client"
import type { Client as ApiClient } from "@/features/clients/api/client-api"
import { ClientModal } from "@/features/clients/components/modals/client-modal"
import { UnlinkedClientMembersModal } from "@/features/clients/components/modals/unlinked-client-members-modal"
import { PendingClientMembersBanner } from "@/features/clients/components/pending-client-members-banner"
import { getUnlinkedClientMembers } from "@/features/clients/utils/unlinked-client-members"
import { bannerEnterExit } from "@/features/clients/constants/motion"
import { ClientsSkeleton } from "@/features/clients/components/skeletons/clients-skeleton"
import { ClientsTab } from "@/features/clients/components/tables/clients-tab"

// Custom hooks, components & dialogs
import { useClientColumns } from "@/features/clients/hooks/use-client-columns"
import { useClientMutations } from "@/features/clients/hooks/use-client-mutations"
import { ClientsToolbar } from "@/features/clients/components/clients-toolbar"
import { DeleteConfirmDialog } from "@/features/projects/ui-components"
import { NotifyToastHost } from "@/shared/ui/layout/toasts/notify-toast-host"

async function fetchClientsForCache(): Promise<Client[]> {
  return (await getClients()) as unknown as Client[]
}

export function ClientsPage() {
  const { isDark } = useTheme()
  const { memberRole, user } = useAuth()
  const canManage = canManageClients(memberRole)
  const t = isDark ? dark : light
  const [tab, setTab] = useComponentState<ClientStatus>("active")
  const { query: search, setQuery: setSearch } = usePageSearch()
  const [showModal, setShowModal] = useComponentState(false)
  const [modalInitialMemberId, setModalInitialMemberId] = useComponentState<string | undefined>()
  const [editingClientId, setEditingClientId] = useComponentState<string | null>(null)
  const [editInitial, setEditInitial] = useComponentState<ApiClient | null>(null)
  const [pageError, setPageError] = useComponentState<string | null>(null)
  const [entityGoneNotice, setEntityGoneNotice] = useComponentState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useComponentState<string | null>(null)
  const [actionBusy, setActionBusy] = useComponentState(false)
  const [showUnlinkedModal, setShowUnlinkedModal] = useComponentState(false)

  // Columns Hook
  const {
    enabledCols,
    colOrder,
    sortCol,
    sortDir,
    draggedCol,
    showColPicker,
    setShowColPicker,
    toggleCol,
    handleSort,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  } = useClientColumns()

  const {
    data: { clients, members, projects },
    setData: setClientsListData,
    isLoading,
    refetch: refetchClientsData,
  } = useCachedMultiList({
    namespace: "pm-clients",
    lists: {
      clients: { fetch: fetchClientsForCache },
      members: {
        fetch: () =>
          getMembers({
            fields: [
              "id",
              "first_name",
              "last_name",
              "name",
              "email",
              "work_email",
              "personal_email",
              "avatar",
              "avatar_url",
              "avatar_color",
              "role",
              "role_name",
            ],
          }),
      },
      projects: {
        fetch: () =>
          getProjects({
            fields: ["id", "name"],
          }),
      },
    },
    loadingKey: "clients",
    staleMs: 60_000,
    refetchOnVisibility: true,
    backgroundRefetchKeys: ["clients"],
    initialData: {
      members: readMembersListCache<Member>() ?? [],
      projects: [] as Project[],
      clients: [] as Client[],
    },
    onError: (err) => {
      console.error("Failed to fetch clients data:", err)
      setPageError(err instanceof Error ? err.message : "Failed to load clients")
    },
    // Live sync (PLAN-livesyncandagenttimer.md §6.4/case 4): replaces the
    // 50s poll - forceRefetch bypasses staleMs so a broadcast repaints in
    // under a second instead of waiting out the interval.
    presencePingEvent: changedEvent("clients"),
    backgroundRefetch: { forceRefetch: true },
  })

  // Live sync (case 16/17): useCachedMultiList only accepts one
  // presencePingEvent, already spent above on "clients" - a member
  // deleted while this page is open needs its own listener to force the
  // "members" sub-list to refetch (the cache is already marked stale via
  // change-events.ts either way; this is what makes a *mounted* page act
  // on it instead of waiting for its next natural revisit).
  useEffect(() => {
    const handler = () => void refetchClientsData({ keys: ["members"], forceRefetch: true })
    window.addEventListener(changedEvent("members"), handler)
    return () => window.removeEventListener(changedEvent("members"), handler)
  }, [refetchClientsData])

  const setClients = (value: Client[] | ((prev: Client[]) => Client[])): void => {
    setClientsListData("clients", value)
  }

  const projectNames = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  )

  const counts = useMemo(
    () => ({
      active: clients.filter((c) => c.status === "active").length,
      archived: clients.filter((c) => c.status === "archived").length,
    }),
    [clients],
  )

  const tabClients = useMemo(() => clients.filter((c) => c.status === tab), [clients, tab])

  const unlinkedClientMembers = useMemo(
    () => getUnlinkedClientMembers(members, clients),
    [members, clients],
  )

  const modalMembers = useMemo(() => {
    const isClientRole = (role: string) => role.toLowerCase().replace(/\s+/g, "") === "client"
// eslint-disable-next-line react-doctor/js-flatmap-filter
    const linkedMemberIds = new Set(
      clients.map((client) => client.clientMember).filter((memberId) => memberId.trim().length > 0),
    )
    return members.filter((member) => {
      if (!isClientRole(member.role)) return false
      if (editingClientId && editInitial?.clientMember === member.id) return true
      return !linkedMemberIds.has(member.id)
    })
  }, [members, clients, editingClientId, editInitial?.clientMember])

  const {
    saveClient,
    archiveClient,
    deleteClientRow,
  } = useClientMutations({
    clients,
    setClients,
    setPageError,
    setActionBusy,
    setDeleteConfirmId,
    canManageClients: canManage,
    createdByUid: user?.uid,
    refreshMembers: async () => {
      const nextMembers = await getMembers({
        fields: [
          "id",
          "first_name",
          "last_name",
          "name",
          "email",
          "work_email",
          "personal_email",
          "avatar",
          "avatar_url",
          "avatar_color",
          "role",
          "role_name",
        ],
      })
      setClientsListData("members", nextMembers)
    },
  })

  function openAddClientModal(memberId?: string) {
    if (!canManage) return
    setEditingClientId(null)
    setEditInitial(null)
    setModalInitialMemberId(memberId)
    setShowUnlinkedModal(false)
    setShowModal(true)
  }

  function closeClientModal() {
    setShowModal(false)
    setModalInitialMemberId(undefined)
    setEditingClientId(null)
    setEditInitial(null)
  }

  function openEditClient(id: string) {
    if (!canManage) return
    setPageError(null)
    const cached = clients.find((c) => c.id === id)
    if (!cached) {
      void (async () => {
        try {
          const loaded = await fetchClientForEdit(id)
          setEditingClientId(id)
          setEditInitial(loaded)
          setModalInitialMemberId(undefined)
          setShowModal(true)
        } catch (error) {
          setPageError(error instanceof Error ? error.message : "Failed to load client for edit")
        }
      })()
      return
    }
    setEditingClientId(id)
    setEditInitial(cached as unknown as ApiClient)
    setModalInitialMemberId(undefined)
    setShowModal(true)
    void fetchClientForEdit(id)
      .then((loaded) => setEditInitial(loaded))
      .catch(() => {
        /* Keep cached row data if refresh fails */
      })
  }

  const emptyContent = (
    <>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.06, duration: 0.2 }}
        className={cn(
          "mb-2 flex h-10 w-10 items-center justify-center rounded-full",
          isDark ? "bg-[#191f31]" : "bg-slate-100",
        )}
      >
        <Building2 className={cn("h-5 w-5", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
      </motion.div>
      <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        {search ? `No ${tab} clients matching "${search}"` : `No ${tab} clients yet`}
      </p>
      {!search && tab === "active" && canManage && (
        <button
          type="button"
          onClick={() => openAddClientModal()}
          className={cn("mt-2 text-sm font-medium hover:underline", isDark ? "text-[#4be277]" : "text-blue-500")}
        >
          + Add client
        </button>
      )}
    </>
  )

  const showListSkeleton = isLoading && clients.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AnimatePresence>
        {!isLoading && unlinkedClientMembers.length > 0 && canManage && (
          <motion.div key="pending-banner" {...bannerEnterExit} className="mx-4 mb-2 mt-1 shrink-0 overflow-hidden">
            <PendingClientMembersBanner
              count={unlinkedClientMembers.length}
              onClick={() => setShowUnlinkedModal(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        {pageError ? (
          <div
            className={cn(
              "mb-3 shrink-0 rounded-lg border px-3 py-2 text-sm",
              isDark ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {pageError}
          </div>
        ) : null}
        <ClientsToolbar
          tab={tab}
          setTab={setTab}
          setSearch={setSearch}
          search={search}
          counts={counts}
          showColPicker={showColPicker}
          setShowColPicker={setShowColPicker}
          toggleCol={toggleCol}
          enabledCols={enabledCols}
          isDark={isDark}
          t={t}
          openAddClientModal={openAddClientModal}
          canManageClients={canManage}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {showListSkeleton ? (
            <ClientsSkeleton isDark={isDark} rowCount={PEOPLE_TABLE_ROWS_PER_PAGE} fillHeight />
          ) : (
            <ClientsTab
              clients={tabClients}
              projectNames={projectNames}
              search={search}
              enabledCols={enabledCols}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
              colOrder={colOrder}
              draggedCol={draggedCol}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onEdit={(id) => void openEditClient(id)}
              onArchive={(id) => void archiveClient(id)}
              onDelete={(id) => setDeleteConfirmId(id)}
              isDark={isDark}
              canManageClients={canManage}
              emptyContent={emptyContent}
            />
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showUnlinkedModal && (
          <UnlinkedClientMembersModal
            members={unlinkedClientMembers}
            onClose={() => setShowUnlinkedModal(false)}
            onAddMember={(memberId) => openAddClientModal(memberId)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModal && canManage && (
          <ClientModal
            key={editingClientId ?? modalInitialMemberId ?? "new"}
            mode={editingClientId ? "edit" : "create"}
            editClientId={editingClientId ?? undefined}
            initialData={editInitial ?? undefined}
            initialMemberId={modalInitialMemberId}
            onClose={closeClientModal}
            onSave={saveClient}
            members={modalMembers}
            onEntityGone={(message) => {
              closeClientModal()
              setEntityGoneNotice(message)
            }}
          />
        )}
      </AnimatePresence>

      <NotifyToastHost
        message={entityGoneNotice}
        onDismiss={() => setEntityGoneNotice(null)}
        title="Notice"
        tone="error"
      />

      <AnimatePresence>
        <DeleteConfirmDialog
          deleteConfirmId={deleteConfirmId}
          onClose={() => setDeleteConfirmId(null)}
          onConfirm={(id) => void deleteClientRow(id)}
          actionBusy={actionBusy}
          isDark={isDark}
          t={t}
        />
      </AnimatePresence>

    </div>
  )
}
