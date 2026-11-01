// Replay measurement of the browser suggestions (called by scripts/replay.py; prints JSON).
//   node replay/measure.cjs <book.month.json> …
// Each month file is a workbook's month as the entry screen has it (made by scripts/replay.py
// from fixtures/private, never committed). Only the code under frontend/src is measured.
const { buildSync } = require("esbuild");
const path = require("path"), os = require("os"), fs = require("fs");

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "replay-")), "s.cjs");
fs.writeFileSync(path.join(path.dirname(out), "entry.ts"),
  `export * from ${JSON.stringify(path.join(__dirname, "../src/history.ts"))};\nexport { searchWorkers, normCode } from ${JSON.stringify(path.join(__dirname, "../src/search.ts"))};\n`);
buildSync({ entryPoints: [path.join(path.dirname(out), "entry.ts")], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "error" });
const H = require(out);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" ? v.trim() : "");
const firstCode = (e) => e.activities.map((a) => str(a.code)).find(Boolean) ?? null;
const lines = (e) => e.activities.filter((a) => str(a.code)).map((a) => `${str(a.code)}:${num(a.hours) ?? ""}`).sort().join(",");
const recordKey = (e) => `${num(e.time_in)}|${num(e.time_out)}|${lines(e)}`;
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

function todayRow(e) {
  return { calling_name: e.calling_name, code: firstCode(e), time_in: num(e.time_in), time_out: num(e.time_out),
           activities: e.activities.filter((a) => str(a.code)).map((a) => ({ code: str(a.code), hours: num(a.hours) })) }; // prettier-ignore
}

/** Entries of a day in the order they are typed: sheet rows, or crew by crew (records in the order
 * their first member appears on the sheet). */
