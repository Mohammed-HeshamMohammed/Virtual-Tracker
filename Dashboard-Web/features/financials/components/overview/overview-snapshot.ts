export const FINANCIALS_OVERVIEW_KPIS = {
  readyToPayTotal: "0:00",
  readyToPayMembers: 0,
  approvedPayrollTotal: "0:00",
  approvedPayrollMembers: 0,
  payrollConnected: false,
  payrollProvider: "Wise",
  paymentsVolumePaid: "$0",
  paymentsPaidCount: 0,
  paymentsPendingCount: 0,
  paymentsLastRunLabel: "—",
  invoicesOpenAmount: "$0",
  invoicesOpenCount: 0,
  invoicesDraftCount: 0,
  invoicesCollected30d: "$0",
  expensesUninvoiced: "$0",
  expensesInvoiced: "$0",
  expensesPaidYtd: "$0",
}

export const FINANCIALS_OVERVIEW_RECENT_PAYMENTS: {
  id: string
  name: string
  amount: string
  status: string
}[] = []

export const FINANCIALS_OVERVIEW_RECENT_INVOICES: {
  number: string
  client: string
  total: string
  status: string
}[] = []
