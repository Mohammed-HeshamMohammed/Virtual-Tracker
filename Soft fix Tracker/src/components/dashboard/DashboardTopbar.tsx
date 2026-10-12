import {
  CalendarBlank,
  CaretDown,
  CaretRight,
  DownloadSimple,
  X,
} from "@phosphor-icons/react";
import { useWorkspace, type Role } from "../../workspace";
import { MenuButton, type MenuEntry } from "../MenuButton";

/** The top bar: where you are, as Section > Page (it starts with the sidebar's own title), with the page name a dropdown that
 *  lists the section's other pages (so they don't need a row of tabs), then the role preview, the
 *  date range and Export. */
export function DashboardTopbar({
  sectionLabel,
  pageLabel,
  pageMenu,
  scopeName,
  onClearScope,
  range,
  onRangeChange,
  onExport,
}: {
  sectionLabel: string;
  pageLabel: string;
  /** The section's pages. With more than one, the page name opens them as a menu. */
  pageMenu: MenuEntry[];
  /** The project the Dashboard is narrowed to, if any, and how to widen it again. */
  scopeName?: string;
  onClearScope: () => void;
  range: string;
  onRangeChange: (value: string) => void;
  onExport: () => void;
}) {
  const { profile, setProfile } = useWorkspace();
  return (
    <header className="db-topbar">
      <div className="db-breadcrumb">
        {pageLabel && pageLabel !== sectionLabel ? (
          <>
            <span>{sectionLabel}</span>
            <CaretRight size={13} />
            {pageMenu.length > 1 ? (
              <MenuButton label={`${sectionLabel} pages`} className="db-crumb-menu" entries={pageMenu}>
                <strong>{pageLabel}</strong>
                <CaretDown size={13} weight="bold" />
              </MenuButton>
            ) : (
              <strong>{pageLabel}</strong>
            )}
          </>
        ) : (
          <strong>{sectionLabel}</strong>
        )}
      </div>
      <div className="db-topbar-actions">
        {scopeName && (
          <button className="db-scope-chip" onClick={onClearScope} title="Show every project again">
            <span>Project</span>
            <strong>{scopeName}</strong>
            <X size={12} weight="bold" />
          </button>
        )}
        <label className="db-role-picker">
          <span>Preview as</span>
          <select
            aria-label="Dashboard role preview"
            value={profile.role}
            onChange={(event) =>
              setProfile((previous) => ({
                ...previous,
                role: event.target.value as Role,
              }))
            }
          >
            {["Owner", "Admin", "Manager", "Member", "Client"].map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <label className="db-range-picker">
          <CalendarBlank size={16} />
          <select
            aria-label="Dashboard date range"
            value={range}
            onChange={(event) => onRangeChange(event.target.value)}
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </label>
        <button
          className="sf-icon-button"
          aria-label="Export dashboard data"
          title="Export dashboard data"
          onClick={onExport}
        >
          <DownloadSimple size={19} />
        </button>
      </div>
    </header>
  );
}
