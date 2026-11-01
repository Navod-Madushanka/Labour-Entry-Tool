// Odd cell values (as Excel may hold them) never crash the suggestions or the commands.
// Made-up data only.   node tests/fuzz.test.cjs
const { buildSync } = require("esbuild");
const path = require("path"), os = require("os"), fs = require("fs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-"));
for (const m of ["history", "commands"])
  buildSync({ entryPoints: [path.join(__dirname, `../src/${m}.ts`)], bundle: true, format: "cjs", platform: "node", outfile: path.join(dir, `${m}.cjs`), logLevel: "error" });
const H = require(path.join(dir, "history.cjs")), C = require(path.join(dir, "commands.cjs"));

const JUNK = [null, "", " ", "abc", "#N/A", true, false, 0, -5, 0.1, 7, 7.5, 19, 27, 48, 1e9, -1e9, "7", "19:00", " 03-11-00-00 ", 5, NaN];
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const workers = Array.from({ length: 30 }, (_, i) => ({ row: 3 + i, block: i, calling_name: `ZZA-${String(i + 1).padStart(2, "0")}`, person: "", name: pick([null, "P", 5]), trade_group: pick([null, "", "Carpenter", 7, " Helper "]), employee_code: pick(JUNK), code_status: "valid" }));
let crashes = 0, runs = 0;
for (let round = 0; round < 60; round++) {
  const month = {};
  for (let d = 1; d <= 20; d++) {
    const entries = Array.from({ length: 25 }, (_, b) => ({ entry: { sheet: String(d), block: b, row: 9 + 7 * b, calling_name: rnd() < 0.9 ? workers[b].calling_name : pick([null, "", "NOBODY", 5]), time_in: pick(JUNK), time_out: pick(JUNK), activities: Array.from({ length: Math.floor(rnd() * 3) }, () => ({ row: 9, code: pick(JUNK), hours: pick(JUNK) })), additional: pick(JUNK), remark: pick(JUNK) }, computed: pick([null, { total: 1, effective: pick(JUNK), ot_raw: pick(JUNK), activity_hours: 0, zidle: null }]), issues: [] }));
    month[String(d)] = { header: { sheet: String(d), date: pick([null, `2026-10-${String(d).padStart(2, "0")}`, "garbage"]), date_raw: null, day_type: pick(JUNK), sheet_no: d, prepared_by: null, project: null }, expected_date: null, expected_day_type: null, header_issues: [], entries };
  }
  const today = Array.from({ length: 10 }, (_, i) => ({ calling_name: workers[i].calling_name, code: pick([null, "03-11-00-00", "x"]), time_in: pick([null, 7, 19]), time_out: pick([null, 19, 27]) }));
  const tries = [
    () => { for (const w of workers) { H.suggestCodes(month, 21, w, workers, today, { time_in: pick([null, 7]), time_out: pick([null, 19]) }); H.suggestTimes(month, 21, w, workers, today); } },
    () => H.companions(month, [workers[0].calling_name, workers[3].calling_name], 21, new Set()),
    () => { for (const w of workers) { H.workerStats(month, w.calling_name); H.usualTimes(H.entriesOf(month, w.calling_name, 21)); H.recentActivities(H.entriesOf(month, w.calling_name)); H.crewToday(month["5"], workers, w); } },
    () => H.topActivities(month),
    () => {
      const ctx = { workers, month, sheets: Object.keys(month).concat(["21", "22"]), monthIso: "2026-10", queued: [], withActivities: rnd() < 0.5, activities: ["03-11-00-00", "03-20-00-00"] };
      for (const src of ["show all on 1-20", "show all on 1-20 where out > 10 and code like 03*", "set out 20 for all on 1-20", "shift times +1 for all on 1-5", "round times for all on 1-20", "copy all from 3 to 21", "move ZZA-01 from 4 to 22", "swap all between 5 and 6", "clear all on 7 where remark empty", "replace 03-11-00-00 with 03-20-00-00 for all on 1-20", "fill all from 2 to 21-22"]) {
        try { C.run(C.parse(src, ctx), ctx); } catch (e) { if (!(e instanceof C.CommandError)) throw e; }
      }
      C.suggest("set out 20 for ZZ", 17, ctx); C.explain("ZZA-01", ctx); C.explain("21", ctx, ["copy", "x", "from"]);
    },
  ];
  for (const t of tries) { runs++; try { t(); } catch (e) { crashes++; if (crashes <= 3) console.log("CRASH:", e.stack.split("\n").slice(0, 3).join(" | ")); } }
}
if (crashes) { console.log(`fuzz: ${crashes} crashes in ${runs} runs`); process.exit(1); }
console.log(`fuzz: ${runs} runs on odd values, no crash`);
