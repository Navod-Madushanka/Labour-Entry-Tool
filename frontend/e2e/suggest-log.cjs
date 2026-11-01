// The suggestion log: adding an entry writes a line (on this PC), and Analysis → Suggestions
// shows it. Made-up data only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/suggest-log.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const before = await (await p.request.get(BASE + "api/suggest-log/summary?days=1")).json();
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "7", exact: true }).click();
  await p.locator("#worker").click();
  await p.keyboard.type(process.env.WORKER || "AAA-01"); await p.keyboard.press("Enter");
  await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Activity 1" || document.activeElement?.id === "worker");
  if (await p.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Activity 1")) {
    await p.keyboard.press("Enter"); // take the suggested code
    await p.waitForSelector('input[aria-label="Activity 2"]:focus');
    await p.keyboard.press("Enter"); // add
  }
  await p.waitForSelector(".queue tbody tr");
  await p.waitForTimeout(500);
  const after = await (await p.request.get(BASE + "api/suggest-log/summary?days=1")).json();
  console.log("entries logged:", before.entries, "->", after.entries, "| keys per entry", after.keys_per_entry, "| time", JSON.stringify(after.time.tiers), "| code", JSON.stringify(after.code.tiers));
  if (after.entries !== before.entries + 1) throw new Error("no log line");
  await p.goto(BASE + "#analysis");
  await p.getByRole("tab", { name: "Suggestions", exact: true }).click();
  await p.waitForSelector(".kpi");
  console.log("analysis shows:", (await p.locator(".kpis").innerText()).replace(/\s+/g, " "));
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("suggest-log e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
