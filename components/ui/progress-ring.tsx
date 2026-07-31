import * as React from "react";

/**
 * A determinate SVG progress ring. `value` is a 0–1 fraction; the `.fill` stroke
 * animates its dash offset (see `.krowe-progress-ring` in globals.css, which
 * rotates the svg -90° so it fills from 12 o'clock). Pass `children` to layer a
 * centered label or glyph over it, and a `className` to compose extra scoped
 * styling (e.g. the agent dock's status-colored ring) — include
 * `krowe-progress-ring` in it to keep the shared track/fill visuals.
 */
export function ProgressRing({
  value,
  size = 32,
  strokeWidth = 3,
  className,
  children,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const r = size / 2 - strokeWidth;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - Math.max(0, Math.min(1, value)));
  return (
    <div className={className ?? "krowe-progress-ring"} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} />
        <circle
          className="fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
        />
      </svg>
      {children}
    </div>
  );
}
