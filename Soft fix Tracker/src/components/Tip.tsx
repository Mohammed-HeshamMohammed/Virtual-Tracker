import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./tip.css";

/** A tooltip that can carry real content (a title, details, notes), unlike the browser's one-line
 *  `title`. It shows after a short hover, or at once on keyboard focus, goes below the element (above
 *  when there's no room), and is drawn on the page rather than inside the card, so nothing clips it.
 *  `children` is the one element it describes. */
export function Tip({ content, children, delay = 380 }: { content: ReactNode; children: ReactElement<Record<string, unknown>>; delay?: number }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const wait = useRef<number>(undefined);
  const [spot, setSpot] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const show = (at: number) => {
    window.clearTimeout(wait.current);
    wait.current = window.setTimeout(() => {
      const element = anchor.current?.firstElementChild as HTMLElement | null;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      const above = below < 190 && box.top > below;
      setSpot({ left: Math.max(8, Math.min(box.left, window.innerWidth - 300)), top: above ? box.top - 8 : box.bottom + 8, above });
    }, at);
  };
  const hide = () => {
    window.clearTimeout(wait.current);
    setSpot(null);
  };

  useEffect(() => {
    if (!spot) return;
    const close = () => setSpot(null);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", escape);
    };
  }, [spot]);
  useEffect(() => () => window.clearTimeout(wait.current), []);

  return (
    <span className="tip-anchor" ref={anchor} onMouseEnter={() => show(delay)} onMouseLeave={hide} onFocus={() => show(0)} onBlur={hide} onMouseDown={hide}>
      {cloneElement(children, { "aria-describedby": spot ? id : undefined })}
      {spot &&
        createPortal(
          <div className="tip" role="tooltip" id={id} style={{ left: spot.left, top: spot.top, transform: spot.above ? "translateY(-100%)" : undefined }}>
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
