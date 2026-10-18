import { useState } from "react";
import { CaretDown, ChatCircleDots, Hash, Microphone, MicrophoneSlash, Plus, SpeakerHigh, UserPlus } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { Avatar } from "./Avatar";
import type { LoungeRoom } from "./lounge-model";

/** The channel list of one server: text channels, then the voice channels. */
export function ChannelSidebar({
  rooms,
  voiceRooms,
  activeChannel,
  previewRoom,
  muted,
  onChannelChange,
  onCreate,
  onCreateVoice,
  onInvite,
  onPreview,
  onVoiceChat,
}: {
  rooms: LoungeRoom[];
  voiceRooms: LoungeRoom[];
  activeChannel?: string;
  previewRoom?: string;
  muted: boolean;
  onChannelChange: (id: string) => void;
  onCreate: () => void;
  onCreateVoice: () => void;
  onInvite: () => void;
  onPreview: (id: string) => void;
  onVoiceChat: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const { profile } = useWorkspace();
  const sections = [
    { id: "text", title: "Text Channels", rooms },
    { id: "voice", title: "Voice Channels", rooms: voiceRooms },
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
                onClick={section.id === "voice" ? onCreateVoice : onCreate}
              >
                <Plus weight="bold" />
              </button>
            </div>
            {!closed && (
              <nav aria-label={section.title}>
                {section.rooms.map((room) => {
                  const voice = section.id === "voice";
                  const active = voice ? previewRoom === room.id : activeChannel === room.id;
                  return (
                    <div key={room.id}>
                      <div className="lg-channel-row">
                      <button
                        className={`lg-channel-link ${active ? "active" : ""}`}
                        aria-current={active && !voice ? "page" : undefined}
                        aria-pressed={voice ? active : undefined}
                        onClick={() => (voice ? onPreview(room.id) : onChannelChange(room.id))}
                      >
                        {voice ? <SpeakerHigh /> : <Hash />}
                        <span>{room.name}</span>
                      </button>
                      {voice && <button className="lg-voice-chat-link" aria-label={`Open voice chat for ${room.name}`} title="Open voice chat" onClick={() => onVoiceChat(room.id)}><ChatCircleDots /></button>}
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
                    {voice && active && (
                      <ul className="lg-channel-people" aria-label={`In voice preview: ${room.name}`}>
                        <li>
                          <Avatar memberId="me" initials={profile.name.split(" ").map(word => word[0]).slice(0, 2).join("")} color="blue" size="sm" />
                          <span>{profile.name}<small>You · voice preview</small></span>
                          {muted ? <MicrophoneSlash aria-label="Microphone muted" /> : <Microphone aria-label="Microphone unmuted" />}
                        </li>
                      </ul>
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
