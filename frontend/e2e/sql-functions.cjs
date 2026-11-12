// SQL panel functions: the Functions list (find, insert), SELECT without FROM, a window query on
// the month, CASE and dates on the columns, and a function error marked. Made-up data only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/sql-functions.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("labour.user", "Tester"); });
  await p.reload(); await p.waitForSelector("#worker");
  await p.waitForFunction(() => !document.querySelector(".statusbar")?.innerText.includes("Loading month"), null, { timeout: 60000 });
  await p.keyboard.press("Control+k");
  await p.waitForFunction(() => location.hash === "#codes/sql");
  const ed = p.getByLabel("SQL query");
  const run = async (q) => {
    await ed.click(); await p.keyboard.press("Control+a"); await p.keyboard.press("Delete");
    await ed.fill(q); await p.keyboard.press("Escape"); await p.keyboard.press("Control+Enter");
    await p.waitForFunction(() => document.querySelector(".sqlws-status, .sqlws-error"));
  };
  const grid = async () => (await p.locator(".sqlws-result .sqlws-grid tbody tr").allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());

  // the Functions list: categories, a search, a click puts the function in the query
  const tree = p.locator(".tree-fns");
  console.log("functions:", (await tree.locator(".tree-title").innerText()).replace(/\s+/g, " "));
  await p.getByLabel("Find a function").fill("regexp");
  const found = await tree.locator(".tree-fn").allInnerTexts();
  console.log("find regexp:", found.map((x) => x.replace(/\s+/g, " ")).join(" | "));
  if (found.length < 4) throw new Error("the function search found too little");
  await ed.click(); await p.keyboard.press("Control+a"); await p.keyboard.press("Delete");
  await tree.locator(".tree-fn", { hasText: "REGEXP_REPLACE" }).click();
  const inserted = await ed.inputValue();
  console.log("inserted:", JSON.stringify(inserted));
  if (!inserted.includes("REGEXP_REPLACE(")) throw new Error("the function was not inserted");
  await p.getByLabel("Find a function").fill("");

  // SELECT without FROM
  await run("SELECT UPPER('abc') AS up, DATE_FORMAT('2026-10-05', '%W %d %b') AS d, ROUND(PI(), 3) AS pi, CAST('12' AS INT) * 2 AS n");
  const r1 = await grid();
  console.log("no FROM:", r1.join(" | "));
  if (!r1[0]?.includes("ABC") || !r1[0].includes("Monday 05 Oct") || !r1[0].includes("3.142") || !r1[0].includes("24")) throw new Error("functions without FROM");

  // a window query with CASE and dates on the month's columns
  await run(`SELECT calling_name, day, DAYNAME(date) AS weekday, TIMEDIFF(out, in) AS span,
  CASE WHEN worked > 10 THEN 'long' ELSE 'normal' END AS kind,
  SUM(worked) OVER (PARTITION BY calling_name ORDER BY day) AS running,
  RANK() OVER (PARTITION BY day ORDER BY worked DESC) AS rank_in_day
FROM entries WHERE calling_name LIKE 'AAA-0%' AND day <= 3
ORDER BY calling_name, day`);
  const r2 = await grid();
  console.log("window:", r2.slice(0, 3).join(" | "), `… (${r2.length} rows)`);
  if (!r2.length) throw new Error("window query gave no rows");
  if (SHOTS) await p.locator(".sqlws").screenshot({ path: `${SHOTS}/sql-functions.png` });

  // a misspelt function is explained
  await run("SELECT UPPPER(calling_name) FROM entries");
  await p.waitForSelector(".sqlws-error");
  const e = await p.locator(".sqlws-error").innerText();
  console.log("error:", e);
  if (!/Did you mean UPPER/.test(e)) throw new Error("no hint for a misspelt function");
  if (errs.length) throw new Error(errs.join("\n"));
  console.log("ok");
  await b.close();
})();
