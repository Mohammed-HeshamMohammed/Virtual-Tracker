import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/** Keep auth/session on one local origin — localhost and 127.0.0.1 are different sites. */
export function middleware(request: NextRequest) {
  const host = request.nextUrl.hostname.toLowerCase()
  if (host !== "127.0.0.1") return NextResponse.next()

  const url = request.nextUrl.clone()
  url.hostname = "localhost"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: "/:path*",
}
