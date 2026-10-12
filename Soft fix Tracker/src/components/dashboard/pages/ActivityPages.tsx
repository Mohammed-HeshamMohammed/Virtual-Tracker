import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { AppleLogo, Camera, CheckCircle, DownloadSimple, LinuxLogo, Plus, ShieldCheck, WindowsLogo, XCircle } from "@phosphor-icons/react";
import { formatDuration, usePersistentState, useWorkspace } from "../../../workspace";
import { Modal } from "../../ui";
import { Badge, FilterSelect, PageHeading } from "../DashboardParts";
import { appUsage, captures, siteUsage, toolUsage, type Capture, type Kind } from "./activity-data";
import { DataTable, Decide, Kpis, Person, type PageContext } from "./kit";
import { logAudit, newId, useDashboardStores, type RemovalRequest } from "./stores";
import "./pages-extra.css";

/** The sessions an Activity page looks at: the date range, optionally one person. */
function useScope(ctx: PageContext) {
  const { members } = useWorkspace();
  const [memberId, setMemberId] = useState("all");
  const sessions = useMemo(() => ctx.sessions.filter((session) => memberId === "all" || session.memberId === memberId), [ctx.sessions, memberId]);
  const people = [...new Set(ctx.sessions.map((session) => session.memberId))];
  const picker =
    ctx.canManage && people.length > 1 ? (
      <label className="db-select-wrap">
        <select aria-label="Show activity for" value={memberId} onChange={(event) => setMemberId(event.target.value)}>
          <option value="all">Everyone</option>
          {people.map((id) => (
            <option key={id} value={id}>
              {members.find((member) => member.id === id)?.name ?? "Team member"}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  return { sessions, picker };
}

const Share = ({ part, whole }: { part: number; whole: number }) => {
  const percent = whole ? Math.round((part / whole) * 100) : 0;
  return (
    <span className="db-share">
      <i style={{ width: `${percent}%` }} />
      <b>{percent}%</b>
    </span>
  );
};

const KINDS: Kind[] = ["Productive", "Neutral", "Distracting"];

/** How the time splits into productive, neutral and distracting: one bar and its three figures. */
function KindSplit({ title, parts }: { title: string; parts: Record<Kind, number> }) {
  const total = KINDS.reduce((sum, kind) => sum + parts[kind], 0);
  return (
    <section className="sf-card ap-panel">
      <div className="db-card-heading">
        <div>
          <h2>{title}</h2>
          <p>{total ? `${Math.round((parts.Productive / total) * 100)}% of tracked time was productive` : "Nothing tracked in this period"}</p>
        </div>
      </div>
      <div className="ap-split" role="img" aria-label={KINDS.map((kind) => `${kind} ${total ? Math.round((parts[kind] / total) * 100) : 0}%`).join(", ")}>
        {KINDS.map((kind) => (parts[kind] > 0 ? <i key={kind} className={kind.toLowerCase()} style={{ flexGrow: parts[kind] }} /> : null))}
      </div>
      <div className="ap-split-legend">
        {KINDS.map((kind) => (
          <div key={kind}>
            <span>
              <i className={kind.toLowerCase()} /> {kind}
            </span>
            <strong>{formatDuration(parts[kind])}</strong>
            <small>{total ? Math.round((parts[kind] / total) * 100) : 0}%</small>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The few biggest, as bars: what took the most time. */
function TopList({ title, hint, rows }: { title: string; hint: string; rows: { name: string; seconds: number; kind: Kind }[] }) {
  const most = rows[0]?.seconds || 1;
  return (
    <section className="sf-card ap-panel">
      <div className="db-card-heading">
        <div>
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
      </div>
      {rows.length ? (
        <div className="db-hbars ap-top">
          {rows.slice(0, 5).map((row) => (
            <div key={row.name} className={`db-hbar ap-${row.kind.toLowerCase()}`}>
              <span title={row.name}>{row.name}</span>
              <i>
                <b style={{ width: `${(row.seconds / most) * 100}%` }} />
              </i>
              <strong>{formatDuration(row.seconds)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="db-muted ap-none">Nothing tracked in this period.</p>
      )}
    </section>
  );
}

const kindFilter = (rows: { kind: Kind }[]) => [
  { value: "all", text: "All categories", count: rows.length },
  ...KINDS.map((kind) => ({ value: kind as string, text: kind as string, count: rows.filter((row) => row.kind === kind).length })),
];

/** What a site is for, from its address: work tools are productive, mail and chat neutral. */
const siteKind = (domain: string): Kind =>
  /spotify|youtube|netflix|facebook|instagram|tiktok|twitter|reddit/.test(domain) ? "Distracting" : /mail\.|calendar\.|slack|^google\.com$/.test(domain) ? "Neutral" : "Productive";

/** What an Activity page shows when its switch in Settings is off. */
function TrackingOff({ ctx, title, what, plural = false }: { ctx: PageContext; title: string; what: string; plural?: boolean }) {
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PULSE OF YOUR TEAM" title={title} description={`${what} ${plural ? "are" : "is"} turned off.`} />
      <section className="sf-card db-table-card">
        <div className="sf-empty">
          <Camera size={32} />
          <h3>
            {what} {plural ? "are" : "is"} turned off
          </h3>
          <p>Turn it on under Activity &amp; tracking in Settings to see it here.</p>
          <button className="sf-button" onClick={() => ctx.go("settings")}>
            Open settings
          </button>
        </div>
      </section>
    </div>
  );
}

/** Screenshots: sample captures from each session. Open one to ask for it to be removed. */
export function ScreenshotsPage({ ctx }: { ctx: PageContext }) {
  const { projects, members, profile, notify, preferences } = useWorkspace();
  const stores = useDashboardStores();
  const { sessions, picker } = useScope(ctx);
  const [shown, setShown] = useState(12);
  const [open, setOpen] = useState<Capture | null>(null);
  const [reason, setReason] = useState("");
  const [level, setLevel] = useState("all");
  const all = useMemo(() => captures(sessions, preferences.captureInterval), [sessions, preferences.captureInterval]);
  const band = (activity: number) => (activity >= 80 ? "high" : activity >= 65 ? "steady" : "low");
  const visible = all.filter((shot) => level === "all" || band(shot.activity) === level);
  const days = useMemo(() => {
    const groups = new Map<string, Capture[]>();
    for (const shot of all.filter((item) => level === "all" || band(item.activity) === level).slice(0, shown)) {
      const day = new Date(shot.at).toDateString();
      groups.set(day, [...(groups.get(day) ?? []), shot]);
    }
    return [...groups.entries()];
  }, [all, level, shown]);
  const average = all.length ? Math.round(all.reduce((sum, shot) => sum + shot.activity, 0) / all.length) : 0;
  const name = (id: string) => members.find((member) => member.id === id)?.name ?? "Team member";

  const requestRemoval = (event: FormEvent) => {
    event.preventDefault();
    if (!open || !reason.trim()) return;
    const request: RemovalRequest = {
      id: newId("rm"),
      memberId: open.memberId,
      kind: "Screenshot",
      item: `Screenshot of ${open.title} at ${new Date(open.at).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`,
      reason: reason.trim(),
      status: "Pending",
    };
    stores.setRemovals((old) => [request, ...old]);
    logAudit(stores, profile.name, "Asked for a screenshot to be removed.");
    setOpen(null);
    setReason("");
    notify("Removal requested.");
  };

  if (!preferences.captureScreenshots) return <TrackingOff ctx={ctx} title="Screenshots" what="Screenshots" plural />;
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PULSE OF YOUR TEAM" title="Screenshots" description="Sample captures from tracked sessions, newest first. Anything private can be sent for removal.">
        <FilterSelect
          label="Activity"
          value={level}
          onChange={(value) => {
            setLevel(value);
            setShown(12);
          }}
          options={[
            { value: "all", text: "All captures", count: all.length },
            { value: "high", text: "High (80%+)", count: all.filter((shot) => band(shot.activity) === "high").length },
            { value: "steady", text: "Steady (65-79%)", count: all.filter((shot) => band(shot.activity) === "steady").length },
            { value: "low", text: "Low (under 65%)", count: all.filter((shot) => band(shot.activity) === "low").length },
          ]}
        />
        {picker}
      </PageHeading>
      <Kpis
        items={[
          { label: "Captures", value: all.length },
          { label: "Average activity", value: `${average}%`, tone: average >= 75 ? "good" : undefined },
          { label: "Low-activity captures", value: all.filter((shot) => band(shot.activity) === "low").length, tone: all.some((shot) => band(shot.activity) === "low") ? "warn" : "good" },
          { label: "People", value: new Set(all.map((shot) => shot.memberId)).size },
        ]}
      />
      {visible.length ? (
        <>
          {days.map(([day, shots]) => (
            <section key={day} className="ap-day">
              <header>
                <h2>{new Date(day).toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}</h2>
                <span>
                  {shots.length} {shots.length === 1 ? "capture" : "captures"} · {Math.round(shots.reduce((sum, shot) => sum + shot.activity, 0) / shots.length)}% average activity
                </span>
              </header>
              <div className="db-shots">
                {shots.map((shot) => (
                  <button key={shot.id} className="sf-card db-shot" onClick={() => setOpen(shot)}>
                    <span className="db-shot-art" data-app={shot.app} style={{ "--tone": 20 + (shot.activity % 7) * 40 } as CSSProperties}>
                      <i />
                      <i />
                      <i />
                      <em>{shot.app}</em>
                    </span>
                    <span className="db-shot-meta">
                      <strong>{name(shot.memberId)}</strong>
                      <small>
                        {new Date(shot.at).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })} · {shot.title}
                      </small>
                    </span>
                    <span className={`ap-meter ${band(shot.activity)}`} title={`${shot.activity}% activity`}>
                      <span className="db-progress">
                        <span style={{ width: `${shot.activity}%` }} />
                      </span>
                      <b>{shot.activity}%</b>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {shown < visible.length && (
            <div className="db-more">
              <button className="sf-button" onClick={() => setShown(shown + 12)}>
                Show more ({visible.length - shown} left)
              </button>
            </div>
          )}
        </>
      ) : (
        <section className="sf-card db-table-card">
          <div className="sf-empty">
            <Camera size={32} />
            <h3>{all.length ? "No captures at that activity level" : "No captures in this period"}</h3>
            <p>{all.length ? "Choose another level to see more." : "Captures appear while you track time in Work."}</p>
          </div>
        </section>
      )}
      {open && (
        <Modal title="Screenshot" description={`${name(open.memberId)} · ${projects.find((project) => project.id === open.projectId)?.name ?? ""}`} onClose={() => setOpen(null)}>
          <span className="db-shot-art large" data-app={open.app} style={{ "--tone": 20 + (open.activity % 7) * 40 } as CSSProperties}>
            <i />
            <i />
            <i />
            <em>{open.app}</em>
          </span>
          <p className="db-form-hint">
            Sample capture in {open.app} · {open.activity}% activity · {open.title}
          </p>
          <form onSubmit={requestRemoval}>
            <label className="db-field">
              Ask for this to be removed
              <input value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} placeholder="Why should it be removed?" />
            </label>
            <div className="db-modal-actions">
              <button className="sf-button" type="button" onClick={() => setOpen(null)}>
                Close
              </button>
              <button className="sf-button primary" type="submit" disabled={!reason.trim()}>
                Request removal
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** Apps: where the time went, app by app, and how much of it was productive. */
export function AppsPage({ ctx }: { ctx: PageContext }) {
  const { members, preferences } = useWorkspace();
  const { sessions, picker } = useScope(ctx);
  const [kind, setKind] = useState("all");
  const apps = useMemo(() => appUsage(sessions), [sessions]);
  const total = apps.reduce((sum, app) => sum + app.seconds, 0);
  const parts = Object.fromEntries(KINDS.map((entry) => [entry, apps.filter((app) => app.kind === entry).reduce((sum, app) => sum + app.seconds, 0)])) as Record<Kind, number>;
  const topPerson = (byMember: Record<string, number>) => {
    const best = Object.entries(byMember).sort((a, b) => b[1] - a[1])[0];
    return best ? members.find((member) => member.id === best[0])?.name ?? "" : "";
  };
  if (!preferences.trackAppsUrls) return <TrackingOff ctx={ctx} title="Apps" what="App tracking" />;
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PULSE OF YOUR TEAM" title="Apps" description="The applications used during tracked time, and what kind of time it was.">
        <FilterSelect label="Category" value={kind} onChange={setKind} options={kindFilter(apps)} />
        {picker}
      </PageHeading>
      <Kpis items={[{ label: "Apps used", value: apps.length }, { label: "Time in apps", value: formatDuration(total) }, { label: "Productive time", value: `${total ? Math.round((parts.Productive / total) * 100) : 0}%`, tone: "good" }, { label: "Top app", value: apps[0]?.app ?? "-" }]} />
      <div className="ap-pair">
        <KindSplit title="How the time was spent" parts={parts} />
        <TopList title="Most used apps" hint="By time, in this period" rows={apps.map((app) => ({ name: app.app, seconds: app.seconds, kind: app.kind }))} />
      </div>
      <DataTable
        rows={apps.filter((app) => kind === "all" || app.kind === kind)}
        rowKey={(row) => row.app}
        searchText={(row) => `${row.app} ${row.tool}`}
        searchPlaceholder="Search apps"
        exportName="apps"
        emptyTitle="No app activity"
        emptyHint="App use is recorded while tracking."
        columns={[
          { header: "App", cell: (row) => <span className="ap-name"><i className={`ap-glyph ${row.kind.toLowerCase()}`}>{row.app[0]}</i><strong>{row.app}</strong></span>, csv: (row) => row.app },
          { header: "Used for", cell: (row) => row.tool, csv: (row) => row.tool },
          { header: "Category", cell: (row) => <Badge text={row.kind} />, csv: (row) => row.kind },
          { header: "People", numeric: true, cell: (row) => Object.keys(row.byMember).length, csv: (row) => Object.keys(row.byMember).length },
          { header: "Most used by", cell: (row) => topPerson(row.byMember), csv: (row) => topPerson(row.byMember) },
          { header: "Time", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => Math.round(row.seconds / 60) },
          { header: "Share", cell: (row) => <Share part={row.seconds} whole={total} /> },
        ]}
      />
    </div>
  );
}

/** URLs: the sites visited during tracked time. */
export function UrlsPage({ ctx }: { ctx: PageContext }) {
  const { members, preferences } = useWorkspace();
  const { sessions, picker } = useScope(ctx);
  const [kind, setKind] = useState("all");
  const sites = useMemo(() => siteUsage(sessions).map((site) => ({ ...site, kind: siteKind(site.domain) })), [sessions]);
  const total = sites.reduce((sum, site) => sum + site.seconds, 0);
  const visits = sites.reduce((sum, site) => sum + site.visits, 0);
  const parts = Object.fromEntries(KINDS.map((entry) => [entry, sites.filter((site) => site.kind === entry).reduce((sum, site) => sum + site.seconds, 0)])) as Record<Kind, number>;
  const topPerson = (byMember: Record<string, number>) => {
    const best = Object.entries(byMember).sort((a, b) => b[1] - a[1])[0];
    return best ? members.find((member) => member.id === best[0])?.name ?? "" : "";
  };
  if (!preferences.trackAppsUrls) return <TrackingOff ctx={ctx} title="URLs" what="Website tracking" />;
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PULSE OF YOUR TEAM" title="URLs" description="The websites visited during tracked time. Only the site is kept, never the full address.">
        <FilterSelect label="Category" value={kind} onChange={setKind} options={kindFilter(sites)} />
        {picker}
      </PageHeading>
      <Kpis items={[{ label: "Sites", value: sites.length }, { label: "Page visits", value: visits }, { label: "Time on sites", value: formatDuration(total) }, { label: "Top site", value: sites[0]?.domain ?? "-" }]} />
      <div className="ap-pair">
        <KindSplit title="What the browsing was for" parts={parts} />
        <TopList title="Most visited sites" hint="By time, in this period" rows={sites.map((site) => ({ name: site.domain, seconds: site.seconds, kind: site.kind }))} />
      </div>
      <DataTable
        rows={sites.filter((site) => kind === "all" || site.kind === kind)}
        rowKey={(row) => row.domain}
        searchText={(row) => `${row.domain} ${row.title}`}
        searchPlaceholder="Search sites"
        exportName="urls"
        emptyTitle="No site activity"
        emptyHint="Sites are recorded while tracking."
        columns={[
          { header: "Site", cell: (row) => <span className="ap-name"><i className={`ap-glyph ${row.kind.toLowerCase()}`}>{row.domain[0].toUpperCase()}</i><span><strong>{row.domain}</strong><small>{row.title}</small></span></span>, csv: (row) => row.domain },
          { header: "Category", cell: (row) => <Badge text={row.kind} />, csv: (row) => row.kind },
          { header: "Visits", numeric: true, cell: (row) => row.visits, csv: (row) => row.visits },
          { header: "Average visit", numeric: true, cell: (row) => formatDuration(row.seconds / Math.max(1, row.visits)), csv: (row) => Math.round(row.seconds / Math.max(1, row.visits)) },
          { header: "Most visited by", cell: (row) => topPerson(row.byMember), csv: (row) => topPerson(row.byMember) },
          { header: "Time", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => Math.round(row.seconds / 60) },
          { header: "Share", cell: (row) => <Share part={row.seconds} whole={total} /> },
        ]}
      />
    </div>
  );
}

/** Where the tracker's installers come from: the same download service the real Dashboard uses. */
const DOWNLOAD = "https://api.myvirtualtracker.com/api/download?platform=";
const PLATFORMS = [
  { id: "windows", name: "Windows", detail: ".exe / .msi installer", needs: "Windows 10 or 11", icon: <WindowsLogo weight="fill" /> },
  { id: "mac", name: "macOS", detail: ".dmg installer", needs: "macOS 11 or later", icon: <AppleLogo weight="fill" /> },
  { id: "linux", name: "Linux", detail: ".AppImage / .deb", needs: "Ubuntu or Debian", icon: <LinuxLogo weight="fill" /> },
];

/** Tools: what works with Soft Fix. First the tracker itself, which is its own program and is
 *  downloaded on its own for each computer; then the tools people use while tracking, and which of
 *  them are allowed (an owner, admin or manager decides; everyone can see the list). */
export function ToolsPage({ ctx }: { ctx: PageContext }) {
  const { preferences, profile, notify } = useWorkspace();
  const stores = useDashboardStores();
  const { sessions, picker } = useScope(ctx);
  const tools = useMemo(() => toolUsage(appUsage(sessions)), [sessions]);
  const [choices, setChoices] = usePersistentState<Record<string, boolean>>("dashboard.allowed-tools", {});
  const total = tools.reduce((sum, tool) => sum + tool.seconds, 0);
  // Until someone decides, a tool is allowed unless it is a distracting one.
  const allowed = (tool: { tool: string; kind: Kind }) => choices[tool.tool] ?? tool.kind !== "Distracting";
  const outside = tools.filter((tool) => !allowed(tool)).reduce((sum, tool) => sum + tool.seconds, 0);
  const toggle = (tool: { tool: string; kind: Kind }) => {
    const next = !allowed(tool);
    setChoices((old) => ({ ...old, [tool.tool]: next }));
    logAudit(stores, profile.name, `${next ? "Allowed" : "Stopped allowing"} ${tool.tool} tools.`);
    notify(next ? `${tool.tool} tools are allowed.` : `${tool.tool} tools are no longer allowed.`);
  };
  const capturing = preferences.captureScreenshots || preferences.trackAppsUrls;
  const records = [preferences.captureScreenshots && `a screenshot every ${preferences.captureInterval} minutes`, preferences.trackAppsUrls && "the apps and sites in use"].filter(Boolean).join(" and ") || "time only";

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PULSE OF YOUR TEAM" title="Tools" description="What works with Soft Fix: the tracker you install, and the tools your team may use while tracking.">
        {picker}
      </PageHeading>

      <section className="sf-card ap-panel ap-tracker">
        <div className="db-card-heading">
          <div>
            <h2>Soft Fix tracker</h2>
            <p>The tracker is its own program. Download it on its own for each computer, install it, sign in, then start and stop tracking from it.</p>
          </div>
          <span className={`ap-status ${capturing ? "on" : "off"}`}>
            {capturing ? <CheckCircle weight="fill" /> : <XCircle weight="fill" />}
            {capturing ? "Capture is on" : "Capture is off"}
          </span>
        </div>
        <div className="ap-downloads">
          {PLATFORMS.map((platform) => (
            <a key={platform.id} className="ap-download" href={`${DOWNLOAD}${platform.id}`} target="_blank" rel="noreferrer" title={`Download the tracker for ${platform.name}`}>
              <span className="ap-download-icon">{platform.icon}</span>
              <span className="ap-download-copy">
                <strong>{platform.name}</strong>
                <small>{platform.detail}</small>
                <small>{platform.needs}</small>
              </span>
              <span className="ap-download-go">
                <DownloadSimple weight="bold" /> Download
              </span>
            </a>
          ))}
        </div>
        <p className="ap-note">
          <ShieldCheck size={16} /> It records {records}, only while someone is tracking.{" "}
          <button className="db-text-button" onClick={() => ctx.go("settings")}>
            Change what is captured
          </button>
        </p>
      </section>

      <Kpis items={[{ label: "Tool groups in use", value: tools.length }, { label: "Allowed", value: tools.filter(allowed).length, tone: "good" }, { label: "Time in tools", value: formatDuration(total) }, { label: "Time outside allowed tools", value: formatDuration(outside), tone: outside ? "warn" : "good" }]} />

      {!preferences.trackAppsUrls ? (
        <section className="sf-card db-table-card">
          <div className="sf-empty">
            <h3>App tracking is turned off</h3>
            <p>Turn it on under Activity &amp; tracking in Settings to see which tools are used.</p>
            <button className="sf-button" onClick={() => ctx.go("settings")}>
              Open settings
            </button>
          </div>
        </section>
      ) : tools.length ? (
        <div className="db-tool-grid">
          {tools.map((tool) => (
            <section key={tool.tool} className={`sf-card db-tool ap-tool ${allowed(tool) ? "" : "blocked"}`}>
              <div className="db-card-heading">
                <div>
                  <h2>{tool.tool}</h2>
                  <p>{tool.apps.join(", ")}</p>
                </div>
                <span className={`ap-status ${allowed(tool) ? "on" : "off"}`}>
                  {allowed(tool) ? <CheckCircle weight="fill" /> : <XCircle weight="fill" />}
                  {allowed(tool) ? "Allowed" : "Not allowed"}
                </span>
              </div>
              <strong data-count>{formatDuration(tool.seconds)}</strong>
              <Share part={tool.seconds} whole={total} />
              <footer>
                <Badge text={tool.kind} />
                {ctx.canManage && (
                  <button className="sf-button" onClick={() => toggle(tool)}>
                    {allowed(tool) ? "Stop allowing" : "Allow"}
                  </button>
                )}
              </footer>
            </section>
          ))}
        </div>
      ) : (
        <section className="sf-card db-table-card">
          <div className="sf-empty">
            <h3>No tool activity</h3>
            <p>Tools are grouped from the apps used while tracking.</p>
          </div>
        </section>
      )}
    </div>
  );
}

/** Removal Requests: captured items someone has asked to have deleted. */
export function RemovalRequestsPage({ ctx }: { ctx: PageContext }) {
  const { profile, notify } = useWorkspace();
  const stores = useDashboardStores();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ kind: RemovalRequest["kind"]; item: string; reason: string }>({ kind: "App", item: "", reason: "" });
  const rows = ctx.canManage ? stores.removals : stores.removals.filter((request) => request.memberId === "me");
  const pending = rows.filter((request) => request.status === "Pending").length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.item.trim() || !form.reason.trim()) return;
    stores.setRemovals((old) => [{ id: newId("rm"), memberId: "me", kind: form.kind, item: form.item.trim(), reason: form.reason.trim(), status: "Pending" }, ...old]);
    logAudit(stores, profile.name, `Asked for a ${form.kind.toLowerCase()} to be removed.`);
    setOpen(false);
    setForm({ ...form, item: "", reason: "" });
    notify("Removal requested.");
  };
  const decide = (request: RemovalRequest, status: "Approved" | "Rejected") => {
    stores.setRemovals((old) => old.map((item) => (item.id === request.id ? { ...item, status } : item)));
    logAudit(stores, profile.name, `${status === "Approved" ? "Approved" : "Declined"} a request to remove "${request.item}".`);
    notify(status === "Approved" ? "Removal approved." : "Request declined.");
  };

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PULSE OF YOUR TEAM" title="Removal Requests" description="Private or mistaken items can be taken out of the record.">
        <button className="sf-button primary" onClick={() => setOpen(true)}>
          <Plus size={17} /> New request
        </button>
      </PageHeading>
      <Kpis items={[{ label: "Waiting for review", value: pending, tone: pending ? undefined : "good" }, { label: "Approved", value: rows.filter((request) => request.status === "Approved").length }, { label: "All requests", value: rows.length }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        searchText={(row) => `${row.item} ${row.reason} ${row.kind}`}
        searchPlaceholder="Search requests"
        exportName="removal-requests"
        emptyTitle="No removal requests"
        emptyHint="Ask for a screenshot, app or URL to be removed."
        columns={[
          { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.reason} /> },
          { header: "Item", cell: (row) => row.item, csv: (row) => row.item },
          { header: "Type", cell: (row) => row.kind, csv: (row) => row.kind },
          { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          { header: "", cell: (row) => (ctx.canManage && row.status === "Pending" ? <Decide approve="Remove it" reject="Decline" onApprove={() => decide(row, "Approved")} onReject={() => decide(row, "Rejected")} /> : null) },
        ]}
      />
      {open && (
        <Modal title="Request a removal" description="A manager reviews the request." onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <div className="db-form-grid">
              <label className="db-field">
                What is it?
                <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as RemovalRequest["kind"] })}>
                  <option>App</option>
                  <option>URL</option>
                  <option>Screenshot</option>
                </select>
              </label>
              <label className="db-field">
                Which one?
                <input required maxLength={120} value={form.item} onChange={(event) => setForm({ ...form, item: event.target.value })} placeholder="e.g. bank.example.com" />
              </label>
            </div>
            <label className="db-field">
              Reason
              <textarea required rows={3} maxLength={240} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            </label>
            <div className="db-modal-actions">
              <button className="sf-button" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="sf-button primary" type="submit">
                Send request
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
