// Time cards from a list file: an Excel file with calling names (one per row) fills the list, in
// the file's order; names not in Labour Detail are shown. Then a practice print.
//
//   python -m app.main --demo fixtures/sanitized/indian_2026-10.json    (fresh server)
//   node e2e/timecards-list.cjs <names.xlsx>   (a one-column workbook: INB-05, INB-03, INB-01, XYZ-99, INB-02)
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const xlsx = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + "/");
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.goto(BASE + "/app/#cards");
  await p.waitForSelector("#tc-names");

  await p.getByLabel("Excel file with calling names").setInputFiles(xlsx);
  await p.waitForSelector("text=Loaded 5 names");
  console.log("hint:", await p.locator(".hint", { hasText: "Loaded" }).innerText());
  const list = await p.locator(".tc-list").innerText();
  console.log("list:", list.replace(/\s+/g, " "));
  if (!/4 time cards · INB-05, INB-03, INB-01, INB-02/.test(list)) throw new Error("file order not kept");
  if (!list.includes("Not found: XYZ-99")) throw new Error("unknown name not shown");

  // A .csv with a header works too.
  await p.getByLabel("Excel file with calling names").setInputFiles({ name: "crew.csv", mimeType: "text/csv", buffer: Buffer.from("Calling Name\r\nINB-02\r\nINB-01\r\n") });
  await p.waitForSelector("text=Loaded 2 names from crew.csv");
  console.log("csv:", (await p.locator(".tc-list").innerText()).replace(/\s+/g, " "));

  // Back to the Excel list, drop the unknown name, practice print.
  await p.getByLabel("Excel file with calling names").setInputFiles(xlsx);
  await p.waitForSelector("text=Loaded 5 names");
  await p.locator("#tc-names").fill((await p.locator("#tc-names").inputValue()).replace("XYZ-99\n", ""));
  await p.getByRole("button", { name: /^Print 4 time cards/ }).click();
  await p.waitForSelector(".tc-progress.done", { timeout: 30000 });
  const printed = await p.evaluate(async () => (await (await fetch("/api/timecards/job")).json()).printed);
  console.log("printed (practice):", printed);
  if (printed.join() !== "INB-05,INB-03,INB-01,INB-02") throw new Error("printed in the wrong order");
  console.log("errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
