/** Soft Fix logo artwork in `public/assets`, served from the app root. */
const asset = (file: string) => `/assets/${encodeURIComponent(file)}`;

export const logos = {
  /** Full logo with white lettering, for dark surfaces. */
  wordmarkOnDark: asset("soft fix copy 2.png"),
  /** Full logo with navy lettering, for light surfaces. */
  wordmarkOnLight: asset("soft fix copy.png"),
  /** The check-mark symbol alone, in brand colour. */
  mark: asset("soft fix copy 3.png"),
};
