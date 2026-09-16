import type { LayoutKind } from "../../types";

/** Each layout's shape at a glance, drawn to its own aspect ratio so Wide
 *  reads wide and Focus reads small. In a 0-100 wide box; heights follow the
 *  window's own proportions. */
const FRAMES: Record<LayoutKind, { width: number; height: number; column: number }> = {
  standard: { width: 1320, height: 660, column: 310 },
  wide: { width: 1420, height: 820, column: 374 },
  extended: { width: 1100, height: 750, column: 0 },
  focus: { width: 1100, height: 600, column: 0 },
};

const LARGEST = 1420;

/**
 * A miniature of a window layout: the sidebar, the main pane's stat cards, and
 * where the week's top apps and screenshots go - a column on the right in Wide
 * and Standard, the bottom of the main pane in Extended and Focus. The
 * apps & screenshots block disappears when that card is switched off.
 */
export function LayoutPreview({
  kind,
  showInsights,
  auto = false,
}: {
  kind: LayoutKind;
  showInsights: boolean;
  auto?: boolean;
}) {
  const frame = FRAMES[kind];
  const hasColumn = frame.column > 0;
  // Switching apps & screenshots off takes the column's width off the window
  // too, so the preview narrows by the same amount the real window does.
  const frameWidth = hasColumn && !showInsights ? frame.width - frame.column : frame.width;
  const scale = frameWidth / LARGEST;
  const w = 100;
  const h = (frame.height / frameWidth) * 100;
  const pad = 3;
  const isFocus = kind === "focus";
  const sideW = ((isFocus ? 270 : 340) / frameWidth) * 100;
  // Focus's tasks column on the right, in the same 0-100 space.
  const tasksW = isFocus ? (240 / frameWidth) * 100 : 0;
  // The column's own width, in the same 0-100 space (the gap is `pad`).
  const columnW = ((frame.column - 14) / frameWidth) * 100;
  const listRows = kind === "standard" ? 2 : 3;

  const mainX = sideW + pad;
  const mainRight = isFocus
    ? w - pad - tasksW - pad
    : hasColumn && showInsights
      ? w - pad - columnW - pad
      : w - pad;
  const mainW = mainRight - mainX;
  const top = pad + 3;
  const bottom = h - pad;

  // Main pane: clock bar, today card, three tiles - then the insights row
  // underneath when this layout keeps it in the main pane.
  const clockH = 7;
  const todayH = 11;
  const tileH = 9;
  const tilesY = top + clockH + 2 + todayH + 2;
  const inlineInsightsY = tilesY + tileH + 2;
  const tileW = (mainW - 4) / 3;

  return (
    <span
      className={`layout-preview${auto ? " is-auto" : ""}`}
      style={{ width: `${Math.round(scale * 100)}%` }}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <rect className="lp-window" x="0.5" y="0.5" width={w - 1} height={h - 1} rx="3" />

        {/* Sidebar: weekly ring, project rows, task rows, start button. */}
        <rect className="lp-sidebar" x="0.5" y="0.5" width={sideW} height={h - 1} rx="3" />
        <circle className="lp-block" cx={pad + 3.5} cy={top + 4} r="3" />
        {Array.from({ length: listRows }, (_, i) => (
          <rect key={`p${i}`} className="lp-row" x={pad} y={top + 10 + i * 4.2} width={sideW - pad * 2} height="3" rx="0.8" />
        ))}
        {(isFocus ? [] : Array.from({ length: listRows })).map((_, i) => (
          <rect
            key={`t${i}`}
            className="lp-row"
            x={pad}
            y={top + 12 + listRows * 4.2 + i * 4.2}
            width={sideW - pad * 2}
            height="3"
            rx="0.8"
          />
        ))}
        <rect className="lp-accent" x={pad} y={bottom - 9} width={sideW - pad * 2} height="4" rx="1" />

        {/* Main pane. */}
        <rect className="lp-pane" x={mainX} y={top} width={mainW} height={bottom - top} rx="2.5" />
        <rect className="lp-block" x={mainX + 2} y={top + 2} width={mainW - 4} height={clockH - 2} rx="1" />
        <rect className="lp-block" x={mainX + 2} y={top + clockH + 2} width={mainW - 4} height={todayH} rx="1" />
        {[0, 1, 2].map((i) => (
          <rect key={i} className="lp-block" x={mainX + 2 + i * (tileW + 0)} y={tilesY} width={tileW - 1} height={tileH} rx="1" />
        ))}
        {!hasColumn && showInsights ? (
          <rect
            className="lp-insights"
            x={mainX + 2}
            y={inlineInsightsY}
            width={mainW - 4}
            height={Math.max(4, bottom - 2 - inlineInsightsY)}
            rx="1"
          />
        ) : null}

        {/* Focus: time zone over the task rows, in their own column. */}
        {isFocus ? (
          <>
            <rect className="lp-pane" x={w - pad - tasksW} y={top} width={tasksW} height={bottom - top} rx="2.5" />
            <rect className="lp-block" x={w - pad - tasksW + 2} y={top + 2} width={tasksW - 4} height="4" rx="1" />
            {Array.from({ length: 5 }, (_, i) => (
              <rect
                key={`ft${i}`}
                className="lp-row"
                x={w - pad - tasksW + 2}
                y={top + 9 + i * 4.2}
                width={tasksW - 4}
                height="3"
                rx="0.8"
              />
            ))}
          </>
        ) : null}

        {/* Side column: top apps over screenshots. */}
        {hasColumn && showInsights ? (
          <>
            <rect className="lp-pane" x={w - pad - columnW} y={top} width={columnW} height={bottom - top} rx="2.5" />
            <rect
              className="lp-insights"
              x={w - pad - columnW + 2}
              y={top + 2}
              width={columnW - 4}
              height={(bottom - top) / 2 - 3}
              rx="1"
            />
            <rect
              className="lp-insights"
              x={w - pad - columnW + 2}
              y={top + (bottom - top) / 2 + 1}
              width={columnW - 4}
              height={(bottom - top) / 2 - 3}
              rx="1"
            />
          </>
        ) : null}
      </svg>
    </span>
  );
}
