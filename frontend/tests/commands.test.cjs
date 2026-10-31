// Unit tests for the command language (src/commands.ts) on a made-up month: no real data.
//   node tests/commands.test.cjs
const { buildSync } = require("esbuild");
const path = require("path");
const os = require("os");
const fs = require("fs");
const assert = require("assert/strict");

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cmdtest-")), "commands.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/commands.ts")], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "error" });
const C = require(out);

// --- a made-up month: 12 workers, 31 days, entries on days 1-5 and 20-26 -----------------------
const workers = [];
for (const [p, trade] of [["AAA", "Carpenter"], ["BBB", "Barbender"], ["CCC", "Helper"]])
  for (let i = 1; i <= 4; i++) workers.push({ row: 2 + workers.length + 1, block: workers.length, calling_name: `${p}-0${i}`, person: `${p}-0${i}`, name: `Person ${p}${i}`, trade_group: trade, employee_code: "X00000", code_status: "valid" });
workers.push({ row: 20, block: 17, calling_name: "AAA-01 CH", person: "AAA-01", name: "Person AAA1", trade_group: "Carpenter", employee_code: "X00000", code_status: "valid" });
const codes = ["03-11-00-00", "03-11-00-00-P", "03-20-00-00", "00-00-10-00"];
const entry = (sheet, name, tin, tout, code, hours, extra = {}) => ({ entry: { sheet, block: 0, row: 9, calling_name: name, time_in: tin, time_out: tout, activities: code ? [{ row: 9, code, hours }] : [], additional: null, remark: null, ...extra }, computed: null, issues: [] });
const month = {};
for (let d = 1; d <= 31; d++) {
  const date = `2026-10-${String(d).padStart(2, "0")}`;
  const entries = [];
  if (d <= 5 || (d >= 20 && d <= 26))
    for (const w of workers.slice(0, 8)) entries.push(entry(String(d), w.calling_name, 7, 19, w.calling_name.startsWith("AAA") ? "03-11-00-00" : "03-20-00-00", 11));
  month[String(d)] = { header: { sheet: String(d), date, date_raw: null, day_type: d === 4 ? "Sunday" : "Normal Day", sheet_no: d, prepared_by: null, project: null }, expected_date: date, expected_day_type: null, header_issues: [], entries };
}
const ctx = (extra = {}) => ({ workers, month, sheets: Object.keys(month), monthIso: "2026-10", queued: [], withActivities: true, activities: codes, partners: (n) => (n === "AAA-01" ? ["AAA-02", "AAA-03"] : []), today: new Date(2026, 9, 21), ...extra });
const go = (src, extra) => C.run(C.parse(src, ctx(extra)), ctx(extra));
const err = (src) => { try { go(src); } catch (e) { return e.message; } throw new Error(`no error for: ${src}`); };
let n = 0;
const t = (name, fn) => { fn(); n++; };

