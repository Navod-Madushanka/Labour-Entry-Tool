// What each activity code is: MasterFormat titles shown beside codes, the office's own wins.
// Made-up data:  cd backend && python ../scripts/demo_two_books.py   then  node e2e/descriptions.cjs [shots]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");

  // the standard title, before anything is typed
  const master = await p.evaluate(async () => (await (await fetch("/api/master")).json()).descriptions);
  if (master["03-11-00-00-P"] !== "Concrete Forming") throw new Error("no standard title: " + JSON.stringify(master));

  // the office's own description on the Trades, places & activity codes tab
  await p.goto(BASE + "#codes/places");
  const box = p.getByLabel("Description of 03-11-00-00-P");
  await box.waitFor();
  if ((await box.getAttribute("placeholder")) !== "Concrete Forming") throw new Error("placeholder is not the standard title");
  await box.fill("Formwork to parking slabs");
  await p.getByRole("button", { name: /^Save 1 description$/ }).click();
  await p.locator(".desc-card >> text=Saved 1 description").waitFor();
  await p.screenshot({ path: out + "/descriptions-editor.png", fullPage: false });

  // the entry screen: shown under the activity box and on the manpower sheet's Description column
  await p.goto(BASE + "#");
  await p.waitForSelector("#worker");
  await p.locator("#worker").fill("AAA-01"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.keyboard.type("03-11-00-00-P");
  await p.locator(".hint.place", { hasText: "Formwork to parking slabs" }).first().waitFor();
  await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  await p.locator(".mp-desc", { hasText: "Formwork to parking slabs" }).first().waitFor();
  console.log("manpower description:", await p.locator(".mp-desc", { hasText: "Formwork" }).first().innerText());

  // Analysis: plain words, and the description beside the code
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.getByRole("tab", { name: "Overview" }).click();
  await p.locator(".kpi-label", { hasText: "unallocated hours (ZIDLE)" }).waitFor();
  await p.getByRole("tab", { name: "Activities" }).click();
  const row = await p.locator("table tbody tr", { hasText: "03-20-00-00-C-8" }).first().innerText();
  if (!row.includes("Concrete Reinforcing")) throw new Error("no description in Activities: " + row);
  await p.screenshot({ path: out + "/descriptions-analysis.png", fullPage: false });

  // put it back for the next run
  await p.evaluate(async () => fetch("/api/setup/descriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ descriptions: { "03-11-00-00-P": "" } }) }));
  console.log("descriptions e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
