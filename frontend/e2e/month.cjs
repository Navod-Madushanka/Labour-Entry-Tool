// The month of a workbook: asked on the start page (the guess filled in), changeable later from
// the workbook menu; the sheets are then checked against it and "Fix all" sets the dates and day
// types. Made-up data only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/month.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  // from the workbook menu
  await p.locator(".book-current").click();
  await p.getByRole("menuitem", { name: /Change the month/ }).click();
  await p.waitForSelector(".month-card");
  console.log("card:", (await p.locator(".month-card h2").innerText()));
  await p.getByLabel("Month of this workbook").fill("2026-11");
  if (SHOTS) await p.locator(".month-card").screenshot({ path: `${SHOTS}/month-card.png` });
  await p.getByRole("button", { name: /November 2026/ }).click();
  await p.waitForSelector("text=Sheet dates and day types: the tool can fix these", { timeout: 60000 });
  const fixAll = p.getByRole("button", { name: /^Fix all \d+ sheets/ });
  console.log("offered:", await fixAll.innerText(), "|", (await p.locator(".chosen").innerText()).split("·")[1].trim());
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/month-fix.png`, fullPage: false });
  await fixAll.click();
  await p.waitForFunction(() => !document.body.innerText.includes("Sheet dates and day types: the tool can fix these"), null, { timeout: 60000 });
  await p.getByRole("button", { name: /^Continue/ }).click();
  await p.getByRole("button", { name: /Start entering data|Start anyway/ }).click();
  await p.waitForSelector("#worker");
  const day1 = await (await p.request.get(BASE + "api/days/1")).json();
  console.log("sheet 1 now:", day1.header.date, day1.header.day_type);
  if (day1.header.date !== "2026-11-01" || day1.header.day_type !== "Sunday") throw new Error("sheet 1 not set for November");
  const setup = await (await p.request.get(BASE + "api/setup")).json();
  console.log("month:", setup.month, "confirmed:", setup.month_confirmed, "source:", setup.month_source);
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("month e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
