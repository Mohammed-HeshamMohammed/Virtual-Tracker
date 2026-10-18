import { Microphone, MicrophoneSlash, Waveform } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { Avatar } from "./Avatar";

/** A short welcome sequence for the local voice preview, independent of chat history. */
export function VoiceIntro({ name, muted }: { name: string; muted: boolean }) {
  const { profile } = useWorkspace();
  return (
    <section className="lg-voice-intro" aria-label={`Voice preview in ${name}`}>
      <div className="lg-voice-intro-copy">
        <span className="lg-voice-intro-label"><Waveform /> VOICE ROOM</span>
        <h2>{name}</h2>
        <p>Make room for a conversation.</p>
        <small>Local voice preview · 1 participant</small>
      </div>
      <div className="lg-voice-intro-person">
        <span className="lg-voice-intro-avatar">
          <Avatar memberId="me" initials={profile.name.split(" ").map(word => word[0]).slice(0, 2).join("")} color="blue" size="lg" />
        </span>
        <span className="lg-voice-intro-person-name">{profile.name}</span>
        <small>{muted ? <MicrophoneSlash /> : <Microphone />}{muted ? "You · muted" : "You · microphone preview on"}</small>
      </div>
      <div className="lg-voice-intro-wave" aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i />
      </div>
    </section>
  );
}
