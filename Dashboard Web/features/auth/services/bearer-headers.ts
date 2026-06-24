export function bearerAuthHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}
