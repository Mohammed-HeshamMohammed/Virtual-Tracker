import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { useWorkspace } from "../../../workspace";
import type { WorkProject } from "../../../data/work";
import type { ProjectMeta } from "../../../data/projectMeta";
import { PROJECT_TYPES, projectTypeDef, type ProjectType } from "../../../data/projectTypes";
import { Avatar, PageHeading } from "../DashboardParts";
import type { PageContext } from "./kit";
import { AvatarPicker, type ProjectPicture } from "./AvatarPicker";
import { ProjectAvatar } from "./project-facts";
import { logAudit, useDashboardStores } from "./stores";
import "../project-form.css";

const COLORS = ["blue", "violet", "cyan", "green", "gold", "orange"];
const STEPS = [
  { label: "Type", hint: "How it tracks time" },
  { label: "Details", hint: "Name, dates, billing" },
  { label: "People", hint: "Client, managers, team" },
  { label: "Budget", hint: "Hours and refills" },
] as const;

type Form = {
  names: string;
  type: ProjectType;
  description: string;
  due: string;
  color: string;
  /** The project's picture, or null for none. */
  picture: ProjectPicture | null;
  billable: boolean;
  requireTask: boolean;
  clientId: string;
  managerIds: string[];
  memberIds: string[];
  useBudget: boolean;
  hours: string;
  resets: "Never" | "Weekly" | "Monthly";
  notifyAt: string;
};

const blank = (type: ProjectType): Form => {
  const def = projectTypeDef(type);
  return { names: "", type, description: "", due: "", color: "blue", picture: null, billable: def.billable, requireTask: def.requiresTask, clientId: "", managerIds: [], memberIds: [], useBudget: true, hours: "80", resets: def.resets, notifyAt: "80" };
};

/** New project and Edit project, as a page rather than a dialog: the sidebar stays where it is with
 *  Projects open, and the main pane becomes the form. Like the real Dashboard's it starts by asking what
 *  kind of project this is (that decides whether it has tasks, whether tracking needs one, whether it is
 *  billable and how a budget refills), then the details, the people on it and its time budget. Saving
 *  returns to the Projects page with the new project showing. Editing (the route's target is the
 *  project's id) skips the type: a project's type is fixed once it is made. */
