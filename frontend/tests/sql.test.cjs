// SQL in the command box (src/sql.ts) on a made-up month: no real data.   node tests/sql.test.cjs
const { buildSync } = require("esbuild");
const path = require("path"), os = require("os"), fs = require("fs");
const assert = require("assert/strict");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sqltest-")), "sql.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/sql.ts")], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "error" });
const S = require(out);

// made-up month: BBB-01..04 (codes E0001..), SSS-01..04, CCS-01; entries days 1-5
const workers = [];
const mk = (n, trade, emp) => workers.push({ row: 3 + workers.length, block: workers.length, calling_name: n, person: n, name: `Person ${n}`, trade_group: trade, employee_code: emp, code_status: "valid" });
["BBB-01", "BBB-02", "BBB-03", "BBB-04"].forEach((n, i) => mk(n, "Barbender", `EMP1000${i + 1}`));
["SSS-01", "SSS-02", "SSS-03", "SSS-04"].forEach((n, i) => mk(n, "Helper", `EMP2000${i + 1}`));
mk("CCS-01", "Carpenter", "EMP30001");
const codes = ["ACT-001", "ACT-002", "ACT-003"];
const month = {};
for (let d = 1; d <= 31; d++) {
  const entries = [];
  if (d <= 5)
    workers.forEach((w, b) => {
      const late = b % 2 === 1; // every other worker 07:00-20:00 (12 h), else 07:00-16:00 (8 h)
      entries.push({ entry: { sheet: String(d), block: b, row: 9 + 7 * b, calling_name: w.calling_name, time_in: 7, time_out: late ? 20 : 16, activities: [{ row: 9, code: w.calling_name.startsWith("B") ? "ACT-001" : "ACT-002", hours: late ? 12 : 8 }], additional: null, remark: null }, computed: null, issues: [] });
    });
  month[String(d)] = { header: { sheet: String(d), date: `2026-10-${String(d).padStart(2, "0")}`, date_raw: null, day_type: d === 3 ? "Saturday" : d === 4 ? "Sunday" : "Normal Day", sheet_no: d, prepared_by: null, project: null }, expected_date: null, expected_day_type: null, header_issues: [], entries };
}
const ctx = (extra = {}) => ({ workers, month, sheets: Object.keys(month), monthIso: "2026-10", queued: [], withActivities: true, activities: codes, places: {}, ...extra });
const sql = (q, extra) => S.runSql(S.parseSql(q, ctx(extra)), ctx(extra));
const err = (q) => { try { sql(q); } catch (e) { return e.message; } throw new Error("no error: " + q); };
let n = 0; const t = (name, fn) => { fn(); n++; };

