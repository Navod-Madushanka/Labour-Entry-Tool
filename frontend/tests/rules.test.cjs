// The suggestion rules added after the replay study (src/history.ts, src/search.ts), on a small
// made-up month: carry-over, crews without codes, recent times, confident fills, whole records,
// the "probably next" list, crew mismatch and leading zeros in the worker search.
//   node tests/rules.test.cjs
const { buildSync } = require("esbuild");
const path = require("path"), os = require("os"), fs = require("fs");
const assert = require("assert/strict");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
fs.writeFileSync(path.join(dir, "entry.ts"), `export * from ${JSON.stringify(path.join(__dirname, "../src/history.ts"))};\nexport { searchWorkers } from ${JSON.stringify(path.join(__dirname, "../src/search.ts"))};\n`);
buildSync({ entryPoints: [path.join(dir, "entry.ts")], bundle: true, format: "cjs", platform: "node", outfile: path.join(dir, "h.cjs"), logLevel: "error" });
const H = require(path.join(dir, "h.cjs"));

const W = (n, block, trade = "Carpenter") => ({ row: 3 + block, block, calling_name: n, person: n, name: n, trade_group: trade, employee_code: "X1", code_status: "valid" });
const workers = ["AA-01", "AA-02", "AA-03", "AA-04", "AA-05", "BB-01", "BB-02"].map((n, i) => W(n, i, n.startsWith("BB") ? "Helper" : "Carpenter"));
const byName = Object.fromEntries(workers.map((w) => [w.calling_name, w]));
const E = (sheet, name, tin, tout, lines) => ({ entry: { sheet: String(sheet), block: byName[name].block, row: 0, calling_name: name, time_in: tin, time_out: tout,
  activities: lines.map(([code, hours]) => ({ row: 0, code, hours })), additional: null, remark: null }, computed: null, issues: [] });
const D = (sheet, entries, type = "Normal Day") => ({ header: { sheet: String(sheet), date: null, date_raw: null, day_type: type, sheet_no: sheet, prepared_by: null, project: null }, expected_date: null, expected_day_type: null, header_issues: [], entries });
const T = (name, code, tin, tout, activities) => ({ calling_name: name, code, time_in: tin, time_out: tout, activities });

// --- carry-over: previous month's last days become sheets 0, -1, …
const prev = { "29": D(29, [E(29, "AA-01", 7, 19, [["P", null]])]), "30": D(30, [E(30, "AA-01", 7, 19, [["Q", null]])]), "31": D(31, []) };
const carried = H.carryOver({ "1": D(1, []) }, prev, 7);
assert.deepEqual(Object.keys(carried).sort(), ["-1", "0", "1"]);
assert.equal(carried["0"].entries[0].entry.activities[0].code, "Q"); // the 30th, the last day with entries
assert.equal(carried["0"].entries[0].entry.sheet, "0");
assert.equal(H.workerStats(carried, "AA-01").days, 0, "carried days are not this month");
assert.equal(H.suggestCodes(carried, 1, byName["AA-01"], workers, [], { time_in: 7, time_out: 19 })[0].code, "Q", "last day reaches into the previous month");

// --- crews without codes: partners on the same times
const noCodes = { "1": D(1, [E(1, "BB-01", 8, 17, []), E(1, "BB-02", 8, 17, [])]), "2": D(2, [E(2, "BB-01", 8, 17, []), E(2, "BB-02", 8, 17, [])]) };
assert.deepEqual([...H.usualPartners(noCodes, 3, byName["BB-02"]).partners], ["BB-01"]);
const t = H.suggestTimes(noCodes, 3, byName["BB-02"], workers, [T("BB-01", null, 9, 18)]);
assert.deepEqual([t.time_in, t.time_out, t.tier], [9, 18, "partners"]);

