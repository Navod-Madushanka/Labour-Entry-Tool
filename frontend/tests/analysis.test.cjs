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
// who worked under whom, when; whose worker; where each supervisor's people worked
const log = A.supervisedDays(sup, sup.entries);
const d1 = log.find((x) => x.name === "AA-02" && x.sheet === "1");
assert.equal(d1.supervisor, "Kamal"); assert.equal(d1.date, "2026-10-01"); near(d1.hours, 11, "AA-02 day 1");
const ws = new Map(A.workerSupervisors(sup.entries).map((w) => [w.person, w]));
// AA-01: day 1 Kamal, day 2 Nimal (as AA-01 CH), day 4 none -> a tie between Kamal and Nimal: the latest wins
assert.equal(ws.get("AA-01").supervisor, "Nimal"); assert.equal(ws.get("AA-01").days, 3);
assert.deepEqual(ws.get("AA-01").all.map((x) => x.supervisor), ["Nimal", "Kamal", A.NO_SUPERVISOR]);
assert.equal(ws.get("AA-02").supervisor, "Kamal"); near(ws.get("AA-02").share, 1, "AA-02 only under Kamal");
assert.equal(ws.get("BB-01").supervisor, A.NO_SUPERVISOR);
const work = A.supervisorWork(sup.slices);
const kp = work.find((x) => x.supervisor === "Kamal" && x.code === "03-11-00-00-P");
near(kp.hours, 19, "Kamal's people on -P: AA-01 8 + AA-02 11"); assert.equal(kp.place, "Parking area"); assert.equal(kp.people, 2);
assert.ok(work.some((x) => x.supervisor === "Kamal" && x.place === "Core 8"));
// as-built programme: bars, S-curves, flowline, planned headcount
{
  const bars = A.programme(data.slices);
  const park = bars.find((b) => b.key === "03-11-00-00-P");
  assert.equal(park.first, 1); assert.equal(park.last, 4); assert.equal(park.activeDays, 3);
  assert.equal(park.people.get(1), 3, "three people on -P on day 1"); assert.equal(park.peak, 3);
  assert.ok(!bars.some((b) => b.key === A.NO_CODE), "no bar for unallocated hours");
  assert.equal(bars[0].first, 1, "sorted by first day");

  const curves = A.sCurves(data.slices, (s) => s.code, [1, 2, 3, 4], 2);
  assert.equal(curves[0].key, A.ALL);
  near(curves[0].total, 61, "all work total");
  assert.deepEqual(curves[0].points.map((x) => x.day), [1, 2, 3, 4]);
  near(curves[0].points[2].cum, curves[0].points[1].cum, "nothing on day 3: flat");
  assert.equal(curves.length, 3, "all + top 2");

  assert.equal(A.workPart("03-20-00-00-C-8"), "03-20-00-00");
  const f = A.flowline(data.slices, ["C-8"]);
  assert.deepEqual(f.levels, ["C-8", "P"], "the PM's order first, then the rest");
  const seg = f.segments.find((x) => x.activity === "03-11-00-00" && x.suffix === "P");
  assert.equal(seg.first, 1); assert.equal(seg.last, 4);

  assert.equal(A.weekOf("2026-10-01"), "2026-09-28"); // Thursday -> Monday
  assert.equal(A.weekOf("2026-10-05"), "2026-10-05");
  assert.equal(A.weekOf("2026-10-04"), "2026-09-28"); // Sunday belongs to the week before
  const plan = { Carpenter: { "2026-09-28": 5 }, Helper: { "2026-09-28": 2, "2026-10-05": 3 } };
  assert.equal(A.planned(plan, "2026-10-02"), 7);
  assert.equal(A.planned(plan, "2026-10-06", "Carpenter"), undefined);
  assert.equal(A.planned(plan, "2026-10-06"), 3);
  assert.equal(A.planned(plan, null), undefined);
}

