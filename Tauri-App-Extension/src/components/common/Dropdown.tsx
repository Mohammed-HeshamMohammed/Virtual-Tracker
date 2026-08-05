import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { DropdownOption } from "../../types";

export function Dropdown({
  id,
  value,
  options,
  placeholder,
  emptyLabel,
  disabled,
  direction = "down",
  onChange,
}: {
  id: string;
  value: string;
  options: DropdownOption[];
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
  direction?: "up" | "down";
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selected = options.find((o) => o.id === value);
  const isEmpty = options.length === 0;

  const openAt = (index: number) => {
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)));
    setOpen(true);
  };

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (isEmpty) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          openAt(options.findIndex((o) => o.id === value));
        } else {
          setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          openAt(options.findIndex((o) => o.id === value));
        } else {
          setActiveIndex((i) => Math.max(0, i - 1));
        }
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) commit(activeIndex);
        else openAt(Math.max(0, options.findIndex((o) => o.id === value)));
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className={`dropdown${open ? " open" : ""}`} ref={rootRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && options[activeIndex] ? `${id}-opt-${activeIndex}` : undefined}
        className={`dropdown-trigger${open ? " open" : ""}`}
        disabled={disabled || isEmpty}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(0, options.findIndex((o) => o.id === value))))}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="dropdown-value">
          {selected ? selected.label : isEmpty ? emptyLabel : placeholder}
        </span>
        <svg
          className={`dropdown-chevron${open ? " open" : ""}`}
          viewBox="0 0 12 12"
          width="10"
          height="10"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && !isEmpty ? (
        <div className={`dropdown-menu dropdown-menu-${direction}`} role="listbox" id={`${id}-listbox`}>
          {options.map((option, index) => (
            <button
              key={option.id}
              id={`${id}-opt-${index}`}
              type="button"
              role="option"
              aria-selected={option.id === value}
              aria-disabled={option.disabled}
              disabled={option.disabled}
              className={`dropdown-item${option.id === value ? " active" : ""}${index === activeIndex ? " highlighted" : ""}${option.disabled ? " disabled" : ""}`}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              onClick={() => !option.disabled && commit(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