t("is SQL vs the plain commands", () => {
  assert.ok(S.isSql("SELECT * FROM labor;"));
  assert.ok(S.isSql("delete from labor where day = 1"));
  assert.ok(S.isSql("UPDATE labor SET out = 20 WHERE day = 1"));
  assert.ok(!S.isSql("select all on 1-3"));         // the SHOW command (select is a synonym)
  assert.ok(!S.isSql("delete INB-03 on 15"));        // the CLEAR command
  assert.ok(!S.isSql("update out 20 for INB on 1")); // the SET command
  assert.ok(S.looksSql("SELECT calling_name") && S.looksSql("select count(") && !S.looksSql("select all on 1"));
});
t("names that start with B or end with S", () => {
  const r = sql("SELECT DISTINCT calling_name FROM workers WHERE calling_name LIKE 'B%' OR name LIKE '%S-01' ORDER BY calling_name");
  assert.deepEqual(r.table.rows.map((x) => x[0]), ["BBB-01", "BBB-02", "BBB-03", "BBB-04", "CCS-01", "SSS-01"]);
});
t("SELECT * FROM labor", () => {
  const r = sql("SELECT * FROM labor;");
  assert.equal(r.table.rows.length, 45);
  assert.ok(r.table.columns.includes("employee_code") && r.table.columns.includes("ot"));
});
t("WHERE ZIDAL = 'EMP10002'", () => {
  const r = sql("SELECT * FROM labor WHERE ZIDAL = 'EMP10002'");
  assert.equal(r.table.rows.length, 5);
});
t("ZIDAL, Hours, `ot hours` WHERE Hours > 8", () => {
  const r = sql("SELECT ZIDAL, Hours, `ot hours` FROM labor WHERE Hours > 8");
  assert.deepEqual(r.table.columns, ["employee_code", "hours", "ot"]);
  assert.equal(r.table.rows.length, 20); // 4 late workers x 5 days
  const sat = sql("SELECT `ot hours` FROM labor WHERE day = 3 AND hours > 8");
  assert.ok(sat.table.rows.every((x) => x[0] === 6.5)); // Saturday: OT after 5.5
});
t("WHERE `activity codes` = … ORDER BY Hours DESC", () => {
  const r = sql("SELECT ZIDAL, `activity codes`, Hours FROM labor WHERE `activity codes` = 'ACT-001' ORDER BY Hours DESC");
  assert.equal(r.table.rows.length, 20);
  assert.equal(r.table.rows[0][2], 12);
  assert.equal(r.table.rows[r.table.rows.length - 1][2], 8);
});
t("GROUP BY with SUM and aliases", () => {
  const r = sql("SELECT `activity codes`, SUM(Hours) AS Total_Hours, SUM(`ot hours`) AS Total_OT FROM labor GROUP BY `activity codes` ORDER BY Total_Hours DESC");
  assert.deepEqual(r.table.columns, ["code", "Total_Hours", "Total_OT"]);
  assert.deepEqual(r.table.rows.map((x) => x[0]), ["ACT-002", "ACT-001"]);
  const c = sql("SELECT COUNT(*) AS n, COUNT(DISTINCT calling_name) AS workers FROM labor WHERE day BETWEEN 1 AND 2");
  assert.deepEqual(c.table.rows, [[18, 9]]);
  const h = sql("SELECT trade, AVG(worked) FROM labor GROUP BY trade HAVING COUNT(*) > 10 ORDER BY 2 DESC");
  assert.equal(h.table.rows.length, 2);
});
t("time columns compare with dates and times", () => {
  assert.equal(sql("SELECT * FROM labor WHERE `in times` LIKE '2026-10-02%'").table.rows.length, 9);
  assert.equal(sql("SELECT * FROM labor WHERE out > '19:00'").table.rows.length, 20);
  assert.equal(sql("SELECT * FROM labor WHERE `in times` = '2026-10-01 07:00:00'").table.rows.length, 9);
  assert.equal(sql("SELECT * FROM labor WHERE `in times` < '2025-01-01 00:00:00'").table.rows.length, 0);
});
t("INSERT with ZIDAL and date-times", () => {
  const r = sql("INSERT INTO labor (ZIDAL, Hours, `ot hours`, `activity codes`, `in times`, `out times`) VALUES ('EMP10001', 8.0, 1.5, 'ACT-001', '2026-10-10 08:00:00', '2026-10-10 17:30:00')");
  assert.equal(r.inputs.length, 1);
  assert.deepEqual([r.inputs[0].calling_name, r.inputs[0].sheet, r.inputs[0].time_in, r.inputs[0].time_out, r.inputs[0].activities[0].hours], ["BBB-01", "10", 8, 17.5, 8]);
  assert.ok(r.notes.some((x) => /OT ignored/.test(x)));
  const two = sql("INSERT INTO labor (calling_name, day, in, out, code) VALUES ('SSS-01', 11, '19:00', '03:00', 'ACT-002'), ('SSS-02', 11, 7, 19, 'ACT-002')");
  assert.deepEqual(two.inputs.map((i) => i.time_out), [27, 19]); // past midnight: the next morning
  assert.match(err("INSERT INTO labor (ZIDAL, `in times`, `out times`, code) VALUES ('EMP10001', '2026-11-01 08:00:00', '2026-11-01 17:30:00', 'ACT-001')"), /not in this workbook's month/);
});
t("UPDATE with date-times, expressions and conditions", () => {
  const r = sql("UPDATE labor SET `out times` = '2026-10-01 17:00:00', Hours = 8.0 WHERE ZIDAL = 'EMP10002' AND `in times` LIKE '2026-10-01%'");
  assert.equal(r.inputs.length, 1);
  assert.deepEqual([r.inputs[0].sheet, r.inputs[0].time_out, r.inputs[0].activities[0].hours, r.inputs[0].overwrite], ["1", 17, 8, true]);
  const shift = sql("UPDATE labor SET out = out + 1 WHERE calling_name LIKE 'SSS%' AND day = 2");
  assert.ok(shift.inputs.every((i) => [17, 21].includes(i.time_out)));
  assert.match(err("UPDATE labor SET `ot hours` = 2.0 WHERE ZIDAL = 'EMP10001' AND `activity codes` = 'ACT-002'"), /OT is worked out by Excel/);
  assert.match(err("UPDATE labor SET out = 20"), /without WHERE/);
});
t("DELETE", () => {
  const r = sql("DELETE FROM labor WHERE ZIDAL = 'EMP10001' AND `in times` = '2026-10-01 07:00:00'");
  assert.equal(r.inputs.length, 1);
  assert.ok(r.inputs[0].time_in === null && r.inputs[0].overwrite);
  assert.equal(sql("DELETE FROM labor WHERE `in times` < '2025-01-01 00:00:00'").inputs.length, 0);
  assert.match(err("DELETE FROM labor"), /without WHERE/);
  assert.match(err("DELETE FROM workers WHERE 1 = 1"), /cannot be changed/);
});
t("other tables", () => {
  assert.equal(sql("SELECT code, lines FROM codes ORDER BY lines DESC").table.rows[0][0], "ACT-002");
  assert.equal(sql("SELECT weekday FROM days WHERE day = 1").table.rows[0][0], "Thursday");
  assert.equal(sql("SELECT code, SUM(hours) FROM activities GROUP BY code").table.rows.length, 2);
  assert.deepEqual(sql("SELECT calling_name, days_worked FROM workers WHERE days_worked = 5 LIMIT 2").table.rows, [["BBB-01", 5], ["BBB-02", 5]]);
});
t("clear errors with hints", () => {
  assert.match(err("SELECT * FROM labr"), /Did you mean entries/);
  assert.match(err("SELECT hourz FROM labor"), /Did you mean hours/);
  assert.match(err("SELECT * FROM labor WHERE"), /stops too early/);
  assert.match(err("SELECT * FROM labor; SELECT * FROM codes"), /One statement at a time/);
});
t("explain and suggest", () => {
  assert.match(S.explainSql("ZIDAL", "SELECT ZIDAL FROM labor", ctx()).text, /"ZIDAL" means employee_code/);
  assert.match(S.explainSql("labor", "SELECT * FROM labor", ctx()).text, /Table entries/);
  assert.match(S.explainSql("LIKE", "", ctx()).text, /%/);
  const s = (q) => S.suggestSql(q, q.length, ctx()).items.map((x) => x.insert);
  assert.ok(s("SELECT * FROM ").includes("entries"));
  assert.ok(s("SELECT * FROM lab").includes("labor")); // other names of a table too
  assert.ok(s("SELECT * FROM labor WHERE ").includes("calling_name"));
  assert.ok(s("SELECT calling_name FROM labor ").includes("WHERE"));
});
t("split statements, comments, quotes", () => {
  const parts = S.splitSql("SELECT 1 FROM days; -- a note\nSELECT calling_name FROM workers WHERE calling_name = 'A;B' ;\n\n");
  assert.equal(parts.length, 2);
  assert.equal(parts[1].text, "SELECT calling_name FROM workers WHERE calling_name = 'A;B'");
  assert.ok(parts[0].end < parts[1].start);
  assert.equal(S.splitSql("-- only a comment").length, 0);
  assert.equal(sql(S.splitSql("-- headcount\nSELECT COUNT(*) FROM entries WHERE day = 1")[0].text).table.rows[0][0], 9);
  const counts = S.sqlRowCounts(ctx());
  assert.equal(counts.workers, 9); assert.equal(counts.days, 31); assert.equal(counts.entries, 45);
  assert.ok(S.SQL_SCHEMA.find((x) => x.name === "entries").cols.find((c) => c.name === "out").writable);
});
t("UPDATE written with FROM: the error gives the right order", () => {
  assert.match(err("UPDATE code = 'ACT-002' FROM entries WHERE code = 'ACT-001'"), /Write: UPDATE entries SET code = 'ACT-002' WHERE code = 'ACT-001'/);
  assert.match(err("UPDATE entries out = 20"), /After UPDATE entries comes SET/);
  assert.equal(sql("UPDATE entries SET code = 'ACT-002' WHERE code = 'ACT-001' AND day = 1").inputs.length, 4);
});
console.log(`sql: ${n} tests passed`);
