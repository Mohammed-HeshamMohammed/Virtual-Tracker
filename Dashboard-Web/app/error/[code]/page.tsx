import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { HttpErrorPage } from "@/shared/ui/errors"
import {
  getHttpErrorDefinition,
  HTTP_ERROR_PAGE_CODES,
  isSupportedHttpErrorPageCode,
  normalizeHttpErrorCode,
} from "@/shared/errors/http-error-catalog"

type HttpErrorRoutePageProps = {
  params: Promise<{ code: string }>
}

export function generateStaticParams() {
  return HTTP_ERROR_PAGE_CODES.map((code) => ({ code: String(code) }))
}

export async function generateMetadata({ params }: HttpErrorRoutePageProps): Promise<Metadata> {
  const { code } = await params
  const status = normalizeHttpErrorCode(code)
  const definition = getHttpErrorDefinition(status)
  return {
    title: `${definition.title} | Virtual Tracker`,
    description: definition.description,
  }
}

export default async function HttpErrorRoutePage({ params }: HttpErrorRoutePageProps) {
  const { code } = await params
  const status = normalizeHttpErrorCode(code)

  if (!isSupportedHttpErrorPageCode(status) || String(status) !== code.trim()) {
    notFound()
  }

  return <HttpErrorPage status={status} />
}
