// Rupee lens (roadmap #3): Hours / Rs switch, "add rates" card, standard rates per trade, cost
// tiles and columns at standard rates, cost in the Excel export. Made-up data and rates.
//   cd backend && python ../scripts/demo_two_books.py   then  node e2e/rupees.cjs [shots]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.setItem("labour.analysis.money", "0"); }); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 60000 });
  await p.getByRole("tab", { name: "Overview" }).click();

  // no rates yet: Rs shows a card, not zeros
  await p.getByRole("group", { name: "Show hours or rupees" }).getByRole("button", { name: "Rs", exact: true }).click();
  await p.locator(".empty-money >> text=Add rates to see rupees.").waitFor();
  if (await p.locator(".kpis.money").count()) throw new Error("rupee tiles without rates");
  await p.getByRole("button", { name: "Add standard rates" }).click();

  // the QS's rates: one trade, OT multiplier as given
  const card = p.locator(".rates-card");
  await card.getByLabel(/^Daily rate for /).first().fill("2,400");
  await card.locator(".rates-table tbody tr").first().locator("td").nth(2).filter({ hasText: "Rs 300" }).waitFor();
  await card.getByRole("button", { name: "Save rates" }).click();
  await card.locator("text=Saved.").waitFor();
  await p.locator(".kpis.money").waitFor();
  const tiles = await p.locator(".kpis.money .kpi").allInnerTexts();
  console.log("tiles:", tiles.map((t) => t.split("\n").slice(0, 2).join(" ")).join(" | "));
  if (!/Rs [1-9]/.test(tiles[0])) throw new Error("no labour cost");
  await p.locator(".money-note >> text=at standard rates").waitFor();
  await card.getByRole("button", { name: "Close" }).click();
  await p.screenshot({ path: out + "/rupees-overview.png" });

  // Activities in rupees: cost columns, sorted by cost
  await p.getByRole("tab", { name: "Activities" }).click();
  await p.locator("th >> text=Cost (Rs)").waitFor();
  await p.locator("th >> text=OT premium (Rs)").waitFor();
  await p.locator(".analysis .card").filter({ hasText: "Labour cost by activity code" }).screenshot({ path: out + "/rupees-activities.png" });

  // export carries the cost
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Export to Excel" }).click()]);
  console.log("export:", dl.suggestedFilename());

  // back to hours: no rupees on screen
  await p.getByRole("group", { name: "Show hours or rupees" }).getByRole("button", { name: "Hours", exact: true }).click();
  if (await p.locator("th >> text=Cost (Rs)").count()) throw new Error("cost columns in hours mode");

  await p.evaluate(async () => fetch("/api/setup/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trades: {} }) }));
  console.log("rupees e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
