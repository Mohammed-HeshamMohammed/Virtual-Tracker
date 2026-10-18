import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from "react";
import { FilterSelect } from "../DashboardParts";
import { ProjectAvatar, cropStyle, type AvatarCrop } from "./project-facts";

/** A project's picture as it is kept: the image, how it is framed (only an animated GIF needs that kept,
 *  a still picture is cut to its frame when it is chosen), and who to credit when it came from a search. */
export type ProjectPicture = { src: string; crop?: AvatarCrop; credit?: string; glyph?: string };

/** An animated GIF is kept whole (cutting it would stop it moving). Pictures live in this device's
 *  local storage, which is a few megabytes for the whole app, so a GIF has a size limit. */
const GIF_LIMIT = 800 * 1024;
const STILL_SIZE = 192;
const MAX_ZOOM = 4;

type Found = { id: string; title: string; creator: string; license: string; thumbnail: string; url: string };
type Draft = { url: string; blob: Blob; gif: boolean; credit?: string; crop: AvatarCrop };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Keeps the frame inside the picture: the centre can't come closer to an edge than half a frame. */
function fit(crop: AvatarCrop): AvatarCrop {
  const zoom = clamp(crop.zoom, 1, MAX_ZOOM);
  const halfX = 0.5 / (zoom * Math.max(crop.ratio, 1));
  const halfY = 0.5 / (zoom * Math.max(1 / crop.ratio, 1));
  return { ...crop, zoom, cx: clamp(crop.cx, halfX, 1 - halfX), cy: clamp(crop.cy, halfY, 1 - halfY) };
}

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(blob);
  });

/** The framed part of a still picture, drawn small, as a data URL. */
async function cutStill(blob: Blob, crop: AvatarCrop): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const side = Math.min(bitmap.width, bitmap.height) / crop.zoom;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = STILL_SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, crop.cx * bitmap.width - side / 2, crop.cy * bitmap.height - side / 2, side, side, 0, 0, STILL_SIZE, STILL_SIZE);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.86);
}

/** Choosing a project's picture, in place on the form: upload an image or an animated GIF, or search
 *  pictures by topic, then drag and zoom to choose the part of it that shows. Nothing is kept until
 *  "Use this picture". */
