import { useState, type ReactNode } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { downloadCsv, useWorkspace, type Role, type Session } from "../../../workspace";
import type { WorkProject } from "../../../data/work";
import { EmptyState, SearchField } from "../../ui";
import { Avatar } from "../DashboardParts";

/** What every page gets from the Dashboard shell. */
export type PageContext = {
  /** The role-scoped sessions inside the top bar's date range. */
  sessions: Session[];
  /** The role-scoped sessions of all time (for pages that choose their own period). */
  allSessions: Session[];
  projects: WorkProject[];
  /** Every project this role may see, whatever the sidebar is scoped to. */
  visibleProjects: WorkProject[];
  /** The role-scoped sessions of all time, whatever the sidebar is scoped to. */
  unscopedSessions: Session[];
  role: Role;
  /** Owner, Admin or Manager. */
  canManage: boolean;
  /** Owner or Admin. */
  isAdmin: boolean;
  range: string;
  /** "all", or the id of the one project the sidebar has scoped the Dashboard to. */
  projectScope: string;
  /** Opens another Dashboard page (a section or a page id), optionally on one record. */
  go: (page: string, target?: string) => void;
};

/** A row of headline numbers at the top of a page. */
export function Kpis({ items }: { items: { label: string; value: ReactNode; unit?: string; tone?: "good" | "warn" }[] }) {
  return (
    <div className="db-kpis">
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `tone-${item.tone}` : undefined}>
          <span>{item.label}</span>
          <strong>
            {item.value}
            {item.unit && <small>{item.unit}</small>}
          </strong>
        </div>
      ))}
    </div>
  );
}

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  /** The value written to the CSV export. Columns without one are left out. */
  csv?: (row: T) => string | number;
  numeric?: boolean;
};

/** A searchable, exportable table inside a card. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = "Search",
  toolbar,
  exportName,
  emptyTitle = "Nothing here yet",
  emptyHint = "Records will show up here.",
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  exportName?: string;
  emptyTitle?: string;
  emptyHint?: string;
  footer?: ReactNode;
}) {
  const { notify } = useWorkspace();
  const [query, setQuery] = useState("");
  const shown = searchText && query ? rows.filter((row) => searchText(row).toLowerCase().includes(query.toLowerCase())) : rows;
  const exportable = columns.filter((column) => column.csv);
  return (
    <section className="sf-card db-table-card">
      {(searchText || toolbar || exportName) && (
        <div className="db-filter-row">
          {searchText && <SearchField value={query} onChange={setQuery} placeholder={searchPlaceholder} />}
          {toolbar}
          {exportName && exportable.length > 0 && (
            <button
              className="sf-button"
              disabled={!shown.length}
              onClick={() => {
                downloadCsv(`softfix-${exportName}.csv`, [
                  exportable.map((column) => column.header),
                  ...shown.map((row) => exportable.map((column) => column.csv!(row))),
                ]);
                notify("Export downloaded.");
              }}
            >
              <DownloadSimple size={16} /> Export
            </button>
          )}
        </div>
      )}
      {shown.length > 0 ? (
        <div className="db-table-scroll">
          <table className="sf-table db-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.header} className={column.numeric ? "db-number" : undefined}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.header} className={column.numeric ? "db-number" : undefined}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={query ? "No matches" : emptyTitle}
          description={query ? "Try a different search." : emptyHint}
          action={query ? "Clear search" : undefined}
          onAction={() => setQuery("")}
        />
      )}
      <div className="db-table-footer">
        <span>
          {shown.length} {shown.length === 1 ? "record" : "records"}
        </span>
        <span>{footer ?? "Kept on this device"}</span>
      </div>
    </section>
  );
}

/** A member's avatar and name (with a second line), as used in every table. */
export function Person({ id, detail }: { id: string; detail?: ReactNode }) {
  const { members } = useWorkspace();
  const member = members.find((item) => item.id === id);
  return (
    <div className="db-person-cell">
      <Avatar name={member?.name || "Team member"} color={member?.color} />
      <div>
        <strong>{member?.name || "Team member"}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}

/** Approve / reject buttons for a pending row. Nothing shows once it has been decided. */
export function Decide({ onApprove, onReject, approve = "Approve", reject = "Reject" }: { onApprove: () => void; onReject: () => void; approve?: string; reject?: string }) {
  return (
    <div className="db-decide">
      <button className="sf-button primary" onClick={onApprove}>
        {approve}
      </button>
      <button className="sf-button" onClick={onReject}>
        {reject}
      </button>
    </div>
  );
}

export const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
export const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
export const dateLabel = (day: string) =>
  new Date(day.length === 10 ? `${day}T12:00:00` : day).toLocaleDateString("en", { day: "numeric", month: "short" });
