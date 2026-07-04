const LANDING_API_URL = process.env.NEXT_PUBLIC_LANDING_API_URL?.trim() ?? ""

export type ContactInquiry = {
  name: string
  email: string
  topic: string
  teamSize: string
  message: string
}

/** Submits a landing-page contact inquiry to Landing-Backend. Throws on failure. */
export async function submitContactInquiry(input: ContactInquiry): Promise<void> {
  if (!LANDING_API_URL) {
    throw new Error("The contact form is not available right now.")
  }
  const res = await fetch(`${LANDING_API_URL}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || "Could not submit your message. Please try again.")
  }
}
