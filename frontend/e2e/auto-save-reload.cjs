// Automatic save and reload: after a push the workbook is saved by itself (switch beside "Save
// Excel file"); a change made in the workbook behind the page's back (as if typed in Excel)
// shows up by itself within 2 minutes (switch beside "Reload from Excel"). The page's clock is
// fast-forwarded (no real waiting). Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/auto-save-reload.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.clock.install();
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.removeItem("labour.auto.save"); localStorage.removeItem("labour.auto.reload"); });
  await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "14", exact: true }).click();
  const status = async () => (await (await p.request.get(BASE + "api/status")).json());

  // a push: saved by itself a few seconds later
  await p.locator("#worker").fill("AAA-07"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("03-11-00-00-P"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelector(".queue tbody")?.innerText.includes("AAA-07"));
  await p.clock.runFor(1000);
  await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled, null, { timeout: 20000 });
  await p.locator(".push-bar button").click();
  await p.getByLabel("Supervisor", { exact: true }).fill("Demo Supervisor"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => !document.querySelector(".queue tbody tr"), null, { timeout: 30000 });
  if (!(await status()).unsaved_changes) throw new Error("the push should leave unsaved changes first");
  await p.clock.runFor(10_000); // status poll + the auto-save delay
  await p.locator(".saved-note", { hasText: "Saved" }).waitFor({ timeout: 15000 });
  console.log("after the push:", (await p.locator(".statusbar").innerText()).match(/✓ Saved [^\n]*/)?.[0], "| unsaved:", (await status()).unsaved_changes);
  if ((await status()).unsaved_changes) throw new Error("not saved by itself");

  // switched off: a push stays unsaved
  await p.getByLabel("Auto-save").uncheck();
  await p.request.post(BASE + "api/entries", { data: { user: "Tester", entries: [{ sheet: "14", calling_name: "AAA-08", time_in: 7, time_out: 19, activities: [{ code: "03-11-00-00-P", hours: 11 }], acknowledged: ["W03", "W01", "W02"] }] } });
  await p.clock.runFor(15_000);
  await p.locator(".badge.warn", { hasText: "Not saved in Excel yet" }).waitFor({ timeout: 15000 });
  console.log("auto-save off: stays unsaved: yes");
  await p.getByLabel("Auto-save").check();
  await p.clock.runFor(10_000);
  await p.waitForFunction(async () => !(await (await fetch("/api/status")).json()).unsaved_changes, null, { timeout: 15000 });

  // changed "in Excel" (written behind the page's back): shows up by itself within 2 minutes
  const before = await p.locator(".day-bar, .daybar, body").first().innerText();
  const n0 = Number((await p.locator("text=/Sheet 14 · \\d+ entered/").first().innerText()).match(/(\d+) entered/)[1]);
  await p.request.post(BASE + "api/entries", { data: { user: "Someone else", entries: [{ sheet: "14", calling_name: "AAA-09", time_in: 7, time_out: 19, activities: [{ code: "03-11-00-00-P", hours: 11 }], acknowledged: ["W03", "W01", "W02"] }] } });
  await p.clock.runFor(125_000);
  await p.waitForFunction((n) => { const m = document.body.innerText.match(/Sheet 14 · (\d+) entered/); return m && Number(m[1]) > n; }, n0, { timeout: 20000 });
  const n1 = Number((await p.locator("text=/Sheet 14 · \\d+ entered/").first().innerText()).match(/(\d+) entered/)[1]);
  console.log(`read again by itself: ${n0} -> ${n1} entered |`, (await p.locator(".auto-switch", { hasText: "Auto" }).last().innerText()).trim());
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/auto.png` });
  if (errs.length) throw new Error(errs.join("\n"));
  void before;
  await b.close();
  console.log("auto-save-reload e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
