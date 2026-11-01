/** localStorage that never throws (private windows, blocked storage): per-browser conveniences. */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode, or storage full: remembered for this page only */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  },
  keys(): string[] {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  },
};

/** Saved queue of a workbook: entries waiting to go to Excel survive a reload, a crash or a switch
 * to another workbook (kept 3 days). */
export const queueKey = (workbook: string) => `labour.queue.${workbook}`;
const QUEUE_DAYS = 3;

export function loadQueue<T>(workbook: string): { inputs: T[]; saved: string } | null {
  try {
    const v = JSON.parse(store.get(queueKey(workbook)) ?? "null");
    if (!v || !Array.isArray(v.inputs) || !v.inputs.length) return null;
    if (Date.now() - Date.parse(v.saved) > QUEUE_DAYS * 86400000) {
      store.remove(queueKey(workbook));
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function saveQueue<T>(workbook: string, inputs: T[]) {
  if (inputs.length) store.set(queueKey(workbook), JSON.stringify({ saved: new Date().toISOString(), inputs }));
  else store.remove(queueKey(workbook));
}

/** Old per-day data (story progress) is dropped after two weeks: the browser's storage stays small. */
export function pruneOldDays(prefix = "labour.story.", days = 14) {
  const cutoff = Date.now() - days * 86400000;
  for (const k of store.keys()) {
    const m = k.startsWith(prefix) ? k.slice(prefix.length).match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
    if (m && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < cutoff) store.remove(k);
  }
}