export function NewProjectPage({ ctx }: { ctx: PageContext }) {
  const { projects, setProjects, members, notify, profile, route } = useWorkspace();
  const stores = useDashboardStores();
  const { projectMeta: meta, setProjectMeta: setMeta } = useWorkspace();
  const project: WorkProject | undefined = projects.find((item) => item.id === route.target);
  const editing = Boolean(project);
  const [step, setStep] = useState<number>(editing ? 1 : 0);
  const [error, setError] = useState("");
  /** Set once the project is saved. Leaving the page waits for this render's effects, which are what
   *  write the saved state to storage: leaving in the same breath would unmount the page before they ran. */
  const [saved, setSaved] = useState<{ ids: string[]; created: boolean } | null>(null);
  const [form, setForm] = useState<Form>(() => {
    if (!project) return blank("normal");
    const def = projectTypeDef(project.type);
    const kept = meta[project.id];
    return {
      names: project.name,
      type: def.value,
      description: kept?.description ?? "",
      due: kept?.due ?? "",
      color: project.color,
      picture: kept?.avatar || kept?.avatarGlyph ? { src: kept.avatar ?? "", crop: kept.avatarCrop, credit: kept.avatarCredit, glyph: kept.avatarGlyph } : null,
      billable: project.billable ?? def.billable,
      requireTask: project.requireTask ?? def.requiresTask,
      clientId: stores.clients.find((client) => client.projectIds.includes(project.id))?.id ?? "",
      managerIds: project.managerIds ?? [],
      memberIds: project.memberIds ?? [],
      useBudget: (kept?.budget ?? 80) > 0,
      hours: String(kept?.budget || 80),
      resets: kept?.resets ?? def.resets,
      notifyAt: String(kept?.notifyAt ?? 80),
    };
  });
  const def = projectTypeDef(form.type);
  const set = (patch: Partial<Form>) => setForm((old) => ({ ...old, ...patch }));
  const isManager = (role: string) => ["Owner", "Admin", "Manager"].includes(role);
  // Managers are chosen once, in their own list; everyone else (never a client) is "people on it".
  const managers = members.filter((member) => isManager(member.role));
  const people = members.filter((member) => member.role !== "Client" && !isManager(member.role));
  const names = useMemo(() => [...new Set(form.names.split(/\n|,/).map((name) => name.trim()).filter(Boolean))], [form.names]);

  useEffect(() => {
    if (!saved) return;
    // Back to the list, with the new projects marked; after an edit, to that project's page.
    if (saved.created) ctx.go("pm-projects", `new:${saved.ids.join(",")}`);
    else ctx.go("pm-project", saved.ids[0]);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickType = (type: ProjectType) => {
    const next = projectTypeDef(type);
    setForm((old) => ({ ...blank(type), names: old.names, description: old.description, due: old.due, color: old.color, picture: old.picture, clientId: old.clientId, managerIds: old.managerIds, memberIds: next.managersOnly ? [] : old.memberIds }));
    setError("");
    setStep(1);
  };
  const toggle = (key: "managerIds" | "memberIds", id: string) => set({ [key]: form[key].includes(id) ? form[key].filter((entry) => entry !== id) : [...form[key], id] } as Partial<Form>);

  /** What is wrong with a step, if anything. */
  const problem = (at: number) => {
    if (at === 1) {
      if (!names.length) return editing ? "Give the project a name." : "Give the project a name (one per line to make several).";
      const taken = names.find((name) => projects.some((item) => item.id !== project?.id && item.name.toLowerCase() === name.toLowerCase()));
      if (taken) return `There is already a project called "${taken}".`;
      if (editing && names.length > 1) return "A project has one name.";
    }
    if (at === 3 && form.useBudget) {
      const hours = Number(form.hours);
      if (!Number.isFinite(hours) || hours <= 0) return "Enter the hours the budget allows.";
      const notify = Number(form.notifyAt);
      if (!Number.isFinite(notify) || notify < 1 || notify > 100) return "Warn at a percentage between 1 and 100.";
    }
    return "";
  };
  const goTo = (target: number) => {
    // Back is always fine; forward only through steps that are in order.
    for (let at = step; at < target; at++) {
      const wrong = problem(at);
      if (wrong) {
        setError(wrong);
        return;
      }
    }
    setError("");
    setStep(target);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    // Enter in a field submits the form: while making a project that means "next", not "create".
    if (!editing && step < STEPS.length - 1) return goTo(step + 1);
    for (const at of [1, 3]) {
      const wrong = problem(at);
      if (wrong) {
        setError(wrong);
        setStep(at);
        return;
      }
    }
    const fields = { color: form.color, type: form.type, billable: form.billable, requireTask: def.hasTasks ? form.requireTask : false, managerIds: form.managerIds, memberIds: [...new Set([...form.memberIds, ...form.managerIds])] };
    const kept: ProjectMeta = { description: form.description.trim(), budget: form.useBudget ? Number(form.hours) : 0, due: form.due, resets: form.resets, notifyAt: Number(form.notifyAt), ...(form.picture ? { avatar: form.picture.src, avatarCrop: form.picture.crop, avatarCredit: form.picture.credit, avatarGlyph: form.picture.glyph } : {}) };
    const ids = editing ? [project!.id] : names.map(() => crypto.randomUUID());
    setProjects((old) => (editing ? old.map((item) => (item.id === project!.id ? { ...item, name: names[0], ...fields } : item)) : [...old, ...names.map((name, index): WorkProject => ({ id: ids[index], name, tasks: [], ...fields }))]));
    setMeta((old) => ({ ...old, ...Object.fromEntries(ids.map((id) => [id, kept])) }));
    // The client's projects follow the choice made here.
    stores.setClients((old) => old.map((client) => ({ ...client, projectIds: [...client.projectIds.filter((id) => !ids.includes(id)), ...(client.id === form.clientId ? ids : [])] })));
    logAudit(stores, profile.name, editing ? `Updated the project "${names[0]}".` : `Created ${names.length === 1 ? `the ${def.label.toLowerCase()} "${names[0]}"` : `${names.length} ${def.label.toLowerCase()} projects`}.`);
    notify(editing ? "Project updated across the workspace." : names.length === 1 ? (def.hasTasks ? "Project created. Open it to add its first task." : "Project created. Members time themselves on it.") : `${names.length} projects created.`);
    setSaved({ ids, created: !editing });
  };

  if (!ctx.canManage)
    return (
      <div className="sf-page db-page">
        <PageHeading eyebrow="GOOD THINGS, IN PROGRESS" title="New project" description="Only owners, admins and managers can make projects." />
        <button className="sf-button" onClick={() => ctx.go("pm-projects")}>
          Back to projects
        </button>
      </div>
    );

  const clientName = stores.clients.find((client) => client.id === form.clientId)?.name;
  const summary: [string, string][] = [
    ["Billing", form.billable ? "Billable" : "Not billable"],
    ["Tracking", def.hasTasks ? (form.requireTask ? "A task is required" : "Task optional") : "No tasks"],
    ["People", `${new Set([...form.memberIds, ...form.managerIds]).size || "Everyone"}${clientName ? ` · ${clientName}` : ""}`],
    ["Budget", form.useBudget ? `${form.hours || 0}h${form.resets === "Never" ? "" : form.resets === "Weekly" ? " a week" : " a month"}` : "None"],
  ];

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="GOOD THINGS, IN PROGRESS" title={editing ? "Edit project" : "New project"} description={editing ? `Change how ${project!.name} is set up.` : "Choose how it tracks time, then set it up."}>
        <button type="button" className="sf-button" onClick={() => (editing ? ctx.go("pm-project", project!.id) : ctx.go("pm-projects"))}>
          Cancel
        </button>
      </PageHeading>

      <div className="np-layout">
        <aside className="sf-card np-side">
          <ol className="np-steps" aria-label="Steps">
            {STEPS.map((entry, index) => (
              <li key={entry.label}>
                <button type="button" className={index === step ? "now" : index < step ? "done" : ""} aria-current={index === step ? "step" : undefined} disabled={editing && index === 0} onClick={() => goTo(index)}>
                  <span className="np-dot">{index < step ? <CheckCircle weight="fill" /> : index + 1}</span>
                  <span>
                    <strong>{entry.label}</strong>
                    <small>{index === 0 && editing ? def.label : entry.hint}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {step > 0 && (
            <div className="np-preview" aria-hidden="true">
              <ProjectAvatar name={names[0] ?? "?"} color={form.color} src={form.picture?.src} crop={form.picture?.crop} glyph={form.picture?.glyph} />
              <span>
                <strong>{names[0] ?? "Untitled project"}</strong>
                <small>
                  {def.label}
                  {names.length > 1 ? ` · and ${names.length - 1} more` : ""}
                </small>
              </span>
            </div>
          )}
          {step > 0 && (
            <dl className="np-summary">
              {summary.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd title={value}>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </aside>

        <form className="sf-card np-main" onSubmit={save}>
          {step === 0 && (
            <>
              <header>
                <h2>What kind of project is it?</h2>
                <p>This decides whether it has tasks, whether tracking needs one, and how a budget works. It can't be changed later.</p>
              </header>
              <div className="np-types" role="list">
                {PROJECT_TYPES.map((type) => (
                  <button key={type.value} type="button" role="listitem" className={`np-type ${type.value === form.type ? "picked" : ""}`} onClick={() => pickType(type.value)} title={type.hover}>
                    <span className="np-type-copy">
                      <strong>{type.label}</strong>
                      <small>{type.blurb}</small>
                      <span className="np-tags">
                        {!type.hasTasks && <em>No tasks</em>}
                        {type.forcesHours && <em>Hours only</em>}
                        {!type.billable && <em>Not billable</em>}
                        {type.value === "retainer" && <em>Refills monthly</em>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <header>
                <h2>Details</h2>
                <p>{def.label}. Give it a name and say how it is billed and tracked.</p>
              </header>
              <div className="np-pane">
                {editing ? (
                  <label className="db-field">
                    Project name
                    <input autoFocus required maxLength={70} value={form.names} onChange={(event) => set({ names: event.target.value })} />
                  </label>
                ) : (
                  <label className="db-field">
                    Project names
                    <textarea autoFocus rows={2} maxLength={400} value={form.names} placeholder={"e.g. Website refresh\nOne name per line makes several projects"} onChange={(event) => set({ names: event.target.value })} />
                    {names.length > 1 && <span className="np-hint">{names.length} projects will be made with these settings.</span>}
                  </label>
                )}
                <AvatarPicker name={names[0] ?? "?"} color={form.color} value={form.picture} onChange={(picture) => set({ picture })} />
                <label className="db-field">
                  Description
                  <textarea rows={3} maxLength={240} value={form.description} placeholder="What are we working toward?" onChange={(event) => set({ description: event.target.value })} />
                </label>
                <div className="np-row">
                  <label className="db-field">
                    End date
                    <input type="date" value={form.due} onChange={(event) => set({ due: event.target.value })} />
                    <span className="np-hint">Optional. It only informs; nothing closes on it.</span>
                  </label>
                  <fieldset className="db-color-picker np-colors">
                    <legend>Colour</legend>
                    {COLORS.map((color) => (
                      <label key={color} title={color}>
                        <input type="radio" name="project-color" value={color} checked={form.color === color} onChange={() => set({ color })} />
                        <span className={`db-color-swatch ${color}`}>{form.color === color && <CheckCircle size={20} />}</span>
                        <span className="db-sr-only">{color}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
                <div className="np-switches">
                  <label className={`np-switch ${!def.billable ? "locked" : ""}`}>
                    <input type="checkbox" checked={form.billable} disabled={!def.billable} onChange={(event) => set({ billable: event.target.checked })} />
                    <span>
                      <strong>Billable</strong>
                      <small>{def.billable ? "Its time can be invoiced." : "Internal work is never invoiced."}</small>
                    </span>
                  </label>
                  {def.hasTasks ? (
                    <label className={`np-switch ${def.requiresTask ? "locked" : ""}`}>
                      <input type="checkbox" checked={form.requireTask} disabled={def.requiresTask} onChange={(event) => set({ requireTask: event.target.checked })} />
                      <span>
                        <strong>Require a task to start tracking</strong>
                        <small>{def.requiresTask ? `Always on for a ${def.label.toLowerCase()}.` : "Off: people can time the project itself, without picking a task."}</small>
                      </span>
                    </label>
                  ) : (
                    <p className="np-note">
                      A {def.label.toLowerCase()} has no tasks. Each person starts their own timer on the project.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <header>
                <h2>People</h2>
                <p>Who the project is for, and who works on it. Leave everyone unticked to let the whole workspace track on it.</p>
              </header>
              <div className="np-pane">
                <label className="db-field np-short">
                  Client
                  <select value={form.clientId} onChange={(event) => set({ clientId: event.target.value })}>
                    <option value="">No client</option>
                    {stores.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  <span className="np-hint">Its time and budget then show under that client.</span>
                </label>
                <div className="np-lists">
                  <fieldset className="np-people">
                    <legend>
                      Managers <b>{form.managerIds.length ? `${form.managerIds.length} picked` : "none picked"}</b>
                    </legend>
                    {managers.map((member) => (
                      <label key={member.id}>
                        <input type="checkbox" checked={form.managerIds.includes(member.id)} onChange={() => toggle("managerIds", member.id)} />
                        <Avatar memberId={member.id} name={member.name} color={member.color} />
                        <span>
                          <strong>{member.name}</strong>
                          <small>{member.role}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {def.managersOnly ? (
                    <p className="np-note">
                      A management project is for managers only.
                    </p>
                  ) : (
                    <fieldset className="np-people">
                      <legend>
                        People on it <b>{form.memberIds.length ? `${form.memberIds.length} of ${people.length}` : "everyone"}</b>
                        {people.length > 1 && (
                          <button type="button" className="np-all" onClick={() => set({ memberIds: form.memberIds.length === people.length ? [] : people.map((member) => member.id) })}>
                            {form.memberIds.length === people.length ? "Clear" : "Select all"}
                          </button>
                        )}
                      </legend>
                      {people.map((member) => (
                        <label key={member.id}>
                          <input type="checkbox" checked={form.memberIds.includes(member.id)} onChange={() => toggle("memberIds", member.id)} />
                          <Avatar memberId={member.id} name={member.name} color={member.color} />
                          <span>
                            <strong>{member.name}</strong>
                            <small>
                              {member.role} · {member.team}
                            </small>
                          </span>
                        </label>
                      ))}
                      {!people.length && <p className="db-muted">No one else to add yet.</p>}
                    </fieldset>
                  )}
                </div>
                <p className="np-note">
                  {form.memberIds.length || form.managerIds.length
                    ? `Only the ${new Set([...form.memberIds, ...form.managerIds]).size} ${new Set([...form.memberIds, ...form.managerIds]).size === 1 ? "person" : "people"} picked can track time on it.`
                    : "Nobody is picked, so everyone in the workspace can track time on it."}
                </p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <header>
                <h2>Budget</h2>
                <p>{def.forcesHours ? `Measured in hours, the only unit a ${def.label.toLowerCase()} has.` : "Measured in hours of tracked time."}</p>
              </header>
              <div className="np-pane">
                <label className="np-switch">
                  <input type="checkbox" checked={form.useBudget} onChange={(event) => set({ useBudget: event.target.checked })} />
                  <span>
                    <strong>Set a time budget</strong>
                    <small>Without one, the project is not measured against a limit.</small>
                  </span>
                </label>
                {form.useBudget && (
                  <div className="np-row">
                    <label className="db-field">
                      Hours
                      <input type="number" min="1" max="100000" value={form.hours} onChange={(event) => set({ hours: event.target.value })} />
                    </label>
                    <label className="db-field">
                      Refills
                      <select value={form.resets} disabled={def.resetsLocked} onChange={(event) => set({ resets: event.target.value as Form["resets"] })}>
                        <option value="Never">Never: spent once</option>
                        <option value="Weekly">Every week</option>
                        <option value="Monthly">Every month</option>
                      </select>
                      {def.resetsLocked && <span className="np-hint">A fixed price is spent once.</span>}
                    </label>
                    <label className="db-field">
                      Warn at (% of the budget)
                      <input type="number" min="1" max="100" value={form.notifyAt} onChange={(event) => set({ notifyAt: event.target.value })} />
                    </label>
                  </div>
                )}
                {form.useBudget && Number(form.hours) > 0 && (
                  <p className="np-note">
                    {`${Number(form.hours)}h ${form.resets === "Never" ? "in total, spent once" : form.resets === "Weekly" ? "every week" : "every month"}. Managers are warned at ${Math.round((Number(form.hours) * (Number(form.notifyAt) || 0)) / 10) / 10}h.`}
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="np-error" role="alert">
              {error}
            </p>
          )}
          {step > 0 && (
            <footer className="np-actions">
              {step > 1 || (step === 1 && !editing) ? (
                <button type="button" className="sf-button" onClick={() => goTo(step - 1)}>
                  Back
                </button>
              ) : null}
              <div>
                {step < STEPS.length - 1 && (
                  // While making a project, Next is the form's submit button, so Enter in a field moves on.
                  <button type={editing ? "button" : "submit"} className={`sf-button ${editing ? "" : "primary"}`} onClick={editing ? () => goTo(step + 1) : undefined}>
                    Next
                  </button>
                )}
                {(editing || step === STEPS.length - 1) && (
                  <button type="submit" className="sf-button primary">
                    {editing ? "Save changes" : names.length > 1 ? `Create ${names.length} projects` : "Create project"}
                  </button>
                )}
              </div>
            </footer>
          )}
        </form>
      </div>
    </div>
  );
}
