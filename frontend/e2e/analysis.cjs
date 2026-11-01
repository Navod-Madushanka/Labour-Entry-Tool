// Analysis tab on made-up data: every view renders, filters narrow the figures, export gives an
// .xlsx, and no page errors. Screenshots go to the scratchpad given in SHOTS (never committed).
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/analysis.cjs
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.env.SHOTS;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.removeItem("labour.analysis.view"); });
  await p.goto(BASE + "#analysis"); await p.reload();
  await p.waitForSelector(".analysis .kpi");
  await p.waitForFunction(() => !document.querySelector(".analysis p.muted")?.textContent.includes("still loading"), null, { timeout: 60000 });
  const kpi = async () => p.$$eval(".kpi", (ks) => Object.fromEntries(ks.map((k) => [k.querySelector(".kpi-label").textContent, k.querySelector(".kpi-value").textContent])));
  const all = await kpi();
  console.log("overview:", JSON.stringify(all));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/analysis-overview.png`, fullPage: true });

  for (const name of ["Activities", "Places & trades", "Daily manpower", "Task timeline", "Overtime", "Attendance", "Data quality", "Compare months"]) {
    await p.getByRole("tab", { name, exact: true }).click();
    await p.waitForTimeout(150);
    const rows = await p.$$eval(".analysis table tbody tr", (r) => r.length);
    const svgs = await p.$$eval(".analysis svg rect", (r) => r.length);
    console.log(`${name}: ${rows} table rows, ${svgs} bars`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/analysis-${name.replace(/\W+/g, "-").toLowerCase()}.png`, fullPage: true });
  }

  // drill down: a code row opens its trades; the filter button narrows everything
  await p.getByRole("tab", { name: "Activities", exact: true }).click();
  await p.locator(".analysis table.data tbody tr.clickable").first().click();
  const detail = await p.locator(".detail-row").innerText();
  console.log("first code by trade:", detail.replace(/\s+/g, " ").slice(0, 120));
  await p.getByRole("button", { name: "Filter by this activity" }).click();
  await p.getByRole("tab", { name: "Overview", exact: true }).click();
  const one = await kpi();
  console.log("filtered to one code:", JSON.stringify(one));
  if (Number(one["hours worked"].replace(/,/g, "")) >= Number(all["hours worked"].replace(/,/g, ""))) throw new Error("filter did not narrow");
  await p.getByRole("button", { name: "Clear filters" }).click();
  if ((await kpi())["hours worked"] !== all["hours worked"]) throw new Error("clear filters did not restore");

  // export
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Export to Excel" }).click()]);
  const file = await dl.path();
  const size = fs.statSync(file).size;
  console.log("export:", dl.suggestedFilename(), size, "bytes");
  if (size < 3000 || fs.readFileSync(file).subarray(0, 2).toString() !== "PK") throw new Error("not an xlsx");
  if (SHOTS) fs.copyFileSync(file, `${SHOTS}/${dl.suggestedFilename()}`);

  // a small screen still works
  await p.setViewportSize({ width: 390, height: 800 });
  await p.getByRole("tab", { name: "Overview", exact: true }).click();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log("phone width overflow px:", overflow);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/analysis-phone.png`, fullPage: true });
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("analysis e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
