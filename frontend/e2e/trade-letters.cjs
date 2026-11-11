// A worker's trade comes from the calling name's letter, else Labour Detail's trade column.
// Made-up data:  cd backend && python ../scripts/demo_two_books.py   then  node e2e/trade-letters.cjs [shots]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector('input[aria-label="Activity 1"]', { timeout: 15000 });
  const master = async () => (await (await p.request.get(BASE + "api/master")).json()).workers;
  const before = (await master()).find((w) => w.calling_name === "AAA-01");
  console.log("AAA-01 before:", before.trade_group, "from", before.trade_source);
  if (before.trade_source !== "column") throw new Error("A is not a known letter: the column should decide");

  await p.getByRole("link", { name: "Codes & registration" }).click();
  const card = p.locator(".trade-letters");
  await card.waitFor();
  await card.locator("text=Letters in Labour Detail with no trade here").waitFor();
  console.log("hint:", (await card.locator(".warn-text").innerText()).replace(/\s+/g, " "));
  const rows = card.locator("tbody tr");
  const last = rows.nth((await rows.count()) - 1); // the empty row (typing in it adds the next one)
  await last.locator("input").first().fill("A");
  await last.locator("input").nth(1).fill("Shuttering Carpenter");
  await card.getByRole("button", { name: "Save trades" }).click();
  await card.locator("text=Saved.").waitFor();
  await p.screenshot({ path: `${out}/trade-letters.png`, fullPage: false });
  const after = (await master()).find((w) => w.calling_name === "AAA-01");
  console.log("AAA-01 after:", after.trade_group, "from", after.trade_source, "| column:", after.trade_column);
  if (after.trade_group !== "Shuttering Carpenter" || after.trade_source !== "name") throw new Error("the letter did not win");

  await p.getByRole("link", { name: "Analysis" }).click();
  await p.getByRole("tab", { name: "Places & trades" }).click();
  await p.waitForTimeout(1500); console.log("TRADES CARD:", (await p.locator(".analysis .card", { hasText: "Hours by trade" }).innerText()).replace(/\s+/g, " ").slice(0, 300));
  await p.locator(".analysis table >> text=Shuttering Carpenter").first().waitFor();
  console.log("analysis shows the trade from the letter");

  // back to the tool's list: A is unknown again, the column decides
  await p.getByRole("link", { name: "Codes & registration" }).click();
  await p.locator(".trade-letters").getByRole("button", { name: "Back to the tool's list" }).click();
  await p.locator(".trade-letters >> text=Saved.").waitFor();
  const back = (await master()).find((w) => w.calling_name === "AAA-01");
  if (back.trade_source !== "column") throw new Error("defaults not restored");
  console.log("trade-letters e2e: ok; errors:", errs);
  await b.close();
})().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
