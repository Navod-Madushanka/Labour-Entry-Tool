// Analysis figures (src/analysis.ts) on a small made-up month whose totals can be checked by hand.
//   node tests/analysis.test.cjs
const { buildSync } = require("esbuild");
const path = require("path"), os = require("os"), fs = require("fs");
const assert = require("assert/strict");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "analysis-")), "a.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/analysis.ts")], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "error" });
const A = require(out);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

const W = (n, trade, person = n, code = "X00001", status = "valid") => ({ row: 0, block: 0, calling_name: n, person, name: `Name ${n}`, trade_group: trade, employee_code: code, code_status: status });
const workers = [W("AA-01", "Carpenter"), W("AA-02", "Carpenter"), W("BB-01", "Helper", "BB-01", null, "missing"), W("AA-01 CH", "Carpenter", "AA-01")];
// e(name, in, out, effective, ot_raw, zidle, lines)
const e = (sheet, name, tin, tout, eff, ot, zidle, lines, issues = []) => ({
  entry: { sheet, block: 0, row: 0, calling_name: name, time_in: tin, time_out: tout, activities: lines.map(([code, hours]) => ({ row: 0, code, hours })), additional: null, remark: null },
  computed: { total: tout - tin, effective: eff, ot_raw: ot, activity_hours: eff - zidle, zidle }, issues });
const day = (sheet, date, type, entries) => ({ header: { sheet, date, date_raw: null, day_type: type, sheet_no: Number(sheet), prepared_by: null, project: null }, expected_date: date, expected_day_type: null, header_issues: [], entries });
const month = {
  // Thu 1 Oct: AA-01 11 h (3 OT) split 8 on -P, 3 on core; AA-02 11 h on -P; BB-01 8 h with 2 ZIDLE
  "1": day("1", "2026-10-01", "Normal Day", [
    e("1", "AA-01", 7, 19, 11, 3, 0, [["03-11-00-00-P", 8], ["03-20-00-00-C-8", 3]]),
    e("1", "AA-02", 7, 19, 11, 3, 0, [["03-11-00-00-P", 11]]),
    e("1", "BB-01", 7, 16, 8, 0, 2, [["03-11-00-00-P", 6]], [{ rule: "W05", severity: "WARN", message: "m", plain: { title: "Left at exactly 22:00" } }]),
    { entry: { sheet: "1", block: 9, row: 0, calling_name: null, time_in: null, time_out: null, activities: [], additional: null, remark: null }, computed: null, issues: [] },
  ]),
  // Fri 2 Oct: only AA-01 (as AA-01 CH, the same person) 15 h, out past 22
  "2": day("2", "2026-10-02", "Normal Day", [e("2", "AA-01 CH", 7, 24, 15, 7, 0, [["03-11-00-00-P", 15]])]),
  // Sun 4 Oct: AA-01 and BB-01; BB-01 uses an unknown code
  "4": day("4", "2026-10-04", "Sunday", [
    e("4", "AA-01", 7, 16, 8, 8, 0, [["03-11-00-00-P", 8]]),
    e("4", "BB-01", 7, 16, 8, 8, 0, [["99-99-99-99", 8]]),
  ]),
  "3": day("3", "2026-10-03", "Saturday", []), // nobody
};
const master = { workers, places: { P: "Parking area", "C-8": "Core 8" }, holidays: [], activities: ["03-11-00-00-P", "03-20-00-00-C-8"], check_activities: true };
const data = A.buildData(month, master);

// slices and KPIs
const k = A.kpis(data.slices);
near(k.hours, 11 + 11 + 8 + 15 + 8 + 8, "hours");
near(k.ot, 3 + 3 + 0 + 7 + 8 + 8, "ot");
near(k.workerDays, 6, "worker-days = entries");
assert.equal(k.people, 3, "AA-01 CH is AA-01");
assert.deepEqual(k.peak, { day: 1, count: 3 });
near(k.avgHeadcount, (3 + 1 + 2) / 3, "average headcount over days with work");
near(k.idle, 2, "ZIDLE");
assert.equal(k.codes, 3);

// by code: AA-01's 11 h split 8:3 -> 8 and 3 worked, OT 3 split the same way
const codes = A.byCode(data.slices);
const core = codes.find((g) => g.key === "03-20-00-00-C-8");
near(core.hours, 3, "core hours"); near(core.ot, 3 * 3 / 11, "core OT share"); near(core.workerDays, 3 / 11, "core worker-day share");
assert.equal(core.place, "Core 8");
const park = codes.find((g) => g.key === "03-11-00-00-P");
near(park.hours, 8 + 11 + 6 + 15 + 8, "parking hours");
assert.equal(park.workers, 3); assert.equal(park.first, 1); assert.equal(park.last, 4);
assert.equal(codes.find((g) => g.key === A.NO_CODE).hours, 2);