// rupee lens: cost at standard rates, OT premium, coverage
{
  const rated = A.buildData(month, { ...master, rates: { trades: { Carpenter: 8000 }, ot: 1.5, sunday: 1.5, holiday: 2, day_hours: 8 } });
  const k2 = A.kpis(rated.slices);
  // Carpenters (hourly 1000): AA-01 d1 8 + 3x1.5 = 12.5k; AA-02 d1 the same; AA-01 CH d2 8 + 7x1.5 = 18.5k;
  // AA-01 Sunday d4 8 h all OT x1.5 = 12k. Helpers have no rate.
  near(k2.cost, 12500 + 12500 + 18500 + 12000, "labour cost");
  near(k2.otPremium, (3 + 3 + 7 + 8) * 1000 * 0.5, "OT premium");
  near(k2.coverage, (11 + 11 + 15 + 8) / 61, "rates known for the carpenters' hours");
  near(k2.costPerWorkerDay, k2.cost / 4, "over rated worker-days");
  const core = A.byCode(rated.slices).find((g) => g.key === "03-20-00-00-C-8");
  near(core.cost, 12500 * 3 / 11, "cost shared over the lines like the hours");
  assert.equal(A.multiplier({ holiday: 2.5 }, "Holiday"), 2.5);
  assert.equal(A.dailyRate({ trades: { Helper: 100 }, workers: { "BB-01": 300 } }, "BB-01", "Helper"), 300, "Labour Detail's own rate wins");
  assert.equal(A.hasRates({}), false);
  near(A.kpis(data.slices).cost, 0, "no rates: no rupees");
}

// weekly site report: periods, rule-written changes, monthly labour return
{
  const ps = A.periods(data);
  // 1-4 Oct 2026: Thu-Sun are the week of Mon 28 Sep
  assert.deepEqual(ps.map((x) => [x.key, x.from, x.to]), [["w:2026-09-28", 1, 4], ["month", 1, 4]]);
  const label = (c) => c;
  const lines = A.whatChanged(data, ps[0], null, label);
  assert.ok(lines[0].text.startsWith("61 hours worked") && lines[0].text.includes("no previous period"), lines[0].text);
  assert.ok(lines.some((l) => l.view === "overtime"), "an overtime line");
  assert.ok(lines.every((l) => !/AA-0|BB-0/.test(l.text)), "no worker names in the report");
  // against a previous period: days 1-2 vs day 4
  const cur = { key: "w:x", label: "x", from: 4, to: 4 }, prev = { key: "w:y", label: "y", from: 1, to: 2 };
  const ch = A.whatChanged(data, cur, prev, label);
  // 1 day with work against 2: compared per day (16 h a day against 22.5)
  assert.ok(ch[0].text.startsWith("16 hours over 1 day with work") && ch[0].text.includes("down 29% a day") && ch[0].text.includes("(23 h a day)"), ch[0].text);
  assert.ok(ch.some((l) => l.text.startsWith("OT share rose")), "OT share 29% -> 100%");
  assert.ok(ch.some((l) => l.text.startsWith("Started: 99-99-99-99")), "a code first used on day 4");
  assert.ok(ch.some((l) => l.text.includes("03-20-00-00-C-8 (last day 1)")), "a code with no hours any more");
  const ret = A.labourReturn(data);
  assert.deepEqual(ret.trades, ["Carpenter", "Helper"]);
  assert.equal(ret.rows.find((r) => r.day === 1).total, 3);
  assert.equal(ret.rows.find((r) => r.day === 3).total, 0, "a day without work stays in the return");
}

// lost time: reasons for supervisor sheets, causes and parties, disrupted vs clean days
{
  const owned = A.buildData(month, master, new Map([["1|BB-01", "Kamal"], ["1|AA-01", "Kamal"]]));
  const causes = [{ id: "concrete", label: "Waiting for concrete", party: "Supplier" }, { id: "rain", label: "Rain or weather", party: "Neutral" }];
  const items = [
    { sheet: "1", supervisor: "Kamal", causes: ["concrete"], note: null, user: "u", created_at: "" },
    { sheet: "4", supervisor: null, causes: ["rain"], note: "heavy rain", user: "u", created_at: "" },
  ];
  const lt = A.lostTime(owned, owned.slices, items, causes);
  near(lt.unallocated, 2, "BB-01's 2 h of ZIDLE");
  near(lt.explained, 2, "on Kamal's sheet with a reason");
  assert.deepEqual(lt.byCause.map((c) => [c.cause, c.party, c.hours, c.sheets]), [["concrete", "Supplier", 2, 1]]);
  assert.deepEqual(lt.byParty, [{ party: "Supplier", hours: 2 }]);
  assert.deepEqual(lt.disrupted.map((d) => [d.day, d.causes, d.note]), [[4, ["rain"], "heavy rain"]]);
  assert.deepEqual(lt.compare.map((c) => [c.label, c.days]), [["Disrupted days", 1], ["Clean days", 2]]);
  near(lt.compare[0].hoursPerPerson, 8, "16 h over 2 person-days on day 4");
  const none = A.lostTime(data, data.slices, [], causes);
  assert.deepEqual(none.byCause.map((c) => c.cause), [A.NO_REASON], "no reasons: all unexplained");
  assert.equal(none.compare.length, 0);
}

