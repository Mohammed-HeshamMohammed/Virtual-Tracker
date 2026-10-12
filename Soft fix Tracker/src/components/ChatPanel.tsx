import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  ArrowBendUpLeft,
  Bell,
  BellSlash,
  BookmarkSimple,
  File,
  Hash,
  MagnifyingGlass,
  Plus,
  SignOut,
  Smiley,
  SmileySticker,
  Tray,
  UserCircle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { Avatar } from "./Avatar";
import {
  conversationKey,
  type LoungeData,
  type LoungeMessage,
  type LoungeRoom,
  type LoungeRoute,
} from "./lounge-model";

const EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "🔥", "✅"];
/** Messages from the same person this close together share one avatar and name. */
const GROUP_WINDOW = 7 * 60 * 1000;

type Props = {
  route: LoungeRoute;
  data: LoungeData;
  room?: LoungeRoom;
  contextOpen: boolean;
  onContext: () => void;
  onDraft: (value: string) => void;
  onSend: (body: string, attachment?: string, replyTo?: string) => void;
  onBookmark: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onJoin: () => void;
  onLeave: () => void;
  onMute: () => void;
  onSaved: () => void;
};

const presence = (status: string) =>
  status === "Available" ? "Online" : status === "Focusing" ? "Do Not Disturb" : status === "Away" ? "Idle" : "Offline";

