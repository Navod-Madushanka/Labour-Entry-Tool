// The suggestions must not change by accident: every code, time and "usually together" suggestion
// for a made-up month (no real data) is compared with tests/suggestions.golden.json.
//   node tests/suggestions.test.cjs            compare
//   node tests/suggestions.test.cjs --update   write the reference (only after a wanted change)
const { buildSync } = require("esbuild");
const path = require("path"), os = require("os"), fs = require("fs");
const assert = require("assert/strict");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sugg-")), "history.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/history.ts")], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "error" });
const H = require(out);

// a made-up month: 100 workers in crews of 10 with their own code and times, days 1-20
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const trades = ["Carpenter", "Barbender", "Helper", "Masan"];
const workers = Array.from({ length: 100 }, (_, i) => ({ row: 3 + i, block: i, calling_name: `ZZ${"ABCD"[i % 4]}-${String(i + 1).padStart(2, "0")}`, person: "", name: `P${i}`, trade_group: trades[Math.floor(i / 10) % 4], employee_code: "X00000", code_status: "valid" }));
const codes = ["03-11-00-00", "03-11-00-00-P", "03-20-00-00-C-8", "04-22-13-25", "09-24-43-00-P", "01-54-23-00"];
const shifts = [[7, 19], [7, 16], [8, 20], [19, 27]];
const month = {};
for (let d = 1; d <= 20; d++) {
  const entries = [];
  workers.forEach((w, b) => {
    if (rnd() < 0.08) return; // off
    const crew = Math.floor(b / 10);
    const [tin, tout] = rnd() < 0.1 ? shifts[(crew + 1) % 4] : shifts[crew % 4];
    const code = codes[(crew + Math.floor(d / 6) + (rnd() < 0.1 ? 1 : 0)) % codes.length];
    entries.push({ entry: { sheet: String(d), block: b, row: 9 + 7 * b, calling_name: w.calling_name, time_in: tin, time_out: tout, activities: [{ row: 9, code, hours: 11 }], additional: null, remark: null }, computed: null, issues: [] });
  });
  month[String(d)] = { header: { sheet: String(d), date: `2026-10-${String(d).padStart(2, "0")}`, date_raw: null, day_type: "Normal Day", sheet_no: d, prepared_by: null, project: null }, expected_date: null, expected_day_type: null, header_issues: [], entries };
}
// replay days 11-20 in entry order, as the entry screen would suggest them
const result = [];
for (let d = 11; d <= 20; d++) {
  const before = {}; for (const k of Object.keys(month)) if (Number(k) < d) before[k] = month[k];
  const today = [];
  for (const v of month[String(d)].entries) {
    const w = workers.find((x) => x.calling_name === v.entry.calling_name);
    const codesS = H.suggestCodes(before, d, w, workers, today, { time_in: v.entry.time_in, time_out: v.entry.time_out }).map((s) => s.code);
    const timesS = H.suggestTimes(before, d, w, workers, today);
    const comp = H.companions(before, [w.calling_name], d, new Set(), 10, 5).map((c) => c.name);
    result.push([d, w.calling_name, codesS.join(" "), timesS ? `${timesS.time_in}-${timesS.time_out}` : "", comp.join(" ")]);
    today.push({ calling_name: w.calling_name, code: v.entry.activities[0].code, time_in: v.entry.time_in, time_out: v.entry.time_out });
  }
}
const golden = path.join(__dirname, "suggestions.golden.json");
if (process.argv.includes("--update")) {
  fs.writeFileSync(golden, JSON.stringify(result));
  console.log(`suggestions: reference written (${result.length} entries)`);
} else {
  const want = JSON.parse(fs.readFileSync(golden, "utf8"));
  assert.equal(result.length, want.length);
  const diff = result.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(want[i]));
  assert.equal(diff, -1, diff >= 0 ? `suggestion changed: ${JSON.stringify(want[diff])} -> ${JSON.stringify(result[diff])}` : "");
  console.log(`suggestions: ${result.length} entries, identical to the reference`);
}
