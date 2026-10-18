import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  CaretRight,
  Check,
  Clock,
  ImageSquare,
  PencilSimple,
  Plus,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import {
  useWorkspace,
  formatDuration,
  type Profile,
  type Member,
} from "../workspace";
import { useOrganizations } from "../organizations";
import { Avatar } from "./Avatar";
import { Modal } from "./ui";
import { AvatarPicker } from "./dashboard/pages/AvatarPicker";
import { ProjectAvatar, cropStyle } from "./ProjectAvatar";
import "./profile-settings.css";

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
const widgetOptions = [
  { id: "focus", label: "Weekly focus" },
  { id: "projects", label: "Projects" },
  { id: "availability", label: "Availability" },
];
type AccountField = "name" | "email" | "title" | "status" | "username";

export function AccountSettings({
  onCustomize,
  onPrivacy,
}: {
  onCustomize: () => void;
  onPrivacy: () => void;
}) {
  const { profile, setProfile, setMembers, notify } = useWorkspace();
  const { active: organization } = useOrganizations();
  const [editing, setEditing] = useState<AccountField | null>(null);
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const fields: { key: AccountField; label: string; value: string }[] = [
    {
      key: "username",
      label: "Username",
      value: profile.username || profile.email.split("@")[0],
    },
    { key: "name", label: "Display name", value: profile.name },
    { key: "email", label: "Work email", value: profile.email },
    { key: "title", label: "Job title", value: profile.title || "Not set" },
    { key: "status", label: "Availability", value: profile.status },
  ];
  const open = (field: AccountField) => {
    setValue(
      profile[field] ||
        (field === "username" ? profile.email.split("@")[0] : ""),
    );
    setEditing(field);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const clean = value.trim();
    if (
      (editing === "name" || editing === "email" || editing === "username") &&
      !clean
    )
      return;
    setProfile((old) => ({ ...old, [editing]: clean }));
    if (editing === "name" || editing === "email" || editing === "status")
      setMembers((old) =>
        old.map((member) =>
          member.id === "me"
            ? {
                ...member,
                ...(editing === "name"
                  ? { name: clean, initials: initials(clean) }
                  : editing === "email"
                    ? { email: clean }
                    : { status: clean as Member["status"] }),
              }
            : member,
        ),
      );
    setEditing(null);
    notify("Account updated across your workspace");
  };
  return (
    <div className="dc-account">
      <section className="dc-account-section" id="account-info">
        <h2>Account Info</h2>
        {fields.map((field) => (
          <div className="dc-account-row" key={field.key}>
            <strong>{field.label}</strong>
            <span className="dc-account-value">
              {field.key === "email" && !revealed
                ? `${"*".repeat(Math.min(profile.email.split("@")[0].length, 10))}@${profile.email.split("@")[1] || ""}`
                : field.value}
              {field.key === "email" && (
                <button
                  type="button"
                  className="dc-link"
                  onClick={() => setRevealed(!revealed)}
                >
                  {revealed ? "Hide" : "Reveal"}
                </button>
              )}
            </span>
            <button
              type="button"
              className="dc-button"
              aria-label={`Edit ${field.label.toLowerCase()}`}
              onClick={() => open(field.key)}
            >
              Edit
            </button>
          </div>
        ))}
      </section>
      <section className="dc-account-section" id="public-profile">
        <h2>Your Profile</h2>
        <div className="dc-profile-row">
          <Avatar initials={initials(profile.name)} memberId="me" size="lg" />
          <div>
            <strong>{profile.name}</strong>
            <p>{profile.title || "Make your profile your own."}</p>
          </div>
          <button
            type="button"
            className="dc-button dc-primary"
            onClick={onCustomize}
          >
            Edit profile
          </button>
        </div>
        <p className="dc-caption">
          Customize your avatar, banner, about me, and profile board.
        </p>
      </section>
      <section className="dc-account-section" id="workspace-access">
        <h2>Workspace Access</h2>
        <div className="dc-access-row">
          <span>
            <strong>Organization</strong>
            <small>Your currently open workspace.</small>
          </span>
          <b>{organization.name}</b>
        </div>
        <div className="dc-access-row">
          <span>
            <strong>Your role</strong>
            <small>Managed by your organization.</small>
          </span>
          <span className="dc-role">{profile.role}</span>
        </div>
        <button
          type="button"
          className="dc-access-row dc-access-button"
          onClick={onPrivacy}
        >
          <span>
            <strong>Data & privacy</strong>
            <small>Choose what you share and export your workspace data.</small>
          </span>
          <CaretRight size={20} />
        </button>
      </section>
      {editing && (
        <Modal
          title={`Edit ${fields.find((field) => field.key === editing)?.label.toLowerCase()}`}
          onClose={() => setEditing(null)}
          className="dc-edit-modal"
        >
          <form onSubmit={save}>
            <label>
              {fields.find((field) => field.key === editing)?.label}
              {editing === "status" ? (
                <select
                  className="sf-input"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  {["Available", "Focusing", "Away", "Offline"].map(
                    (status) => (
                      <option key={status}>{status}</option>
                    ),
                  )}
                </select>
              ) : (
                <input
                  className="sf-input"
                  autoFocus
                  type={editing === "email" ? "email" : "text"}
                  required={editing !== "title"}
                  maxLength={editing === "email" ? 254 : 80}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </label>
            <div className="sf-form-actions">
              <button
                type="button"
                className="sf-button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="sf-button primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

async function bannerData(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Choose an image smaller than 8 MB.");
  let blob: Blob = file;
  if (file.type === "image/gif") {
    if (file.size > 800 * 1024)
      throw new Error("Animated banners must be smaller than 800 KB.");
  } else {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 400;
    const scale = Math.max(
      canvas.width / bitmap.width,
      canvas.height / bitmap.height,
    );
    canvas
      .getContext("2d")!
      .drawImage(
        bitmap,
        (canvas.width - bitmap.width * scale) / 2,
        (canvas.height - bitmap.height * scale) / 2,
        bitmap.width * scale,
        bitmap.height * scale,
      );
    bitmap.close();
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("This image could not be read.")),
        "image/webp",
        0.86,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This image could not be read."));
    reader.readAsDataURL(blob);
  });
}

export function ProfileCustomizer({
  onBack,
  onDirtyChange,
}: {
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const {
    profile,
    setProfile,
    setMembers,
    projects,
    sessions,
    preferences,
    notify,
  } = useWorkspace();
  const [draft, setDraft] = useState<Profile>(() => ({
    ...profile,
    widgets: profile.widgets ?? ["focus", "projects"],
  }));
  const [saved, setSaved] = useState(() =>
    JSON.stringify({
      ...profile,
      widgets: profile.widgets ?? ["focus", "projects"],
    }),
  );
  const [tab, setTab] = useState("board");
  const [choosingWidgets, setChoosingWidgets] = useState(false);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [error, setError] = useState("");
  const bannerInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== saved;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const set = (patch: Partial<Profile>) =>
    setDraft((old) => ({ ...old, ...patch }));
  const ownSessions = sessions
    .filter((session) => session.memberId === "me")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(
    weekStart.getDate() -
      (preferences.weekStart === "Sunday"
        ? weekStart.getDay()
        : preferences.weekStart === "Saturday"
          ? (weekStart.getDay() + 1) % 7
          : (weekStart.getDay() + 6) % 7),
  );
  const weekSessions = ownSessions.filter(
    (session) => new Date(session.startedAt) >= weekStart,
  );
  const weekSeconds = weekSessions.reduce(
    (sum, session) => sum + session.seconds,
    0,
  );
  const ownProjects = projects.filter(
    (project) =>
      !project.memberIds?.length ||
      project.memberIds.includes("me") ||
      ownSessions.some((session) => session.projectId === project.id),
  );
  const reset = () => {
    setDraft(JSON.parse(saved) as Profile);
    setError("");
  };
  const save = () => {
    if (!draft.name.trim()) {
      setError("Your display name cannot be empty.");
      return;
    }
    const clean = {
      ...draft,
      name: draft.name.trim(),
      title: draft.title.trim(),
      bio: draft.bio?.trim(),
      pronouns: draft.pronouns?.trim(),
    };
    setProfile((old) => ({
      ...old,
      ...clean,
      email: old.email,
      role: old.role,
      status: old.status,
    }));
    setMembers((old) =>
      old.map((member) =>
        member.id === "me"
          ? { ...member, name: clean.name, initials: initials(clean.name) }
          : member,
      ),
    );
    setDraft(clean);
    setSaved(JSON.stringify(clean));
    setError("");
    notify("Profile saved across your workspace");
  };
  const uploadBanner = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      set({ banner: await bannerData(file) });
      setError("");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "The image could not be opened.",
      );
    }
  };
  const widgets = draft.widgets ?? ["focus", "projects"];
  return (
    <div className="dc-customizer">
      <aside className="dc-custom-controls" aria-label="Profile customization">
        <button type="button" className="dc-profile-back" onClick={onBack}>
          <ArrowLeft size={16} /> Main Profile
        </button>
        <div className="dc-controls-scroll">
          <section>
            <h3>Avatar & Decoration</h3>
            <div className="dc-avatar-options">
              <button
                type="button"
                className="dc-avatar-choice"
                onClick={() => setPickingAvatar(true)}
                aria-label="Change profile avatar"
              >
                {draft.avatar ? (
                  <img
                    src={draft.avatar}
                    alt="Your avatar"
                    style={
                      draft.avatarCrop ? cropStyle(draft.avatarCrop) : undefined
                    }
                  />
                ) : (
                  <UserCircle size={58} weight="fill" />
                )}
                <span>
                  <PencilSimple size={14} />
                </span>
              </button>
              <div className="dc-decoration-options">
                {(["none", "ring", "double"] as const).map((decoration) => (
                  <button
                    type="button"
                    key={decoration}
                    className={
                      (draft.decoration ?? "none") === decoration
                        ? "selected"
                        : ""
                    }
                    aria-label={`${decoration} avatar decoration`}
                    aria-pressed={(draft.decoration ?? "none") === decoration}
                    onClick={() => set({ decoration })}
                  >
                    <span className={`dc-deco-sample ${decoration}`}>
                      <UserCircle size={21} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="dc-link"
              onClick={() => setPickingAvatar(true)}
            >
              Change avatar
            </button>
            {draft.avatar && (
              <button
                type="button"
                className="dc-link dc-remove"
                onClick={() =>
                  set({ avatar: "", avatarCrop: undefined, avatarCredit: "" })
                }
              >
                Remove
              </button>
            )}
          </section>
          <section>
            <h3>Profile Banner</h3>
            <button
              type="button"
              className="dc-banner-choice"
              style={{ backgroundColor: draft.bannerColor || "#111214" }}
              onClick={() => bannerInput.current?.click()}
            >
              {draft.banner ? (
                <img src={draft.banner} alt="Profile banner" />
              ) : (
                <>
                  <ImageSquare size={22} />
                  <span>Upload banner</span>
                </>
              )}
            </button>
            <input
              ref={bannerInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="Upload profile banner"
              onChange={(event) => void uploadBanner(event)}
            />
            {draft.banner && (
              <button
                type="button"
                className="dc-link"
                onClick={() => set({ banner: "" })}
              >
                Remove banner
              </button>
            )}
          </section>
          <section className="dc-color-controls">
            <label>
              <span>Banner Color</span>
              <input
                type="color"
                aria-label="Banner color"
                value={draft.bannerColor || "#111214"}
                onChange={(event) => set({ bannerColor: event.target.value })}
              />
            </label>
            <label>
              <span>Profile Accent</span>
              <input
                type="color"
                aria-label="Profile accent"
                value={
                  draft.accentColor ||
                  (preferences.theme === "light" ? "#5b2bc0" : "#2fd16d")
                }
                onChange={(event) => set({ accentColor: event.target.value })}
              />
            </label>
          </section>
          <section>
            <h3>Display Name Style</h3>
            <div className="dc-name-styles">
              {(["default", "rounded", "serif"] as const).map((style) => (
                <button
                  type="button"
                  key={style}
                  className={`dc-name-${style} ${(draft.nameStyle ?? "default") === style ? "selected" : ""}`}
                  onClick={() => set({ nameStyle: style })}
                  aria-label={`${style} display name style`}
                  aria-pressed={(draft.nameStyle ?? "default") === style}
                >
                  {style === "default"
                    ? "Aa"
                    : style === "rounded"
                      ? "Aa"
                      : "Aa"}
                </button>
              ))}
            </div>
          </section>
          <section className="dc-profile-fields">
            <h3>Profile Details</h3>
            <label>
              Display name
              <input
                value={draft.name}
                maxLength={60}
                onChange={(event) => set({ name: event.target.value })}
              />
            </label>
            <label>
              Pronouns
              <input
                value={draft.pronouns || ""}
                maxLength={40}
                placeholder="Add pronouns"
                onChange={(event) => set({ pronouns: event.target.value })}
              />
            </label>
            <label>
              Job title
              <input
                value={draft.title}
                maxLength={80}
                onChange={(event) => set({ title: event.target.value })}
              />
            </label>
            <label>
              About me
              <textarea
                value={draft.bio || ""}
                maxLength={300}
                rows={4}
                placeholder="A little about you…"
                onChange={(event) => set({ bio: event.target.value })}
              />
              <small>{draft.bio?.length || 0}/300</small>
            </label>
          </section>
        </div>
      </aside>
      <div
        className="dc-custom-main"
        style={
          {
            "--profile-accent": draft.accentColor || "var(--accent-strong)",
          } as CSSProperties
        }
      >
        <div className="dc-custom-columns">
          <article
            className="dc-preview-card"
            aria-label="Live profile preview"
          >
            <div
              className="dc-preview-banner"
              style={{ backgroundColor: draft.bannerColor || "#111214" }}
            >
              {draft.banner && <img src={draft.banner} alt="" />}
            </div>
            <div className="dc-preview-identity">
              <button
                type="button"
                className={`dc-preview-avatar dc-decoration-${draft.decoration || "none"}`}
                onClick={() => setPickingAvatar(true)}
                aria-label="Change preview avatar"
              >
                <span className="dc-preview-avatar-media">
                  {draft.avatar ? (
                    <img
                      src={draft.avatar}
                      alt=""
                      style={
                        draft.avatarCrop
                          ? cropStyle(draft.avatarCrop)
                          : undefined
                      }
                    />
                  ) : (
                    initials(draft.name)
                  )}
                </span>
                <i className={`dc-presence ${profile.status.toLowerCase()}`} />
              </button>
              <span className="dc-preview-status">{profile.status}</span>
            </div>
            <div className="dc-preview-body">
              {draft.avatarCredit && (
                <p className="dc-avatar-credit">{draft.avatarCredit}</p>
              )}
              <h2 className={`dc-name-${draft.nameStyle || "default"}`}>
                {draft.name || "Your name"}
              </h2>
              <div className="dc-preview-username">
                {profile.username || profile.email.split("@")[0]}
                {draft.pronouns && <span> · {draft.pronouns}</span>}
              </div>
              {draft.title && <p className="dc-preview-title">{draft.title}</p>}
              <span className="dc-role">{profile.role}</span>
              <div className="dc-preview-about">
                <h3>About me</h3>
                <p>
                  {draft.bio || "Tell your teammates a little about yourself."}
                </p>
              </div>
              <div className="dc-preview-workspace">
                <h3>In this workspace</h3>
                <div>
                  <span>Projects</span>
                  <strong>{ownProjects.length}</strong>
                </div>
                <div>
                  <span>Work sessions</span>
                  <strong>{ownSessions.length}</strong>
                </div>
                <div>
                  <span>This week</span>
                  <strong>{formatDuration(weekSeconds)}</strong>
                </div>
              </div>
              <button
                type="button"
                className="dc-button dc-preview-edit"
                onClick={() =>
                  document
                    .querySelector<HTMLInputElement>(".dc-profile-fields input")
                    ?.focus()
                }
              >
                <PencilSimple size={15} /> Edit profile details
              </button>
            </div>
          </article>
          <section className="dc-profile-board" aria-label="Profile board">
            <div
              className="dc-profile-tabs"
              role="tablist"
              aria-label="Profile views"
            >
              <button
                type="button"
                role="tab"
                id="profile-board-tab"
                aria-controls="profile-board-content"
                aria-selected={tab === "board"}
                className={tab === "board" ? "active" : ""}
                onClick={() => setTab("board")}
              >
                Board
              </button>
              <button
                type="button"
                role="tab"
                id="profile-activity-tab"
                aria-controls="profile-board-content"
                aria-selected={tab === "activity"}
                className={tab === "activity" ? "active" : ""}
                onClick={() => setTab("activity")}
              >
                Activity
              </button>
            </div>
            <div
              id="profile-board-content"
              role="tabpanel"
              aria-labelledby={
                tab === "board" ? "profile-board-tab" : "profile-activity-tab"
              }
            >
              {tab === "board" ? (
                <>
                  <div className="dc-widget-heading">
                    <strong>Your Widgets</strong>
                    <div className="dc-widget-picker">
                      <button
                        type="button"
                        className="dc-button"
                        onClick={() => setChoosingWidgets(!choosingWidgets)}
                        aria-expanded={choosingWidgets}
                      >
                        <Plus size={15} /> Add Widget
                      </button>
                      {choosingWidgets && (
                        <div className="dc-widget-menu">
                          {widgetOptions.map((widget) => (
                            <button
                              type="button"
                              key={widget.id}
                              onClick={() =>
                                set({
                                  widgets: widgets.includes(widget.id)
                                    ? widgets.filter((id) => id !== widget.id)
                                    : [...widgets, widget.id],
                                })
                              }
                            >
                              <span>{widget.label}</span>
                              {widgets.includes(widget.id) ? (
                                <Check size={16} />
                              ) : (
                                <Plus size={16} />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {widgets.includes("focus") && (
                    <article className="dc-widget dc-focus-widget">
                      <header>
                        <span>
                          <Clock size={17} /> Weekly Focus
                        </span>
                        <button
                          type="button"
                          aria-label="Remove weekly focus widget"
                          onClick={() =>
                            set({
                              widgets: widgets.filter((id) => id !== "focus"),
                            })
                          }
                        >
                          <X size={14} />
                        </button>
                      </header>
                      <strong className="dc-focus-time">
                        {formatDuration(weekSeconds)}
                      </strong>
                      <p>Time tracked this week</p>
                      <div className="dc-widget-stats">
                        <div>
                          <strong>{weekSessions.length}</strong>
                          <span>Sessions</span>
                        </div>
                        <div>
                          <strong>
                            {
                              new Set(
                                weekSessions.map(
                                  (session) => session.projectId,
                                ),
                              ).size
                            }
                          </strong>
                          <span>Projects</span>
                        </div>
                        <div>
                          <strong>
                            {
                              new Set(
                                weekSessions.map((session) =>
                                  new Date(session.startedAt).toDateString(),
                                ),
                              ).size
                            }
                          </strong>
                          <span>Active days</span>
                        </div>
                      </div>
                    </article>
                  )}
                  {widgets.includes("projects") && (
                    <article className="dc-widget">
                      <header>
                        <span>Your Projects</span>
                        <button
                          type="button"
                          aria-label="Remove projects widget"
                          onClick={() =>
                            set({
                              widgets: widgets.filter(
                                (id) => id !== "projects",
                              ),
                            })
                          }
                        >
                          <X size={14} />
                        </button>
                      </header>
                      {ownProjects.slice(0, 4).map((project) => (
                        <div className="dc-widget-project" key={project.id}>
                          <ProjectAvatar projectId={project.id} />
                          <span>
                            <strong>{project.name}</strong>
                            <small>
                              {project.tasks.filter((task) => task.done).length}{" "}
                              / {project.tasks.length} tasks complete
                            </small>
                          </span>
                        </div>
                      ))}
                      {!ownProjects.length && (
                        <p>Your projects will appear here when you join one.</p>
                      )}
                    </article>
                  )}
                  {widgets.includes("availability") && (
                    <article className="dc-widget">
                      <header>
                        <span>Availability</span>
                        <button
                          type="button"
                          aria-label="Remove availability widget"
                          onClick={() =>
                            set({
                              widgets: widgets.filter(
                                (id) => id !== "availability",
                              ),
                            })
                          }
                        >
                          <X size={14} />
                        </button>
                      </header>
                      <h3>{profile.status}</h3>
                      <p>
                        {preferences.timezone} · Workday starts at{" "}
                        {preferences.startOfDay}
                      </p>
                    </article>
                  )}
                  {!widgets.length && (
                    <div className="dc-empty-board">
                      <Plus size={28} />
                      <h3>Make this space yours</h3>
                      <p>Add widgets to build your profile board.</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="dc-activity-feed">
                  <h3>Recent activity</h3>
                  {ownSessions.slice(0, 6).map((session) => (
                    <div className="dc-profile-activity" key={session.id}>
                      <ProjectAvatar projectId={session.projectId} size="sm" />
                      <span>
                        <strong>{session.taskTitle}</strong>
                        <small>
                          {new Date(session.startedAt).toLocaleDateString(
                            "en",
                            { month: "short", day: "numeric" },
                          )}
                        </small>
                      </span>
                      <b>{formatDuration(session.seconds)}</b>
                    </div>
                  ))}
                  {!ownSessions.length && (
                    <p>Your tracked work will appear here.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
        {error && (
          <p className="dc-profile-error" role="alert">
            {error}
          </p>
        )}
        {dirty && (
          <div className="dc-save-bar" role="status">
            <span>Careful — you have unsaved changes!</span>
            <button type="button" className="dc-link" onClick={reset}>
              Reset
            </button>
            <button type="button" className="dc-button dc-save" onClick={save}>
              Save Changes
            </button>
          </div>
        )}
      </div>
      {pickingAvatar && (
        <Modal
          title="Choose your avatar"
          description="Upload a picture or GIF, then adjust the crop."
          className="dc-avatar-modal"
          onClose={() => setPickingAvatar(false)}
          wide
        >
          <AvatarPicker
            subject="profile"
            name={draft.name}
            color="blue"
            value={
              draft.avatar
                ? {
                    src: draft.avatar,
                    crop: draft.avatarCrop,
                    credit: draft.avatarCredit,
                  }
                : null
            }
            onChange={(picture) => {
              set({
                avatar: picture?.src || "",
                avatarCrop: picture?.crop,
                avatarCredit: picture?.credit || "",
              });
              setPickingAvatar(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
