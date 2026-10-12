import type { ReactNode } from "react";
import { ChatTeardropDots, Compass, Plus, UsersThree } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { WORKPLACE_SERVER, type LoungeData, type LoungeRoute } from "./lounge-model";
import { initials, ServerIconView } from "./server-icons";

/** One icon in the rail: the button, its tooltip, and the white pill that marks it. */
function RailItem({
  selected,
  label,
  className = "",
  onClick,
  children,
}: {
  selected?: boolean;
  label: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`lg-rail-item ${selected ? "selected" : ""}`}>
      <button
        className={`lg-server-button ${className}`}
        aria-label={label}
        aria-current={selected ? "page" : undefined}
        data-tooltip={label}
        onClick={onClick}
      >
        {children}
      </button>
    </div>
  );
}

/** The leftmost column: Direct Messages, then one "server" per workspace and project. */
export function LoungeRail({
  route,
  data,
  onNavigate,
  onCreate,
}: {
  route: LoungeRoute;
  data: LoungeData;
  onNavigate: (route: LoungeRoute) => void;
  onCreate: () => void;
}) {
  const { projects } = useWorkspace();
  const icons = data.serverIcons ?? {};
  const currentRoom = data.rooms.find((room) => room.id === route.id);
  const inChannel = route.page === "channel";
  const direct = !inChannel && route.page !== "rooms";
  return (
    <nav className="lg-server-rail" aria-label="Lounge servers">
      <RailItem
        selected={direct}
        label="Direct Messages"
        className="lg-home-server"
        onClick={() => onNavigate({ page: "home" })}
      >
        <ChatTeardropDots weight="fill" />
      </RailItem>
      <span className="lg-rail-divider" />
      <RailItem
        selected={inChannel && !currentRoom?.projectId}
        label="Soft Fix"
        className={`lg-workplace-server ${icons[WORKPLACE_SERVER]?.image ? "has-image" : ""}`}
        onClick={() => onNavigate({ page: "channel", id: "general" })}
      >
        <ServerIconView icon={icons[WORKPLACE_SERVER]} fallback={<UsersThree weight="fill" />} />
      </RailItem>
      {projects.map((project) => (
        <RailItem
          key={project.id}
          selected={inChannel && currentRoom?.projectId === project.id}
          label={project.name}
          className={icons[project.id]?.image ? "has-image" : ""}
          onClick={() =>
            onNavigate({
              page: "channel",
              id: data.rooms.find((room) => room.projectId === project.id)?.id ?? project.id,
            })
          }
        >
          <ServerIconView icon={icons[project.id]} fallback={initials(project.name)} />
        </RailItem>
      ))}
      <RailItem label="Add a Server" className="lg-rail-action" onClick={onCreate}>
        <Plus weight="bold" />
      </RailItem>
      <RailItem
        selected={route.page === "rooms"}
        label="Explore Channels"
        className="lg-rail-action"
        onClick={() => onNavigate({ page: "rooms" })}
      >
        <Compass weight="fill" />
      </RailItem>
    </nav>
  );
}
