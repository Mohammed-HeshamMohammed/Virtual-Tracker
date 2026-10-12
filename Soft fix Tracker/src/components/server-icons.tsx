import type { ComponentType, ReactNode } from "react";
import {
  Anchor,
  Briefcase,
  Buildings,
  Bug,
  Camera,
  ChartBar,
  Code,
  Coffee,
  Crown,
  Cube,
  Flame,
  GameController,
  Globe,
  Heart,
  Leaf,
  Lightbulb,
  Lightning,
  Megaphone,
  MusicNotes,
  PaintBrush,
  Palette,
  Planet,
  Rocket,
  ShieldCheck,
  Star,
  Target,
  Wrench,
  type IconProps,
} from "@phosphor-icons/react";
import type { ServerIcon } from "./lounge-model";

/** The built-in icons a server can use when it has no picture. */
export const SERVER_GLYPHS: Record<string, { label: string; Icon: ComponentType<IconProps> }> = {
  rocket: { label: "Rocket", Icon: Rocket },
  lightning: { label: "Lightning", Icon: Lightning },
  flame: { label: "Flame", Icon: Flame },
  star: { label: "Star", Icon: Star },
  heart: { label: "Heart", Icon: Heart },
  planet: { label: "Planet", Icon: Planet },
  palette: { label: "Palette", Icon: Palette },
  paintbrush: { label: "Paintbrush", Icon: PaintBrush },
  code: { label: "Code", Icon: Code },
  bug: { label: "Bug", Icon: Bug },
  wrench: { label: "Wrench", Icon: Wrench },
  chart: { label: "Chart", Icon: ChartBar },
  briefcase: { label: "Briefcase", Icon: Briefcase },
  buildings: { label: "Buildings", Icon: Buildings },
  megaphone: { label: "Megaphone", Icon: Megaphone },
  globe: { label: "Globe", Icon: Globe },
  leaf: { label: "Leaf", Icon: Leaf },
  coffee: { label: "Coffee", Icon: Coffee },
  game: { label: "Game controller", Icon: GameController },
  music: { label: "Music", Icon: MusicNotes },
  camera: { label: "Camera", Icon: Camera },
  lightbulb: { label: "Lightbulb", Icon: Lightbulb },
  shield: { label: "Shield", Icon: ShieldCheck },
  crown: { label: "Crown", Icon: Crown },
  cube: { label: "Cube", Icon: Cube },
  target: { label: "Target", Icon: Target },
  anchor: { label: "Anchor", Icon: Anchor },
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** A server's picture, glyph, or - with neither - the supplied fallback (usually its initials). */
export function ServerIconView({
  icon,
  fallback,
  size = 26,
}: {
  icon?: ServerIcon;
  fallback: ReactNode;
  size?: number;
}) {
  if (icon?.image) return <img src={icon.image} alt="" draggable={false} />;
  const glyph = icon?.glyph ? SERVER_GLYPHS[icon.glyph] : undefined;
  if (glyph) return <glyph.Icon weight="fill" size={size} />;
  return <>{fallback}</>;
}

const MAX_BYTES = 8 * 1024 * 1024;
const SIZE = 128;

/**
 * Turns a picked file into a small square data URL: centre-cropped and scaled to 128px, so it
 * stays light enough to keep with the rest of the Lounge's saved data. Read as a data URL rather
 * than an object URL, which the app's content-security policy would not let an image load from.
 */
export async function readIconImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG, JPG, WebP or GIF).");
  if (file.size > MAX_BYTES) throw new Error("That image is over 8 MB. Choose a smaller one.");
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That file couldn't be read as an image."));
    element.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your system couldn't prepare the image.");
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  return canvas.toDataURL("image/webp", 0.92);
}
