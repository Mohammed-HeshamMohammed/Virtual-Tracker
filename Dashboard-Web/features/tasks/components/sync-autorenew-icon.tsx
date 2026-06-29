import { cn } from "@/shared/utils/utils"

/** Rounded two-arc autorenew icon (matches Hubstaff-style sync glyph). */
export function SyncAutorenewIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path
        d="M17.2 8.2C15.4 5.9 12.3 4.6 9.2 5.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M7.4 6.6L5.2 8.8L7.4 11"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.8 15.8C8.6 18.1 11.7 19.4 14.8 18.6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M16.6 17.4L18.8 15.2L16.6 12.8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
