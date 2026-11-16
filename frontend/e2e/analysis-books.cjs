// Analysis, advanced mode: another open workbook of the same month analysed together with this
// one; the BP bill check by business partner and workbook; the Workbook filter. Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/analysis-books.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.removeItem("labour.analysis.combine"); localStorage.setItem("labour.analysis.view", "bp"); });
  await p.reload(); await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 60000 });
  const before = await p.locator(".bp-card").count();

  // pick DEMO C too
  await p.getByRole("button", { name: /Workbooks: this one/ }).click();
  const box = p.getByLabel(/Analyse .*DEMO C/);
  await box.check();
  await p.waitForFunction(() => /2 workbooks/.test(document.querySelector(".analysis h2")?.textContent ?? ""), null, { timeout: 60000 });
  await p.getByRole("button", { name: "Close" }).first().click();
  console.log("heading:", await p.locator(".analysis h2").first().innerText());
  console.log("note:", (await p.locator(".combined-note").innerText()).slice(0, 120));

  // BP bill check: the matrix by business partner and workbook
  await p.locator(".bp-matrix").waitFor();
  const heads = await p.locator(".bp-matrix thead th").allInnerTexts();
  console.log("matrix columns:", heads.join(" | "));
  if (!heads.some((h) => /DEMO A/.test(h)) || !heads.some((h) => /DEMO C/.test(h))) throw new Error("both workbooks should be columns");
  const rows = await p.locator(".bp-matrix tbody tr").allInnerTexts();
  console.log("matrix rows:", rows.map((r) => r.replace(/\s+/g, " ")).join(" | "));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/analysis-books.png`, fullPage: false });

  // the Workbook filter: one of them again
  await p.getByLabel("Workbook filter").selectOption({ label: await p.getByLabel("Workbook filter").locator("option").nth(2).textContent() });
  await p.locator(".filter-chips >> text=Workbook").waitFor();
  console.log("filtered to:", (await p.locator(".filter-chips .chip").first().innerText()).replace(/\s*✕/, ""));

  // only this one again: back to one workbook
  await p.getByRole("button", { name: /Workbooks: 2/ }).click();
  await p.getByRole("button", { name: "Only this one" }).click();
  await p.waitForFunction(() => !/workbooks/.test(document.querySelector(".analysis h2")?.textContent ?? ""));
  if (await p.locator(".bp-matrix").count()) throw new Error("matrix should go with one workbook");
  console.log("back to one workbook: yes (cards before:", before, ")");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("analysis-books e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