// productivity: hours and rupees per unit against a norm, measured mile
{
  const P = "03-11-00-00-P";
  const [r] = A.productivity(data, { [P]: { "2026-09-28": 40 } }, { [P]: "m2" }, { [P]: { hours: 1, source: "BSR" } });
  near(r.hours, 8 + 11 + 6 + 15 + 8, "hours on the code in the measured week");
  near(r.hpu, 48 / 40, "hours per unit");
  near(r.index, 40 / 48, "earned 40 h against 48 actual");
  assert.equal(r.normSource, "BSR"); assert.equal(r.unit, "m2");
  assert.equal(r.weeks[0].disrupted.length, 0);
  const [noNorm] = A.productivity(data, { [P]: { "2026-09-28": 40 } }, {}, {});
  assert.equal(noNorm.norm, null, "one week is not enough for a site median");
  const [d] = A.productivity(data, { [P]: { "2026-09-28": 40 } }, {}, {}, new Set([4]));
  assert.deepEqual(d.weeks[0].disrupted, [4], "day 4 was disrupted while the code had hours");
  assert.equal(d.mile.clean, null, "no clean week to compare with");
  const [late] = A.productivity(data, { [P]: { "2026-09-28": 40, "2026-10-05": 30 } }, {}, {});
  near(late.qty, 40, "a quantity for a week with no hours yet is left out");
  const [unmeasured] = A.productivity(data, {}, { [P]: "m2" }, {});
  near(unmeasured.allHours, 48, "all hours"); near(unmeasured.hours, 0, "none measured"); assert.equal(unmeasured.hpu, null);
}

// fatigue and OT risk: worst 7 days, days in a row, short rests, against the limits
{
  const lim = { week_hours: 30, week_ot: 15, days_in_row: 1, rest_hours: 8 };
  const rows = A.fatigue(data, data.entries, lim);
  const aa = rows.find((r) => r.person === "AA-01");
  near(aa.maxWeek, 11 + 15 + 8, "days 1, 2 and 4 fall in one 7-day window");
  near(aa.maxWeekOt, 3 + 7 + 8, "OT in the window");
  assert.equal(aa.longestRun, 3, "days 1, 2 and 4: day 3 had nobody on site, so it breaks no run");
  assert.equal(aa.shortRests, 0); near(aa.minRest, 12, "out 19:00, in 07:00 next day");
  assert.deepEqual(aa.flags, ["7-day hours", "7-day OT", "days in a row"]);
  assert.equal(rows[0].person, "AA-01", "riskiest first");
  const strict = A.fatigue(data, data.entries, { ...lim, rest_hours: 13 }).find((r) => r.person === "AA-01");
  assert.equal(strict.shortRests, 1); assert.ok(strict.flags.includes("short rest"));
  const trend = A.overLimitByDay(data, data.entries, lim);
  assert.equal(trend.get(4), 1, "AA-01 is over 30 h in the 7 days to day 4");
  assert.equal(trend.get(1), 0);
  assert.equal(A.otAndOutput(data, []), null, "no quantities: no output link");
}