// places and trades
const places = A.byPlace(data.slices);
assert.deepEqual(places.map((p) => p.key), ["Parking area", "No place", "Core 8"]); // 48, 8 + 2, 3 h
const trades = A.byTrade(data.slices);
near(trades.find((t) => t.key === "Carpenter").hours, 11 + 11 + 15 + 8, "carpenter hours");
near(trades.reduce((s, t) => s + t.pct, 0), 1, "shares add up");

// filters: place and days
const onlyPark = A.applyFilter(data, { place: "Parking area" });
near(A.kpis(onlyPark.slices).hours, 48, "parking only");
const firstDay = A.applyFilter(data, { from: 1, to: 1 });
assert.equal(firstDay.entries.length, 3);
assert.equal(A.applyFilter(data, { trade: "Helper" }).entries.length, 2);

// daily: every sheet, also the empty Saturday
const d = A.daily(data, data.slices);
assert.deepEqual(d.map((r) => [r.day, r.kind, r.headcount]), [[1, "Normal", 3], [2, "Normal", 1], [3, "Saturday", 0], [4, "Sunday", 2]]);
assert.equal(d[0].byTrade.get("Carpenter"), 2);

// heat map
const h = A.heatmap(data.slices);
assert.equal(h.codes[0], "03-11-00-00-P"); near(h.max, 8 + 11 + 6, "max cell: parking on day 1");

// people: runs over site days 1, 2, 4 (3 had nobody)
const p = A.people(data, data.entries);
const aa = p.find((r) => r.person === "AA-01");
assert.deepEqual([aa.days, aa.sundays, aa.late, aa.overnight, aa.longestRun, aa.currentRun, aa.daysOff], [3, 1, 1, 1, 3, 3, 0]);
assert.deepEqual(aa.names.sort(), ["AA-01", "AA-01 CH"]);
const bb = p.find((r) => r.person === "BB-01");
assert.deepEqual([bb.days, bb.longestRun, bb.currentRun, bb.daysOff], [2, 1, 1, 1]);

// quality
const q = A.quality(data, data.entries);
assert.deepEqual(q.idle.map((x) => [x.name, x.hours]), [["BB-01", 2]]);
assert.deepEqual(q.unknownCodes.map((x) => x.code), ["99-99-99-99"]);
assert.deepEqual(q.longDays.map((x) => x.name), ["AA-01 CH"]);
assert.deepEqual(q.noEmployeeCode.map((x) => [x.name, x.days]), [["BB-01", 2]]);
assert.deepEqual(q.rareCodes.map((x) => x.code), ["03-20-00-00-C-8", "99-99-99-99"]);
assert.deepEqual(q.issues.map((x) => [x.rule, x.count]), [["W05", 1]]);

// a workbook without activity codes: all hours are ZIDLE, no code checks
const sub = A.buildData({ "1": day("1", "2026-10-01", "Normal Day", [e("1", "AA-02", 7, 19, 11, 3, 11, [])]) }, { ...master, check_activities: false });
assert.equal(A.byCode(sub.slices)[0].key, A.NO_CODE);
assert.equal(A.quality(sub, sub.entries).idle.length, 0);

// junk values never crash and never count
const junk = A.buildData({ "1": day("1", "2026-10-01", "x", [
  { entry: { sheet: "1", block: 0, row: 0, calling_name: "AA-01", time_in: "seven", time_out: {}, activities: [{ row: 0, code: 5, hours: "x" }], additional: null, remark: null }, computed: { total: NaN, effective: "11", ot_raw: null, activity_hours: 0, zidle: null }, issues: [] },
  e("1", "AA-02", 7, 19, 11, null, null, [[null, 3], ["03-11-00-00-P", null]]),
]) }, master);
assert.equal(junk.entries.length, 1);
near(A.kpis(junk.slices).hours, 11, "single coded line without hours gets the worked hours");

// summary for month-to-month compare
const s = A.summarise("Book.xlsb", "2026-10", data, new Date("2026-11-01T00:00:00Z"));
assert.equal(s.people, 3); assert.equal(s.hours, 61); assert.equal(s.trades.Carpenter, 45);
// supervisors: whose manpower sheet each entry came from (given at push)
const owners = new Map([["1|AA-01", "Kamal"], ["1|AA-02", "Kamal"], ["2|AA-01 CH", "Nimal"]]);
const sup = A.buildData(month, master, owners);
const bySup = new Map(A.bySupervisor(sup.slices).map((g) => [g.key, g]));
near(bySup.get("Kamal").hours, 22, "Kamal: AA-01 and AA-02 on day 1");
near(bySup.get("Nimal").hours, 15, "Nimal: day 2");
near(bySup.get(A.NO_SUPERVISOR).hours, 24, "the rest has no supervisor");
assert.equal(bySup.get("Kamal").workers, 2);
const kamal = A.applyFilter(sup, { supervisor: "Kamal" });
assert.deepEqual([...new Set(kamal.entries.map((x) => x.name))].sort(), ["AA-01", "AA-02"]);
assert.equal(A.supervisorDays(sup.slices).get(1).get("Kamal"), 2);
assert.equal(A.buildData(month, master).slices.every((x) => x.supervisor === A.NO_SUPERVISOR), true);
console.log("analysis: all passed");