t("set out 20 on 10 days: hours follow", () => {
  const r = go("set out 20 for AAA-01 on 1-5, 20-24");
  assert.equal(r.inputs.length, 10);
  assert.ok(r.inputs.every((i) => i.time_out === 20 && i.activities[0].hours === 12 && i.overwrite));
  assert.match(r.summary, /SET OUT 20:00: 10 entries \(AAA-01\)/);
});
t("synonyms: change / update / make mean SET", () => {
  for (const v of ["change", "update", "make", "modify"]) assert.equal(go(`${v} out 20 for AAA-01 on 1`).verb, "SET");
});
t("copy four workers from 26 to 21", () => {
  const r = go("copy AAA-01, AAA-02, BBB-01, BBB-02 from 26 to 21");
  assert.deepEqual(r.inputs.map((i) => `${i.sheet} ${i.calling_name}`), ["21 AAA-01", "21 AAA-02", "21 BBB-01", "21 BBB-02"]);
  assert.ok(r.inputs.every((i) => i.overwrite === false)); // day 21 has them in Excel: confirm in the queue
  assert.ok(r.notes.some((x) => /already in Excel/.test(x)));
  assert.ok(go("duplicate AAA-01 from 26 to 21 overwrite").inputs.every((i) => i.overwrite));
});
t("move: copy there, clear the source", () => {
  const r = go("move AAA-01 from 26 to 28");
  assert.deepEqual(r.inputs.map((i) => [i.sheet, i.time_in]), [["28", 7], ["26", null]]);
});
t("fill only empty days", () => {
  const r = go("fill AAA-01 from 26 to 25-28");
  assert.deepEqual(r.inputs.map((i) => i.sheet), ["27", "28"]);
});
t("add with insert/create synonyms, codes share the hours", () => {
  const r = go("insert CCC-01, CCC-02 on 10 in 7 out 19 code 03-11-00-00, 03-20-00-00");
  assert.equal(r.verb, "ADD");
  assert.deepEqual(r.inputs[0].activities, [{ code: "03-11-00-00", hours: 5.5 }, { code: "03-20-00-00", hours: 5.5 }]);
  assert.equal(go("create CCC-01 on 10 in 19 out 3 code 03-11-00-00").inputs[0].time_out, 27); // next morning
});
t("clear, swap, shift, round, replace", () => {
  assert.ok(go("delete BBB-03 on 2, 3").inputs.every((i) => i.time_in === null && i.overwrite));
  const s = go("swap AAA-01 between 5 and 6");
  assert.deepEqual(s.inputs.map((i) => [i.sheet, i.time_in]), [["5", null], ["6", 7]]);
  assert.equal(go("shift out +30m for AAA-02 on 1").inputs[0].time_out, 19.5);
  assert.equal(go("nudge times -1 for AAA-02 on 1").inputs[0].time_in, 6);
  assert.equal(go("shift in by 0.5 for AAA-02 on 1").inputs[0].time_in, 7.5);
  const rep = go("replace 03-11-00-00 with 03-11-00-00-P for all on 1-3");
  assert.equal(rep.inputs.length, 12); // 4 AAA workers x 3 days
  assert.ok(rep.inputs.every((i) => i.activities[0].code === "03-11-00-00-P"));
  assert.equal(go("replace out 19 with 18 for AAA on 1").inputs[0].activities[0].hours, 10);
});
t("workers: prefix, range, all, except, crew, trade, names with a space", () => {
  assert.equal(go("set out 20 for AAA on 1").inputs.length, 4);
  assert.equal(go("set out 20 for AAA-01..AAA-03 on 1").inputs.length, 3);
  assert.equal(go("set out 20 for AAA-01 to AAA-03 on 1").inputs.length, 3);
  assert.equal(go("set out 20 for all on 1").inputs.length, 8);
  assert.equal(go("set out 20 for all except AAA-01, BBB-02 on 1").inputs.length, 6);
  assert.equal(go("set out 20 for crew of AAA-01 on 1").inputs.length, 3);
  assert.equal(go("set out 20 for trade Barbender on 1").inputs.length, 4);
  assert.equal(C.parse("add AAA-01 CH on 10 in 7 out 19 code 03-11-00-00", ctx()).workers[0], "AAA-01 CH");
});
t("days: ranges, words, today", () => {
  assert.equal(C.parse("show all on weekdays", ctx()).days.length, 22); // October 2026
  assert.deepEqual(C.parse("show all on saturdays", ctx()).days, ["3", "10", "17", "24", "31"]);
  assert.deepEqual(C.parse("show all on today", ctx()).days, ["21"]);
  assert.deepEqual(C.parse("set out 20 for AAA-01 from 1 to 3", ctx()).days, ["1", "2", "3"]);
});
t("where: compare, like, empty, and", () => {
  assert.equal(go("set out 20 for all on 1 where code like 03-20*").inputs.length, 4);
  assert.equal(go("show all on 1-31 where out = 19 and code = 03-11-00-00").rows.length, 48);
  assert.equal(go("count all on 1 where remark empty").rows.length, 8);
  assert.equal(go("show all on 1 where worked > 11").rows.length, 0);
});
t("show totals and changes nothing", () => {
  const r = go("show AAA-01 on 1-31");
  assert.equal(r.rows.length, 12);
  assert.equal(r.inputs.length, 0);
  assert.match(r.summary, /132 worked hours/);
});
t("the queue counts as the current state", () => {
  const queued = [{ sheet: "1", calling_name: "AAA-01", time_in: 8, time_out: 20, activities: [{ code: "03-11-00-00", hours: 11 }], additional: null, remark: null, overwrite: true, acknowledged: [] }];
  assert.equal(go("shift out +1 for AAA-01 on 1", { queued }).inputs[0].time_out, 21);
  const q2 = [{ ...queued[0], sheet: "10" }]; // only waiting, not in Excel: CLEAR drops it from the queue
  assert.deepEqual(go("clear AAA-01 on 10", { queued: q2 }).removeQueued, [{ sheet: "10", name: "AAA-01" }]);
});
t("clear messages with suggestions", () => {
  assert.match(err("sett out 20 for AAA-01 on 1"), /Did you mean "set"/);
  assert.match(err("set outt 20 for AAA-01 on 1"), /not a worker|not understood|Did you mean/);
  assert.match(err("set out 20 for AAA-1O on 1"), /not a worker/);
  assert.match(err("set out 20 for AAA-01"), /Say which days/);
  assert.match(err("set out 20 on 1"), /Say which workers/);
  assert.match(err("set out 20 for AAA-01 on 40"), /no sheet 40/);
  assert.match(err("add AAA-01 on 10 in 7 out 19 code 99-99"), /not in the activity list/);
  assert.match(err("copy AAA-01 from 26"), /to put the entries on/);
  assert.match(err("swap AAA-01 on 5"), /two days/);
});
t("explain: synonyms name the command", () => {
  const e = C.explain("insert", ctx());
  assert.equal(e.name, "ADD");
  assert.match(e.text, /"insert" means ADD/);
  assert.equal(C.explain("whose", ctx()).name, "WHERE");
  assert.equal(C.explain("finish", ctx()).name, "OUT");
  assert.match(C.explain("21", ctx()).text, /Wednesday, October 21|21 October/);
  assert.match(C.explain("AAA-02", ctx()).text, /Carpenter/);
  assert.equal(C.explain("19", ctx(), ["show", "all", "on", "1", "where", "out", "="]).name, "19:00"); // a time, not day 19
  assert.equal(C.explain("20", ctx(), ["set", "out"]).name, "20:00");
  assert.match(C.explain("+30m", ctx(), ["shift", "out"]).text, /later by 0.5 hours \(30 minutes\)/);
  assert.match(C.explain("19", ctx(), ["copy", "AAA-01", "from"]).text, /Monday, October 19|19 October/); // a day here
});
t("suggest: verbs, then fields, workers, days, codes", () => {
  const s = (src) => C.suggest(src, src.length, ctx()).items.map((i) => i.insert);
  assert.ok(s("").includes("set") && s("").includes("copy"));
  assert.ok(s("ins").includes("insert"));
  assert.ok(s("set ").includes("out"));
  assert.ok(s("set out 20 for AA").includes("AAA-01"));
  assert.ok(s("set out 20 for AAA-01 on 2").includes("20"));
  assert.ok(s("add AAA-01 on 10 in 7 out 19 code 03-1").includes("03-11-00-00"));
  assert.ok(s("show all on 1 where ").includes("out"));
  assert.ok(s("show all on 1 where out ").includes(">"));
});
console.log(`commands: ${n} tests passed`);
