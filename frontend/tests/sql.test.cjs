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
  assert.ok(S.isSql("SELECT UPPER('abc')") && S.isSql("select now()") && S.isSql("SELECT CASE WHEN 1 THEN 2 END") && S.isSql("SELECT 1 + 1") && !S.isSql("select all on 3") && !S.isSql("select crew of INB-01 on 4"));
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
t("pasted text: curly quotes and look-alike dashes work; an empty result says why", () => {
  const plain = sql("SELECT calling_name FROM activities WHERE code = 'ACT-002' AND day = 1").table.rows.length;
  assert.ok(plain > 0);
  assert.equal(sql("SELECT calling_name FROM activities WHERE code = \u2018ACT\u2011002\u2019 AND day = 1").table.rows.length, plain);
  assert.equal(sql("SELECT calling_name\u00a0FROM activities WHERE code = \u201cACT\u2013002\u201d AND day = 1").table.rows.length, plain);
  const part = sql("SELECT calling_name FROM activities WHERE code = 'ACT-00'");
  assert.equal(part.table.rows.length, 0);
  assert.match(part.notes.join(" "), /Codes like "ACT-00" in this workbook: ACT-00[12] \(\d+ lines\)/);
  const none = sql("SELECT calling_name FROM entries WHERE code = 'ZZZ-9'");
  assert.match(none.notes[0], /No code like "ZZZ-9"/);
  const many = sql("SELECT calling_name FROM entries WHERE code = 'ACT-0'");
  assert.match(many.notes.join(" "), /joined with "\+"/);
});
t("UPDATE … SET code WHERE code = old AND calling_name = (list): only that code line changes", () => {
  const m = JSON.parse(JSON.stringify(month));
  m["1"].entries[0].entry.activities = [{ row: 9, code: "ACT-001 ", hours: 4 }, { row: 10, code: "ACT-003", hours: 4 }]; // BBB-01: two codes, a trailing space
  const x = { month: m };
  const run = (q) => S.runSql(S.parseSql(q, ctx(x)), ctx(x));
  const r = run("update entries set code = 'ACT-002' where code = 'ACT-001' and calling name = (BBB-01, bbb-02) and day between 1 and 2");
  const b1 = r.inputs.find((i) => i.calling_name === "BBB-01" && i.sheet === "1");
  assert.deepEqual(b1.activities.map((a) => [a.code, a.hours]), [["ACT-002", 4], ["ACT-003", 4]]); // the other code and the hours stay
  assert.deepEqual(r.inputs.map((i) => `${i.calling_name}@${i.sheet}`).sort(), ["BBB-01@1", "BBB-01@2", "BBB-02@1", "BBB-02@2"]);
  // entries.code = X finds a worker who has X among several codes
  assert.ok(run("SELECT calling_name FROM entries WHERE code = 'ACT-003' AND day = 1").table.rows.some((row) => row[0] === "BBB-01"));
  // a name that is no worker is said, with the ones it starts
  const notes = run("SELECT calling_name FROM entries WHERE calling_name IN (BBB, SSS-01)").notes.join(" ");
  assert.match(notes, /"BBB" is not a calling name: 4 start with it/);
});
t("a code change on workers with many lines: one line changes; a code twice is merged, hours added", () => {
  const m = JSON.parse(JSON.stringify(month));
  const lines = (l) => l.map(([code, hours], k) => ({ row: 9 + k, code, hours }));
  m["1"].entries[0].entry.activities = lines([["ACT-001", 2], ["ACT-002", 3], ["ACT-003", 2], ["ACT-001", 2], ["ACT-003", 3]]);
  m["1"].entries[1].entry.activities = lines([["ACT-003", 5], ["ACT-002", 7]]);
  const x = { month: m };
  const r = S.runSql(S.parseSql("update entries set code = 'ACT-003' where code = 'ACT-002' and day = 1 and calling_name in (BBB-01, BBB-02)", ctx(x)), ctx(x));
  const by = Object.fromEntries(r.inputs.map((i) => [i.calling_name, i.activities.map((a) => [a.code, a.hours])]));
  assert.deepEqual(by["BBB-01"], [["ACT-001", 4], ["ACT-003", 8]]); // 2+2 and 2+3+3: lines with the same code merged
  assert.deepEqual(by["BBB-02"], [["ACT-003", 12]]); // had the new code: one line, 5 + 7
});
// supervisors: BBB-01/02 on days 1-2 from Kamal's sheet, SSS-01 on day 1 from Nimal's (made up)
const owners = new Map([["1|BBB-01", "Kamal"], ["1|BBB-02", "Kamal"], ["2|BBB-01", "Kamal"], ["2|BBB-02", "Kamal"], ["1|SSS-01", "Nimal"]]);
t("WHERE supervisor = \"Kamal\" (double quotes are a value; case does not matter)", () => {
  const r = sql('SELECT * FROM entries WHERE supervisor = "Kamal";', { owners });
  assert.equal(r.table.rows.length, 4);
  assert.ok(r.table.columns.includes("supervisor"));
  assert.equal(sql("SELECT day FROM entries WHERE supervisor = 'kamal'", { owners }).table.rows.length, 4);
  assert.equal(sql("SELECT day FROM entries WHERE supervisor IS NULL", { owners }).table.rows.length, 40);
  assert.equal(sql("SELECT day FROM entries WHERE foreman IN (\"Kamal\", \"Nimal\")", { owners }).table.rows.length, 5);
  assert.deepEqual(sql("SELECT supervisor, COUNT(*) AS n FROM entries GROUP BY supervisor ORDER BY n DESC", { owners }).table.rows.slice(0, 2), [[null, 40], ["Kamal", 4]]);
  assert.equal(sql("SELECT * FROM activities WHERE supervisor = 'Nimal'", { owners }).table.rows.length, 1);
  // a double-quoted column name still works as a column
  assert.equal(sql('SELECT "calling_name" FROM entries WHERE "supervisor" = "Nimal"', { owners }).table.rows[0][0], "SSS-01");
});
t("UPDATE … WHERE code = … AND supervisor = 'Kamal': only Kamal's entries, other lines kept", () => {
  const r = sql('UPDATE entries SET code = "ACT-003" where code = "ACT-001" AND supervisor = \'Kamal\';', { owners });
  assert.equal(r.inputs.length, 4);
  assert.ok(r.inputs.every((i) => ["1", "2"].includes(i.sheet) && i.activities[0].code === "ACT-003"));
  assert.equal(sql("UPDATE entries SET out = '18:00' WHERE supervisor = 'Nimal'", { owners }).inputs[0].calling_name, "SSS-01");
});
t("supervisor cannot be SET; unknown names are explained", () => {
  assert.match(err("UPDATE entries SET supervisor = 'Nimal' WHERE day = 1"), /cannot be set here.*Reassign/);
  const miss = sql("SELECT * FROM entries WHERE supervisor = 'Kamall'", { owners });
  assert.equal(miss.table.rows.length, 0);
  assert.ok(miss.notes.some((x) => /Kamal/.test(x) && /did you mean/.test(x)), miss.notes.join(" | "));
  assert.ok(sql("SELECT * FROM entries WHERE supervisor = 'Kam'", { owners }).notes.some((x) => /LIKE '%Kam%'/.test(x)));
  assert.ok(sql("SELECT * FROM entries WHERE supervisor = 'Kamal'").notes.some((x) => /No entries this month were pushed with a supervisor/.test(x)));
});
t("the supervisors table", () => {
  const r = sql("SELECT * FROM supervisors ORDER BY entries DESC", { owners });
  assert.deepEqual(r.table.columns, ["supervisor", "days", "entries", "workers", "hours", "first_day", "last_day"]);
  assert.deepEqual(r.table.rows[0], ["Kamal", 2, 4, 2, 40, 1, 2]); // BBB-01 8 h + BBB-02 12 h, twice
  assert.deepEqual(r.table.rows[1].slice(0, 4), ["Nimal", 1, 1, 1]);
  const sug = S.suggestSql("SELECT * FROM entries WHERE supervisor = ", 41, ctx({ owners }));
  assert.deepEqual(sug.items.map((x) => x.insert), ["'Kamal'", "'Nimal'"]);
});
// ---- functions (SELECT without FROM: one row to try them on)
const one = (q, extra) => sql(q, extra).table.rows[0][0];
const eq = (q, want) => assert.deepEqual(one(q), want, q);
t("string functions, under each database's names", () => {
  eq("SELECT UPPER('abc')", "ABC"); eq("SELECT UCASE('abc')", "ABC"); eq("SELECT LOWER('ABC') FROM dual", "abc"); eq("SELECT INITCAP('hello big world')", "Hello Big World");
  eq("SELECT CONCAT('a', 'b', 3)", "ab3"); eq("SELECT CONCAT_WS('-', 'a', NULL, 'c')", "a-c"); eq("SELECT 'a' || 'b'", "ab"); eq("SELECT 'a' + 'b'", "ab");
  eq("SELECT LENGTH('hello')", 5); eq("SELECT LEN('hello')", 5); eq("SELECT CHAR_LENGTH('hello')", 5);
  eq("SELECT SUBSTRING('labour entry', 1, 6)", "labour"); eq("SELECT SUBSTR('labour', 3)", "bour"); eq("SELECT MID('labour', 2, 3)", "abo"); eq("SELECT SUBSTRING('labour' FROM 2 FOR 3)", "abo"); eq("SELECT SUBSTRING('labour', -3)", "our");
  eq("SELECT LEFT('03-11-00-00-P', 2)", "03"); eq("SELECT RIGHT('03-11-00-00-P', 1)", "P");
  eq("SELECT POSITION('b' IN 'abc')", 2); eq("SELECT LOCATE('b', 'abc')", 2); eq("SELECT CHARINDEX('c', 'abc')", 3); eq("SELECT INSTR('abcabc', 'c')", 3); eq("SELECT STRPOS('abc', 'c')", 3); eq("SELECT INSTR('abc', 'z')", 0);
  eq("SELECT REPLACE('a-b-c', '-', '')", "abc"); eq("SELECT TRANSLATE('a-b_c', '-_', '  ')", "a b c"); eq("SELECT REVERSE('abc')", "cba");
  eq("SELECT REPEAT('ab', 3)", "ababab"); eq("SELECT REPLICATE('x', 2)", "xx"); eq("SELECT LPAD('7', 3, '0')", "007"); eq("SELECT RPAD('7', 3, '*')", "7**");
  eq("SELECT TRIM('  a  ')", "a"); eq("SELECT LTRIM('  a')", "a"); eq("SELECT RTRIM('a  ')", "a"); eq("SELECT TRIM(LEADING '0' FROM '0070')", "70"); eq("SELECT TRIM(BOTH 'x' FROM 'xxaxx')", "a"); eq("SELECT BTRIM('xxaxx', 'x')", "a");
  eq("SELECT SPLIT_PART('03-11-00-00-P', '-', 2)", "11"); eq("SELECT SPLIT_PART('03-11-00-00-P', '-', -1)", "P"); eq("SELECT SUBSTRING_INDEX('a.b.c', '.', 2)", "a.b"); eq("SELECT SUBSTRING_INDEX('a.b.c', '.', -1)", "c");
  eq("SELECT STUFF('abcdef', 2, 3, 'X')", "aXef"); eq("SELECT OVERLAY('abcdef' PLACING 'X' FROM 2 FOR 3)", "aXef");
  eq("SELECT ASCII('A')", 65); eq("SELECT CHAR(65, 66)", "AB"); eq("SELECT CHR(67)", "C"); eq("SELECT SOUNDEX('Robert')", "R163"); eq("SELECT DIFFERENCE('Robert', 'Rupert')", 4); eq("SELECT LEVENSHTEIN('kitten', 'sitting')", 3);
  eq("SELECT FIELD('b', 'a', 'b', 'c')", 2); eq("SELECT ELT(2, 'a', 'b')", "b"); eq("SELECT CHOOSE(3, 'a', 'b', 'c')", "c"); eq("SELECT FIND_IN_SET('b', 'a,b,c')", 2);
  eq("SELECT REGEXP_REPLACE('INB-01 CH', '[^A-Z]', '')", "INBCH"); eq("SELECT REGEXP_SUBSTR('code 03-11 here', '[0-9]+-[0-9]+')", "03-11"); eq("SELECT REGEXP_LIKE('BBB-01', '^B+-')", 1); eq("SELECT REGEXP_COUNT('a1b2c3', '[0-9]')", 3); eq("SELECT REGEXP_INSTR('abc1', '[0-9]')", 4);
  eq("SELECT QUOTE('it''s')", "'it''s'"); eq("SELECT HEX(255)", "FF"); eq("SELECT TO_BASE64('ab')", "YWI="); eq("SELECT FROM_BASE64('YWI=')", "ab"); eq("SELECT STARTS_WITH('BBB-01', 'BBB')", 1);
});
t("number functions", () => {
  eq("SELECT ABS(-3)", 3); eq("SELECT CEIL(2.1)", 3); eq("SELECT CEILING(2.1)", 3); eq("SELECT FLOOR(2.9)", 2); eq("SELECT ROUND(2.345, 2)", 2.35); eq("SELECT ROUND(2.5)", 3); eq("SELECT ROUND(-2.5)", -3); eq("SELECT ROUND(1234, -2)", 1200);
  eq("SELECT TRUNCATE(2.789, 1)", 2.7); eq("SELECT TRUNC(2.789)", 2); eq("SELECT MOD(7, 3)", 1); eq("SELECT 7 % 3", 1); eq("SELECT 7 MOD 3", 1); eq("SELECT 7 DIV 2", 3); eq("SELECT 7 / 2", 3.5); eq("SELECT 1 / 0", null);
  eq("SELECT POWER(2, 10)", 1024); eq("SELECT POW(3, 2)", 9); eq("SELECT SQRT(16)", 4); eq("SELECT SQUARE(5)", 25); eq("SELECT EXP(0)", 1); eq("SELECT LN(1)", 0); eq("SELECT LOG10(1000)", 3); eq("SELECT LOG(2, 8)", 3); eq("SELECT LOG2(8)", 3);
  eq("SELECT SIGN(-5)", -1); eq("SELECT ROUND(PI(), 4)", 3.1416); eq("SELECT DEGREES(PI())", 180); eq("SELECT ROUND(SIN(RADIANS(90)), 6)", 1); eq("SELECT GREATEST(3, 9, 2)", 9); eq("SELECT LEAST(3, 9, 2)", 2); eq("SELECT GREATEST('b', 'a')", "b");
  eq("SELECT GCD(12, 18)", 6); eq("SELECT LCM(4, 6)", 12); eq("SELECT FACTORIAL(5)", 120); eq("SELECT WIDTH_BUCKET(7.5, 0, 10, 4)", 4); eq("SELECT ISNUMERIC('12.5')", 1); eq("SELECT ISNUMERIC('ab')", 0); eq("SELECT -2 + +3", 1);
  const r = one("SELECT RAND()"); assert.ok(r >= 0 && r < 1);
});
t("conditions and NULL: CASE, IF, IIF, COALESCE, NVL, NULLIF, DECODE", () => {
  eq("SELECT CASE WHEN 2 > 1 THEN 'yes' ELSE 'no' END", "yes"); eq("SELECT CASE 3 WHEN 1 THEN 'one' WHEN 3 THEN 'three' END", "three"); eq("SELECT CASE WHEN 1 = 2 THEN 'x' END", null);
  eq("SELECT IF(1 > 2, 'a', 'b')", "b"); eq("SELECT IIF(1 < 2, 'a', 'b')", "a"); eq("SELECT COALESCE(NULL, NULL, 'z')", "z"); eq("SELECT IFNULL(NULL, 5)", 5); eq("SELECT ISNULL(NULL, 5)", 5); eq("SELECT ISNULL(NULL)", 1);
  eq("SELECT NVL(NULL, 'x')", "x"); eq("SELECT NVL2('a', 'set', 'unset')", "set"); eq("SELECT NULLIF(5, 5)", null); eq("SELECT NULLIF(5, 6)", 5); eq("SELECT DECODE(2, 1, 'one', 2, 'two', 'other')", "two"); eq("SELECT DECODE(9, 1, 'one', 'other')", "other");
  eq("SELECT ZEROIFNULL(NULL)", 0); eq("SELECT 1 IS DISTINCT FROM NULL", 1); eq("SELECT NULL IS NOT DISTINCT FROM NULL", 1); eq("SELECT NULL <=> NULL", 1); eq("SELECT 1 IS TRUE", 1); eq("SELECT 0 IS NOT FALSE", 0);
  eq("SELECT 'BBB-01' REGEXP '^B'", 1); eq("SELECT 'BBB-01' RLIKE 'x'", 0); eq("SELECT 'BBB-01' ~ '^B'", 1); eq("SELECT 'BBB-01' ~ '^b'", 0); eq("SELECT 'BBB-01' ~* '^b'", 1); eq("SELECT 'BBB-01' SIMILAR TO 'B%'", 1); eq("SELECT 'abc' ILIKE 'A%'", 1);
});
t("types: CAST, ::, CONVERT, TO_CHAR, TO_NUMBER, TO_DATE, STR_TO_DATE, FORMAT", () => {
  eq("SELECT CAST('12' AS INT) + 1", 13); eq("SELECT CAST(7.89 AS INTEGER)", 7); eq("SELECT CAST(2.345 AS DECIMAL(10, 2))", 2.35); eq("SELECT CAST(12 AS VARCHAR(10))", "12"); eq("SELECT CAST('abcdef' AS VARCHAR(3))", "abc");
  eq("SELECT CAST('2026-10-05 07:30:00' AS DATE)", "2026-10-05"); eq("SELECT CAST('yes' AS BOOLEAN)", 1); eq("SELECT '42'::int", 42); eq("SELECT TRY_CAST('x' AS INT)", null); assert.match(err("SELECT CAST('x' AS INT)"), /not a number/);
  eq("SELECT CONVERT(INT, '12')", 12); eq("SELECT CONVERT('12', SIGNED)", 12); eq("SELECT CONVERT(VARCHAR(10), '2026-10-05', 103)", "05/10/2026"); eq("SELECT TRY_CONVERT(INT, 'x')", null);
  eq("SELECT TO_CHAR('2026-10-05', 'DD/MM/YYYY')", "05/10/2026"); eq("SELECT TO_CHAR('2026-10-05 14:05:00', 'HH24:MI Dy')", "14:05 Mon"); eq("SELECT TO_CHAR(1234.5, '999,999.99')", "1,234.50"); eq("SELECT TO_NUMBER('1,234.50')", 1234.5);
  eq("SELECT TO_DATE('05/10/2026', 'DD/MM/YYYY')", "2026-10-05"); eq("SELECT STR_TO_DATE('05/10/2026', '%d/%m/%Y')", "2026-10-05"); eq("SELECT TO_TIMESTAMP('2026-10-05 07:00')", "2026-10-05 07:00:00");
  eq("SELECT FORMAT(1234.5, 2)", "1,234.50"); eq("SELECT FORMAT(1234.5, 'N1')", "1,234.5"); eq("SELECT FORMAT(0.375, 'P1')", "37.5%"); eq("SELECT FORMAT('2026-10-05', 'dd MMM yyyy')", "05 Oct 2026"); eq("SELECT FORMAT('2026-10-05', 'dddd')", "Monday");
  eq("SELECT TYPEOF(1.5)", "real");
});
t("dates and times, on the month's columns too", () => {
  eq("SELECT YEAR('2026-10-05')", 2026); eq("SELECT MONTH('2026-10-05')", 10); eq("SELECT DAY('2026-10-05')", 5); eq("SELECT DAYOFMONTH('2026-10-05')", 5); eq("SELECT QUARTER('2026-10-05')", 4);
  eq("SELECT DAYNAME('2026-10-05')", "Monday"); eq("SELECT MONTHNAME('2026-10-05')", "October"); eq("SELECT DAYOFWEEK('2026-10-04')", 1); eq("SELECT WEEKDAY('2026-10-05')", 0); eq("SELECT DAYOFYEAR('2026-02-01')", 32);
  eq("SELECT WEEKOFYEAR('2026-10-05')", 41); eq("SELECT WEEK('2026-01-03')", 0); eq("SELECT WEEK('2026-01-04')", 1); eq("SELECT EXTRACT(YEAR FROM '2026-10-05')", 2026); eq("SELECT EXTRACT(DOW FROM '2026-10-05')", 1); eq("SELECT DATE_PART('month', '2026-10-05')", 10); eq("SELECT DATEPART(weekday, '2026-10-05')", 2);
  eq("SELECT DATENAME(month, '2026-10-05')", "October"); eq("SELECT LAST_DAY('2026-02-10')", "2026-02-28"); eq("SELECT EOMONTH('2026-01-15', 1)", "2026-02-28");
  eq("SELECT DATE_ADD('2026-10-05', INTERVAL 7 DAY)", "2026-10-12"); eq("SELECT DATE_SUB('2026-10-05', INTERVAL 1 MONTH)", "2026-09-05"); eq("SELECT DATEADD(month, 1, '2026-01-31')", "2026-02-28"); eq("SELECT ADD_MONTHS('2026-10-31', 1)", "2026-11-30");
  eq("SELECT '2026-10-05' + INTERVAL '2' DAY", "2026-10-07"); eq("SELECT '2026-10-05' - INTERVAL 1 YEAR", "2025-10-05"); eq("SELECT '2026-10-05' + 3", "2026-10-08"); eq("SELECT '2026-10-05' - '2026-10-01'", 4); eq("SELECT TIMESTAMPADD(HOUR, 2, '2026-10-05 07:00:00')", "2026-10-05 09:00:00");
  eq("SELECT DATEDIFF('2026-10-31', '2026-10-01')", 30); eq("SELECT DATEDIFF(month, '2026-01-31', '2026-02-01')", 1); eq("SELECT TIMESTAMPDIFF(MONTH, '2026-01-31', '2026-02-01')", 0); eq("SELECT TIMESTAMPDIFF(HOUR, '2026-10-05 07:00:00', '2026-10-05 19:30:00')", 12);
  eq("SELECT MONTHS_BETWEEN('2026-03-01', '2026-01-01')", 2); eq("SELECT DATE_TRUNC('month', '2026-10-15')", "2026-10-01"); eq("SELECT DATE_TRUNC('week', '2026-10-08')", "2026-10-05"); eq("SELECT TRUNC('2026-10-15 13:00:00', 'month')", "2026-10-01");
  eq("SELECT DATE_FORMAT('2026-10-05 14:05:00', '%d %b %Y %H:%i')", "05 Oct 2026 14:05"); eq("SELECT DATE_FORMAT('2026-10-05', '%W %D %M')", "Monday 5th October"); eq("SELECT STRFTIME('%Y/%m/%d %H:%M', '2026-10-05 14:05:00')", "2026/10/05 14:05");
  eq("SELECT MAKE_DATE(2026, 10, 5)", "2026-10-05"); eq("SELECT DATEFROMPARTS(2026, 10, 5)", "2026-10-05"); eq("SELECT MAKEDATE(2026, 32)", "2026-02-01"); eq("SELECT MAKETIME(7, 30, 0)", "07:30:00");
  eq("SELECT SEC_TO_TIME(3661)", "01:01:01"); eq("SELECT TIME_TO_SEC('01:01:01')", 3661); eq("SELECT TIMEDIFF('20:00', '07:30')", "12:30:00"); eq("SELECT AGE('2026-10-05', '2025-08-01')", "1 years 2 mons 4 days"); eq("SELECT NEXT_DAY('2026-10-05', 'Friday')", "2026-10-09");
  eq("SELECT ISDATE('2026-02-30')", 0); eq("SELECT ISDATE('2026-02-28')", 1); eq("SELECT DATE('2026-10-05 07:00:00')", "2026-10-05"); eq("SELECT TIME('2026-10-05 07:00:00')", "07:00:00");
  assert.match(one("SELECT CURRENT_DATE"), /^\d{4}-\d{2}-\d{2}$/); assert.match(one("SELECT NOW()"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); assert.match(one("SELECT GETDATE()"), /^\d{4}-/); assert.match(one("SELECT CURRENT_TIMESTAMP"), /^\d{4}-/);
  // on the columns: in / out are clock hours, date is the sheet's date
  const r = sql("SELECT HOUR(out), MINUTE(in), TIME(out), TIMEDIFF(out, in), DAYNAME(date), DATE_FORMAT(date, '%d/%m') FROM entries WHERE calling_name = 'BBB-02' AND day = 1");
  assert.deepEqual(r.table.rows[0], [20, 0, "20:00:00", "13:00:00", "Thursday", "01/10"]);
  eq("SELECT COUNT(*) FROM entries WHERE DAYOFWEEK(date) = 1", 9); // Sunday 4 Oct: 9 workers
  eq("SELECT COUNT(*) FROM entries WHERE date BETWEEN '2026-10-01' AND DATE_ADD('2026-10-01', INTERVAL 1 DAY)", 18);
});
t("aggregates: every kind", () => {
  const r = sql("SELECT COUNT(*), COUNT(DISTINCT calling_name), SUM(hours), AVG(hours), MIN(hours), MAX(hours), MEDIAN(hours), STDDEV_POP(worked), VAR_POP(worked) FROM entries WHERE day = 1").table.rows[0];
  assert.deepEqual(r.slice(0, 7), [9, 9, 88, 9.78, 8, 12, 8]); // 5 at 8 h, 4 at 12 h
  assert.ok(Math.abs(r[7] - 1.987616) < 1e-5 && Math.abs(r[8] - 3.950617) < 1e-5, r.join(","));
  eq("SELECT GROUP_CONCAT(DISTINCT trade ORDER BY trade SEPARATOR '/') FROM entries", "Barbender/Carpenter/Helper");
  eq("SELECT GROUP_CONCAT(DISTINCT trade) FROM workers", "Barbender,Helper,Carpenter");
  eq("SELECT STRING_AGG(calling_name, ', ' ORDER BY calling_name DESC) FROM workers WHERE trade = 'Barbender'", "BBB-04, BBB-03, BBB-02, BBB-01");
  eq("SELECT LISTAGG(calling_name, ';') WITHIN GROUP (ORDER BY calling_name) FROM workers WHERE calling_name LIKE 'S%'", "SSS-01;SSS-02;SSS-03;SSS-04");
  eq("SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours) FROM entries WHERE day = 1", 8); eq("SELECT PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY hours) FROM entries WHERE day = 1", 12);
  eq("SELECT MODE() WITHIN GROUP (ORDER BY hours) FROM entries", 8); eq("SELECT ARRAY_AGG(DISTINCT day) FROM entries WHERE day < 3", "{1,2}");
  eq("SELECT COUNT(*) FILTER (WHERE hours > 8) FROM entries", 20); eq("SELECT BOOL_AND(hours >= 8) FROM entries", 1); eq("SELECT BOOL_OR(hours > 12) FROM entries", 0); eq("SELECT ROUND(CORR(hours, hours * 2), 3) FROM entries", 1); eq("SELECT REGR_SLOPE(hours * 2 + 1, hours) FROM entries", 2); eq("SELECT REGR_INTERCEPT(hours * 2 + 1, hours) FROM entries", 1);
  eq("SELECT SUM(CASE WHEN hours > 8 THEN 1 ELSE 0 END) FROM entries", 20);
  const g = sql("SELECT trade, COUNT(*) AS n, ROUND(AVG(worked), 1) AS avg_worked FROM entries GROUP BY trade HAVING COUNT(*) >= 5 ORDER BY n DESC, trade").table.rows;
  assert.deepEqual(g, [["Barbender", 20, 10], ["Helper", 20, 10], ["Carpenter", 5, 8]]);
});
t("window functions: ranking, running totals, LAG / LEAD, frames", () => {
  const r = sql("SELECT calling_name, day, hours, ROW_NUMBER() OVER (PARTITION BY calling_name ORDER BY day) AS rn, SUM(hours) OVER (PARTITION BY calling_name ORDER BY day) AS running, LAG(hours) OVER (PARTITION BY calling_name ORDER BY day) AS prev, LEAD(day, 1, 0) OVER (PARTITION BY calling_name ORDER BY day) AS next FROM entries WHERE calling_name = 'BBB-02' ORDER BY day").table.rows;
  assert.deepEqual(r.map((x) => x.slice(3)), [[1, 12, null, 2], [2, 24, 12, 3], [3, 36, 12, 4], [4, 48, 12, 5], [5, 60, 12, 0]]);
  const rk = sql("SELECT calling_name, hours, RANK() OVER (ORDER BY hours DESC) AS rk, DENSE_RANK() OVER (ORDER BY hours DESC) AS drk, NTILE(3) OVER (ORDER BY calling_name) AS band FROM entries WHERE day = 1 ORDER BY calling_name").table.rows;
  assert.deepEqual(rk.map((x) => [x[0], x[2], x[3], x[4]]), [["BBB-01", 5, 2, 1], ["BBB-02", 1, 1, 1], ["BBB-03", 5, 2, 1], ["BBB-04", 1, 1, 2], ["CCS-01", 5, 2, 2], ["SSS-01", 5, 2, 2], ["SSS-02", 1, 1, 3], ["SSS-03", 5, 2, 3], ["SSS-04", 1, 1, 3]]);
  const share = sql("SELECT trade, SUM(hours) AS h, ROUND(100.0 * SUM(hours) / SUM(SUM(hours)) OVER (), 1) AS pct, RANK() OVER (ORDER BY SUM(hours) DESC) AS r FROM entries GROUP BY trade ORDER BY r").table.rows;
  assert.deepEqual(share, [["Barbender", 200, 45.5, 1], ["Helper", 200, 45.5, 1], ["Carpenter", 40, 9.1, 3]]); // 200 + 200 + 40 = 440 h
  const fr = sql("SELECT day, SUM(hours) OVER (ORDER BY day ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS two_days, FIRST_VALUE(day) OVER (ORDER BY day) AS f, LAST_VALUE(day) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS l, PERCENT_RANK() OVER (ORDER BY day) AS pr, CUME_DIST() OVER (ORDER BY day) AS cd FROM entries WHERE calling_name = 'BBB-01' ORDER BY day").table.rows;
  assert.deepEqual(fr.map((x) => x.slice(1)), [[8, 1, 5, 0, 0.2], [16, 1, 5, 0.25, 0.4], [16, 1, 5, 0.5, 0.6], [16, 1, 5, 0.75, 0.8], [16, 1, 5, 1, 1]]);
  assert.match(err("SELECT * FROM entries WHERE ROW_NUMBER() OVER (ORDER BY day) = 1"), /SELECT list or ORDER BY/);
  assert.match(err("SELECT ROW_NUMBER() FROM entries"), /needs OVER/);
});
t("errors and help for functions", () => {
  assert.match(err("SELECT UPPPER('a')"), /UPPPER is not a function here\. Did you mean UPPER\?/);
  assert.match(err("SELECT SUBSTRING('a')"), /SUBSTRING takes 2 to 3 values/);
  assert.match(err("SELECT DATEADD(fortnight, 1, '2026-10-01')"), /not a date part/);
  const help = S.explainSql("DATEADD", "SELECT DATEADD(day, 1, date) FROM entries", ctx());
  assert.match(help.text, /SQL Server: n parts/);
  assert.equal(S.explainSql("nvl", "", ctx()).name, "IFNULL");
  assert.ok(S.suggestSql("SELECT REGEXP_", 14, ctx()).items.some((x) => x.insert === "REGEXP_REPLACE("));
  // functions in UPDATE … SET and WHERE (to the waiting list as before)
  const u = sql("UPDATE entries SET remark = CONCAT('checked ', DATE_FORMAT(date, '%d/%m')) WHERE calling_name = 'BBB-01' AND DAYNAME(date) = 'Friday'");
  assert.deepEqual(u.inputs.map((i) => [i.sheet, i.remark]), [["2", "checked 02/10"]]);
  const o = sql("UPDATE entries SET out = LEAST(out, 18) WHERE calling_name = 'BBB-02' AND day = 1");
  assert.equal(o.inputs[0].time_out, 18);
});
console.log(`sql: ${n} tests passed`);
