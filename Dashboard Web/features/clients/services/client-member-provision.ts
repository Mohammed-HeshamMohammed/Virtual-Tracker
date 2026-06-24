import { createInvitesBulk, preprovisionMember } from "@/infrastructure/api"
import type { Invite } from "@/features/members/models/member"
import {
  clientMemberDraftDisplayName,
  clientMemberDraftEmail,
  type ClientMemberDraft,
} from "@/features/clients/components/modals/client-modal/client-member-invite-panel"

export type ProvisionClientMemberResult = {
  email: string
  displayName: string
  mode: ClientMemberDraft["mode"]
  invites?: Invite[]
}

/** Creates a Client-role invite or pre-provisioned account from the modal draft. */
export async function provisionClientMemberFromDraft(
  draft: ClientMemberDraft,
  options?: { createdByUid?: string },
): Promise<ProvisionClientMemberResult> {
  const appOrigin = typeof window !== "undefined" ? window.location.origin : undefined
  const email = clientMemberDraftEmail(draft)
  const displayName = clientMemberDraftDisplayName(draft)

  if (draft.mode === "invites") {
    const result = await createInvitesBulk([{ email }], "Client", {
      appOrigin,
      createdByUid: options?.createdByUid,
    })
    if (!result.invites.length) {
      throw new Error("Failed to create client member invite.")
    }
    return { email, displayName, mode: "invites", invites: result.invites }
  }

  const name = [draft.accountForm.firstName, draft.accountForm.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
  if (!name) {
    throw new Error("First and last name are required to create a client account.")
  }

  await preprovisionMember({
    name,
    email: draft.accountForm.email.trim(),
    role: "Client",
    sendWelcomeEmail: draft.sendWelcomeEmail,
    createdByUid: options?.createdByUid,
  })

  return { email: draft.accountForm.email.trim(), displayName: name, mode: "accounts" }
}
