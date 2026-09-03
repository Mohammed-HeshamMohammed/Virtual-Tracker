export type IconName =
  | "check"
  | "check-filled"
  | "circle"
  | "warn"
  | "error"
  | "info"
  | "close"
  | "undo"
  | "chevron"
  | "external"
  | "gear"
  | "refresh"
  | "bolt"
  | "lock"
  | "clock";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const p = {
    className: className ? `vt-icon ${className}` : "vt-icon",
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "check":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7.5" />
          <path d="m6.8 10.2 2.1 2.1 4.3-4.4" />
        </svg>
      );
    case "check-filled":
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm3.9 5.9-4.6 4.7a.8.8 0 0 1-1.1 0L6.1 11a.8.8 0 1 1 1.1-1.1l1.6 1.6 4-4.2a.8.8 0 1 1 1.1 1.1Z" />
        </svg>
      );
    case "circle":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7.5" />
        </svg>
      );
    case "warn":
      return (
        <svg {...p}>
          <path d="M10 3.4 2.9 15.6h14.2L10 3.4Z" />
          <path d="M10 8v3.1M10 13.6v.01" />
        </svg>
      );
    case "error":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7.5" />
          <path d="m7.7 7.7 4.6 4.6M12.3 7.7l-4.6 4.6" />
        </svg>
      );
    case "info":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9.2v4M10 6.6v.01" />
        </svg>
      );
    case "close":
      return (
        <svg {...p}>
          <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
        </svg>
      );
    case "undo":
      return (
        <svg {...p}>
          <path d="M3.5 8.5h7a4 4 0 0 1 0 8H7" />
          <path d="M6 5.5 3 8.5l3 3" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...p}>
          <path d="m7.5 4.5 5 5.5-5 5.5" />
        </svg>
      );
    case "external":
      return (
        <svg {...p}>
          <path d="M11 4h5v5M16 4l-7 7" />
          <path d="M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" />
        </svg>
      );
    case "gear":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="2.6" />
          <path d="M15.9 12.1a1.3 1.3 0 0 0 .3 1.4l.1.1a1.5 1.5 0 1 1-2.2 2.2l-.1-.1a1.3 1.3 0 0 0-1.4-.3 1.3 1.3 0 0 0-.8 1.2v.2a1.5 1.5 0 1 1-3 0v-.1a1.3 1.3 0 0 0-.9-1.2 1.3 1.3 0 0 0-1.4.3l-.1.1a1.5 1.5 0 1 1-2.2-2.2l.1-.1a1.3 1.3 0 0 0 .3-1.4 1.3 1.3 0 0 0-1.2-.8h-.2a1.5 1.5 0 1 1 0-3h.1a1.3 1.3 0 0 0 1.2-.9 1.3 1.3 0 0 0-.3-1.4l-.1-.1a1.5 1.5 0 1 1 2.2-2.2l.1.1a1.3 1.3 0 0 0 1.4.3h.1a1.3 1.3 0 0 0 .8-1.2v-.2a1.5 1.5 0 1 1 3 0v.1a1.3 1.3 0 0 0 .8 1.2 1.3 1.3 0 0 0 1.4-.3l.1-.1a1.5 1.5 0 1 1 2.2 2.2l-.1.1a1.3 1.3 0 0 0-.3 1.4v.1a1.3 1.3 0 0 0 1.2.8h.2a1.5 1.5 0 1 1 0 3h-.1a1.3 1.3 0 0 0-1.2.8Z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...p}>
          <path d="M16.5 8.5a6.5 6.5 0 1 0 .4 3.4" />
          <path d="M17 4v4.5h-4.5" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...p}>
          <path d="M11 2.5 4.5 11h4l-.5 6.5L15 9h-4l0-6.5Z" />
        </svg>
      );
    case "lock":
      return (
        <svg {...p}>
          <rect x="4.2" y="8.6" width="11.6" height="8.2" rx="1.8" />
          <path d="M7 8.6V6.4a3 3 0 0 1 6 0v2.2" />
        </svg>
      );
    case "clock":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 5.9V10l2.7 1.6" />
        </svg>
      );
    default:
      return null;
  }
}