// --- the worker's own times weigh recent days most (moved to nights two days ago)
const moved = {};
for (let d = 1; d <= 9; d++) moved[d] = D(d, [E(d, "AA-05", d >= 7 ? 19 : 7, d >= 7 ? 31 : 19, [["P", null]])]);
const own = H.suggestTimes(moved, 10, byName["AA-05"], workers, []);
assert.deepEqual([own.time_in, own.tier], [19, "usual"], "nights after three nights (six day shifts before), not after the month count turns");

// --- confident fill and the agreement in the reason
const crew = {};
for (let d = 1; d <= 3; d++) crew[d] = D(d, ["AA-01", "AA-02", "AA-03", "AA-04"].map((n) => E(d, n, 7, 19, [["P", null]])));
const three = [T("AA-01", "P", 7, 19), T("AA-02", "P", 7, 19), T("AA-03", "P", 7, 19)];
let s = H.suggestCodes(crew, 4, byName["AA-04"], workers, three, { time_in: 7, time_out: 19 });
assert.equal(s[0].code, "P"); assert.equal(s[0].confident, true); assert.match(s[0].why, /^3\/3 crew today/);
s = H.suggestCodes(crew, 4, byName["AA-04"], workers, [T("AA-01", "P", 7, 19)], { time_in: 7, time_out: 19 });
assert.equal(s[0].confident, false, "one partner is not enough to fill the box");
s = H.suggestCodes(crew, 4, byName["AA-04"], workers, [T("AA-01", "P", 7, 19), T("AA-02", "P", 7, 19), T("AA-03", "Q", 7, 19)], { time_in: 7, time_out: 19 });
assert.equal(s[0].confident, false, "2 of 3 agree: below the share");
assert.ok(s.every((x) => typeof x.confident === "boolean"));

// --- whole record: fills lines only for an agreed record of several lines
const split = [["P", 6], ["Q", 5]];
const rec = H.suggestRecord(crew, 4, byName["AA-04"], [T("AA-01", "P", 7, 19, split.map(([code, hours]) => ({ code, hours }))), T("AA-02", "P", 7, 19, split.map(([code, hours]) => ({ code, hours })))]);
assert.deepEqual([rec.agree, rec.of, rec.activities.length, rec.why], [2, 2, 2, "2/2 crew today"]);
assert.equal(H.fillsLines(rec), true);
assert.equal(H.fillsLines(H.suggestRecord(crew, 4, byName["AA-04"], three)), false, "one line: the code suggestion does it");
assert.equal(H.suggestRecord(crew, 4, byName["AA-04"], []), null);

// --- probably next: the last worker's crew first, then the last day in sheet order
const next = H.nextWorkers(crew, 4, byName["AA-01"], workers, [T("AA-01", "P", 7, 19)]).map((w) => w.calling_name);
assert.deepEqual(next.slice(0, 3), ["AA-02", "AA-03", "AA-04"]);
assert.ok(!next.includes("AA-01"), "already entered");
assert.equal(H.nextWorkers({}, 1, null, workers, [])[0].calling_name, "AA-01", "nothing known: Labour Detail order");

// --- crew mismatch: three partners agree on another code
const mm = H.crewMismatch(crew, 4, byName["AA-04"], three, { code: "Z", time_in: 7, time_out: 19 });
assert.equal(mm.length, 3);
assert.equal(H.crewMismatch(crew, 4, byName["AA-04"], three, { code: "P", time_in: 7, time_out: 16 }), null, "times alone don't warn");
assert.equal(H.crewMismatch(crew, 4, byName["AA-04"], three.slice(0, 2), { code: "Z", time_in: 7, time_out: 19 }), null, "two partners are too few");

// --- worker search: leading zeros are optional
const many = [W("INB-03", 0), W("INB-30", 1), W("INB-013", 2)];
assert.equal(H.searchWorkers(many, "inb3")[0].calling_name, "INB-03");
assert.equal(H.searchWorkers(many, "INB-03")[0].calling_name, "INB-03");
assert.equal(H.searchWorkers(many, "inb13")[0].calling_name, "INB-013");
assert.equal(H.searchWorkers(many, "inb30")[0].calling_name, "INB-30");
console.log("rules: all passed");