function stamp(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const clock = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Today at ${clock}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${clock}`;
  return `${date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "numeric" })} ${clock}`;
}

export function ChatPanel({
  route,
  data,
  room,
  contextOpen,
  onContext,
  onDraft,
  onSend,
  onBookmark,
  onReact,
  onJoin,
  onLeave,
  onMute,
  onSaved,
}: Props) {
  const { members, profile, notify } = useWorkspace();
  const key = conversationKey(route);
  const messages = data.messages[key] ?? [];
  const draft = data.drafts[key] ?? "";
  const person = members.find((member) => member.id === route.id);
  const name = room ? room.name : (person?.name ?? "Conversation");
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState<LoungeMessage | null>(null);
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  /** Which emoji tray is open: "composer", or the id of the message it reacts to. */
  const [picker, setPicker] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const attachment = attachments[key];
  const canCompose = !room || room.joined;
  const muted = room ? data.mutedRooms.includes(room.id) : false;

  useEffect(() => {
    setQuery("");
    setReply(null);
    setPicker(null);
  }, [key]);
  useEffect(() => {
    if (!query && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [key, messages.length, query]);
  useEffect(() => {
    const field = composer.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 320)}px`;
  }, [draft, key, canCompose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canCompose || (!draft.trim() && !attachment)) return;
    onSend(draft.trim(), attachment, reply?.id);
    setAttachments((previous) => ({ ...previous, [key]: "" }));
    setReply(null);
    setPicker(null);
    composer.current?.focus();
  };
  const nameOf = (id: string) => (id === "me" ? profile.name : (members.find((member) => member.id === id)?.name ?? "Teammate"));
  const search = query.trim().toLowerCase();
  const visible = messages.filter((message) =>
    `${message.body} ${message.attachment ?? ""} ${nameOf(message.personId)}`.toLowerCase().includes(search),
  );

  const topbarIcon = (active: boolean, label: string, onClick: () => void, icon: ReactElement) => (
    <button
      className={`lg-icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <main className="lg-main lg-chat">
      <header className="lg-topbar">
        <div className="lg-topbar-title">
          {room ? (
            <>
              <Hash />
              <h1>{room.name}</h1>
              <span className="lg-topbar-divider" />
              <p className="lg-topic" title={room.description}>
                {room.description}
              </p>
            </>
          ) : (
            <>
              <span className="lg-avatar-status">
                <Avatar initials={person?.initials ?? "AM"} color={person?.color} size="sm" />
                <i className={`lg-status-dot ${(person?.status ?? "Offline").toLowerCase()}`} />
              </span>
              <h1>{name}</h1>
              <span className="lg-topbar-presence">{presence(person?.status ?? "Offline")}</span>
            </>
          )}
        </div>
        <div className="lg-topbar-tools">
          {room &&
            topbarIcon(
              muted,
              muted ? "Unmute channel" : "Mute channel",
              onMute,
              muted ? <BellSlash weight="fill" /> : <Bell weight="fill" />,
            )}
          {room?.joined &&
            topbarIcon(false, "Leave channel", onLeave, <SignOut weight="fill" />)}
          {topbarIcon(
            contextOpen,
            room ? "Member list" : "User profile",
            onContext,
            room ? <UsersThree weight="fill" /> : <UserCircle weight="fill" />,
          )}
          <label className="lg-search-box">
            <input
              aria-label={`Search ${room ? `#${room.name}` : name}`}
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                <X weight="bold" />
              </button>
            ) : (
              <MagnifyingGlass weight="bold" />
            )}
          </label>
          {topbarIcon(false, "Saved messages", onSaved, <Tray weight="fill" />)}
        </div>
      </header>

      <div className="lg-message-scroller" ref={scroller} role="log" aria-label={`Messages in ${name}`}>
        {!query && (
          <section className="lg-intro">
            {room ? (
              <span className="lg-intro-icon">
                <Hash weight="bold" />
              </span>
            ) : (
              <span className="lg-intro-avatar">
                <Avatar initials={person?.initials ?? "AM"} color={person?.color} size="lg" />
              </span>
            )}
            <h2>{room ? `Welcome to #${room.name}!` : name}</h2>
            <p>
              {room ? (
                <>This is the start of the #{room.name} channel. {room.description}</>
              ) : (
                <>
                  This is the beginning of your direct message history with <strong>{name}</strong>.
                </>
              )}
            </p>
          </section>
        )}
        {query && (
          <div className="lg-results-count">
            {visible.length} {visible.length === 1 ? "Result" : "Results"}
          </div>
        )}
        {visible.map((message, index) => {
          const author = members.find((member) => member.id === message.personId);
          const self = message.personId === "me";
          const quoted = message.replyTo ? messages.find((item) => item.id === message.replyTo) : undefined;
          const time = new Date(message.time);
          const previous = visible[index - 1];
          const newDay = !previous || new Date(previous.time).toDateString() !== time.toDateString();
          const grouped =
            !newDay &&
            !!previous &&
            previous.personId === message.personId &&
            !message.replyTo &&
            time.getTime() - new Date(previous.time).getTime() < GROUP_WINDOW;
          const saved = data.bookmarks.includes(message.id);
          const reactions = message.reactions ?? [];
          return (
            <div key={message.id}>
              {newDay && (
                <div className="lg-date-rule">
                  <span>
                    {time.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              )}
              <article className={`lg-message ${grouped ? "grouped" : ""} ${quoted ? "has-reply" : ""}`}>
                {quoted && (
                  <div className="lg-reply-ref">
                    <Avatar
                      initials={members.find((member) => member.id === quoted.personId)?.initials ?? "AM"}
                      color={members.find((member) => member.id === quoted.personId)?.color}
                      size="sm"
                    />
                    <strong>@{nameOf(quoted.personId)}</strong>
                    <span>{quoted.body || quoted.attachment}</span>
                  </div>
                )}
                {grouped ? (
                  <time className="lg-gutter-time" dateTime={message.time} title={time.toLocaleString()}>
                    {time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </time>
                ) : (
                  <Avatar initials={author?.initials ?? "AM"} color={author?.color} size="lg" />
                )}
                {!grouped && (
                  <div className="lg-message-meta">
                    <strong className={`lg-role-${(author?.role ?? "Member").toLowerCase()}`}>
                      {self ? profile.name : nameOf(message.personId)}
                    </strong>
                    <time dateTime={message.time} title={time.toLocaleString()}>
                      {stamp(message.time)}
                    </time>
                    {saved && <BookmarkSimple className="lg-bookmark-indicator" weight="fill" aria-label="Saved" />}
                  </div>
                )}
                {message.body && <p>{message.body}</p>}
                {message.attachment && (
                  <div className="lg-attachment">
                    <File weight="fill" />
                    <span>
                      <strong>{message.attachment}</strong>
                      <small>Attachment preview · stored on this device</small>
                    </span>
                  </div>
                )}
                {reactions.length > 0 && (
                  <div className="lg-reactions">
                    {reactions.map((emoji) => (
                      <button
                        key={emoji}
                        className="lg-reaction"
                        aria-label={`Remove ${emoji} reaction`}
                        onClick={() => onReact(message.id, emoji)}
                      >
                        {emoji}
                        <span>1</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="lg-message-actions">
                  <button
                    className="lg-icon-button"
                    title="Add Reaction"
                    aria-label="Add reaction"
                    aria-expanded={picker === message.id}
                    onClick={() => setPicker(picker === message.id ? null : message.id)}
                  >
                    <SmileySticker />
                  </button>
                  <button
                    className="lg-icon-button"
                    title="Reply"
                    aria-label={`Reply to ${nameOf(message.personId)}`}
                    onClick={() => {
                      setReply(message);
                      composer.current?.focus();
                    }}
                  >
                    <ArrowBendUpLeft />
                  </button>
                  <button
                    className={`lg-icon-button ${saved ? "active" : ""}`}
                    title={saved ? "Unsave Message" : "Save Message"}
                    aria-label={saved ? "Unsave message" : "Save message"}
                    aria-pressed={saved}
                    onClick={() => onBookmark(message.id)}
                  >
                    <BookmarkSimple weight={saved ? "fill" : "regular"} />
                  </button>
                  {picker === message.id && (
                    <div className="lg-emoji-tray" role="group" aria-label="Choose a reaction">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          aria-label={`React with ${emoji}`}
                          onClick={() => {
                            onReact(message.id, emoji);
                            setPicker(null);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            </div>
          );
        })}
        {!visible.length && (
          <div className="lg-no-results">
            <MagnifyingGlass />
            <h3>{query ? "No results" : "No messages yet"}</h3>
            <p>{query ? "Try another word, teammate name, or attachment name." : "Be the first to say something."}</p>
          </div>
        )}
      </div>

      <footer className="lg-composer-wrap">
        {canCompose ? (
          <form onSubmit={submit} className="lg-composer">
            {reply && (
              <div className="lg-reply-preview">
                <span>
                  Replying to <strong>{nameOf(reply.personId)}</strong>
                </span>
                <button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}>
                  <X weight="bold" />
                </button>
              </div>
            )}
            {attachment && (
              <div className="lg-file-preview">
                <File weight="fill" />
                <span>{attachment}</span>
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => setAttachments((previous) => ({ ...previous, [key]: "" }))}
                >
                  <X weight="bold" />
                </button>
              </div>
            )}
            <div className="lg-composer-box">
              <input
                className="lg-hidden-input"
                ref={fileInput}
                type="file"
                aria-label="Choose an attachment"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setAttachments((previous) => ({ ...previous, [key]: file.name }));
                    notify("Attachment added as a local preview.");
                  }
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="lg-composer-plus"
                title="Upload a File"
                aria-label="Upload a file"
                onClick={() => fileInput.current?.click()}
              >
                <Plus weight="bold" />
              </button>
              <textarea
                ref={composer}
                aria-label={`Message ${room ? `#${name}` : `@${name}`}`}
                placeholder={`Message ${room ? `#${name}` : `@${name}`}`}
                value={draft}
                rows={1}
                maxLength={12000}
                onChange={(event) => onDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="lg-composer-icons">
                <button
                  type="button"
                  className="lg-icon-button"
                  title="Select Emoji"
                  aria-label="Select emoji"
                  aria-expanded={picker === "composer"}
                  onClick={() => setPicker(picker === "composer" ? null : "composer")}
                >
                  <Smiley weight="fill" />
                </button>
              </div>
              {picker === "composer" && (
                <div className="lg-emoji-tray lg-composer-tray" role="group" aria-label="Choose an emoji">
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Insert ${emoji}`}
                      onClick={() => {
                        onDraft(draft + emoji);
                        setPicker(null);
                        composer.current?.focus();
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </form>
        ) : (
          <div className="lg-join-prompt">
            <div>
              <strong>You are viewing a preview of #{name}</strong>
              <p>Join this channel to take part in the conversation.</p>
            </div>
            <button className="sf-button primary" onClick={onJoin}>
              Join Channel
            </button>
          </div>
        )}
      </footer>
    </main>
  );
}
