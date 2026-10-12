import { useEffect, useId, useRef, type ReactNode } from "react";
import { MagnifyingGlass, X, ArrowRight } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";

export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Extra classes for the dialog, e.g. to give it a mode's colours. */
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const { notice, route } = useWorkspace();
  const openedAt = useRef(route.revision);
  useEffect(() => {
    if (route.revision !== openedAt.current) onClose();
  }, [route.revision, onClose]);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    element
      ?.querySelector<HTMLElement>(
        "[autofocus], input:not([type=checkbox]), textarea, select",
      )
      ?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`sf-modal ${wide ? "wide" : ""} ${className}`.trim()}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="sf-modal-header">
        <div>
          <h2 id={heading}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className="sf-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="sf-modal-body">{children}</div>
      {notice && (
        <div className="sf-modal-notice" role="status">
          {notice}
        </div>
      )}
    </dialog>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <label className={`sf-search ${className}`}>
      <MagnifyingGlass size={18} />
      <input
        aria-label={label || placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={15} />
        </button>
      )}
    </label>
  );
}
export function EmptyState({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="sf-empty">
      <MagnifyingGlass size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="sf-button" onClick={onAction}>
          {action}
          <ArrowRight />
        </button>
      )}
    </div>
  );
}
