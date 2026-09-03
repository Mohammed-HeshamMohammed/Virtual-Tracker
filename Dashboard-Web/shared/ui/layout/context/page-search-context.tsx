"use client"

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode, use } from "react"

type PageSearchContextValue = {
  query: string
  setQuery: (value: string) => void
  clearQuery: () => void
}

const PageSearchContext = createContext<PageSearchContextValue | null>(null)

const noop = () => {}

export function PageSearchProvider({
  children,
  activePageId,
}: {
  children: ReactNode
  activePageId: string
}) {
  const [query, setQuery] = useState("")
  const [prevActivePageId, setPrevActivePageId] = useState(activePageId)

  if (activePageId !== prevActivePageId) {
    setPrevActivePageId(activePageId)
    setQuery("")
  }

  const clearQuery = useCallback(() => setQuery(""), [])

  const value = useMemo(
    () => ({ query, setQuery, clearQuery }),
    [query, clearQuery],
  )

  return (
    <PageSearchContext.Provider value={value}>{children}</PageSearchContext.Provider>
  )
}

export function usePageSearch(): PageSearchContextValue {
  const ctx = use(PageSearchContext)
  if (!ctx) {
    return { query: "", setQuery: noop, clearQuery: noop }
  }
  return ctx
}
