"use client";
import { useState } from "react";

export interface ChartPoint {
  label: string;
  value: number;
  detail?: string;
}

const W = 640;
const H = 220;
const PAD = { l: 34, r: 14, t: 14, b: 26 };

/** One series over time: a line with a dot on each point when they fit, and a value on hover or tap. */
export function LineChart({ title, points, unit }: { title: string; points: ChartPoint[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="text-sm text-steel">Play a little more and this chart fills in.</p>;
  const values = points.map((p) => p.value);
  const top = Math.ceil(Math.max(...values, 1) / 5) * 5;
  const bottom = Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - (Math.min(...values) > 40 ? 5 : top));
  const low = Math.min(...values) > 40 ? bottom : 0;
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - ((v - low) / Math.max(1, top - low)) * (H - PAD.t - PAD.b);
  const ticks = [low, (low + top) / 2, top];
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const showDots = points.length <= 24;
  const every = Math.ceil(points.length / 8);
  const best = values.indexOf(Math.max(...values));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1)))));
  };
  const h = hover !== null ? points[hover] : null;
  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-pan-y"
        role="img"
        aria-label={`${title}. High of ${points[best].value.toFixed(1)} ${unit}, ${points[best].label}.`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-steel)">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {points.map(
          (p, i) =>
            i % every === 0 && (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-steel)">
                {p.label}
              </text>
            ),
        )}
        <path d={path} fill="none" stroke="var(--color-amber)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map(
          (p, i) =>
            (showDots || i === points.length - 1 || i === best) && (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill="var(--color-amber)" stroke="var(--color-deck)" strokeWidth={2} />
            ),
        )}
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-steel)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.value)} r={5} fill="var(--color-amber)" stroke="var(--color-deck)" strokeWidth={2} />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <figcaption
          className="pointer-events-none absolute top-1 rounded-[var(--radius-chip)] bg-navy px-2 py-1 text-xs ring-1 ring-line"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})` }}
        >
          <span className="block font-semibold tabular-nums">
            {h.value.toFixed(unit === "overall" || unit === "points" ? 0 : 1)} {unit}
          </span>
          <span className="block text-steel">{h.detail ?? h.label}</span>
        </figcaption>
      )}
    </figure>
  );
}
