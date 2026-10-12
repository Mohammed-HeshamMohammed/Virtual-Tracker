/** How data appears, done once for the whole app rather than in every page.
 *
 *  When a page opens, the cards in view come in together: each chart starts empty and fills, and each
 *  figure counts up from zero. A card further down plays when you scroll to it, so it is never
 *  finished before you could see it. Each card plays once: scrolling away and back, or leaving a mode
 *  and coming back, doesn't repeat it.
 *
 *  There is one clock and one value. A single loop works out, each frame, how far along every chart
 *  is (a number from 0 to 1) and writes that same number to two places: the chart, as the CSS
 *  variable --p that its shape is drawn from (see data-motion.css), and the figure that belongs to
 *  it, as its text. So "39%" and an arc at 39% are the same number and cannot disagree. Do not draw
 *  the charts with CSS animations beside a scripted counter: that was tried three ways, and in real
 *  playback the charts ran about a second ahead of their figures.
 *
 *  Until its page plays, a card holds its charts empty (--p: 0, in CSS) and its figures at zero
 *  (here), so nothing flashes its final value first. A card that only appears later (or outside any
 *  page) plays when it is first on screen.
 *
 *  Figures are found by FIGURES. Their text is never replaced, only their text nodes' values, so React
 *  keeps working on them; if anything else changes the text while it counts, the count simply stops. */

const FIGURES = [
  ".db-tile > strong",
  ".db-metric > strong",
  ".wk-metric > strong",
  ".db-kpis strong",
  ".db-summary-strip strong",
  ".db-people-stats strong",
  ".db-team-stats strong",
  ".db-detail-summary strong",
  ".db-profile-summary strong",
  ".db-allocation-total > strong",
  ".db-gauge-value strong",
  ".db-gauge-facts strong",
  ".db-donut-centre strong",
  ".db-invoice-total strong",
  ".wk-task-summary strong",
  ".wk-timesheet-summary strong",
  ".wk-goal-ring strong",
  ".wk-week-card > div > strong",
  ".wk-week-chart > button > span",
  ".db-bar-bubble",
  ".db-prow-percent",
  ".db-contributor-time",
  "[data-count]",
].join(",");

/** The shapes drawn from --p (the same list data-motion.css draws and holds empty). */
const SHAPES = [
  ".db-gauge-fill",
  ".db-bar",
  ".db-donut-segment",
  ".db-progress > span",
  ".db-prow-bar i",
  ".db-share > i",
  ".db-hbar > i > b",
  ".wk-progress > i",
  ".mode-meter > i",
  ".wk-week-chart i",
  ".wk-goal-ring",
  ".db-area-canvas svg",
].join(",");

/** The cards whose charts and figures wait to be played. */
const CARDS = ".sf-card, .mode-card, .wk-week-card";
/** The containers that hold one page's content; a page is a new element each time it is opened. */
const PAGES = ".db-content, .wk-main, .lg-main, .mode-body";
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const supported = typeof document !== "undefined" && typeof IntersectionObserver !== "undefined" && typeof MutationObserver !== "undefined" && typeof ResizeObserver !== "undefined";
// Set as the module loads, before anything is drawn, so the stylesheet holds the charts empty from the
// very first frame. Not set when motion is off or this can't run: the charts are then simply drawn.
if (supported && !reduced()) document.documentElement.setAttribute("data-motion", "");

const clamp = (value: number) => Math.min(1, Math.max(0, value));

// ---- the clock: read from the CSS variables in data-motion.css, the one place the pace is set ----

type Ease = (t: number) => number;

/** A CSS cubic-bezier(x1, y1, x2, y2) as a function of progress. */
function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let i = 0; i < 8; i++) {
      const error = x(t) - progress;
      if (Math.abs(error) < 1e-5) return y(t);
      const slope = dx(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0, high = 1;
    t = progress;
    for (let i = 0; i < 24; i++) {
      if (x(t) < progress) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return y(t);
  };
}

const timeMs = (value: string, fallback: number) => {
  const match = /^\s*(-?[\d.]+)(ms|s)\s*$/.exec(value);
  return match ? parseFloat(match[1]) * (match[2] === "s" ? 1000 : 1) : fallback;
};

type Clock = { duration: number; lead: number; ease: Ease };
let clock: Clock | null = null;
function getClock(): Clock {
  if (clock) return clock;
  const style = getComputedStyle(document.documentElement);
  const curve = /cubic-bezier\(([^)]+)\)/.exec(style.getPropertyValue("--data-ease"));
  const points = curve ? curve[1].split(",").map(parseFloat) : [];
  const [x1, y1, x2, y2] = points.length === 4 && !points.some(Number.isNaN) ? points : [0.37, 0, 0.63, 1];
  clock = {
    duration: Math.max(1, timeMs(style.getPropertyValue("--data-dur"), 2200)),
    lead: timeMs(style.getPropertyValue("--data-lead"), 250),
    ease: bezier(x1, y1, x2, y2),
  };
  return clock;
}

// ---- figures ---------------------------------------------------------------------------------------

