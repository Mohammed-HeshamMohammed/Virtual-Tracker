import type { ClientFormData } from "@/features/clients/models/client"
import {
  firstValidationError,
  isNonEmptyTrimmed,
  isOptionalEmail,
  parseNonNegativeNumber,
  parsePercentage,
} from "@/shared/validation"

export function validateClientForm(form: ClientFormData): string | null {
  if (!isNonEmptyTrimmed(form.name)) return "Client name is required."

  return firstValidationError(
    form.email.trim() && !isOptionalEmail(form.email) ? "Enter a valid email." : null,
    form.budget && form.budget.type !== "none" && parseNonNegativeNumber(String(form.budget.cost)) === null
      ? "Budget cost must be a valid number."
      : null,
    form.budget && parsePercentage(String(form.budget.notifyAt)) === null
      ? "Notify at percentage must be between 0 and 100."
      : null,
    form.invoicing.taxRate < 0 || form.invoicing.taxRate > 100
      ? "Tax rate must be between 0 and 100."
      : null,
    form.invoicing.netTerms < 0 ? "Net terms must be zero or greater." : null,
  )
}
