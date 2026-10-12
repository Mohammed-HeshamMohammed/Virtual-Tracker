import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "@phosphor-icons/react";

export type MenuEntry =
  | { kind: "heading"; label: string }
  | { kind: "item"; id: string; label: string; detail?: string; icon?: ReactNode; active?: boolean; disabled?: boolean; onSelect: () => void };

/** A button that opens a small menu under it. Arrow keys move through the items, Enter picks one,
 *  Escape or a click elsewhere closes it, and focus goes back to the button. The title bar's View
 *  menu and the Dashboard's page menu are both this. */
export function MenuButton({
  entries,
  label,
  children,
  align = "start",
  className = "",
  title,
  fixed = false,
  up = false,
}: {
  entries: MenuEntry[];
  /** The button's accessible name. */
  label: string;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  title?: string;
  /** Place the menu on the screen instead of inside its parent, for a button in a card that clips. */
  fixed?: boolean;
  /** With `fixed`: open above the button instead of below it (for one at the bottom of a sidebar). */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<{ top?: number; bottom?: number; left?: number; right?: number; room: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Focus an item without letting the browser scroll the page to reveal it (that would move a menu
  // that is placed on the screen); a long menu is kept scrolled to the focused row by hand.
  const focusItem = (item?: HTMLElement) => {
    if (!item) return;
    item.focus({ preventScroll: true });
    const pop = item.closest<HTMLElement>(".menu-pop");
    if (!pop) return;
    if (item.offsetTop < pop.scrollTop) pop.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > pop.scrollTop + pop.clientHeight) pop.scrollTop = item.offsetTop + item.offsetHeight - pop.clientHeight;
  };
  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    // A screen-placed menu would drift away from its button, so it closes if the page moves.
    // (Scrolling inside the menu itself, when it is a long list, is not the page moving.)
    const drift = (event?: Event) => {
      if (event?.type === "scroll" && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    if (fixed) {
      window.addEventListener("resize", drift);
      window.addEventListener("scroll", drift, true);
    }
    // Focus the chosen item (or the first) once the menu is on screen.
    const frame = requestAnimationFrame(() => focusItem(root.current?.querySelector<HTMLButtonElement>('[role="menuitem"][aria-current="true"]') ?? items()[0]));
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", drift);
      window.removeEventListener("scroll", drift, true);
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const onKeys = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") setOpen(false);
    else if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      focusItem(list[next]);
    } else if (!open && event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className={`menu-root ${className}`} ref={root} onKeyDown={onKeys}>
      <button ref={trigger} type="button" className="menu-trigger" aria-label={label} title={title ?? label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => {
          if (!open && fixed && trigger.current) {
            const box = trigger.current.getBoundingClientRect();
            const side = align === "end" ? { right: window.innerWidth - box.right } : { left: box.left };
            setSpot(up ? { bottom: window.innerHeight - box.top + 6, ...side, room: box.top - 18 } : { top: box.bottom + 6, ...side, room: window.innerHeight - box.bottom - 18 });
          }
          setOpen(!open);
        }}>
        {children}
      </button>
      {open && (
        <div className={`menu-pop align-${align}`} role="menu" id={id} aria-label={label} data-tauri-drag-region="false" style={fixed && spot ? { position: "fixed", top: spot.top ?? "auto", bottom: spot.bottom, left: spot.left, right: spot.right, maxHeight: Math.max(160, spot.room) } : undefined}>
          {entries.map((entry, index) =>
            entry.kind === "heading" ? (
              <div className="menu-heading" role="presentation" key={`${entry.label}-${index}`}>
                {entry.label}
              </div>
            ) : (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={entry.disabled}
                aria-current={entry.active ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  entry.onSelect();
                }}
              >
                {entry.icon && <span className="menu-icon">{entry.icon}</span>}
                <span className="menu-copy">
                  <strong>{entry.label}</strong>
                  {entry.detail && <small>{entry.detail}</small>}
                </span>
                {entry.active && <Check size={15} weight="bold" />}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