const two = (value: number) => String(value).padStart(2, "0");
/** A clock ("03:02:33", "12:05") or a duration ("8h 02m") at `k` of its length, as real time: 8h 02m at
 *  a half is 4h 01m, not each group halved on its own. Null if the text is neither. */
function scaledTime(text: string, k: number) {
  const clock = /^(\s*)(\d+):(\d{2})(?::(\d{2}))?(\s*)$/.exec(text);
  if (clock) {
    const [, before, a, b, c, after] = clock;
    if (c === undefined) {
      const total = Math.round((Number(a) * 60 + Number(b)) * k);
      return `${before}${String(Math.floor(total / 60)).padStart(a.length, "0")}:${two(total % 60)}${after}`;
    }
    const total = Math.round((Number(a) * 3600 + Number(b) * 60 + Number(c)) * k);
    return `${before}${String(Math.floor(total / 3600)).padStart(a.length, "0")}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}${after}`;
  }
  const span = /^(\s*)(\d+)h (\d{2})m(\s*)$/.exec(text);
  if (span) {
    const total = Math.round((Number(span[2]) * 60 + Number(span[3])) * k);
    return `${span[1]}${Math.floor(total / 60)}h ${two(total % 60)}m${span[4]}`;
  }
  return null;
}

/** `text` with every number scaled by `k` (0 to 1), keeping its decimals, thousands commas and zero padding. */
function scaled(text: string, k: number) {
  const time = scaledTime(text, k);
  if (time !== null) return time;
  return text.replace(NUMBER, (token, offset: number, whole: string) => {
    const decimals = token.includes(".") ? token.length - token.indexOf(".") - 1 : 0;
    const integer = token.split(".")[0];
    const value = parseFloat(token.replace(/,/g, "")) * k;
    let out = value.toFixed(decimals);
    // Clock groups ("03:02:33") and zero-padded counts ("04") keep their width while they count.
    const clock = text[offset - 1] === ":" || whole[offset + token.length] === ":";
    if (integer.includes(",")) out = Number(out).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    else if (integer.length > 1 && (integer.startsWith("0") || clock)) out = out.padStart(token.length, "0");
    return out;
  });
}

const HAS_DIGIT = /\d/;

function textNodes(element: Element) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (HAS_DIGIT.test((node as Text).data)) nodes.push(node as Text);
  return nodes;
}

type Held = { nodes: Text[]; finals: string[]; shown: string[] };
const held = new WeakMap<Element, Held>();

/** Puts a figure at zero, ready to count. Returns false if it has nothing to count. */
function prime(element: Element) {
  if (held.has(element)) return true;
  const nodes = textNodes(element);
  if (!nodes.length || (element.textContent ?? "").length > 26) return false;
  const finals = nodes.map((node) => node.data);
  const shown = finals.map((text) => scaled(text, 0));
  nodes.forEach((node, index) => (node.data = shown[index]));
  held.set(element, { nodes, finals, shown });
  return true;
}

/** Writes a held figure at `k` of its value (1 = the real text, and it is let go). */
function show(element: Element, k: number) {
  const figure = held.get(element);
  if (!figure) return;
  for (let index = 0; index < figure.nodes.length; index++) {
    // Something else wrote to this text (React, on an update): leave it alone and stop.
    if (figure.nodes[index].data !== figure.shown[index]) return void held.delete(element);
    figure.shown[index] = k >= 1 ? figure.finals[index] : scaled(figure.finals[index], k);
    figure.nodes[index].data = figure.shown[index];
  }
  if (k >= 1) held.delete(element);
}

// ---- playing ---------------------------------------------------------------------------------------

type Styled = Element & { style: CSSStyleDeclaration };

/** The chart a figure belongs to: the nearest shape, looking outwards from the figure as far as its card. */
function shapeFor(figure: Element, card: Element, shapes: Element[]) {
  for (let node: Element | null = figure; node; node = node.parentElement) {
    if (shapes.includes(node)) return node;
    const inside = shapes.find((shape) => node!.contains(shape));
    if (inside) return inside;
    if (node === card) break;
  }
  return null;
}

/** Plays one card from `start`: every frame, each of its charts and that chart's figures get the same progress.
 *  `card` is null for a figure that stands outside any card. */
