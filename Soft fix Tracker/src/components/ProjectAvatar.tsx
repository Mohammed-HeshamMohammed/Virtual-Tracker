import { useState, type CSSProperties } from "react";
import type { AvatarCrop } from "../data/projectMeta";
import { useWorkspace } from "../workspace";
import { initials, SERVER_GLYPHS } from "./server-icons";
import "./project-avatar.css";

export type { AvatarCrop } from "../data/projectMeta";

export function cropStyle(crop: AvatarCrop): CSSProperties {
  const width = crop.zoom * Math.max(crop.ratio, 1);
  const height = crop.zoom * Math.max(1 / crop.ratio, 1);
  return { position: "absolute", maxWidth: "none", width: `${width * 100}%`, height: `${height * 100}%`, left: `${(0.5 - crop.cx * width) * 100}%`, top: `${(0.5 - crop.cy * height) * 100}%` };
}

type Props = {
  projectId?: string;
  name?: string;
  color?: string;
  src?: string;
  crop?: AvatarCrop;
  glyph?: string;
  size?: "xs" | "sm" | "lg" | "rail";
  className?: string;
};

/** Resolve saved project pictures by ID; explicit pictures are for unsaved picker previews. */
export function ProjectAvatar({ projectId, name, color, src, crop, glyph, size, className = "" }: Props) {
  const { projects, projectMeta } = useWorkspace();
  const project = projects.find((item) => item.id === projectId);
  const meta = projectId ? projectMeta[projectId] : undefined;
  const source = projectId ? meta?.avatar : src;
  const frame = projectId ? meta?.avatarCrop : crop;
  const glyphKey = projectId ? meta?.avatarGlyph : glyph;
  const Glyph = glyphKey ? SERVER_GLYPHS[glyphKey]?.Icon : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  return (
    <span className={`sf-project-avatar ${project?.color ?? color ?? "blue"} ${size ?? ""} ${className}`} data-project-avatar={projectId} aria-hidden="true">
      {source && source !== failedSource ? (
        <img src={source} alt="" draggable={false} style={frame ? cropStyle(frame) : undefined} onError={() => setFailedSource(source)} />
      ) : Glyph ? <Glyph weight="fill" /> : initials(project?.name ?? name ?? "Project") || "?"}
    </span>
  );
}

export function ProjectLabel({ projectId, fallback = "Archived project" }: { projectId: string; fallback?: string }) {
  const { projects } = useWorkspace();
  const project = projects.find((item) => item.id === projectId);
  return <span className="sf-project-label"><ProjectAvatar projectId={projectId} name={fallback} size="xs" /><span>{project?.name ?? fallback}</span></span>;
}
