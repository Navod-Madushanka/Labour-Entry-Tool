// BP bill check (roadmap #8): worker-days the BP Bill counts per business partner, the workers to
// check before certifying, the export for the QS. Made-up data:
//   cd backend && python ../scripts/demo_two_books.py   then  node e2e/bp-check.cjs [shots]
const { chromium } = require("playwright");
const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 60000 });
  await p.getByRole("tab", { name: "BP bill check" }).click();
  const card = p.locator(".bp-card").first();
  await card.waitFor();
  console.log("partner:", await card.locator("h3").innerText());
  console.log("figures:", (await card.locator(".bp-figures").innerText()).replace(/\s+/g, " "));
  const flagged = await card.locator("tbody tr").count();
  await p.getByLabel("only workers to check").uncheck();
  const all = await card.locator("tbody tr").count();
  console.log("workers to check:", flagged, "of", all);
  if (all < flagged || all === 0) throw new Error("the full list should hold every worker");
  const first = await card.locator("tbody tr").first().innerText();
  console.log("first row:", first.replace(/\s+/g, " "));
  await p.locator(".analysis").screenshot({ path: out + "/bp-check.png" });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Export for the QS" }).click()]);
  console.log("export:", dl.suggestedFilename());
  console.log("bp-check e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
