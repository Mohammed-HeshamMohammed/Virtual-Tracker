"use client"

import {
  createClientWithDetails,
  deleteClient,
  updateClient,
  updateClientWithDetails,
} from "@/infrastructure/api"
import type { Client, ClientFormData } from "@/features/clients/models/client"
import type { ClientSaveMeta } from "@/features/clients/components/modals/client-modal"
import { provisionClientMemberFromDraft } from "@/features/clients/services/client-member-provision"
import type { Invite } from "@/features/members/models/member"
import {
  invalidatePeopleMemberCaches,
  readCache,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"

interface UseClientMutationsProps {
  clients: Client[]
  setClients: (value: Client[] | ((prev: Client[]) => Client[])) => void
  setPageError: (msg: string | null) => void
  setActionBusy: (busy: boolean) => void
  setDeleteConfirmId: (id: string | null) => void
  canManageClients: boolean
  createdByUid?: string
  refreshMembers?: () => Promise<void>
}

export function useClientMutations({
  clients,
  setClients,
  setPageError,
  setActionBusy,
  setDeleteConfirmId,
  canManageClients,
  createdByUid,
  refreshMembers,
}: UseClientMutationsProps) {

  async function saveClient(data: ClientFormData, meta: ClientSaveMeta) {
    if (!canManageClients) return
    setPageError(null)
    if (meta.mode === "edit" && meta.clientId) {
      // §6.9 - a 409 here (stale write) is left to propagate: the modal's
      // own submit handler shows a reload/keep-editing notice instead of a
      // generic save error.
      const updated = await updateClientWithDetails(meta.clientId, data, {
        budgetId: data.budgetId ?? meta.budgetId,
        invoicingId: data.invoicingId ?? meta.invoicingId,
        expectedUpdatedAt: meta.expectedUpdatedAt,
      })
      setClients((prev) => prev.map((client) => (client.id === updated.id ? (updated as unknown as Client) : client)))
      return
    }

    let payload: ClientFormData = { ...data }
    let provisioned: Awaited<ReturnType<typeof provisionClientMemberFromDraft>> | undefined

    if (meta.newClientMember) {
      provisioned = await provisionClientMemberFromDraft(meta.newClientMember, { createdByUid })
      payload = {
        ...payload,
        clientMember: "",
        name: provisioned.displayName || payload.name,
        email: provisioned.email || payload.email,
      }
    }

    const created = await createClientWithDetails(payload)
    setClients((prev) => [...prev, created as unknown as Client])

    if (meta.newClientMember && provisioned) {
      const cachedInvites = readCache<Invite[]>("people-members:invites")
      invalidatePeopleMemberCaches()
      if (provisioned.mode === "invites" && provisioned.invites?.length) {
        writeCache("people-members:invites", [...provisioned.invites, ...(cachedInvites ?? [])])
      }
      if (refreshMembers) {
        await refreshMembers()
      }
    }
  }

  async function archiveClient(id: string) {
    if (!canManageClients) return
    setPageError(null)
    setActionBusy(true)
    try {
      const current = clients.find((c) => c.id === id)
      const nextStatus = current?.status === "active" ? "archived" : "active"
      await updateClient(id, { status: nextStatus })
      setClients((prev) => prev.map((c) => (c.id === id ? { ...c, status: nextStatus } : c)))
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to update client status")
    } finally {
      setActionBusy(false)
    }
  }

  async function deleteClientRow(id: string) {
    if (!canManageClients) return
    setPageError(null)
    setActionBusy(true)
    try {
      await deleteClient(id)
      setClients((prev) => prev.filter((c) => c.id !== id))
      setDeleteConfirmId(null)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to delete client")
    } finally {
      setActionBusy(false)
    }
  }

  return {
    saveClient,
    archiveClient,
    deleteClientRow,
  }
}
