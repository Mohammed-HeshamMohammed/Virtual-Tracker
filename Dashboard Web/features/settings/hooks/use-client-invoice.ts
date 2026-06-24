import { useState, useRef } from "react"

interface ClientInvoiceState {
  address: string
  taxId: string
  logoFile: string
  taxRate: string
  notes: string
  netTerms: string
  paypalEmail: string
  autoInvoicing: boolean
  amountBased: "Hourly" | "Fixed price"
  fixedPrice: string
  frequency: string
  delaySending: string
  sendReminder: string
  lineItems: string
  includeNonBillable: boolean
  includeExpenses: boolean
}

interface UseClientInvoiceReturn extends ClientInvoiceState {
  setAddress: (value: string) => void
  setTaxId: (value: string) => void
  setLogoFile: (value: string) => void
  setTaxRate: (value: string) => void
  setNotes: (value: string) => void
  setNetTerms: (value: string) => void
  setPaypalEmail: (value: string) => void
  setAutoInvoicing: (value: boolean) => void
  setAmountBased: (value: "Hourly" | "Fixed price") => void
  setFixedPrice: (value: string) => void
  setFrequency: (value: string) => void
  setDelaySending: (value: string) => void
  setSendReminder: (value: string) => void
  setLineItems: (value: string) => void
  setIncludeNonBillable: (value: boolean) => void
  setIncludeExpenses: (value: boolean) => void
  logoRef: React.RefObject<HTMLInputElement | null>
}

export function useClientInvoice(defaultLineItems: string): UseClientInvoiceReturn {
  const [address, setAddress] = useState("")
  const [taxId, setTaxId] = useState("")
  const [logoFile, setLogoFile] = useState("")
  const [taxRate, setTaxRate] = useState("")
  const [notes, setNotes] = useState("")
  const [netTerms, setNetTerms] = useState("30")
  const [paypalEmail, setPaypalEmail] = useState("")
  const [autoInvoicing, setAutoInvoicing] = useState(false)
  const [amountBased, setAmountBased] = useState<"Hourly" | "Fixed price">("Hourly")
  const [fixedPrice, setFixedPrice] = useState("")
  const [frequency, setFrequency] = useState("Monthly")
  const [delaySending, setDelaySending] = useState("0")
  const [sendReminder, setSendReminder] = useState("0")
  const [lineItems, setLineItems] = useState(defaultLineItems)
  const [includeNonBillable, setIncludeNonBillable] = useState(false)
  const [includeExpenses, setIncludeExpenses] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  return {
    address, setAddress,
    taxId, setTaxId,
    logoFile, setLogoFile,
    taxRate, setTaxRate,
    notes, setNotes,
    netTerms, setNetTerms,
    paypalEmail, setPaypalEmail,
    autoInvoicing, setAutoInvoicing,
    amountBased, setAmountBased,
    fixedPrice, setFixedPrice,
    frequency, setFrequency,
    delaySending, setDelaySending,
    sendReminder, setSendReminder,
    lineItems, setLineItems,
    includeNonBillable, setIncludeNonBillable,
    includeExpenses, setIncludeExpenses,
    logoRef,
  }
}
