import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { setHelpMode, useHelpMode } from "../../utils/helpMode";
import { placeTip, tipTextOf, type Placed } from "../../utils/tooltip";
import { isShowable, orderForTour, rankOf, type Candidate } from "../../utils/tour";

const SPOTLIGHT_PAD = 4;
const EXPLAINABLE = "[data-help], [data-tip], [title]";
const OWN_UI = ".vt-tour, .titlebar-help";

/** Everything on screen worth explaining, in the order the tour visits it. */
export function collectTourSteps(doc: Document = document): Element[] {
  // A dialog on top of the page is the only thing the member can be asking about.
  const dialogs = doc.querySelectorAll('[role="dialog"][aria-modal="true"]');
  const scope: ParentNode = dialogs.length ? dialogs[dialogs.length - 1] : doc;
  const items: (Candidate & { el: Element })[] = [];
  scope.querySelectorAll(EXPLAINABLE).forEach((el, order) => {
    if (el.closest(OWN_UI) || !tipTextOf(el, true) || !isShowable(el)) return;
    items.push({
      el,
      order,
      rank: dialogs.length ? 0 : rankOf(el),
      // Rows of one list name themselves, so only they are thinned; a run of icon buttons
      // that merely look alike are each a different thing and are all explained.
      group: el.getAttribute("data-tour-repeat") ?? `solo-${order}`,
    });
  });
  return orderForTour(items).map((item) => item.el);
}

/**
 * The guided tour behind the title-bar "?": it walks through everything on screen one
 * thing at a time - sidebar, then top bar, then the page - dimming the rest and pointing at
 * each. Esc or Skip ends it, and nothing under it can be clicked while it runs.
 */
export function TourLayer() {
  const touring = useHelpMode();
  const [steps, setSteps] = useState<Element[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const finish = useCallback(() => setHelpMode(false), []);
  const step = useCallback(
    (by: number) => {
      const to = index + by;
      if (to >= steps.length) finish();
      else setIndex(Math.max(0, to));
    },
    [index, steps.length, finish],
  );

  useEffect(() => {
    if (!touring) {
      setSteps([]);
      setIndex(0);
      setRect(null);
      setPlaced(null);
      return;
    }
    const found = collectTourSteps();
    if (!found.length) {
      finish();
      return;
    }
    setSteps(found);
    setIndex(0);
  }, [touring, finish]);

  const current = steps[index];
  const measure = useCallback(() => {
    if (current?.isConnected) setRect(current.getBoundingClientRect());
  }, [current]);

  useEffect(() => {
    // Something can leave the page while the tour is on (a list refreshing): move on.
    if (current && !current.isConnected) step(1);
  }, [current, step]);

  useLayoutEffect(() => {
    if (!current?.isConnected) return;
    current.scrollIntoView?.({ block: "center", inline: "nearest" });
    measure();
  }, [current, measure]);

  useEffect(() => {
    if (!touring) return;
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [touring, measure]);

  useLayoutEffect(() => {
    if (!rect || !calloutRef.current) return;
    const { offsetWidth, offsetHeight } = calloutRef.current;
    setPlaced(
      placeTip(rect, { width: offsetWidth, height: offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [rect, index]);

  useEffect(() => {
    if (touring) nextRef.current?.focus();
  }, [touring, index, steps.length]);

  useEffect(() => {
    if (!touring) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    // Only the tour's own controls and the help button work while it runs.
    const block = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(OWN_UI)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", block, true);
    document.addEventListener("submit", block, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", block, true);
      document.removeEventListener("submit", block, true);
    };
  }, [touring, finish, step]);

  if (!touring || !current || !rect) return null;
  const last = index === steps.length - 1;
  return (
    <div className="vt-tour">
      <div
        className="vt-spotlight"
        style={{
          left: rect.left - SPOTLIGHT_PAD,
          top: rect.top - SPOTLIGHT_PAD,
          width: rect.width + SPOTLIGHT_PAD * 2,
          height: rect.height + SPOTLIGHT_PAD * 2,
        }}
      />
      <div
        ref={calloutRef}
        className={`vt-tip is-tour ${placed?.below === false ? "is-above" : "is-below"}${placed?.arrow === null ? " no-arrow" : ""}`}
        role="dialog"
        aria-label="Guided tour"
        style={
          {
            left: placed?.left ?? 0,
            top: placed?.top ?? 0,
            visibility: placed ? "visible" : "hidden",
            "--arrow-x": `${placed?.arrow ?? 0}px`,
          } as CSSProperties
        }
      >
        <p className="vt-tour-text">{tipTextOf(current, true)}</p>
        <div className="vt-tour-foot">
          <button type="button" className="vt-tour-skip" data-tip="Leave the tour" onClick={finish}>
            Skip tour
          </button>
          <span className="vt-tour-count">
            {index + 1} of {steps.length}
          </span>
          {index > 0 ? (
            <button type="button" className="vt-tour-back" data-tip="Go back to the previous item" onClick={() => step(-1)}>
              Back
            </button>
          ) : null}
          <button
            ref={nextRef}
            type="button"
            className="vt-tour-next"
            data-tip={last ? "Finish the tour" : "Go to the next item"}
            onClick={() => step(1)}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
