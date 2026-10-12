import { useRef, useState } from "react";
import { UploadSimple, Trash } from "@phosphor-icons/react";
import { Modal } from "./ui";
import { initials, readIconImage, ServerIconView, SERVER_GLYPHS } from "./server-icons";
import type { ServerIcon } from "./lounge-model";

/** Server Settings: the picture or icon a server wears in the rail. */
export function ServerSettings({
  name,
  icon,
  onChange,
  onClose,
}: {
  name: string;
  icon?: ServerIcon;
  onChange: (icon: ServerIcon | undefined) => void;
  onClose: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange({ image: await readIconImage(file) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That image couldn't be used.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Server Settings" description={name} onClose={onClose}>
      <div className="lg-icon-editor">
        <div className="lg-icon-preview">
          <span className="lg-server-preview">
            <ServerIconView icon={icon} fallback={initials(name)} size={40} />
          </span>
          <div>
            <h3>Server Icon</h3>
            <p>We recommend an image of at least 128×128. It is cropped to a square.</p>
            <div className="lg-icon-actions">
              <input
                ref={fileInput}
                className="lg-hidden-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                aria-label="Choose an image for the server icon"
                onChange={(event) => {
                  void upload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button type="button" className="sf-button primary" disabled={busy} onClick={() => fileInput.current?.click()}>
                <UploadSimple weight="bold" />
                {busy ? "Preparing…" : "Upload Image"}
              </button>
              {icon && (
                <button type="button" className="sf-button ghost" onClick={() => onChange(undefined)}>
                  <Trash />
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        {error && (
          <p className="lg-form-error" role="alert">
            {error}
          </p>
        )}
        <h3 className="lg-icon-heading">Or choose an icon</h3>
        <div className="lg-glyph-grid" role="group" aria-label="Built-in icons">
          {Object.entries(SERVER_GLYPHS).map(([key, { label, Icon }]) => (
            <button
              key={key}
              type="button"
              className={`lg-glyph ${icon?.glyph === key ? "selected" : ""}`}
              title={label}
              aria-label={label}
              aria-pressed={icon?.glyph === key}
              onClick={() => onChange({ glyph: key })}
            >
              <Icon weight="fill" />
            </button>
          ))}
        </div>
        <div className="sf-form-actions">
          <button type="button" className="sf-button primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
