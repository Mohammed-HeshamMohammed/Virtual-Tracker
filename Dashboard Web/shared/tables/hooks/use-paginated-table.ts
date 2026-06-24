import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { PEOPLE_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import {
  TABLE_FALLBACK_THEAD_HEIGHT_PX,
  TABLE_MIN_ROW_HEIGHT_PX,
  measureTbodyArea,
  rowsThatFit,
} from "@/shared/tables/utils/table-layout"

export type UsePaginatedTableResult<T> = {
  currentPage: number
  setCurrentPage: (page: number | ((prev: number) => number)) => void
  totalPages: number
  visibleRows: T[]
  fillsRemaining: boolean
  rowsPerPage: number
}

const PAGINATION_HEIGHT_PX = 56

export function useDynamicRowCount(
  containerRef?: RefObject<HTMLElement | null>,
  defaultRowCount: number = PEOPLE_TABLE_ROWS_PER_PAGE,
  includesPagination = false,
  maxRowsPerPage?: number,
  minRowsPerPage?: number,
): number {
  const [rowCount, setRowCount] = useState(defaultRowCount)

  useEffect(() => {
    if (!containerRef) return

    const el = containerRef.current
    if (!el) return

    const measure = () => {
      let available: number
      if (includesPagination) {
        const shellHeight = el.getBoundingClientRect().height
        const thead = el.querySelector("thead")
        const theadHeight = thead?.getBoundingClientRect().height ?? TABLE_FALLBACK_THEAD_HEIGHT_PX
        available = Math.max(0, shellHeight - PAGINATION_HEIGHT_PX - theadHeight)
      } else {
        available = measureTbodyArea(el, 1).tbodyArea
      }
      let count = rowsThatFit(available, defaultRowCount)
      if (available < TABLE_MIN_ROW_HEIGHT_PX) {
        count = defaultRowCount
      }
      if (typeof maxRowsPerPage === "number" && maxRowsPerPage > 0) {
        count = Math.min(count, maxRowsPerPage)
      }
      if (typeof minRowsPerPage === "number" && minRowsPerPage > 0) {
        count = Math.max(count, minRowsPerPage)
      }
      setRowCount((prev) => (prev === count ? prev : count))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [containerRef, defaultRowCount, includesPagination, maxRowsPerPage, minRowsPerPage])

  return rowCount
}

export function usePaginatedTable<T>(
  items: T[],
  defaultRowsPerPage: number = PEOPLE_TABLE_ROWS_PER_PAGE,
  containerRef?: RefObject<HTMLElement | null>,
  options?: { includesPagination?: boolean; maxRowsPerPage?: number; minRowsPerPage?: number },
): UsePaginatedTableResult<T> {
  const includesPagination = options?.includesPagination ?? false
  const rowsPerPage = useDynamicRowCount(
    containerRef,
    defaultRowsPerPage,
    includesPagination,
    options?.maxRowsPerPage,
    options?.minRowsPerPage,
  )
  const [currentPage, setCurrentPage] = useState(1)
  const prevItemsLengthRef = useRef(items.length)

  const totalPages = Math.max(1, Math.ceil(items.length / rowsPerPage))

  useEffect(() => {
    if (items.length === prevItemsLengthRef.current) return
    prevItemsLengthRef.current = items.length
    setCurrentPage(1)
  }, [items.length])

  useEffect(() => {
    setCurrentPage((page) => (page > totalPages ? totalPages : page))
  }, [totalPages])

  const activePage = Math.min(currentPage, totalPages)

  const visibleRows = useMemo(() => {
    const start = (activePage - 1) * rowsPerPage
    return items.slice(start, start + rowsPerPage)
  }, [items, activePage, rowsPerPage])

  const fillsRemaining = items.length === 0 || visibleRows.length < rowsPerPage

  return {
    currentPage: activePage,
    setCurrentPage,
    totalPages,
    visibleRows,
    fillsRemaining,
    rowsPerPage,
  }
}
