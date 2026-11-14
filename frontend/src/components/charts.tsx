// Charts shared by Analysis and the as-built programme: hand-drawn SVG, theme colours from CSS.
import { createContext } from "react";
import type { DayRow } from "../analysis";
import { date as fmtDate, numberFormat } from "../fmt";

/** Days tagged as disrupted in Lost time, for every day chart under the Analysis tab. */
export const DisruptedCtx = createContext<Set<number>>(new Set());

export const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];
const ONE_PLACE = numberFormat({ maximumFractionDigits: 1 }); // the most used: every chart label
export const h = (n: number) => (Math.abs(n) < 0.005 ? "0" : ONE_PLACE.format(n));

export const dayLabel = (d: { day: number; date: string | null }) => {
  if (!d.date) return `Day ${d.day}`;
  const wd = fmtDate(new Date(`${d.date}T12:00:00Z`), { weekday: "short", timeZone: "UTC" });
  return `${wd} ${d.day}`;
};

/** Bars per day, stacked by series; Sundays and holidays marked under the axis. */
export function DayBars({ days, series, value, unit, line, disrupted }: {
  days: DayRow[];
  series: { key: string; label: string; color: string }[];
  value: (d: DayRow, key: string) => number;
  unit: string;
  line?: { label: string; color: string; value: (d: DayRow) => number | undefined }; // e.g. planned people
  disrupted?: Set<number>; // days tagged as disrupted (Lost time): marked over the day number
}) {
  const totals = days.map((d) => series.reduce((s, x) => s + value(d, x.key), 0));
  const lineVals = days.map((d) => line?.value(d));
  const max = Math.max(1, ...totals, ...lineVals.filter((v): v is number => v !== undefined));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = 22, gap = 6, left = 40, bottom = 34, height = 220;
  const width = left + days.length * (bw + gap) + 8;
  const y = (v: number) => height - bottom - (v / top) * (height - bottom - 12);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  return (
    <div className="chart">
      {(series.length > 1 || line) && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
          ))}
          {line && <span><i className="line" style={{ borderColor: line.color }} />{line.label}</span>}
        </div>
      )}
      <div className="table-wrap">
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} width={Math.max(width, 320)} height={height} role="img" aria-label={`${series.map((s) => s.label).join(", ")} by day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = left + i * (bw + gap) + gap / 2;
            const off = d.kind === "Sunday" || d.kind === "Holiday";
            const tint = off ? "var(--sun-bg)" : d.kind === "Saturday" ? "var(--sat-bg)" : null;
            return tint ? <rect key={`t${d.sheet}`} className="day-tint" x={x - gap / 2} y={8} width={bw + gap} height={height - bottom - 8} fill={tint} opacity="0.3" /> : null;
          })}
          {days.map((d, i) => {
            const x = left + i * (bw + gap) + gap / 2;
            let acc = 0;
            const off = d.kind === "Sunday" || d.kind === "Holiday";
            const bad = disrupted?.has(d.day);
            const tip = [
              `${dayLabel(d)}${d.kind !== "Normal" ? ` (${d.kind})` : ""}`,
              ...(series.length > 1 ? series.map((s) => [s.label, value(d, s.key)] as const).filter(([, v]) => v).map(([l, v]) => `${l}: ${h(v)}`) : []),
              `${series.length > 1 ? "Total" : series[0]?.label ?? "Value"}: ${h(totals[i])} ${unit}`,
              ...(lineVals[i] !== undefined ? [`${line!.label}: ${h(lineVals[i]!)} (${totals[i] - lineVals[i]! >= 0 ? "+" : "−"}${h(Math.abs(totals[i] - lineVals[i]!))})`] : []),
              ...(bad ? ["Disrupted day (Lost time)"] : []),
            ].join("\n");
            return (
              <g key={d.sheet}>
                {series.map((s) => {
                  const v = value(d, s.key);
                  if (!v) return null;
                  const y0 = y(acc), y1 = y(acc + v);
                  acc += v;
                  return (
                    <rect key={s.key} x={x} y={y1} width={bw} height={Math.max(y0 - y1, 0.5)} fill={s.color}>
                      <title>{`${dayLabel(d)}: ${s.label} ${h(v)} ${unit}`}</title>
                    </rect>
                  );
                })}
                {totals[i] > 0 && series.length > 1 && (
                  <text x={x + bw / 2} y={y(totals[i]) - 3} textAnchor="middle" fontSize="9" fill="var(--muted)" opacity="0.75">{Math.round(totals[i])}</text>
                )}
                <text x={x + bw / 2} y={height - bottom + 14} textAnchor="middle" fontSize="11" fill={off ? "var(--sun)" : d.kind === "Saturday" ? "var(--sat)" : "var(--text)"} fontWeight={off ? 600 : 400}>
                  {d.day}
                </text>
                {off && <text x={x + bw / 2} y={height - bottom + 27} textAnchor="middle" fontSize="9" fill="var(--sun)">{d.kind === "Sunday" ? "Sun" : "Hol"}</text>}
                {bad && <path className="disrupted-mark" d={`M${x + bw / 2 - 4},${height - bottom + 4} L${x + bw / 2 + 4},${height - bottom + 4} L${x + bw / 2},${height - bottom - 2} Z`} fill="var(--warn)" />}
                <rect className="day-hit" x={x - gap / 2} y={8} width={bw + gap} height={height - 8} fill="transparent"><title>{tip}</title></rect>
              </g>
            );
          })}
          {line && (
            <path
              d={lineVals
                .map((v, i) => {
                  if (v === undefined) return "";
                  const x0 = left + i * (bw + gap), x1 = x0 + bw + gap;
                  const move = i === 0 || lineVals[i - 1] === undefined ? "M" : "L";
                  return `${move}${x0},${y(v)} L${x1},${y(v)}`;
                })
                .join(" ")}
              fill="none" stroke={line.color} strokeWidth="2.5" strokeDasharray="6 3"
            >
              <title>{line.label}</title>
            </path>
          )}
        </svg>
      </div>
    </div>
  );
}

export function niceStep(max: number): number {
  const raw = max / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10;
}


/** Save a chart as a PNG for the progress meeting: the SVG with its theme colours filled in,
 * drawn at twice the size on the page's background. */
export async function saveChart(svg: SVGSVGElement | null, name: string): Promise<void> {
  if (!svg) return;
  const css = getComputedStyle(document.documentElement);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const resolve = (v: string) => v.replace(/var\((--[\w-]+)\)/g, (_m, n: string) => css.getPropertyValue(n).trim() || "#888");
  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const attr of ["fill", "stroke", "style", "stop-color"]) {
      const v = el.getAttribute(attr);
      if (v && v.includes("var(")) el.setAttribute(attr, resolve(v));
    }
  }
  const box = svg.viewBox.baseVal;
  const w = box && box.width ? box.width : svg.clientWidth, ht = box && box.height ? box.height : svg.clientHeight;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(ht));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("font-family", css.fontFamily || "sans-serif");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("could not draw the chart"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = ht * 2 + 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = css.getPropertyValue("--panel").trim() || "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = css.getPropertyValue("--text").trim() || "#000";
    ctx.font = `600 28px ${css.fontFamily || "sans-serif"}`;
    ctx.fillText(name, 20, 42);
    ctx.drawImage(img, 0, 64, w * 2, ht * 2);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w .-]+/g, " ").trim()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A "Save image" button for the chart in the same card. */
export function SaveImage({ name }: { name: string }) {
  return (
    <button
      className="link small"
      title="Save this chart as a picture (PNG) for the progress meeting"
      onClick={(e) => saveChart((e.currentTarget.closest(".card") as HTMLElement | null)?.querySelector("svg.chart-svg") ?? null, name)}
    >
      Save image
    </button>
  );
}
