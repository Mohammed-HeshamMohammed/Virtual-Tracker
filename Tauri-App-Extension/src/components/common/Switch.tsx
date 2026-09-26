export function Switch({
  checked,
  disabled,
  label,
  tip,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  /** What turning it on does; the label when omitted. */
  tip?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button data-tip={tip ?? label}
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