export function AvatarPicker({ name, color, value, onChange, subject = "project" }: { name: string; color: string; value: ProjectPicture | null; onChange: (picture: ProjectPicture | null) => void; subject?: "project" | "profile" }) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("pictures");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  // The picture being framed is shown from a temporary address, released when it is replaced or the form closes.
  useEffect(() => () => void (draft && URL.revokeObjectURL(draft.url)), [draft?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Opens a picture for framing, once its size is known. */
  const frameUp = async (blob: Blob, credit?: string) => {
    if (!blob.type.startsWith("image/")) throw new Error("Choose an image file.");
    const gif = blob.type === "image/gif";
    if (gif && blob.size > GIF_LIMIT) throw new Error("That GIF is over 800 KB. An animated picture is kept whole, so it has to be smaller.");
    const url = URL.createObjectURL(blob);
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("That image could not be read. Try a PNG, JPEG or GIF."));
      image.src = url;
    }).catch((problem) => {
      URL.revokeObjectURL(url);
      throw problem;
    });
    setDraft({ url, blob, gif, credit, crop: { cx: 0.5, cy: 0.5, zoom: 1, ratio: size.width / size.height } });
  };
  /** Runs a step that can fail, showing what it is doing and what went wrong. */
  const attempt = async (doing: string, step: () => Promise<void>) => {
    setBusy(doing);
    setError("");
    try {
      await step();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That did not work. Try again.");
    } finally {
      setBusy("");
    }
  };

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still counts as a change.
    event.target.value = "";
    if (file) void attempt("Opening the image", () => frameUp(file));
  };
  const search = () => {
    const topic = query.trim();
    if (!topic) return;
    void attempt("Searching", async () => {
      // Openverse: an open library of Creative Commons pictures, searched without an account. Only
      // pictures whose licence allows changing them (a crop is a change) and commercial use are asked for.
      const response = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(topic)}&page_size=18&mature=false&license_type=commercial,modification${kind === "gifs" ? "&extension=gif&source=wikimedia" : ""}`);
      if (response.status === 429) throw new Error("Too many searches just now. Try again in a minute.");
      if (!response.ok) throw new Error("The picture search is not answering. Check the connection and try again.");
      const data = (await response.json()) as { results?: Found[] };
      setFound(data.results ?? []);
    }).catch(() => undefined);
  };
  const pick = (item: Found) =>
    void attempt("Fetching the picture", async () => {
      // A GIF is fetched whole so it keeps moving; a still picture only needs its preview size.
      const response = await fetch(kind === "gifs" ? item.url : item.thumbnail).catch(() => null);
      if (!response?.ok) throw new Error("That picture could not be fetched. Try another one.");
      await frameUp(await response.blob(), `${item.title || "Untitled"}${item.creator ? ` by ${item.creator}` : ""} (CC ${item.license.toUpperCase()}, via Openverse)`);
    });
  const use = () => {
    if (!draft) return;
    const { blob, gif, crop, credit } = draft;
    void attempt("Saving the picture", async () => {
      const picture: ProjectPicture = gif ? { src: await asDataUrl(blob), crop, credit } : { src: await cutStill(blob, crop), credit };
      // Saving is silent when storage is full, so find out now whether this picture fits.
      try {
        localStorage.setItem("softfix.picture-probe", picture.src);
        localStorage.removeItem("softfix.picture-probe");
      } catch {
        throw new Error("There is no room left on this device to keep that picture. Try a smaller one, or remove another saved picture.");
      }
      onChange(picture);
      setDraft(null);
      setSearching(false);
    });
  };

  const setCrop = (patch: Partial<AvatarCrop>) => setDraft((old) => (old ? { ...old, crop: fit({ ...old.crop, ...patch }) } : old));
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, cx: draft.crop.cx, cy: draft.crop.cy };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    const side = frame.current?.clientWidth;
    if (!from || !draft || !side) return;
    // Dragging the picture right shows more of its left: the centre moves the other way.
    const { zoom, ratio } = draft.crop;
    setCrop({ cx: from.cx - (event.clientX - from.x) / (side * zoom * Math.max(ratio, 1)), cy: from.cy - (event.clientY - from.y) / (side * zoom * Math.max(1 / ratio, 1)) });
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!draft) return;
    const step = 0.02 / draft.crop.zoom;
    const moves: Record<string, Partial<AvatarCrop>> = {
      ArrowLeft: { cx: draft.crop.cx - step },
      ArrowRight: { cx: draft.crop.cx + step },
      ArrowUp: { cy: draft.crop.cy - step },
      ArrowDown: { cy: draft.crop.cy + step },
      "+": { zoom: draft.crop.zoom + 0.1 },
      "=": { zoom: draft.crop.zoom + 0.1 },
      "-": { zoom: draft.crop.zoom - 0.1 },
    };
    if (!moves[event.key]) return;
    event.preventDefault();
    setCrop(moves[event.key]);
  };

  return (
    <div className="pp">
      <div className="np-avatar-field">
        <ProjectAvatar name={name} color={color} src={value?.src} crop={value?.crop} glyph={value?.glyph} size="lg" />
        <div>
          <strong>{subject === "profile" ? "Profile avatar" : "Project picture"}</strong>
          <small>Upload an image or an animated GIF, or search pictures by topic, then choose the part that shows. Without one, {subject === "profile" ? "your profile" : "the project"} shows its initials.</small>
          <div>
            <label className="sf-button np-upload">
              {value ? "Upload another" : "Upload image"}
              <input type="file" accept="image/*" className="db-sr-only" onChange={upload} />
            </label>
            <button type="button" className="sf-button" aria-expanded={searching} onClick={() => setSearching(!searching)}>
              {searching ? "Close search" : "Search pictures"}
            </button>
            {value && (
              <button type="button" className="sf-button" onClick={() => onChange(null)}>
                Remove
              </button>
            )}
          </div>
          {value?.credit && <small className="pp-credit">{value.credit}</small>}
        </div>
      </div>

      {draft && (
        <div className="pp-panel pp-framing">
          <div
            ref={frame}
            className="pp-frame"
            tabIndex={0}
            role="group"
            aria-label="The part of the picture that shows. Drag it, or use the arrow keys, to move; plus and minus to zoom."
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={nudge}
          >
            <img src={draft.url} alt="" draggable={false} style={cropStyle(draft.crop)} />
          </div>
          <div className="pp-framing-side">
            <strong>Choose the part that shows</strong>
            <small>Drag the picture to move it. {draft.gif ? "It keeps moving as an animated GIF." : "It is saved cut to this square."}</small>
            <label className="pp-zoom">
              Zoom
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={draft.crop.zoom} onChange={(event) => setCrop({ zoom: Number(event.target.value) })} />
              <b>{Math.round(draft.crop.zoom * 100)}%</b>
            </label>
            <div className="pp-previews" aria-hidden="true">
              <span>How it will look</span>
              <div>
                {(["lg", undefined, "sm"] as const).map((size) => (
                  <ProjectAvatar key={size ?? "md"} name={name} color={color} src={draft.url} crop={draft.crop} size={size} />
                ))}
              </div>
            </div>
            <div className="pp-actions">
              <button type="button" className="sf-button primary" disabled={Boolean(busy)} onClick={use}>
                Use this picture
              </button>
              <button type="button" className="sf-button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {searching && !draft && (
        <div className="pp-panel">
          <div className="pp-search">
            <input
              aria-label="Topic to search pictures for"
              placeholder="A topic, e.g. mountains, coffee, rocket"
              value={query}
              autoFocus
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter here searches; it must not submit the project form around it.
                if (event.key !== "Enter") return;
                event.preventDefault();
                search();
              }}
            />
            <FilterSelect
              label="Kind"
              value={kind}
              onChange={(next) => {
                setKind(next);
                setFound(null);
              }}
              options={[
                { value: "pictures", text: "Pictures" },
                { value: "gifs", text: "Animated GIFs" },
              ]}
            />
            <button type="button" className="sf-button" disabled={!query.trim() || Boolean(busy)} onClick={search}>
              Search
            </button>
          </div>
          {found && !found.length && <p className="db-muted pp-quiet">Nothing found for that topic. Try a simpler word.</p>}
          {found && found.length > 0 && (
            <div className="pp-results">
              {found.map((item) => (
                <button key={item.id} type="button" title={`${item.title || "Untitled"}${item.creator ? ` by ${item.creator}` : ""}`} aria-label={`Use ${item.title || "this picture"}`} disabled={Boolean(busy)} onClick={() => pick(item)}>
                  <img src={item.thumbnail} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
          <p className="db-muted pp-quiet">The topic is sent to Openverse, an open library of Creative Commons pictures. The picture you choose is credited on the {subject === "profile" ? "profile" : "project's page"}.</p>
        </div>
      )}

      {busy && (
        <p className="db-muted pp-quiet" role="status">
          {busy}…
        </p>
      )}
      {error && (
        <p className="np-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