function animate(card: Element | null, figures: Element[], start: number, onDone?: () => void) {
  const { duration, lead, ease } = getClock();
  const shapes = card ? ([...(card.matches(SHAPES) ? [card] : []), ...card.querySelectorAll(SHAPES)].filter((shape) => shape.closest(CARDS) === card) as Styled[]) : [];
  // A row's place in its list is a delay (--d, set by the stylesheet or inline), so rows follow one another.
  const delays = shapes.map((shape) => timeMs(getComputedStyle(shape).getPropertyValue("--d"), 0));
  const follows = figures.map((figure) => (card ? shapes.indexOf(shapeFor(figure, card, shapes) as Styled) : -1));
  const progress = shapes.map(() => 0);
  // Hold the charts at zero inline before the card is marked as playing, so they never jump to full.
  shapes.forEach((shape) => shape.style.setProperty("--p", "0"));
  card?.setAttribute("data-in", "");
  const step = () => {
    const elapsed = performance.now() - start - lead;
    const base = ease(clamp(elapsed / duration));
    let done = elapsed >= duration;
    shapes.forEach((shape, index) => {
      const t = clamp((elapsed - delays[index]) / duration);
      progress[index] = t >= 1 ? 1 : ease(t);
      if (t < 1) done = false;
      shape.style.setProperty("--p", progress[index].toFixed(4));
    });
    figures.forEach((figure, index) => show(figure, follows[index] >= 0 ? progress[follows[index]] : elapsed >= duration ? 1 : base));
    if (!done) return void requestAnimationFrame(step);
    // Finished: the charts go back to being drawn at their value by the stylesheet alone.
    shapes.forEach((shape) => shape.style.removeProperty("--p"));
    figures.forEach((figure) => show(figure, 1));
    onDone?.();
  };
  step();
}

// ---- watching --------------------------------------------------------------------------------------

/** Starts watching the page. Returns a function that stops. */
export function installDataMotion() {
  if (!supported || reduced()) return () => {};

  // Figures: decided once, the first time the figure has a box. In a card that hasn't played yet it is
  // held at zero until the card does; in a card that has (a figure added later) it is just there.
  const decided = new WeakSet<Element>();
  const onScreen = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
  };
  const decide = (element: Element) => {
    if (decided.has(element)) return true;
    if (!element.getClientRects().length) return false; // not drawn yet (a hidden pane)
    decided.add(element);
    const card = element.closest(CARDS);
    if (card) {
      if (!card.hasAttribute("data-in")) prime(element); // held at zero until its card plays
    } else if (onScreen(element) && prime(element)) animate(null, [element], performance.now());
    return true;
  };
  const boxes = new ResizeObserver((entries) => {
    for (const entry of entries) if (decide(entry.target)) boxes.unobserve(entry.target);
  });
  const addFigure = (element: Element) => {
    if (!decide(element)) boxes.observe(element);
  };

  // Cards: each plays once. `start` is shared by every card of a page, so the page moves as one.
  const playedCards = new WeakSet<Element>();
  const play = (card: Element, start: number) => {
    if (playedCards.has(card)) return;
    playedCards.add(card);
    // Its figures are gathered now, not from what was noticed earlier, so none can be missed.
    const figures = [...card.querySelectorAll(FIGURES)].filter((figure) => figure.closest(CARDS) === card);
    for (const figure of figures) {
      if (decided.has(figure)) continue;
      decided.add(figure);
      boxes.unobserve(figure);
      prime(figure);
    }
    // Marked once it has finished, so its own entrance can't replay when a hidden pane is shown again.
    animate(card, figures.filter((figure) => held.has(figure)), start, () => card.setAttribute("data-settled", ""));
  };

  // Enough of a card in view to watch it play: about a third of it, or a good slice of a tall one.
  const inView = (card: Element) => {
    const box = card.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    const seen = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    return seen >= Math.min(box.height * 0.35, 160);
  };
  // A card that isn't in view yet (further down the page, added later, or outside any page) plays when
  // it is: so a card you scroll down to fills as you reach it, rather than having finished unseen.
  const late = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !inView(entry.target)) continue;
        observer.unobserve(entry.target);
        play(entry.target, performance.now());
      }
    },
    { threshold: [0, 0.1, 0.2, 0.35, 0.5] },
  );
  // Pages: the first time a page is on screen, the cards in view play together (one shared start).
  const playedPages = new WeakSet<Element>();
  const pages = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const page = entry.target;
      observer.unobserve(page);
      playedPages.add(page);
      const start = performance.now();
      for (const card of [...(page.matches(CARDS) ? [page] : []), ...page.querySelectorAll(CARDS)]) {
        if (inView(card)) play(card, start);
        else late.observe(card);
      }
    }
  });
  const seenPages = new WeakSet<Element>();
  const addPage = (page: Element) => {
    if (seenPages.has(page)) return;
    seenPages.add(page);
    pages.observe(page);
  };
  const seenCards = new WeakSet<Element>();
  const addCard = (card: Element) => {
    if (seenCards.has(card)) return;
    seenCards.add(card);
    const page = card.closest(PAGES);
    if (page && !playedPages.has(page)) return; // its page will play it
    late.observe(card);
  };

  const watch = (root: ParentNode) => {
    if (root instanceof Element) {
      if (root.matches(FIGURES)) addFigure(root);
      if (root.matches(PAGES)) addPage(root);
      if (root.matches(CARDS)) addCard(root);
    }
    root.querySelectorAll?.(FIGURES).forEach(addFigure);
    root.querySelectorAll?.(PAGES).forEach(addPage);
    root.querySelectorAll?.(CARDS).forEach(addCard);
  };
  watch(document.body);
  const mo = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach((node) => node instanceof Element && watch(node));
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return () => {
    boxes.disconnect();
    pages.disconnect();
    late.disconnect();
    mo.disconnect();
  };
}
