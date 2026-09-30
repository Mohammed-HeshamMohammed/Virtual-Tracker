type Props = { initials: string; color?: string; size?: "sm" | "md" | "lg" };

export function Avatar({ initials, color = "violet", size = "md" }: Props) {
  return <span className={`avatar avatar-${color} avatar-${size}`}>{initials}</span>;
}
