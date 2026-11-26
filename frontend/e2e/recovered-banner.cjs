// Working on Excel's recovered copy ("… (AutoRecovered).xlsb"): a banner on every page says so,
// where pushes and saves go, and what to do. The status is faked here (page.route). Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/recovered-banner.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 500 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let fake = { mode: "live", recovered_copy: true, workbook: "Labour Entry Sheet November 2026 - Demo(AutoRecovered).xlsb", file_path: "C:\\\\Users\\\\clerk\\\\AppData\\\\Roaming\\\\Microsoft\\\\Excel\\\\Labour Entry Sheet November 2026 - Demo(AutoRecovered).xlsb" };
  await p.route("**/api/status", async (r) => { const res = await r.fetch(); r.fulfill({ json: { ...(await res.json()), ...fake } }); });
  await p.goto(BASE); await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  const banner = p.locator(".recovered-banner");
  await banner.waitFor();
  const text = (await banner.innerText()).replace(/\s+/g, " ");
  console.log("banner:", text.slice(0, 220));
  if (!/recovered copy/.test(text) || !/AppData/.test(text) || !/Save As/.test(text)) throw new Error("banner text");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/recovered-banner.png` });
  await p.getByRole("link", { name: "Analysis" }).click();
  await banner.waitFor(); // every page
  // the normal workbook file: no banner
  fake = { mode: "live", recovered_copy: false, workbook: "Labour Entry Sheet November 2026 - Demo.xlsb", file_path: "C:\\\\Labour\\\\Labour Entry Sheet November 2026 - Demo.xlsb" };
  await p.reload(); await p.waitForSelector(".analysis, #worker");
  await p.waitForTimeout(1000);
  if (await banner.count()) throw new Error("no banner for the normal file");
  console.log("normal file: no banner");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("recovered-banner e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
