import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowUpRight, ChatTeardropText, MagnifyingGlass, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { useWorkspace } from "../../workspace";
import { Avatar } from "../Avatar";
import { dmKey, loungeId, unreadIn } from "../lounge-model";
import "./chat.css";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" }));
const initialsOf = (name: string) => name.split(" ").map((word) => word[0]).slice(0, 2).join("");

/** A chat box in the corner of the app, so you can message someone without leaving what you are doing.
 *  It is the Lounge's direct messages in a small window: it reads and writes the same conversations,
 *  drafts and unread marks, so a message sent here is in the Lounge and the other way round. */
export function ChatDock() {
  const { members, lounge, setLounge, chat, openChat, closeChat, navigate } = useWorkspace();
  const [query, setQuery] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const blocked = lounge.blocked ?? [];

  const rows = members
    .filter((member) => member.id !== "me" && !blocked.includes(member.id))
    .map((person) => {
      const key = dmKey(person.id);
      const messages = lounge.messages[key] ?? [];
      return { person, key, last: messages[messages.length - 1], unread: unreadIn(lounge, key) };
    });
  const known = rows.filter((row) => row.last || lounge.contacts.includes(row.person.id));
  const listed = (query.trim() ? rows.filter((row) => row.person.name.toLowerCase().includes(query.trim().toLowerCase())) : known).sort((a, b) => (b.last?.time ?? "").localeCompare(a.last?.time ?? ""));
  const unread = known.reduce((sum, row) => sum + row.unread, 0);

  const person = chat.personId ? members.find((member) => member.id === chat.personId && !blocked.includes(member.id)) : undefined;
  const key = person ? dmKey(person.id) : "";
  const messages = key ? lounge.messages[key] ?? [] : [];
  const draft = key ? lounge.drafts[key] ?? "" : "";
  const newest = messages[messages.length - 1]?.time ?? "";

  // Opening a thread reads it, and so does a message arriving while it is open.
  useEffect(() => {
    if (!chat.open || !key || newest <= (lounge.reads?.[key] ?? "")) return;
    setLounge((previous) => ({ ...previous, reads: { ...previous.reads, [key]: new Date().toISOString() } }));
  }, [chat.open, key, newest, lounge.reads, setLounge]);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [key, messages.length, chat.open]);
  useEffect(() => {
    if (!chat.open) return;
    (key ? composer.current : search.current)?.focus();
  }, [chat.open, key]);

  const setDraft = (value: string) => setLounge((previous) => ({ ...previous, drafts: { ...previous.drafts, [key]: value } }));
  const send = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!person || !body) return;
    const now = new Date().toISOString();
    setLounge((previous) => ({
      ...previous,
      contacts: previous.contacts.includes(person.id) ? previous.contacts : [...previous.contacts, person.id],
      messages: { ...previous.messages, [key]: [...(previous.messages[key] ?? []), { id: loungeId(), personId: "me", body, time: now }] },
      drafts: { ...previous.drafts, [key]: "" },
      reads: { ...previous.reads, [key]: now },
    }));
  };
  const onKeys = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeChat();
  };

  return (
    <div className="chat-dock">
      {chat.open && (
        <section className="chat-panel" role="dialog" aria-label={person ? `Chat with ${person.name}` : "Chat"} onKeyDown={onKeys}>
          <header className="chat-head">
            {person ? (
              <>
                <button className="chat-icon" aria-label="Back to your chats" title="Back" onClick={() => openChat(undefined)}>
                  <ArrowLeft size={17} />
                </button>
                <span className="chat-who">
                  <Avatar memberId={person.id} initials={person.initials || initialsOf(person.name)} color={person.color} size="sm" />
                  <span>
                    <strong>{person.name}</strong>
                    <small>
                      <i className={`chat-dot ${person.status.toLowerCase()}`} />
                      {person.status}
                    </small>
                  </span>
                </span>
              </>
            ) : (
              <strong className="chat-title">Chat</strong>
            )}
            <span className="chat-tools">
              <button
                className="chat-icon"
                aria-label="Open in the Lounge"
                title="Open in the Lounge"
                onClick={() => {
                  navigate("lounge", person ? "messages" : "home", person?.id);
                  closeChat();
                }}
              >
                <ArrowUpRight size={17} />
              </button>
              <button className="chat-icon" aria-label="Close chat" title="Close" onClick={closeChat}>
                <X size={17} />
              </button>
            </span>
          </header>

          {person ? (
            <>
              <div className="chat-thread" ref={thread}>
                {messages.length === 0 && <p className="chat-empty">Say hello to {person.name.split(" ")[0]}.</p>}
                {messages.map((message) => (
                  <div key={message.id} className={`chat-bubble ${message.personId === "me" ? "mine" : "theirs"}`}>
                    <p>{message.body}</p>
                    <time dateTime={message.time}>{when(message.time)}</time>
                  </div>
                ))}
              </div>
              <form className="chat-composer" onSubmit={send}>
                <input ref={composer} value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${person.name.split(" ")[0]}`} aria-label={`Message ${person.name}`} />
                <button className="chat-send" type="submit" disabled={!draft.trim()} aria-label="Send message" title="Send">
                  <PaperPlaneTilt size={17} weight="fill" />
                </button>
              </form>
            </>
          ) : (
            <>
              <label className="chat-search">
                <MagnifyingGlass size={15} />
                <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find someone to message" aria-label="Find someone to message" />
              </label>
              <div className="chat-list">
                {listed.map(({ person: item, last, unread: count }) => (
                  <button key={item.id} className="chat-row" onClick={() => openChat(item.id)}>
                    <span className="chat-avatar">
                      <Avatar memberId={item.id} initials={item.initials || initialsOf(item.name)} color={item.color} size="sm" />
                      <i className={`chat-dot ${item.status.toLowerCase()}`} />
                    </span>
                    <span className="chat-row-copy">
                      <strong>{item.name}</strong>
                      <small>{last ? `${last.personId === "me" ? "You: " : ""}${last.body}` : "No messages yet"}</small>
                    </span>
                    <span className="chat-row-meta">
                      {last && <time dateTime={last.time}>{when(last.time)}</time>}
                      {count > 0 && <b aria-label={`${count} unread`}>{count}</b>}
                    </span>
                  </button>
                ))}
                {listed.length === 0 && <p className="chat-empty">{query ? "No one by that name." : "Search for someone to start a chat."}</p>}
              </div>
            </>
          )}
        </section>
      )}
      <button className="chat-fab" aria-label={unread ? `Chat, ${unread} unread` : "Chat"} aria-expanded={chat.open} title="Chat" onClick={() => (chat.open ? closeChat() : openChat(chat.personId))}>
        {chat.open ? <X size={22} weight="bold" /> : <ChatTeardropText size={24} weight="fill" />}
        {!chat.open && unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
      </button>
    </div>
  );
}
