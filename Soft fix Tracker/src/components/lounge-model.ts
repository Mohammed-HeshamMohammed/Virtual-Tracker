import type { Member } from "../workspace";
import type { WorkProject } from "../data/work";

export type LoungeRoom = { id: string; name: string; description: string; category: "Workspace" | "Project"; members: string[]; joined: boolean; projectId?: string };
export type LoungeMessage = { id: string; personId: string; body: string; time: string; attachment?: string; replyTo?: string; reactions?: string[] };
export type LoungeRoute = { page: "home" | "people" | "requests" | "blocked" | "saved" | "rooms" | "dm" | "channel"; id?: string };
export type LoungeInvite = { id: string; email: string; role: string };
/** What a server shows in the rail: an uploaded picture, a built-in glyph, or neither (initials). */
export type ServerIcon = { image?: string; glyph?: string };
/** Key of the workplace server in `serverIcons`; project servers use their project id. */
export const WORKPLACE_SERVER = "workplace";
export type LoungeData = { /** When each conversation was last read, as an ISO time (for the unread counts). */ reads?: Record<string, string>; serverIcons?: Record<string, ServerIcon>; rooms: LoungeRoom[]; messages: Record<string, LoungeMessage[]>; drafts: Record<string, string>; bookmarks: string[]; requests: Member[]; contacts: string[]; invites: LoungeInvite[]; mutedRooms: string[]; blocked: string[] };
export const conversationKey = (route: LoungeRoute) => `${route.page}:${route.id}`;
export const loungeId = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function initialLoungeData(members: Member[], projects: WorkProject[], sample = true): LoungeData {
  const teammates = members.filter(member => member.id !== "me");
  const ids = teammates.map(member => member.id);
  const rooms: LoungeRoom[] = [
    { id: "general", name: "general", description: "Everyday updates, questions, and good conversations.", category: "Workspace", members: ids, joined: true },
    { id: "announcements", name: "announcements", description: "Company news and the updates worth knowing about.", category: "Workspace", members: ids, joined: true },
    ...projects.map((project, index) => ({ id: project.id, projectId: project.id, name: project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: `The place to connect and share progress on ${project.name}.`, category: "Project" as const, members: ids.slice(0, index + 2), joined: true })),
    { id: "design-studio", name: "design-studio", description: "Share work in progress and get a fresh perspective.", category: "Project", members: ids.slice(0, 3), joined: false },
    { id: "coffee-break", name: "coffee-break", description: "Take five. Meet the people behind the projects.", category: "Workspace", members: ids.slice(1, 4), joined: false },
  ];
  const time = (hour: number, minute: number) => { const date = new Date(); date.setHours(hour, minute, 0, 0); return date.toISOString(); };
  const messages: Record<string, LoungeMessage[]> = {};
  for (const room of rooms) {
    messages[`channel:${room.id}`] = [
      { id: `${room.id}-1`, personId: room.members[0] ?? "me", body: room.id === "announcements" ? "This week’s team update is ready. Please add your project highlights before our Friday check-in." : `Welcome to #${room.name}. ${room.description}`, time: time(9, 15) },
      { id: `${room.id}-2`, personId: room.members[1] ?? "me", body: "I’ve added my notes for the week. Looking forward to hearing what everyone is working on.", time: time(9, 32) },
    ];
  }
  const bodies = ["The updated screens are ready for your review. Let me know when you have a moment and we can walk through the details.", "I’ve finished the navigation changes. Happy to pair on the next piece when you’re ready.", "Quick check-in: do you have everything you need for today? I’m around if anything is blocked."];
  teammates.forEach((person, index) => { messages[`dm:${person.id}`] = [{ id: `dm-${person.id}-1`, personId: person.id, body: bodies[index % bodies.length], time: time(9, 20 + index * 3) }]; });
  return { rooms, messages, drafts: {}, bookmarks: [], contacts: ids.slice(0, 4), invites: [], mutedRooms: [], blocked: [], requests: !sample ? [] : [
    { id: "ahmed", name: "Ahmed Tarek", initials: "AT", color: "orange", role: "Member", team: "Support", status: "Away", email: "ahmed@softfix.work" },
    { id: "laila", name: "Laila Reda", initials: "LR", color: "slate", role: "Member", team: "Operations", status: "Offline", email: "laila@softfix.work" },
  ] };
}

/** The key of the direct-message thread with one person. */
export const dmKey = (personId: string) => `dm:${personId}`;
/** Messages in a conversation from other people that were sent after it was last read. */
export const unreadIn = (data: LoungeData, key: string) => {
  const read = data.reads?.[key] ?? "";
  return (data.messages[key] ?? []).filter(message => message.personId !== "me" && message.time > read).length;
};
