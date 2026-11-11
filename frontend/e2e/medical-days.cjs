// Medical leave for any number of days (as the report says): presets and a typed number.
// Made-up data:  cd backend && python ../scripts/demo_two_books.py   then  node e2e/medical-days.cjs [shots]
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
  await p.getByRole("tab", { name: "10", exact: true }).click();
  await p.getByRole("button", { name: /Medical leave/ }).click();
  await p.locator("#med-worker").fill("AAA-03");
  const rows = () => p.locator(".medical-plan tbody tr").count();
  const hint = () => p.locator(".med-days small").innerText();
  for (const n of [14, 2, 20]) {
    await p.locator(".med-presets").getByRole("button", { name: String(n), exact: true }).click();
    await p.waitForFunction((k) => document.querySelectorAll(".medical-plan tbody tr").length + 0 > 0 && document.querySelector("#med-days").value === String(k), n);
    await p.waitForTimeout(500);
    console.log(`${n} days → ${await rows()} sheets this month | ${await hint()}`);
  }
  await p.locator("#med-days").fill("25");
  await p.waitForTimeout(700);
  console.log(`25 typed → ${await rows()} sheets | ${await hint()}`);
  if (!/next month/.test(await hint())) throw new Error("25 working days from the 10th should run into next month");
  await p.screenshot({ path: `${out}/medical-days.png` });
  await p.locator("#med-days").fill("0");
  await p.waitForTimeout(400);
  if (!/1 to 90/.test(await hint())) throw new Error("0 days should say 1 to 90");
  console.log("medical-days e2e: ok; errors:", errs);
  await b.close();
})().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
