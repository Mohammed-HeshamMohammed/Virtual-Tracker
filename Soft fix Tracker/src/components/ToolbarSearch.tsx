import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, MagnifyingGlass } from "@phosphor-icons/react";

export type SearchCommand = { label: string; detail: string; icon: (props: { size?: number }) => ReactNode; action: () => void };

/** The title bar's search. It is a field, not a button that opens a dialog: click it (or press
 *  Ctrl/Cmd + K) and type, and the matches drop down right under it. Arrow keys move through them,
 *  Enter opens one, Escape closes the list. */
export function ToolbarSearch({ commands }: { commands: SearchCommand[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((command) => words.every((word) => `${command.label} ${command.detail}`.toLowerCase().includes(word))).slice(0, 8);
  }, [commands, query]);

  useEffect(() => setAt(0), [query]);

  // Ctrl/Cmd + K goes to the field from anywhere.
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const run = (command: SearchCommand) => {
    setOpen(false);
    setQuery("");
    input.current?.blur();
    command.action();
  };

  const onKeys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (open) event.stopPropagation();
      setOpen(false);
      if (!query) input.current?.blur();
      else setQuery("");
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return setOpen(true);
      if (matches.length) setAt((at + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter" && open && matches[at]) {
      event.preventDefault();
      run(matches[at]);
    }
  };

  return (
    <div className="toolbar-search-wrap" ref={root} onKeyDown={onKeys} data-tauri-drag-region="false">
      <label className={`toolbar-search ${open ? "open" : ""}`} title="Search pages, projects and people (Ctrl K)">
        <MagnifyingGlass size={16} />
        <input
          ref={input}
          value={query}
          placeholder="Search Soft Fix"
          aria-label="Search workspace"
          role="combobox"
          aria-expanded={open}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[at] ? `${list}-${at}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        <kbd>Ctrl K</kbd>
      </label>
      {open && (
        <div className="toolbar-search-pop" id={list} role="listbox" data-tauri-drag-region="false">
          {matches.length ? (
            <>
              <div className="menu-heading" role="presentation">
                {query ? "Results" : "Jump to"}
              </div>
              {matches.map((command, index) => (
                <button key={`${command.label}-${index}`} id={`${list}-${index}`} type="button" role="option" aria-selected={index === at} className={`menu-item ${index === at ? "hot" : ""}`} onMouseEnter={() => setAt(index)} onClick={() => run(command)}>
                  <span className="menu-icon">
                    <command.icon size={17} />
                  </span>
                  <span className="menu-copy">
                    <strong>{command.label}</strong>
                    <small>{command.detail}</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </>
          ) : (
            <p className="toolbar-search-none">
              No matches for “{query}”. Try a project, teammate or page name.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
