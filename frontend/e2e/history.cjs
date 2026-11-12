// Month history (roadmap #9): save this month, add a past month from its file, trends month by
// month, and a run carried over the month end on Fatigue & OT risk. Made-up data:
//   cd backend && python ../scripts/demo_two_books.py 8012 big   then  node e2e/history.cjs [shots]
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
// the made-up September book the demo writes next to October (newest demo folder)
const dirs = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("labour_two_books_")).map((d) => path.join(os.tmpdir(), d))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const sept = dirs.map((d) => path.join(d, "Labour Entry Sheet September 2026 - DEMO A.json")).find((f) => fs.existsSync(f));
(async () => {
  if (!sept) throw new Error("start the demo with 'big' (it writes a September book)");
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 90000 });
  await p.getByRole("tab", { name: "Month history" }).click();

  await p.getByRole("button", { name: "Save this month to history" }).click();
  await p.locator(".history-card >> text=Saved Oct").waitFor({ timeout: 30000 });
  await p.locator('input[aria-label="Past month workbook"]').setInputFiles(sept);
  await p.locator(".history-card >> text=Added Sep").waitFor({ timeout: 60000 });
  const months = await p.locator(".history-card tbody tr").allInnerTexts();
  console.log("months:", months.map((m) => m.split("\t").slice(0, 3).join(" ")).join(" | "));
  if (months.length !== 2) throw new Error("two months expected");
  const table = await p.locator("table.compare thead").innerText();
  console.log("trend columns:", table.replace(/\s+/g, " "));
  const hours = await p.locator("table.compare tbody tr", { hasText: "Hours worked" }).innerText();
  console.log(hours.replace(/\s+/g, " "));
  await p.locator(".analysis").screenshot({ path: out + "/history.png" });

  // runs carried over the month end
  await p.getByRole("tab", { name: "Fatigue & OT risk" }).click();
  await p.getByLabel("everyone").check();
  const carried = await p.locator(".fatigue-table tbody tr", { hasText: "last month" }).count();
  console.log("people with a run carried from September:", carried);
  if (!carried) throw new Error("no run carried over the month end");

  // clean up the history
  await p.evaluate(async () => { for (const m of await (await fetch("/api/history")).json()) await fetch(`/api/history/${m.id}`, { method: "DELETE" }); });
  console.log("history e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
