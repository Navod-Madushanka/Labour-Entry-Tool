// Supervisors page: a supervisor's sheet opened there can be edited in place ("Edit this sheet"
// puts it on the manpower sheet under the list), changed and pushed again; it stays that
// supervisor's sheet. Made-up data:
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/supervisor-edit.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.removeItem("labour.askSupervisor"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload(); await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "6", exact: true }).click();
  const add = async (name) => {
    await p.locator("#worker").fill(name); await p.keyboard.press("Enter");
    await p.keyboard.press("Control+a"); await p.keyboard.type("7"); await p.keyboard.press("Enter");
    await p.keyboard.press("Control+a"); await p.keyboard.type("19"); await p.keyboard.press("Enter");
    await p.keyboard.press("Control+a"); await p.keyboard.type("03-11-00-00-P"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    await p.waitForFunction((n) => document.querySelector(".queue tbody")?.innerText.includes(n), name);
  };
  await add("AAA-01"); await add("AAA-02");
  await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled, null, { timeout: 20000 });
  await p.locator(".push-bar button").click();
  const dlg = p.getByRole("dialog", { name: "Whose manpower sheet is this?" }); await dlg.waitFor();
  await p.getByLabel("Supervisor", { exact: true }).fill("Kamal Perera");
  await dlg.getByRole("button", { name: /^Push 2 entries for Kamal Perera$/ }).click();
  await p.waitForFunction(() => !document.querySelector(".queue tbody tr"), null, { timeout: 30000 });

  await p.getByRole("link", { name: "Supervisors" }).click();
  await p.waitForSelector("table.sup-index tbody tr");
  await p.locator('select[aria-label="Day"]').selectOption("6");
  await p.locator('.mp-day[data-sheet="6"]').waitFor();
  if (await p.locator("#sup-manpower").count()) throw new Error("no editor before Edit");
  await p.getByRole("button", { name: "✎ Edit this sheet" }).click();
  await p.locator("#sup-manpower .manpower").first().waitFor();
  const btn = await p.getByRole("button", { name: "✎ Being edited below" }).count();
  console.log("on the manpower sheet here:", await p.locator("#sup-manpower").isVisible(), "| button now says being edited:", btn === 1);
  if (!btn) throw new Error("the button should say the sheet is being edited");
  // change AAA-02's time out to 17:00 on the sheet
  await p.locator("#sup-manpower").getByRole("button", { name: "Change AAA-02 Time Out" }).click();
  await p.keyboard.press("Control+a"); await p.keyboard.type("17"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => !document.querySelector("#sup-manpower .push-bar button")?.disabled, null, { timeout: 20000 });
  if (SHOTS) await p.locator("#sup-manpower").screenshot({ path: `${SHOTS}/supervisor-edit.png` });
  await p.locator("#sup-manpower .push-bar button").click();
  const dlg2 = p.getByRole("dialog", { name: "Whose manpower sheet is this?" }); await dlg2.waitFor();
  await dlg2.getByRole("button", { name: /^Push/ }).first().click();
  await p.waitForFunction(() => !document.querySelector("#sup-manpower .manpower"), null, { timeout: 30000 });
  const day = await (await p.request.get(BASE + "api/days/6")).json();
  const out = day.entries.find((e) => e.entry.calling_name === "AAA-02").entry.time_out;
  const one = day.entries.find((e) => e.entry.calling_name === "AAA-01").entry.time_out;
  const owners = await (await p.request.get(BASE + "api/supervisor-sheets")).json();
  const sups = owners.filter((o) => o.sheet === "6").map((o) => `${o.calling_name}:${o.supervisor}`);
  console.log("AAA-02 out:", out, "| AAA-01 out:", one, "| owners:", sups.join(", "));
  if (out !== 17 || one !== 19) throw new Error("the edit should be in Excel, the rest unchanged");
  if (!sups.includes("AAA-02:Kamal Perera") || !sups.includes("AAA-01:Kamal Perera")) throw new Error("still Kamal's sheet");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("supervisor-edit e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
