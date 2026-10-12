import { useState } from "react";
import { CaretDown, Hash, Plus, SpeakerHigh, UserPlus } from "@phosphor-icons/react";
import type { LoungeRoom } from "./lounge-model";

/** The channel list of one server: text channels, then the voice channels. */
export function ChannelSidebar({
  rooms,
  activeChannel,
  previewRoom,
  onChannelChange,
  onCreate,
  onInvite,
  onPreview,
}: {
  rooms: LoungeRoom[];
  activeChannel?: string;
  previewRoom?: string;
  onChannelChange: (id: string) => void;
  onCreate: () => void;
  onInvite: () => void;
  onPreview: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const joined = rooms.filter((room) => room.joined);
  const sections = [
    { id: "text", title: "Text Channels", rooms: joined },
    { id: "voice", title: "Voice Channels", rooms: joined.slice(0, 2) },
  ];
  const toggle = (id: string) =>
    setCollapsed((previous) =>
      previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id],
    );
  return (
    <div className="lg-channel-navigation">
      {sections.map((section) => {
        const closed = collapsed.includes(section.id);
        return (
          <section key={section.id}>
            <div className="lg-channel-group">
              <button
                onClick={() => toggle(section.id)}
                aria-expanded={!closed}
              >
                <CaretDown weight="bold" className={closed ? "is-collapsed" : ""} />
                {section.title}
              </button>
              <button
                className="lg-icon-button"
                aria-label={`Create a channel in ${section.title}`}
                title="Create Channel"
                onClick={onCreate}
              >
                <Plus weight="bold" />
              </button>
            </div>
            {!closed && (
              <nav aria-label={section.title}>
                {section.rooms.map((room, index) => {
                  const voice = section.id === "voice";
                  const active = voice ? previewRoom === room.id : activeChannel === room.id;
                  return (
                    <div className="lg-channel-row" key={room.id}>
                      <button
                        className={`lg-channel-link ${active ? "active" : ""}`}
                        aria-current={active && !voice ? "page" : undefined}
                        onClick={() => (voice ? onPreview(room.id) : onChannelChange(room.id))}
                      >
                        {voice ? <SpeakerHigh /> : <Hash />}
                        <span>{voice ? (index === 0 ? "General" : "Team room") : room.name}</span>
                      </button>
                      {!voice && (
                        <button
                          className="lg-channel-hover"
                          aria-label={`Invite people to ${room.name}`}
                          title="Create Invite"
                          onClick={onInvite}
                        >
                          <UserPlus weight="fill" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </nav>
            )}
          </section>
        );
      })}
    </div>
  );
}
