import { ChatsCircle } from "@phosphor-icons/react";

/** A floating shortcut back into the Lounge's chat, so being in Dashboard mode never means
 *  being cut off from the team conversation - only the icon shows until it is hovered. */
export function ChatLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="chat-launcher" onClick={onOpen} title="Chat with your team">
      <ChatsCircle weight="fill" />
      <span>Chat with your team</span>
      <b>3</b>
    </button>
  );
}
