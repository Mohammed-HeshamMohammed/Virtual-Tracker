import { useState } from "react";
import { useWorkspace } from "../workspace";
import { cropStyle } from "./ProjectAvatar";

type Props = {
  initials: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  memberId?: string;
};

export function Avatar({
  initials,
  color = "violet",
  size = "md",
  memberId,
}: Props) {
  const { profile } = useWorkspace();
  const [failed, setFailed] = useState<string>();
  const own = memberId === "me";
  const source = own ? profile.avatar : undefined;
  const decoration =
    own && profile.decoration && profile.decoration !== "none"
      ? {
          outline: `${profile.decoration === "double" ? "3px double" : "2px solid"} ${profile.accentColor || "var(--accent-strong)"}`,
          outlineOffset: "1px",
        }
      : undefined;
  return (
    <span
      className={`avatar avatar-${color} avatar-${size}`}
      style={decoration}
    >
      {source && source !== failed ? (
        <img
          src={source}
          alt=""
          style={profile.avatarCrop ? cropStyle(profile.avatarCrop) : undefined}
          onError={() => setFailed(source)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
