import { useState } from "react"

interface CustomField {
  id: string
  name: string
  type: "text" | "number" | "date" | "dropdown"
  options?: string[]
  required: boolean
}

interface UseCustomFieldsReturn {
  fields: CustomField[]
  addField: (field: Omit<CustomField, "id">) => void
  updateField: (id: string, updates: Partial<CustomField>) => void
  removeField: (id: string) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
}

export function useCustomFields(): UseCustomFieldsReturn {
  const [fields, setFields] = useState<CustomField[]>([
    { id: "1", name: "Department", type: "dropdown", options: ["Engineering", "Design", "Marketing", "Sales"], required: false },
    { id: "2", name: "Employee ID", type: "text", required: true },
    { id: "3", name: "Start Date", type: "date", required: false },
  ])
  const [editingId, setEditingId] = useState<string | null>(null)

  const addField = (field: Omit<CustomField, "id">) => {
    const newField = { ...field, id: Date.now().toString() }
    setFields(prev => [...prev, newField])
  }

  const updateField = (id: string, updates: Partial<CustomField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
  }

  return {
    fields,
    addField,
    updateField,
    removeField,
    editingId,
    setEditingId,
  }
}
