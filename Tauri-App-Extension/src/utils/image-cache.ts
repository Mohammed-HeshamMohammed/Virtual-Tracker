/**
 * A bounded cache for screenshot images.
 *
 * These were plain `Record<string, string>` maps of base64 `data:` URLs with
 * no eviction anywhere - every screenshot a member opened stayed in the map for
 * the life of the window. Base64 inflates a JPEG by a third, so each entry is
 * 150-400 KB of string, plus whatever bitmap the renderer keeps for an <img>
 * that used it. A shift's worth of clicking accumulated tens of megabytes the
 * webview could never release, because the map still referenced it.
 *
 * WebView2 kills its renderer when it runs out, and Tauri does not bring it
 * back: the window is left painting nothing at all. That is the blank dark
 * window in the field reports - the frame is alive, the renderer is gone.
 *
 * Two changes fix it. The map is capped at what the UI can actually display,
 * and the bytes are moved out of the JS heap into a Blob behind an object URL,
 * which is revoked on eviction so the memory is genuinely returned rather than
 * merely unreferenced.
 */

/** The screenshot strip renders at most MAX_VISIBLE_SHOTS (12) at a time; a
 *  little headroom covers the selected one plus recent scrollback. */
export const IMAGE_CACHE_LIMIT = 16;

export type ImageCache = {
  /** Object URLs, keyed by screenshot id, safe to hand straight to <img src>. */
  urls: Record<string, string>;
  /** Insertion order, oldest first - the eviction queue. */
  order: string[];
};

export const EMPTY_IMAGE_CACHE: ImageCache = { urls: {}, order: [] };

/** Turns a `data:` URL into a Blob so the bytes leave the JS string heap. */
function toObjectUrl(dataUrl: string): string | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const meta = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    if (!meta.includes("base64")) return null;
    const mime = meta.slice(5, meta.indexOf(";")) || "image/jpeg";

    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    // Malformed payload - the caller keeps its placeholder.
    return null;
  }
}

/**
 * Adds one image, evicting the oldest entries past the cap and revoking their
 * object URLs. Returns the same cache untouched when there is nothing to do,
 * so React can skip the re-render.
 *
 * `keep` are ids that must not be evicted whatever their age - the currently
 * selected screenshot, which would otherwise blank out mid-view.
 */
export function putImage(
  cache: ImageCache,
  id: string,
  dataUrl: string,
  keep: readonly string[] = [],
): ImageCache {
  if (cache.urls[id]) return cache;
  const objectUrl = toObjectUrl(dataUrl);
  if (!objectUrl) return cache;

  const urls = { ...cache.urls, [id]: objectUrl };
  const order = [...cache.order, id];

  const protectedIds = new Set([id, ...keep]);
  while (order.length > IMAGE_CACHE_LIMIT) {
    const victim = order.findIndex((candidate) => !protectedIds.has(candidate));
    if (victim < 0) break;
    const [evicted] = order.splice(victim, 1);
    if (evicted && urls[evicted]) {
      URL.revokeObjectURL(urls[evicted]);
      delete urls[evicted];
    }
  }
  return { urls, order };
}

/** Revokes everything. For sign-out and project switches, where none of it is
 *  worth keeping and all of it is worth reclaiming. */
export function clearImages(cache: ImageCache): ImageCache {
  for (const url of Object.values(cache.urls)) URL.revokeObjectURL(url);
  return EMPTY_IMAGE_CACHE;
}
