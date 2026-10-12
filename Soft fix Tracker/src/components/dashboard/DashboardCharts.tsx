import { useId, useState, type CSSProperties, type ReactNode } from "react";

export type ChartPoint = { label: string; value: number };

const WIDTH = 1000;
const HEIGHT = 240;

/** A smooth path through the points that never dips below or above its neighbours (monotone cubic). */
function monotonePath(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return "";
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    slope[i] = (ys[i + 1] - ys[i]) / dx[i];
  }
  const tangent = new Array<number>(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const sum = a * a + b * b;
    if (sum > 9) {
      const scale = 3 / Math.sqrt(sum);
      tangent[i] = scale * a * slope[i];
      tangent[i + 1] = scale * b * slope[i];
    }
  }
  let path = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    path += ` C ${xs[i] + dx[i] / 3} ${ys[i] + (tangent[i] * dx[i]) / 3}, ${xs[i + 1] - dx[i] / 3} ${ys[i + 1] - (tangent[i + 1] * dx[i]) / 3}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return path;
}

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The top gridline for a chart whose data peaks at `value`: four equal, round-numbered steps that cover it. */
function niceCeiling(value: number) {
  if (value <= 0) return 4;
  const raw = value / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const normal = raw / power;
  return (STEPS.find((step) => step >= normal) ?? 10) * power * 4;
}

/** A smooth filled line chart with four gridlines, sparse x labels and a hover crosshair + tooltip. */
export function AreaChart({
  points,
  format = (value) => String(Math.round(value * 10) / 10),
  unit = "",
  label,
}: {
  points: ChartPoint[];
  format?: (value: number) => string;
  unit?: string;
  label: string;
}) {
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  const top = niceCeiling(Math.max(...points.map((point) => point.value), 0));
  const count = points.length;
  const xs = points.map((_, index) => (count === 1 ? WIDTH / 2 : (index / (count - 1)) * WIDTH));
  const ys = points.map((point) => HEIGHT - (point.value / top) * HEIGHT);
  const line = monotonePath(xs, ys);
  const area = line ? `${line} L ${xs[count - 1]} ${HEIGHT} L ${xs[0]} ${HEIGHT} Z` : "";
  const ticks = [0, 1, 2, 3, 4].map((step) => (top * step) / 4);
  const every = Math.max(1, Math.ceil(count / 7));
  const active = hover === null ? null : points[hover];
  const activeX = hover === null ? 0 : (xs[hover] / WIDTH) * 100;
  const activeY = hover === null ? 0 : (ys[hover] / HEIGHT) * 100;

  return (
    <div
      className="db-area"
      role="img"
      aria-label={`${label}: ${points.map((point) => `${point.label} ${format(point.value)}${unit}`).join(", ")}`}
    >
      <div className="db-area-axis" aria-hidden="true">
        {[...ticks].reverse().map((tick) => (
          <span key={tick}>
            {format(tick)}
            {unit}
          </span>
        ))}
      </div>
      <div className="db-area-plot">
        <div
          className="db-area-canvas"
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
            setHover(Math.round(ratio * (count - 1)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--db-accent-strong)" stopOpacity="0.42" />
                <stop offset="100%" stopColor="var(--db-accent-strong)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((tick) => (
              <line
                key={tick}
                className="db-area-grid"
                x1="0"
                x2={WIDTH}
                y1={HEIGHT - (tick / top) * HEIGHT}
                y2={HEIGHT - (tick / top) * HEIGHT}
              />
            ))}
            {area && <path className="db-area-fill" d={area} fill={`url(#${gradient})`} />}
            {line && <path className="db-area-line" d={line} />}
          </svg>
          {active && (
            <>
              <i className="db-area-cursor" style={{ left: `${activeX}%` }} />
              <i className="db-area-dot" style={{ left: `${activeX}%`, top: `${activeY}%` }} />
              <div className={`db-area-tip ${activeX > 70 ? "left" : ""}`} style={{ left: `${activeX}%`, top: `${activeY}%` }}>
                <span>{active.label}</span>
                <strong>
                  {format(active.value)}
                  {unit}
                </strong>
              </div>
            </>
          )}
        </div>
        <div className="db-area-x" aria-hidden="true">
          {points.map((point, index) =>
            index % every === 0 ? (
              <span
                key={point.label + index}
                style={{
                  left: `${(xs[index] / WIDTH) * 100}%`,
                  transform: index === 0 ? "none" : index === count - 1 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {point.label}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

export type DonutSegment = { label: string; value: number; tone: string };

/** A ring that draws itself, split into toned segments, with whatever you pass in its centre. */
export function Donut({
  segments,
  size = 190,
  thickness = 24,
  children,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  children?: ReactNode;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return (
    <div className="db-donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="db-donut-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={thickness} />
        {total > 0 &&
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => {
              const length = (segment.value / total) * circumference;
              const gap = segments.filter((item) => item.value > 0).length > 1 ? 3 : 0;
              const node = (
                <circle
                  key={segment.label}
                  className={`db-donut-segment tone-${segment.tone}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  strokeWidth={thickness}
                  style={{
                    "--len": Math.max(length - gap, 0.5),
                    "--circ": circumference,
                    strokeDashoffset: -offset,
                  } as CSSProperties}
                />
              );
              offset += length;
              return node;
            })}
      </svg>
      <div className="db-donut-centre">{children}</div>
    </div>
  );
}
