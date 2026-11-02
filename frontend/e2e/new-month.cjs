// "Start the next month": a folder named after the month, a copy with the name typed, only the
// entries cleared, opened in the tool. Made-up practice workbooks only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/new-month.cjs [screenshot-dir]
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.locator(".book-current").click();
  await p.getByRole("menuitem", { name: /Start the next month/ }).click();
  await p.waitForSelector(".new-month input[type=month]");
  await p.waitForFunction(() => document.querySelector(".new-month input[type=month]").value !== "");
  const month = await p.locator(".new-month input[type=month]").inputValue();
  const folder = await p.getByLabel(/Folder/).inputValue();
  const name = await p.getByLabel("File name").inputValue();
  console.log("suggested:", month, "|", folder, "|", name);
  if (month !== "2026-11" || !folder.endsWith("November 2026") || !name.includes("November 2026")) throw new Error("bad defaults");
  await p.getByLabel("File name").fill("Labour Entry Sheet November 2026 - DEMO A (test)");
  await p.getByLabel(/Folder/).click(); // blur the name -> preview again
  if (SHOTS) await p.locator(".new-month").screenshot({ path: `${SHOTS}/new-month.png` });
  await p.getByRole("button", { name: /Create November 2026/ }).click();
  await p.waitForSelector(".new-month .ok-text", { timeout: 60000 });
  const done = (await p.locator(".new-month").innerText()).replace(/\s+/g, " ");
  console.log("done:", done.slice(0, 260));
  const path = done.match(/✓ (.+?\.json) is ready/)[1];
  const snap = JSON.parse(fs.readFileSync(path, "utf8"));
  const entries = snap.days.reduce((s, d) => s + (d.entries || []).length, 0);
  console.log("new file:", path, "| entries:", entries, "| workers:", snap.master.workers.length, "| day 1:", snap.days[0].header.date, snap.days[0].header.day_type);
  if (entries !== 0 || !snap.master.workers.length || snap.days[0].header.date !== "2026-11-01") throw new Error("new file not right");
  await p.getByRole("button", { name: "Work on the new month" }).click();
  await p.waitForFunction(() => document.body.innerText.includes("November 2026 - DEMO A (test)"));
  console.log("now open:", (await p.locator("body").innerText()).match(/Labour Entry Sheet November 2026 - DEMO A \(test\)\.json/)?.[0]);
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("new-month e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
