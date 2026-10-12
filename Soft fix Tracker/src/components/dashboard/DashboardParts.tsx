import { ArrowUpRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
export function Avatar({
  name,
  color = "blue",
}: {
  name: string;
  color?: string;
}) {
  return (
    <span className={`db-avatar ${color}`} aria-hidden="true">
      {name
        .split(" ")
        .map((word) => word[0])
        .join("")
        .slice(0, 2)}
    </span>
  );
}
export function Badge({ text }: { text: string }) {
  return (
    <span
      className={`db-badge db-status-${text.toLowerCase().replaceAll(" ", "-")}`}
    >
      {text}
    </span>
  );
}
/** A stat tile: a title, an optional round arrow that opens the page behind the number, then the content. */
export function StatTile({
  title,
  action,
  onOpen,
  hero,
  children,
}: {
  title: string;
  action?: string;
  onOpen?: () => void;
  hero?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`sf-card db-tile ${hero ? "db-hero" : ""}`}>
      <div className="db-tile-top">
        <span>{title}</span>
        {onOpen && (
          <button className="db-arrow" aria-label={action ?? title} title={action ?? title} onClick={onOpen}>
            <ArrowUpRight weight="bold" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="sf-page-header db-page-heading">
      <div>
        <div className="db-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="db-heading-actions">{children}</div>}
    </div>
  );
}
export function Money({ amount }: { amount: number }) {
  return (
    <>
      {new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(amount)}
    </>
  );
}
export function ShortDate({ value }: { value: string }) {
  return (
    <>
      {new Date(
        value.length === 10 ? `${value}T12:00:00` : value,
      ).toLocaleDateString("en", { day: "numeric", month: "short" })}
    </>
  );
}

/** A labelled dropdown for the filters that used to be a row of tabs: it takes one control's worth
 *  of room next to the search box instead of a whole row. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; text: string; count?: number }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="db-filter-select">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
            {option.count !== undefined ? ` (${option.count})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
