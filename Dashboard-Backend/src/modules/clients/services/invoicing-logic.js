
import { LINE_ITEM_OPTIONS } from "./form-config.js";

const LINE_ITEM_KEYS = new Set(LINE_ITEM_OPTIONS.map((o) => o.value));

export function normalizeInvoicing(invoicing) {
  const row = invoicing ?? {};
  return {
    custom: Boolean(row.custom ?? row.custom_for_client),
    notes: String(row.notes ?? ""),
    netTerms: Math.max(0, Math.floor(Number(row.netTerms ?? row.net_terms_days ?? 30))),
    taxRate: Math.min(100, Math.max(0, Number(row.taxRate ?? row.tax_rate ?? 0))),
    autoInvoicing: Boolean(row.autoInvoicing ?? row.auto_invoicing),
    autoAmountBasis: String(row.autoAmountBasis ?? row.auto_invoice_amount_based_on ?? "hourly").toLowerCase(),
    autoFixedAmount: Math.max(0, Number(row.autoFixedAmount ?? row.auto_fixed_amount ?? 0)),
    autoFrequency: String(row.autoFrequency ?? row.auto_invoice_frequency ?? "monthly").toLowerCase(),
    autoDelaySending: Math.max(0, Math.floor(Number(row.autoDelaySending ?? row.auto_invoice_delay_days ?? 0))),
    autoReminderDays: Math.max(0, Math.floor(Number(row.autoReminderDays ?? row.auto_invoice_reminder_days ?? 7))),
    autoLineItems: String(row.autoLineItems ?? row.auto_invoice_line_items ?? "detailed_project_user_date"),
    autoIncludeNonBillable: Boolean(row.autoIncludeNonBillable ?? row.include_non_billable_time),
    autoIncludeExpenses: Boolean(row.autoIncludeExpenses ?? row.include_expenses),
  };
}

export function buildInvoicingPolicy(invoicing) {
  const lineItemsValid = LINE_ITEM_KEYS.has(invoicing.autoLineItems);

  return {
    customEnabled: invoicing.custom,
    autoInvoicingEnabled: invoicing.autoInvoicing,
    persisted: invoicing.custom || invoicing.autoInvoicing,
    netTermsDays: invoicing.netTerms,
    taxRatePct: invoicing.taxRate,
    notes: invoicing.notes,
    auto: invoicing.autoInvoicing
      ? {
          amountBasis: invoicing.autoAmountBasis,
          fixedAmount: invoicing.autoFixedAmount,
          frequency: invoicing.autoFrequency,
          delayDays: invoicing.autoDelaySending,
          reminderDaysAfterDue: invoicing.autoReminderDays,
          lineItems: invoicing.autoLineItems,
          lineItemsValid,
          includeNonBillable: invoicing.autoIncludeNonBillable,
          includeExpenses: invoicing.autoIncludeExpenses,
        }
      : null,
    triggers: buildInvoicingTriggerDefinitions(invoicing),
  };
}

function buildInvoicingTriggerDefinitions(invoicing) {
  const triggers = [];

  if (invoicing.custom) {
    triggers.push({
      key: "invoicing.apply_custom_terms",
      label: "Use client-specific net terms, tax, and notes on manual invoices",
      condition: "custom_for_client = true",
      activations: ["invoice_pdf_terms", "manual_invoice"],
    });
  }

  if (invoicing.autoInvoicing) {
    triggers.push({
      key: "invoicing.auto_send",
      label: "Send invoice on schedule after period close + delay",
      condition: `frequency=${invoicing.autoFrequency}, delay_days=${invoicing.autoDelaySending}`,
      activations: ["send_email", "send_whatsapp", "create_invoice_draft"],
    });
    triggers.push({
      key: "invoicing.payment_reminder",
      label: "Remind client after due date",
      condition: `due_date + ${invoicing.autoReminderDays} days`,
      activations: ["send_email", "send_whatsapp"],
    });
  }

  return triggers;
}

export function computeInvoiceDueDate(issueDateIso, netTermsDays) {
  const base = issueDateIso ? new Date(issueDateIso) : new Date();
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setDate(base.getDate() + Math.max(0, Number(netTermsDays ?? 30)));
  return base.toISOString().slice(0, 10);
}

const MS_DAY = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function frequencyToDays(frequency) {
  if (frequency === "weekly") return 7;
  if (frequency === "biweekly") return 14;
  return 30;
}

export function computeNextAutoInvoiceAt(invoicing, from = new Date()) {
  if (!invoicing.autoInvoicing) return null;
  const periodDays = frequencyToDays(invoicing.autoFrequency);
  const delayDays = invoicing.autoDelaySending;
  return addDays(from, periodDays + delayDays);
}

