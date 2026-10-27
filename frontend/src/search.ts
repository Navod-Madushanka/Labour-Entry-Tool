// Worker search: calling name (hyphens/spaces optional), name, or employee code.
import type { Worker } from "./api";

export const normCode = (s: unknown) => String(s ?? "").toUpperCase().replace(/[\s-]/g, "");
const normText = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Rank workers for a query; best first. Empty query keeps Labour Detail order. */
export function searchWorkers(workers: Worker[], query: string, limit = 12): Worker[] {
  const q = query.trim();
  if (!q) return workers.slice(0, limit);
  const qc = normCode(q);
  const qt = normText(q);
  const scored: [number, Worker][] = [];
  for (const w of workers) {
    const code = normCode(w.calling_name);
    const emp = normCode(w.employee_code);
    const name = normText(w.name);
    let score = 0;
    if (code === qc) score = 100;
    else if (code.startsWith(qc)) score = 80 - (code.length - qc.length);
    else if (emp && emp === qc) score = 75;
    else if (code.includes(qc)) score = 50;
    else if (name.startsWith(qt)) score = 45;
    else if (name.split(" ").some((part) => part.startsWith(qt))) score = 40;
    else if (emp.includes(qc) && qc.length >= 3) score = 30;
    else if (qt.length >= 3 && name.includes(qt)) score = 20;
    if (score > 0) scored.push([score, w]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].row - b[1].row);
  return scored.slice(0, limit).map(([, w]) => w);
}
