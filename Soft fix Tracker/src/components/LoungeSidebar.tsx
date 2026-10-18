import { ProjectLabel } from "./ProjectAvatar";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  BookmarkSimple,
  CaretDown,
  EnvelopeSimple,
  Gear,
  Hash,
  Plus,
  UserPlus,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { Avatar } from "./Avatar";
import { ChannelSidebar } from "./ChannelSidebar";
import type { LoungeData, LoungeRoute } from "./lounge-model";

type Props = {
  route: LoungeRoute;
  data: LoungeData;
  previewRoom?: string;
  muted: boolean;
  onNavigate: (route: LoungeRoute) => void;
  onCreate: () => void;
  onCreateVoice: () => void;
  onInvite: () => void;
  onServerSettings: () => void;
  onPreview: (id: string) => void;
  onVoiceChat: (id: string) => void;
};

/** The second column: your direct messages, or the channels of the server you're in. */
export function LoungeSidebar({
  route,
  data,
  previewRoom,
  muted,
  onNavigate,
  onCreate,
  onCreateVoice,
  onInvite,
  onServerSettings,
  onPreview,
  onVoiceChat,
}: Props) {
  const { members, projects } = useWorkspace();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!header.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  const inServer = ["channel", "voice", "voice-chat", "rooms"].includes(route.page);
  const room = [...data.rooms, ...(data.voiceRooms ?? [])].find((value) => value.id === route.id);
  const project = projects.find((value) => value.id === room?.projectId);
  const serverRooms = data.rooms.filter((value) =>
    project ? value.projectId === project.id : !value.projectId,
  );
  const friendsPage = ["home", "people", "blocked"].includes(route.page);
  const blocked = data.blocked ?? [];
  const search = query.trim().toLowerCase();
  const directPeople = members.filter(
    (person) =>
      person.id !== "me" &&
      !blocked.includes(person.id) &&
      (search
        ? `${person.name} ${person.team}`.toLowerCase().includes(search)
        : data.contacts.includes(person.id)),
  );
  const menuItem = (label: string, icon: ReactElement, action: () => void) => (
    <button
      onClick={() => {
        action();
        setMenuOpen(false);
      }}
    >
      {label}
      {icon}
    </button>
  );

  return (
    <aside className="lg-sidebar">
      {inServer ? (
        <div className="lg-server-heading" ref={header}>
          <button onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
            <strong>{project ? <ProjectLabel projectId={project.id} /> : "Soft Fix"}</strong>
            {menuOpen ? <X weight="bold" /> : <CaretDown weight="bold" />}
          </button>
          {menuOpen && (
            <div className="lg-workspace-menu">
              {menuItem("Invite People", <UserPlus weight="fill" />, onInvite)}
              {menuItem("Create Channel", <Plus weight="bold" />, onCreate)}
              {menuItem("Browse Channels", <Hash weight="bold" />, () => onNavigate({ page: "rooms" }))}
              {menuItem("Server Settings", <Gear weight="fill" />, onServerSettings)}
            </div>
          )}
        </div>
      ) : (
        <div className="lg-sidebar-top">
          <input
            className="lg-find"
            aria-label="Find or start a conversation"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find or start a conversation"
          />
        </div>
      )}
      <div className="lg-sidebar-scroll">
        {inServer ? (
          <>
            <nav className="lg-primary-nav" aria-label="Server">
              <button
                className={route.page === "rooms" ? "active" : ""}
                aria-current={route.page === "rooms" ? "page" : undefined}
                onClick={() => onNavigate({ page: "rooms" })}
              >
                <Hash weight="bold" />
                <span>Browse Channels</span>
              </button>
            </nav>
            <ChannelSidebar
              rooms={serverRooms}
              voiceRooms={(data.voiceRooms ?? []).filter(value => project ? value.projectId === project.id : !value.projectId)}
              onCreateVoice={onCreateVoice}
              activeChannel={route.page === "channel" ? route.id : undefined}
              previewRoom={previewRoom}
              muted={muted}
              onVoiceChat={onVoiceChat}
              onChannelChange={(id) => onNavigate({ page: "channel", id })}
              onCreate={onCreate}
              onInvite={onInvite}
              onPreview={onPreview}
            />
          </>
        ) : (
          <>
            {!search && (
              <nav className="lg-primary-nav" aria-label="Lounge navigation">
                <button
                  className={friendsPage ? "active" : ""}
                  aria-current={friendsPage ? "page" : undefined}
                  onClick={() => onNavigate({ page: "home" })}
                >
                  <UsersThree weight="fill" />
                  <span>Friends</span>
                </button>
                <button
                  className={route.page === "requests" ? "active" : ""}
                  aria-current={route.page === "requests" ? "page" : undefined}
                  onClick={() => onNavigate({ page: "requests" })}
                >
                  <EnvelopeSimple weight="fill" />
                  <span>Message Requests</span>
                  {data.requests.length > 0 && <b>{data.requests.length}</b>}
                </button>
                <button
                  className={route.page === "saved" ? "active" : ""}
                  aria-current={route.page === "saved" ? "page" : undefined}
                  onClick={() => onNavigate({ page: "saved" })}
                >
                  <BookmarkSimple weight="fill" />
                  <span>Saved Messages</span>
                </button>
              </nav>
            )}
            <div className="lg-sidebar-label">
              <span>{search ? "Search results" : "Direct Messages"}</span>
              <button
                className="lg-icon-button"
                aria-label="Start a new direct message"
                title="Create DM"
                onClick={() => onNavigate({ page: "people" })}
              >
                <Plus weight="bold" />
              </button>
            </div>
            <nav className="lg-dm-nav" aria-label="Direct messages">
              {directPeople.map((person) => {
                const active = route.page === "dm" && route.id === person.id;
                return (
                  <button
                    key={person.id}
                    className={`lg-dm-link ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      onNavigate({ page: "dm", id: person.id });
                      setQuery("");
                    }}
                  >
                    <span className="lg-avatar-status">
                      <Avatar memberId={person.id} initials={person.initials} color={person.color} />
                      <i className={`lg-status-dot ${person.status.toLowerCase()}`} />
                    </span>
                    <span>{person.name}</span>
                    {data.drafts[`dm:${person.id}`] && <small>Draft</small>}
                  </button>
                );
              })}
            </nav>
            {search && !directPeople.length && <p className="lg-sidebar-empty">No people found.</p>}
          </>
        )}
      </div>
    </aside>
  );
}
