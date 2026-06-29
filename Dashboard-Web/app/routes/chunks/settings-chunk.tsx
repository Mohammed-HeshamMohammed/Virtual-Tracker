"use client"

import {
  SettingsAllPage,
  OrganizationSettingsPage,
  MembersSettings,
  SchedulesSettings,
  BillingPage,
  IntegrationsSettingsPage,
  PoliciesSettingsPage,
  EnterpriseSecuritySettingsPage,
  ActivityTrackingSettingsPage,
  SubscriptionPlans,
} from "@/features/settings/components/app"
import type { PageChunkProps } from "@/app/routes/types"

export default function SettingsChunk({ pageId, onNavigate }: PageChunkProps) {
  switch (pageId) {
    case "settings-all":
      return <SettingsAllPage onNavigate={onNavigate} />
    case "settings-organization":
      return <OrganizationSettingsPage onNavigate={onNavigate} />
    case "settings-members":
      return <MembersSettings onNavigate={onNavigate} />
    case "settings-schedules":
      return <SchedulesSettings onNavigate={onNavigate} />
    case "settings-activity":
      return <ActivityTrackingSettingsPage onNavigate={onNavigate} />
    case "settings-integrations":
      return <IntegrationsSettingsPage />
    case "settings-policies":
      return <PoliciesSettingsPage />
    case "settings-enterprise-security":
      return <EnterpriseSecuritySettingsPage />
    case "settings-billing-plans":
      return <SubscriptionPlans onNavigate={onNavigate} />
    case "settings-billing":
    default:
      return <BillingPage onNavigate={onNavigate} />
  }
}
