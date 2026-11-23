// "Ask supervisor at push" (tick beside Reload from Excel): off, Push writes at once with no
// supervisor and no dialog; remembered after a reload; on again, the dialog asks. Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/ask-supervisor.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.removeItem("labour.askSupervisor"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload(); await p.waitForSelector("#worker");
  const tick = p.getByLabel("Ask supervisor at push");
  if (!(await tick.isChecked())) throw new Error("on by default (as before)");
  const add = async (name) => {
    await p.locator("#worker").fill(name); await p.keyboard.press("Enter");
    await p.keyboard.press("Control+a"); await p.keyboard.type("7"); await p.keyboard.press("Enter");
    await p.keyboard.press("Control+a"); await p.keyboard.type("19"); await p.keyboard.press("Enter");
    await p.keyboard.press("Control+a"); await p.keyboard.type("03-11-00-00-P"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    await p.waitForFunction((n) => document.querySelector(".queue tbody")?.innerText.includes(n), name);
    await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled, null, { timeout: 20000 });
  };
  await p.getByRole("tab", { name: "20", exact: true }).click();
  // off: Push writes at once
  await tick.uncheck();
  if (SHOTS) await p.locator(".day-bar, .daybar").first().screenshot({ path: `${SHOTS}/ask-supervisor.png` }).catch(() => {});
  await add("AAA-02");
  await p.locator(".push-bar button").click();
  await p.waitForFunction(() => !document.querySelector(".queue tbody tr"), null, { timeout: 30000 });
  const dialogShown = await p.getByRole("dialog", { name: "Whose manpower sheet is this?" }).count();
  const inExcel = (await (await p.request.get(BASE + "api/days/20")).json()).entries.some((e) => e.entry.calling_name === "AAA-02" && e.entry.time_in === 7);
  const owners = await (await p.request.get(BASE + "api/supervisor-sheets")).json();
  console.log("off: dialog shown:", dialogShown, "| written:", inExcel, "| supervisor recorded:", owners.some((o) => o.calling_name === "AAA-02"));
  if (dialogShown || !inExcel || owners.some((o) => o.calling_name === "AAA-02")) throw new Error("off: should push at once with no supervisor");
  // remembered after a reload
  await p.reload(); await p.waitForSelector("#worker");
  if (await p.getByLabel("Ask supervisor at push").isChecked()) throw new Error("the choice should be remembered");
  console.log("remembered after reload: yes");
  // on again: the dialog asks
  await p.getByLabel("Ask supervisor at push").check();
  await p.getByRole("tab", { name: "20", exact: true }).click();
  await add("AAA-03");
  await p.locator(".push-bar button").click();
  await p.getByRole("dialog", { name: "Whose manpower sheet is this?" }).waitFor();
  console.log("on: the dialog asks: yes");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("ask-supervisor e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
