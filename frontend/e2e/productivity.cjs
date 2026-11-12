// Productivity and unit cost (roadmap #6): weekly quantities for a code with its unit and norm,
// hours per unit, the index against the norm, Rs per unit with rates, and the measured mile with a
// disrupted day. Made-up data:  cd backend && python ../scripts/demo_two_books.py 8012 big
//   node e2e/productivity.cjs [shots]
const { chromium } = require("playwright");
const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.setItem("labour.analysis.money", "1"); });
  await p.reload();
  await p.waitForSelector("#worker");
  const post = (u, body) => p.evaluate(async ([u, body]) => (await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, [u, body]);
  // a rainy day and a standard rate (both made up)
  await post("/api/lost-time", { user: "Tester", sheet: "8", causes: ["rain"] });
  const trades = await p.evaluate(async () => [...new Set((await (await fetch("/api/master")).json()).workers.map((w) => w.trade_group))]);
  await post("/api/setup/rates", { trades: Object.fromEntries(trades.map((t) => [t, 3000])) });
  await p.reload(); await p.waitForSelector("#worker");

  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 90000 });
  await p.getByRole("tab", { name: "Productivity" }).click();

  // add the code with most hours, its unit and norm, and a quantity for every week
  const pick = p.getByLabel("Add a code");
  const code = await pick.evaluate((s) => s.options[1].value);
  await pick.selectOption(code);
  await p.getByRole("button", { name: "Add", exact: true }).click();
  await p.getByLabel(`Unit of ${code}`).fill("m3");
  await p.getByLabel(`Norm of ${code}`).fill("4");
  await p.getByLabel(`Norm source of ${code}`).selectOption("BSR");
  const boxes = p.locator(`input[aria-label^="Quantity of ${code}, days"]`);
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).fill(String(40 + 5 * i));
  await p.getByRole("button", { name: "Save quantities" }).click();
  await p.locator(".qty-editor >> text=Saved.").waitFor();

  const readout = await p.locator(".prod-readout").innerText();
  console.log("code:", code, "| weeks:", n);
  console.log("read-out:", readout.replace(/\s+/g, " "));
  if (!/index \d/.test(readout) || !/Rs [\d,]+ per m3/.test(readout)) throw new Error("no index or Rs per unit");
  const row = await p.locator("table tbody tr.clickable").first().innerText();
  console.log("row:", row.replace(/\s+/g, " "));
  await p.locator("table tbody tr.clickable").first().click();
  await p.locator(".prod-weeks").waitFor();
  const mile = await p.locator(".card", { hasText: "Measured mile" }).innerText().catch(() => "(no measured mile)");
  console.log("measured mile:", mile.split("\n").slice(1, 4).join(" | "));
  await p.locator(".analysis").screenshot({ path: out + "/productivity.png" });

  const master = await p.evaluate(async () => (await (await fetch("/api/master")).json()));
  console.log("saved:", JSON.stringify(master.units), JSON.stringify(master.norms));
  // put things back
  await post("/api/setup/quantities", { quantities: {}, units: {}, norms: {} });
  await post("/api/setup/rates", { trades: {} });
  await post("/api/lost-time", { user: "Tester", sheet: "8", causes: [] });
  console.log("productivity e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