export function computeNextPaymentReminderAt(invoicing, dueDateIso) {
  if (!invoicing.autoInvoicing || !dueDateIso) return null;
  const due = new Date(dueDateIso);
  if (Number.isNaN(due.getTime())) return null;
  return addDays(due, invoicing.autoReminderDays);
}

export function shouldRunAutoInvoice(invoicing, state = {}) {
  if (!invoicing.autoInvoicing) {
    return { due: false, reason: "auto_invoicing_disabled" };
  }

  const asOf = state.asOf instanceof Date ? state.asOf : new Date();
  const last = state.lastAutoInvoiceAt
    ? new Date(state.lastAutoInvoiceAt)
    : null;
  const periodMs = frequencyToDays(invoicing.autoFrequency) * MS_DAY;
  const delayMs = invoicing.autoDelaySending * MS_DAY;

  if (!last || Number.isNaN(last.getTime())) {
    const firstDue = addDays(asOf, delayMs);
    return { due: asOf >= firstDue, reason: "first_run", nextAt: firstDue };
  }

  const next = new Date(last.getTime() + periodMs + delayMs);
  return {
    due: asOf >= next,
    reason: asOf >= next ? "schedule_elapsed" : "waiting",
    nextAt: next,
  };
}

export function shouldRunPaymentReminder(invoicing, state = {}) {
  if (!invoicing.autoInvoicing || !state.dueDate) {
    return { due: false, reason: "no_due_date" };
  }

  const asOf = state.asOf instanceof Date ? state.asOf : new Date();
  const due = new Date(state.dueDate);
  const remindAt = addDays(due, invoicing.autoReminderDays);
  if (asOf < remindAt) {
    return { due: false, reason: "before_reminder_date", nextAt: remindAt };
  }

  const last = state.lastReminderAt ? new Date(state.lastReminderAt) : null;
  if (last && !Number.isNaN(last.getTime()) && last >= remindAt) {
    return { due: false, reason: "already_reminded" };
  }

  return { due: true, reason: "past_due_reminder", nextAt: remindAt };
}

export function resolveLineItemSpec(lineItemsKey) {
  const valid = LINE_ITEM_KEYS.has(lineItemsKey);
  const group = lineItemsKey.startsWith("detailed_todo")
    ? "todo"
    : lineItemsKey.startsWith("summary")
      ? "summary"
      : "project";
  return {
    key: lineItemsKey,
    valid,
    group,
    dimensions: lineItemsKey.split("_").filter((p) => !["detailed", "summary"].includes(p)),
  };
}

export function computeInvoiceAmount(invoicing, usage = {}) {
  if (invoicing.autoAmountBasis === "fixed") {
    const subtotal = invoicing.autoFixedAmount;
    const tax = subtotal * (invoicing.taxRate / 100);
    return { subtotal, tax, total: subtotal + tax, basis: "fixed" };
  }
  const hours = Math.max(0, Number(usage.billableHours ?? 0));
  const rate = Math.max(0, Number(usage.hourlyRate ?? 0));
  const subtotal = hours * rate;
  const tax = subtotal * (invoicing.taxRate / 100);
  return { subtotal, tax, total: subtotal + tax, basis: "hourly", hours, rate };
}

export function evaluateInvoicingAutomation(invoicing, state = {}) {
  const policy = buildInvoicingPolicy(invoicing);
  const autoSend = shouldRunAutoInvoice(invoicing, {
    lastAutoInvoiceAt: state.lastAutoInvoiceAt,
    asOf: state.asOf,
  });
  const reminder = shouldRunPaymentReminder(invoicing, {
    dueDate: state.openDueDate,
    lastReminderAt: state.lastReminderAt,
    asOf: state.asOf,
  });

  const activeTriggers = [];
  if (autoSend.due) {
    activeTriggers.push({
      key: "invoicing.auto_send",
      met: true,
      payload: { reason: autoSend.reason },
    });
  }
  if (reminder.due) {
    activeTriggers.push({
      key: "invoicing.payment_reminder",
      met: true,
      payload: { reason: reminder.reason, dueDate: state.openDueDate },
    });
  }

  return {
    policy,
    autoSend,
    reminder,
    nextAutoInvoiceAt: computeNextAutoInvoiceAt(invoicing, state.asOf ?? new Date()),
    nextReminderAt: state.openDueDate
      ? computeNextPaymentReminderAt(invoicing, state.openDueDate)
      : null,
    lineItemSpec: invoicing.autoInvoicing ? resolveLineItemSpec(invoicing.autoLineItems) : null,
    activeTriggers,
  };
}