function ordered(day, order) {
  const list = day.entries.map((v) => v.entry).filter((e) => e.calling_name && num(e.time_in) !== null).sort((a, b) => a.block - b.block);
  if (order === "sheet") return list;
  const groups = new Map();
  for (const e of list) {
    const k = recordKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return [...groups.values()].flat();
}

function measureBook(month, master, opts = {}) {
  const workers = master.workers;
  const byName = new Map(workers.map((w) => [w.calling_name, w]));
  const withActs = master.check_activities;
  const sheets = Object.keys(month).map(Number).filter((n) => n >= 1).sort((a, b) => a - b);
  const onlyDays = opts.days ? new Set(opts.days) : null;
  const t = new Map(); // metric counters
  const inc = (k, by = 1) => t.set(k, (t.get(k) ?? 0) + by);
  for (const order of ["sheet", "crew"]) {
    const P = order === "sheet" ? "" : "crew.";
    for (const sheet of sheets) {
      if (onlyDays && !onlyDays.has(sheet)) continue;
      const before = {};
      for (const k of Object.keys(month)) if (Number(k) < sheet) before[k] = month[k];
      const today = [];
      let lastTyped = null;
      for (const e of ordered(month[String(sheet)], order)) {
        const w = byName.get(e.calling_name);
        if (!w) continue;
        const code = firstCode(e);
        const ctx = { time_in: num(e.time_in), time_out: num(e.time_out) };
        // --- codes
        if (withActs && code) {
          const s = H.suggestCodes(before, sheet, w, workers, today, ctx);
          inc(P + "codes.n");
          if (s[0]?.code === code) inc(P + "codes.top1");
          if (s.slice(0, 3).some((x) => x.code === code)) inc(P + "codes.top3");
          if (s[0]) {
            inc(`${P}tier.code.${s[0].tier}.fired`);
            if (s[0].code === code) inc(`${P}tier.code.${s[0].tier}.right`);
          }
          const prefilled = s[0] && (s[0].confident ?? true);
          if (prefilled) {
            inc(P + "codes.prefills");
            if (s[0].code === code) inc(P + "codes.prefill_ok");
          }
        }
        // --- times
        const ts = H.suggestTimes(before, sheet, w, workers, today);
        inc(P + "times.n");
        if (ts && ts.time_in === ctx.time_in && ts.time_out === ctx.time_out) inc(P + "times.right");
        if (ts) {
          inc(`${P}tier.time.${ts.tier}.fired`);
          if (ts.time_in === ctx.time_in && ts.time_out === ctx.time_out) inc(`${P}tier.time.${ts.tier}.right`);
        }
        // --- whole record as it would stand after Enter, Enter, Enter
        inc(P + "record.n");
        // As the form does it: times from suggestTimes; every line from the crew's record when it
        // fills lines, else the first code suggestion for a one-line entry.
        const rec = H.suggestRecord ? H.suggestRecord(before, sheet, w, today) : null;
        const timesOk = ts && ts.time_in === ctx.time_in && ts.time_out === ctx.time_out;
        let exact;
        if (H.fillsLines && H.fillsLines(rec)) {
          inc(P + "record.copied");
          exact = timesOk && rec.activities.map((a) => `${a.code}:${a.hours ?? ""}`).sort().join(",") === lines(e);
        } else {
          const s = withActs ? H.suggestCodes(before, sheet, w, workers, today, ctx) : [];
          const coded = e.activities.filter((a) => str(a.code));
          exact = timesOk && (!withActs || (coded.length === 1 && s[0]?.code === code));
        }
        if (exact) inc(P + "record.exact");
        // --- empty worker box: is the next worker in the list?
        const list = H.nextWorkers
          ? H.nextWorkers(before, sheet, lastTyped, workers, today).map((x) => x.calling_name)
          : H.searchWorkers(workers, "").map((x) => x.calling_name);
        inc(P + "next.n");
        const at = list.indexOf(e.calling_name);
        if (at >= 0 && at < 5) inc(P + "next.top5");
        if (at >= 0 && at < 12) inc(P + "next.top12");
        // --- crew mismatch warning
        if (H.crewMismatch) {
          inc(P + "mismatch.checked");
          if (H.crewMismatch(before, sheet, w, today, todayRow(e))) inc(P + "mismatch.fired");
          // a planted misread: another code used on this day (the next different one on the sheet)
          const other = code && month[String(sheet)].entries.map((v) => firstCode(v.entry)).find((c) => c && c !== code);
          if (other) {
            inc(P + "mismatch.planted");
            if (H.crewMismatch(before, sheet, w, today, { ...todayRow(e), code: other })) inc(P + "mismatch.caught");
          }
        }
        // --- "same entry also for" chips, for the first of a record typed today
        if (order === "crew" && !today.some((x) => recordKey(x._e) === recordKey(e))) {
          const exclude = new Set(today.map((x) => x.calling_name));
          const limit = H.COMPANION_LIMIT ?? 12;
          const chips = H.companions(before, [e.calling_name], sheet, exclude, 10, limit).map((c) => c.name);
          const real = new Set(month[String(sheet)].entries.map((v) => v.entry).filter((x) => x.calling_name !== e.calling_name && recordKey(x) === recordKey(e)).map((x) => x.calling_name));
          inc("chips.entries");
          inc("chips.shown_total", chips.length);
          inc("chips.right_total", chips.filter((c) => real.has(c)).length);
          inc("chips.crew_total", real.size);
        }
        const row = todayRow(e);
        row._e = e;
        today.push(row);
        lastTyped = w;
      }
    }
  }
  const r = {};
  for (const P of ["", "crew."]) {
    if (t.get(P + "codes.n")) {
      r[P + "codes.n"] = t.get(P + "codes.n");
      r[P + "codes.top1"] = pct(t.get(P + "codes.top1") ?? 0, t.get(P + "codes.n"));
      r[P + "codes.top3"] = pct(t.get(P + "codes.top3") ?? 0, t.get(P + "codes.n"));
      r[P + "codes.prefill_rate"] = pct(t.get(P + "codes.prefills") ?? 0, t.get(P + "codes.n"));
      r[P + "codes.prefill_right"] = pct(t.get(P + "codes.prefill_ok") ?? 0, t.get(P + "codes.prefills") ?? 0);
      r[P + "codes.prefill_wrong"] = pct((t.get(P + "codes.prefills") ?? 0) - (t.get(P + "codes.prefill_ok") ?? 0), t.get(P + "codes.n"));
    }
    r[P + "times.n"] = t.get(P + "times.n") ?? 0;
    r[P + "times.right"] = pct(t.get(P + "times.right") ?? 0, t.get(P + "times.n") ?? 0);
    r[P + "record.n"] = t.get(P + "record.n") ?? 0;
    r[P + "record.exact"] = pct(t.get(P + "record.exact") ?? 0, t.get(P + "record.n") ?? 0);
    r[P + "next.top5"] = pct(t.get(P + "next.top5") ?? 0, t.get(P + "next.n") ?? 0);
    r[P + "next.top12"] = pct(t.get(P + "next.top12") ?? 0, t.get(P + "next.n") ?? 0);
    if (t.get(P + "mismatch.checked")) r[P + "mismatch.fires"] = pct(t.get(P + "mismatch.fired") ?? 0, t.get(P + "mismatch.checked"));
    if (t.get(P + "mismatch.planted")) r[P + "mismatch.catches"] = pct(t.get(P + "mismatch.caught") ?? 0, t.get(P + "mismatch.planted"));
  }
  for (const [k, v] of t) {
    const m = k.match(/^(crew\.)?tier\.(code|time)\.(\w+)\.fired$/);
    if (m) r[`${m[1] ?? ""}tier.${m[2]}.${m[3]}`] = `${pct(t.get(k.replace("fired", "right")) ?? 0, v)}% of ${v}`;
  }
  if (t.get("chips.entries")) {
    r["chips.entries"] = t.get("chips.entries");
    r["chips.shown"] = Math.round((10 * t.get("chips.shown_total")) / t.get("chips.entries")) / 10;
    r["chips.precision"] = pct(t.get("chips.right_total"), t.get("chips.shown_total"));
    r["chips.recall"] = pct(t.get("chips.right_total"), t.get("chips.crew_total"));
  }
  return r;
}

/** Worker search: keys typed (calling name in code form, letter by letter) until the worker is
 * first; and whether "inb3" finds INB-03 (leading zeros left out). */
function measureSearch(master) {
  let keys = 0, n = 0, noZero = 0, noZeroN = 0;
  const seen = new Set();
  for (const w of master.workers) {
    if (seen.has(w.calling_name)) continue;
    seen.add(w.calling_name);
    const typed = w.calling_name.toLowerCase().replace(/[\s-]/g, "");
    let k = typed.length;
    for (let i = 1; i <= typed.length; i++) {
      if (H.searchWorkers(master.workers, typed.slice(0, i))[0]?.calling_name === w.calling_name) { k = i; break; }
    }
    keys += k; n += 1;
    const short = w.calling_name.replace(/(\D)0+(\d)/g, "$1$2");
    if (short !== w.calling_name) {
      noZeroN += 1;
      if (H.searchWorkers(master.workers, short.toLowerCase().replace(/[\s-]/g, ""))[0]?.calling_name === w.calling_name) noZero += 1;
    }
  }
  return { "search.keys": Math.round((10 * keys) / Math.max(n, 1)) / 10, "search.no_zeros_found": pct(noZero, noZeroN) };
}

/** Carry-over check without a second month: the second half of the month as a "new month" whose
 * previous month is the first half. Measures its first 7 days. */
function splitMonth(month) {
  const sheets = Object.keys(month).map(Number).filter((n) => n >= 1 && month[String(n)].entries.length).sort((a, b) => a - b);
  if (sheets.length < 20) return null;
  const cut = sheets[Math.floor(sheets.length / 2)];
  const renum = (d, s) => ({ ...d, header: { ...d.header, sheet: String(s) }, entries: d.entries.map((v) => ({ ...v, entry: { ...v.entry, sheet: String(s) } })) });
  const next = {}, prev = {};
  for (const n of sheets) {
    if (n >= cut) next[String(n - cut + 1)] = renum(month[String(n)], n - cut + 1);
    else prev[String(n)] = month[String(n)];
  }
  return { next, prev };
}

const results = {};
const files = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
for (const book of files) {
  const r = { ...measureBook(book.days, book.master), ...measureSearch(book.master) };
  // previous month of the same kind, when there is one
  const prev = files.filter((b) => b.kind === book.kind && b.master.month < book.master.month).sort((a, b) => (a.master.month < b.master.month ? 1 : -1))[0];
  const split = splitMonth(book.days);
  if (split) {
    const withCarry = H.carryOver && !process.env.NO_CARRY ? H.carryOver(split.next, split.prev) : split.next;
    const s = measureBook(withCarry, book.master, { days: [1, 2, 3, 4, 5, 6, 7] });
    for (const k of Object.keys(s)) if (process.env.SPLIT_ALL || ["codes.top1", "codes.top3", "times.right", "record.exact", "crew.codes.top1", "crew.times.right"].includes(k)) r[`split.first7.${k}`] = s[k];
  }
  if (prev && H.carryOver) r["carry.used"] = 1;
  results[book.workbook] = r;
}
process.stdout.write(JSON.stringify(results));
