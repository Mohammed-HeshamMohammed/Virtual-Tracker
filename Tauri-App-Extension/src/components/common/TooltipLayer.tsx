import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { isHelpMode, useHelpMode } from "../../utils/helpMode";
import { HELP_SELECTOR, placeTip, tipTextOf, TIP_SELECTOR } from "../../utils/tooltip";

const SHOW_DELAY_MS = 350;
const HELP_DELAY_MS = 120;

type Shown = { text: string; rect: DOMRect; help: boolean };
type Placed = ReturnType<typeof placeTip>;

/** The highlight is drawn a little outside the element so it does not touch its edges. */
const SPOTLIGHT_PAD = 4;

/**
 * One tooltip for the whole app. Anything carrying `data-tip` (or a plain `title`) gets
 * it on hover or keyboard focus, so a button needs only the attribute and no wrapper.
 *
 * In help mode everything that explains itself (`data-help`, too) is outlined and answers
 * straight away, and nothing can be triggered by accident while the member is reading.
 * Only the help button leaves it: Esc hides the tip on screen and nothing more.
 */
export function TooltipLayer() {
  const helping = useHelpMode();
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<Placed | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setShown(null);
      setPos(null);
    };
    const show = (target: Element | null) => {
      if (target === current) return;
      hide();
      const help = isHelpMode();
      const text = target ? tipTextOf(target, help) : "";
      if (!target || !text) return;
      current = target;
      timer = window.setTimeout(
        () => {
          if (target.isConnected) setShown({ text, help, rect: target.getBoundingClientRect() });
        },
        help ? HELP_DELAY_MS : SHOW_DELAY_MS,
      );
    };
    const targetOf = (event: Event) =>
      event.target instanceof Element ? event.target.closest(isHelpMode() ? HELP_SELECTOR : TIP_SELECTOR) : null;

    const onOver = (event: Event) => show(targetOf(event));
    const onFocus = (event: Event) => {
      const target = targetOf(event);
      if (target?.matches(":focus-visible")) show(target);
    };
    const onLeaveWindow = (event: MouseEvent) => {
      if (!event.relatedTarget) hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    // The help button is the way out, so it is the one thing that still works.
    const blockWhileHelping = (event: Event) => {
      if (!isHelpMode()) return;
      if (event.target instanceof Element && event.target.closest(".titlebar-help")) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("mouseout", onLeaveWindow);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("click", blockWhileHelping, true);
    document.addEventListener("submit", blockWhileHelping, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("mouseout", onLeaveWindow);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("click", blockWhileHelping, true);
      document.removeEventListener("submit", blockWhileHelping, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useEffect(() => {
    setShown(null);
    setPos(null);
  }, [helping]);

  useLayoutEffect(() => {
    if (!shown || !tipRef.current) return;
    const { offsetWidth, offsetHeight } = tipRef.current;
    setPos(
      placeTip(shown.rect, { width: offsetWidth, height: offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [shown]);

  return (
    <>
      {helping ? (
        <div className="help-mode-pill" role="status">
          Help mode: hover anything to see what it is for. Press the ? button to leave.
        </div>
      ) : null}
      {shown?.help ? (
        <div
          className="vt-spotlight"
          style={{
            left: shown.rect.left - SPOTLIGHT_PAD,
            top: shown.rect.top - SPOTLIGHT_PAD,
            width: shown.rect.width + SPOTLIGHT_PAD * 2,
            height: shown.rect.height + SPOTLIGHT_PAD * 2,
          }}
        />
      ) : null}
      {shown ? (
        <div
          ref={tipRef}
          className={`vt-tip ${pos?.below === false ? "is-above" : "is-below"}${shown.help ? " is-help" : ""}`}
          role="tooltip"
          style={
            {
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? "visible" : "hidden",
              "--arrow-x": `${pos?.arrow ?? 0}px`,
            } as CSSProperties
          }
        >
          {shown.text}
        </div>
      ) : null}
    </>
  );
}
