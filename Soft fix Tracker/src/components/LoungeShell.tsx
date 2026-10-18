import { useEffect, useState, type FormEvent } from "react";
import { Hash, UserPlus } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { ChatPanel } from "./ChatPanel";
import { VoiceRoom } from "./VoiceRoom";
import { defaultVoiceUi, type VoiceUiState } from "./voice-ui";
import { ControlDock } from "./ControlDock";
import { CrewSidebar, ProfilePanel } from "./CrewSidebar";
import { LoungeHome } from "./LoungeHome";
import { LoungeRail } from "./LoungeRail";
import { LoungeSidebar } from "./LoungeSidebar";
import { ServerSettings } from "./ServerSettings";
import { EmptyState, Modal } from "./ui";
import {
  conversationKey,
  loungeId,
  WORKPLACE_SERVER,
  type LoungeData,
  type ServerIcon,
  type LoungeRoute,
} from "./lounge-model";
import "./lounge.css";

export function LoungeShell({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { members, setMembers, projects, route: appRoute, navigate, notify, lounge: data, setLounge: setData } = useWorkspace();
  const [route, setRoute] = useState<LoungeRoute>({ page: "home" });
  // The member list / profile sits beside the chat on wide windows and starts closed on narrow ones.
  const [contextOpen, setContextOpen] = useState(() => window.innerWidth > 1180);
  const [previewRoom, setPreviewRoom] = useState<string>();
  const [voiceMuted, setVoiceMuted] = useState(true);
  const [voiceUi, setVoiceUi] = useState<VoiceUiState>(defaultVoiceUi);
  useEffect(() => {
    setVoiceUi(previous => previous.panel ? { ...previous, panel: undefined } : previous);
  }, [route.page]);
  const [modal, setModal] = useState<"invite" | "room" | null>(null);
  const [serverSettings, setServerSettings] = useState(false);
  const [channelKind, setChannelKind] = useState<"text" | "voice">("text");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"Workspace" | "Project">("Project");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Member");
  const [error, setError] = useState("");
  // Reading a conversation here marks it read, so the chat box's unread count agrees.
  const openKey = route.page === "dm" || route.page === "channel" || route.page === "voice-chat" ? conversationKey(route) : "";
  const openCount = openKey ? data.messages[openKey]?.length ?? 0 : 0;
  useEffect(() => {
    if (appRoute.mode !== "lounge" || !openKey) return;
    setData((previous) => ({ ...previous, reads: { ...previous.reads, [openKey]: new Date().toISOString() } }));
  }, [appRoute.mode, openKey, openCount]);

  // Every project gets a channel of its own, kept in step with the project's name.
  useEffect(() => {
    setData((previous) => {
      let changed = false;
      const rooms = [...previous.rooms];
      for (const project of projects) {
        const index = rooms.findIndex(
          (room) => room.projectId === project.id || (room.category === "Project" && room.id === project.id),
        );
        const roomName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project-room";
        const roomDescription = `The place to connect and share progress on ${project.name}.`;
        if (index === -1) {
          rooms.push({
            id: project.id,
            projectId: project.id,
            name: roomName,
            description: roomDescription,
            category: "Project",
            members: members.filter((member) => member.id !== "me").slice(0, 4).map((member) => member.id),
            joined: true,
          });
          changed = true;
        } else if (
          rooms[index].name !== roomName ||
          rooms[index].description !== roomDescription ||
          rooms[index].projectId !== project.id
        ) {
          rooms[index] = { ...rooms[index], name: roomName, description: roomDescription, projectId: project.id };
          changed = true;
        }
      }
      return changed ? { ...previous, rooms } : previous;
    });
  }, [projects, members, setData]);

  // Voice rooms belong to a server, independently of its text-channel definitions.
  useEffect(() => {
    setData(previous => {
      const voiceRooms = [...(previous.voiceRooms ?? [])];
      for (const projectId of [undefined, ...projects.map(project => project.id)]) {
        const id = `voice-${projectId ?? WORKPLACE_SERVER}-general`;
        if (!voiceRooms.some(room => room.projectId === projectId))
          voiceRooms.push({ id, name: "General", description: "A place to talk with your team.", category: projectId ? "Project" : "Workspace", projectId, members: members.filter(member => member.id !== "me").map(member => member.id), joined: true });
      }
      return voiceRooms.length === (previous.voiceRooms ?? []).length ? previous : { ...previous, voiceRooms };
    });
  }, [projects, members, setData]);

  // Links from Work and Dashboard ("Message Sara", "Open the project room") land here.
  useEffect(() => {
    if (appRoute.mode !== "lounge") return;
    const section = appRoute.loungeSection;
    if ((section === "messages" || section === "dm" || section === "channel" || section === "voice" || section === "voice-chat") && appRoute.target) {
      setRoute({ page: section === "channel" || section === "voice" || section === "voice-chat" ? section : "dm", id: appRoute.target });
      if (section === "messages" || section === "dm")
        setData((previous) => ({
          ...previous,
          contacts: previous.contacts.includes(appRoute.target!) ? previous.contacts : [...previous.contacts, appRoute.target!],
        }));
    } else if (["home", "overview", "people", "rooms", "requests", "blocked", "saved"].includes(section)) {
      setRoute({ page: section === "overview" ? "home" : (section as LoungeRoute["page"]) });
    } else if (section === "messages" || section === "dm") {
      setRoute((previous) => (previous.page === "dm" && previous.id ? previous : { page: "people" }));
    } else if (section === "channel") {
      setRoute((previous) => (previous.page === "channel" && previous.id ? previous : { page: "rooms" }));
    } else {
      setRoute({ page: "home" });
    }
  }, [appRoute.revision, appRoute.mode, appRoute.loungeSection, appRoute.target, setData]);

  const go = (next: LoungeRoute) => {
    setRoute(next);
    if (next.page === "dm" && next.id)
      setData((previous) => ({
        ...previous,
        contacts: previous.contacts.includes(next.id!) ? previous.contacts : [...previous.contacts, next.id!],
      }));
    navigate("lounge", next.page === "dm" ? "messages" : next.page, next.id);
  };
  const openModal = (kind: "invite" | "room") => {
    setChannelKind("text");
    setName("");
    setDescription("");
    setEmail("");
    setError("");
    setSelectedMembers([]);
    setCategory("Project");
    setInviteRole("Member");
    setModal(kind);
  };
  const toggleBookmark = (id: string) => {
    const saved = data.bookmarks.includes(id);
    setData((previous) => ({
      ...previous,
      bookmarks: saved ? previous.bookmarks.filter((value) => value !== id) : [...previous.bookmarks, id],
    }));
    notify(saved ? "Message removed from saved." : "Message saved for later.");
  };
  const toggleReaction = (messageId: string, emoji: string) => {
    const key = conversationKey(route);
    setData((previous) => ({
      ...previous,
      messages: {
        ...previous.messages,
        [key]: (previous.messages[key] ?? []).map((message) => {
          if (message.id !== messageId) return message;
          const reactions = message.reactions ?? [];
          return {
            ...message,
            reactions: reactions.includes(emoji) ? reactions.filter((value) => value !== emoji) : [...reactions, emoji],
          };
        }),
      },
    }));
  };
  const toggleBlock = (id: string) => {
    const person = members.find((member) => member.id === id);
    const wasBlocked = (data.blocked ?? []).includes(id);
    setData((previous) => ({
      ...previous,
      blocked: (previous.blocked ?? []).includes(id)
        ? (previous.blocked ?? []).filter((value) => value !== id)
        : [...(previous.blocked ?? []), id],
    }));
    notify(`${person?.name ?? "This person"} ${wasBlocked ? "unblocked" : "blocked"}.`);
  };
  const togglePreview = (id: string) => {
    const target = data.voiceRooms?.find((room) => room.id === id);
    if (!target) return;
    setPreviewRoom(id);
    go({ page: "voice", id });
  };
  const accept = (id: string) => {
    const person = data.requests.find((request) => request.id === id);
    if (!person) return;
    setMembers((previous) => (previous.some((member) => member.id === id) ? previous : [...previous, person]));
    setData((previous) => ({
      ...previous,
      requests: previous.requests.filter((request) => request.id !== id),
      contacts: [...new Set([...previous.contacts, id])],
      rooms: previous.rooms.map((room) =>
        room.category === "Workspace" && !room.members.includes(id) ? { ...room, members: [...room.members, id] } : room,
      ),
    }));
    notify(`${person.name} is now part of your workspace.`);
  };
  const createRoom = (event: FormEvent) => {
    event.preventDefault();
    const roomName = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (roomName.length < 2) {
      setError("Enter a channel name with at least two letters or numbers.");
      return;
    }
    if ((channelKind === "voice" ? data.voiceRooms ?? [] : data.rooms).some((value) => value.name === roomName && value.projectId === room?.projectId)) {
      setError("A channel with that name already exists. Try a different name.");
      return;
    }
    const id = loungeId();
    setData((previous) => ({
      ...previous,
      [channelKind === "voice" ? "voiceRooms" : "rooms"]: [
        ...(channelKind === "voice" ? previous.voiceRooms ?? [] : previous.rooms),
        { id, name: roomName, description: description.trim() || "A shared space for your team.", category: room?.projectId ? "Project" : category, projectId: room?.projectId, members: selectedMembers, joined: true },
      ],
      messages: { ...previous.messages, [`${channelKind === "voice" ? "voice-chat" : "channel"}:${id}`]: [] },
    }));
    setModal(null);
    go({ page: channelKind === "voice" ? "voice" : "channel", id });
    notify(`#${roomName} is ready for your team.`);
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (members.some((member) => member.email.toLowerCase() === normalized)) {
      setError("This person is already in your workspace.");
      return;
    }
    if (data.invites.some((invitation) => invitation.email === normalized)) {
      setError("You already have a pending invitation for this email.");
      return;
    }
    setData((previous) => ({ ...previous, invites: [...previous.invites, { id: loungeId(), email: normalized, role: inviteRole }] }));
    setModal(null);
    go({ page: "requests" });
    notify("Invitation prepared. You can review it under Pending.");
  };

  const leaveVoice = () => { setPreviewRoom(undefined); setVoiceMuted(true); setVoiceUi(previous => ({ ...previous, camera:false, screen:false, deafened:false, activity:undefined, panel:undefined, selectedSound:undefined })); };
  const toggleVoiceMute = () => { if (voiceUi.deafened) { setVoiceUi(previous => ({ ...previous, deafened:false })); setVoiceMuted(false); } else setVoiceMuted(value => !value); };
  const updateVoiceUi = (change: Partial<VoiceUiState>) => {
    setVoiceUi(previous => ({ ...previous, ...change }));
    if ((change.camera || change.screen || change.activity) && previewRoom) go({ page:"voice", id:previewRoom });
  };
  const room = (route.page === "voice" || route.page === "voice-chat" ? data.voiceRooms ?? [] : data.rooms).find((value) => value.id === route.id);
  const person = route.page === "dm" ? members.find((member) => member.id === route.id) : undefined;
  const chatVisible = route.page === "dm" || route.page === "channel" || route.page === "voice-chat";
  const conversationExists = route.page === "dm" ? !!person : !!room;
  const showContext = chatVisible && conversationExists && contextOpen;
  const previewName = data.voiceRooms?.find((value) => value.id === previewRoom)?.name;
  // The server being looked at: the project the channel belongs to, or the workplace.
  const serverProject = projects.find((project) => project.id === room?.projectId);
  const serverKey = serverProject?.id ?? WORKPLACE_SERVER;
  const setServerIcon = (icon: ServerIcon | undefined) =>
    setData((previous) => {
      const icons = { ...(previous.serverIcons ?? {}) };
      if (icon) icons[serverKey] = icon;
      else delete icons[serverKey];
      return { ...previous, serverIcons: icons };
    });

  return (
    <div className={`lg-layout ${showContext ? (route.page === "dm" ? "lg-has-profile" : "lg-has-context") : ""}`}>
      <LoungeRail route={route} data={data} onNavigate={go} onCreate={() => openModal("room")} />
      <LoungeSidebar
        route={route}
        data={data}
        previewRoom={previewRoom}
        muted={voiceMuted || voiceUi.deafened}
        onNavigate={go}
        onCreate={() => openModal("room")}
        onInvite={() => openModal("invite")}
        onServerSettings={() => setServerSettings(true)}
        onPreview={togglePreview}
        onVoiceChat={id => go({ page: "voice-chat", id })}
        onCreateVoice={() => { openModal("room"); setChannelKind("voice"); }}
      />
      {route.page === "voice" && room ? (
        <VoiceRoom room={room} connected={previewRoom === room.id} muted={voiceMuted} voiceUi={voiceUi} onVoiceUi={updateVoiceUi} onLeave={leaveVoice} onToggleMute={toggleVoiceMute} onJoin={() => togglePreview(room.id)} onChat={() => go({ page: "voice-chat", id: room.id })} />
      ) : chatVisible ? (
        conversationExists ? (
          <ChatPanel
            onVoiceRoom={() => go({ page: "voice", id: room?.id })}
            route={route}
            data={data}
            room={route.page === "channel" || route.page === "voice-chat" ? room : undefined}
            contextOpen={contextOpen}
            onContext={() => setContextOpen(!contextOpen)}
            onDraft={(value) =>
              setData((previous) => ({ ...previous, drafts: { ...previous.drafts, [conversationKey(route)]: value } }))
            }
            onSend={(body, attachment, replyTo) => {
              const key = conversationKey(route);
              setData((previous) => ({
                ...previous,
                messages: {
                  ...previous.messages,
                  [key]: [
                    ...(previous.messages[key] ?? []),
                    { id: loungeId(), personId: "me", body, attachment, replyTo, time: new Date().toISOString() },
                  ],
                },
                drafts: { ...previous.drafts, [key]: "" },
              }));
            }}
            onBookmark={toggleBookmark}
            onReact={toggleReaction}
            onMute={() => {
              if (!room) return;
              setData((previous) => ({
                ...previous,
                mutedRooms: previous.mutedRooms.includes(room.id)
                  ? previous.mutedRooms.filter((id) => id !== room.id)
                  : [...previous.mutedRooms, room.id],
              }));
              notify(data.mutedRooms.includes(room.id) ? "Channel notifications enabled." : "Channel notifications muted.");
            }}
            onSaved={() => go({ page: "saved" })}
          />
        ) : (
          <main className="lg-main">
            <EmptyState
              title="This conversation is unavailable"
              description="Find a teammate or choose another channel to continue."
              action="Back to the Lounge"
              onAction={() => go({ page: "home" })}
            />
          </main>
        )
      ) : (
        <LoungeHome
          key={route.page}
          route={route}
          data={data}
          onNavigate={go}
          onInvite={() => openModal("invite")}
          onCreate={() => openModal("room")}
          onAccept={accept}
          onDecline={(id) => {
            setData((previous) => ({ ...previous, requests: previous.requests.filter((request) => request.id !== id) }));
            notify("Request declined.");
          }}
          onCancelInvite={(id) => {
            setData((previous) => ({ ...previous, invites: previous.invites.filter((invitation) => invitation.id !== id) }));
            notify("Invitation cancelled.");
          }}
          onBookmark={toggleBookmark}
          onBlock={toggleBlock}
        />
      )}
      {showContext && (route.page === "channel" || route.page === "voice-chat") && room && (
        <CrewSidebar room={room} onMessage={(id) => go({ page: "dm", id })} />
      )}
      {showContext && route.page === "dm" && person && (
        <ProfilePanel person={person} blocked={(data.blocked ?? []).includes(person.id)} onBlock={() => toggleBlock(person.id)} />
      )}
      <ControlDock
        onOpenSettings={onOpenSettings} roomName={previewName}
        muted={voiceMuted || voiceUi.deafened} voiceUi={voiceUi}
        inVoiceRoom={route.page === "voice"}
        onVoiceUi={updateVoiceUi}
        onToggleMute={toggleVoiceMute}
        onLeave={leaveVoice}
      />

      {serverSettings && (
        <ServerSettings
          projectId={serverProject?.id}
          name={serverProject?.name ?? "Soft Fix"}
          icon={data.serverIcons?.[serverKey]}
          onChange={setServerIcon}
          onClose={() => setServerSettings(false)}
        />
      )}
      {modal === "room" && (
        <Modal title="Create Channel" description={channelKind === "voice" ? "in Voice Channels" : "in Text Channels"} onClose={() => setModal(null)}>
          <form onSubmit={createRoom}>
            <label>
              Channel name
              <input
                className="sf-input"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                autoFocus
                required
                maxLength={48}
                placeholder="new-channel"
              />
              <small>Use a short name. Spaces will become hyphens.</small>
            </label>
            <label>
              Channel topic <span>(optional)</span>
              <textarea
                className="sf-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={240}
                placeholder="What will your team use this channel for?"
              />
            </label>
            <label>
              Category
              <select
                className="sf-input"
                value={category}
                onChange={(event) => setCategory(event.target.value as "Workspace" | "Project")}
              >
                <option>Project</option>
                <option>Workspace</option>
              </select>
            </label>
            <fieldset className="lg-member-picker">
              <legend>
                Add teammates <span>(optional)</span>
              </legend>
              {members
                .filter((member) => member.id !== "me")
                .map((member) => (
                  <label key={member.id}>
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(member.id)}
                      onChange={(event) =>
                        setSelectedMembers((previous) =>
                          event.target.checked ? [...previous, member.id] : previous.filter((id) => id !== member.id),
                        )
                      }
                    />
                    <span>
                      {member.name}
                      <small>{member.team}</small>
                    </span>
                  </label>
                ))}
            </fieldset>
            {error && (
              <p className="lg-form-error" role="alert">
                {error}
              </p>
            )}
            <div className="sf-form-actions">
              <button type="button" className="sf-button ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="submit" className="sf-button primary">
                <Hash />
                Create Channel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "invite" && (
        <Modal title="Add Friend" description="Invite a teammate to your Soft Fix workspace by email." onClose={() => setModal(null)}>
          <form onSubmit={invite}>
            <label>
              Email address
              <input
                className="sf-input"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError("");
                }}
                autoFocus
                required
                placeholder="teammate@company.com"
              />
            </label>
            <label>
              Workspace role
              <select className="sf-input" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                <option>Member</option>
                <option>Manager</option>
                <option>Client</option>
              </select>
            </label>
            <p className="lg-form-note">This preview saves the invitation on your device. No email is sent.</p>
            {error && (
              <p className="lg-form-error" role="alert">
                {error}
              </p>
            )}
            <div className="sf-form-actions">
              <button type="button" className="sf-button ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="submit" className="sf-button primary">
                <UserPlus />
                Send Friend Request
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