// BP bill check: worker-days at 6+ hours, flags before certifying
{
  const [g] = A.bpBill(data, data.entries, { daysInRow: 2, changedAfterReview: new Set(["1|AA-02"]) });
  assert.equal(g.bp, A.NO_BP, "no business partner in Labour Detail");
  assert.equal(g.days, 6); assert.equal(g.billable, 6, "every entry is 6 h or more");
  near(g.hours, 61, "hours"); assert.equal(g.sundays, 2, "AA-01 and BB-01 on Sunday 4 Oct");
  const w = Object.fromEntries(g.workers.map((x) => [x.name, x]));
  assert.equal(w["AA-01"].billable, 2); assert.equal(w["AA-01 CH"].billable, 1, "a BP Bill row per calling name");
  assert.deepEqual(w["BB-01"].flags, ["no employee code"]);
  assert.deepEqual(w["AA-02"].flags, ["changed after review"]);
  assert.ok(w["AA-01"].flags.includes("long run"), "3 days in a row over a limit of 2");
  assert.equal(g.flagged, 4, "AA-01, AA-01 CH (same person), AA-02, BB-01");
  // a short day is not billed
  const short = A.buildData({ "1": { ...month["1"], entries: [month["1"].entries[0]].map((v) => ({ ...v, computed: { ...v.computed, effective: 5, ot_raw: 0, zidle: 0 } })) } }, master);
  const [s1] = A.bpBill(short, short.entries);
  assert.equal(s1.billable, 0); assert.equal(s1.workers[0].short, 1);
}

// month history: trends, the site's own norms, runs carried over the month end
{
  const R = (month_id, day, date, person, worked, ot, zidle, lines, trade = "Carpenter") => ({
    month_id, sheet: String(day), day, date, day_type: "Normal Day", calling_name: person, person, trade, bp: null, supervisor: null,
    time_in: 7, time_out: 19, worked, ot, zidle, lines });
  const months = [{ id: 1, month: "2026-09", kind: "k", source: "s", saved_at: "", entries: 3, workers: 2, hours: 0, ot: 0 },
                  { id: 2, month: "2026-10", kind: "k", source: "s", saved_at: "", entries: 1, workers: 1, hours: 0, ot: 0 }];
  const rows = [
    R(1, 7, "2026-09-07", "A", 11, 3, 0, [["03-11-00-00-P", 8], ["03-20-00-00", 3]]),
    R(1, 8, "2026-09-08", "A", 11, 3, 2, [["03-11-00-00-P", 9]]),
    R(1, 8, "2026-09-08", "B", 8, 0, 0, [["03-11-00-00-P", null]], "Helper"),
    R(2, 5, "2026-10-05", "A", 10, 2, 0, [["03-11-00-00-P", 10]]),
  ];
  const t = A.monthTrends(months, rows);
  near(t[0].hours, 30, "September hours"); near(t[0].ot, 6, "OT"); assert.equal(t[0].people, 2);
  near(t[0].avgHeadcount, 1.5, "1 on day 7, 2 on day 8"); assert.equal(t[0].peak, 2);
  near(t[0].idle, 2, "ZIDLE"); near(t[0].codes.get("03-11-00-00-P"), 8 + 9 + 8, "B's single line without hours takes all");
  near(t[0].trades.get("Helper"), 8); near(t[1].hours, 10, "October");
  const qs = [{ month_id: 1, code: "03-11-00-00-P", week: "2026-09-07", qty: 25, unit: "m2" },
              { month_id: 2, code: "03-11-00-00-P", week: "2026-10-05", qty: 5, unit: "m2" }];
  const [n] = A.historyNorms(rows, qs);
  assert.equal(n.weeks, 2); near(n.values[0], 25 / 25, "25 h for 25 m2"); near(n.values[1], 10 / 5, "10 h for 5 m2"); near(n.median, 1.5, "median");
  // a run carried from last month: AA-01 worked days 1, 2 (and 4); 5 days in a row at September's end
  const f = A.fatigue(data, data.entries, { week_hours: 100, week_ot: 100, days_in_row: 6, rest_hours: 0 }, { "AA-01": 5 });
  const aa = f.find((r) => r.person === "AA-01");
  assert.equal(aa.carried, 5); assert.equal(aa.longestRun, 5 + 3, "5 carried + days 1, 2, 4 (site days)");
  assert.ok(aa.flags.includes("days in a row"));
  const bb = f.find((r) => r.person === "BB-01");
  assert.equal(bb.carried, 0, "nothing carried for BB-01 (not in last month's runs)");
}

console.log("analysis: all passed");
