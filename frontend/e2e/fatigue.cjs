// Fatigue and OT risk (roadmap #7): counts over the limits, the trend chart, the per-person table,
// changing the limits (settings), and the OT-output link once quantities exist. Made-up data:
//   cd backend && python ../scripts/demo_two_books.py 8012 big   then  node e2e/fatigue.cjs [shots]
const { chromium } = require("playwright");
const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 90000 });
  await p.getByRole("tab", { name: "Fatigue & OT risk" }).click();
  const tiles = async () => (await p.locator(".kpis .kpi").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join(" | ");
  console.log("default limits:", await tiles());
  const before = await p.locator(".fatigue-table tbody tr").count();

  // stricter limits (made up): the counts and the table grow
  await p.getByRole("button", { name: "Change limits…" }).click();
  await p.getByLabel("Worked hours in any 7 days").fill("40");
  await p.getByLabel("Overtime hours in any 7 days").fill("8");
  await p.getByRole("button", { name: "Save limits" }).click();
  await p.locator("text=Limits: 40 h worked or 8 h overtime").waitFor();
  console.log("strict limits:", await tiles());
  const after = await p.locator(".fatigue-table tbody tr").count();
  console.log("people over a limit:", before, "->", after);
  if (after < before || after === 0) throw new Error("stricter limits should flag more people");
  const first = await p.locator(".fatigue-table tbody tr").first().innerText();
  console.log("riskiest:", first.replace(/\s+/g, " "));
  await p.locator(".analysis").screenshot({ path: out + "/fatigue.png" });

  // back to the defaults
  await p.evaluate(async () => fetch("/api/setup/limits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week_hours: 60, week_ot: 20, days_in_row: 13, rest_hours: 8 }) }));
  console.log("fatigue e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
