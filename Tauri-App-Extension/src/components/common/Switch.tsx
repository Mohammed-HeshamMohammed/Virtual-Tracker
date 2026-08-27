/**
 * Replaces the bare `<input type="checkbox">` with accent-color that Settings
 * used - the only unstyled control left in the app. Keeps real checkbox
 * semantics via role="switch" so it stays keyboard- and screen-reader-usable.
 */
export function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`vt-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="vt-switch-thumb" />
    </button>
  );
}
