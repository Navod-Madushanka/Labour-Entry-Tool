// Recover pushed entries: the banner when the open file misses pushes (save tracking), the
// Recover dialog listing lost entries (from the change log), and "Put back on the manpower sheet".
// The recovery answer and the status are faked here (page.route); the comparison itself is tested
// on the server (tests/test_recovery.py). Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/recovery.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const entry = (name, sheet, out) => ({ sheet, calling_name: name, time_in: 7, time_out: out, activities: [{ code: "03-11-00-00-P", hours: out - 8 }], additional: null, remark: null, overwrite: false, acknowledged: [] });
  const lost = [
    { sheet: "12", calling_name: "AAA-04", pushed_at: "2026-10-12T09:10:00+05:30", user: "Tester", batch_id: 7, what: "07:00–19:00 · 03-11-00-00-P 11", input: entry("AAA-04", "12", 19) },
    { sheet: "13", calling_name: "AAA-05", pushed_at: "2026-10-13T09:12:00+05:30", user: "Tester", batch_id: 9, what: "07:00–18:00 · 03-11-00-00-P 10", input: entry("AAA-05", "13", 18) },
  ];
  await p.route("**/api/recovery", (r) => r.fulfill({ json: { workbook: "Labour Entry Sheet October 2026 - DEMO A.json", pushes: 14, entries: 30, present: 27, lost, changed: [{ sheet: "11", calling_name: "AAA-06", pushed_at: "2026-10-11T08:00:00+05:30", why: "changed in Excel since the push" }], other_names: ["Labour Entry Sheet October 2026 - DEMO A(AutoRecovered).json"] } }));
  await p.route("**/api/status", async (r) => { const res = await r.fetch(); r.fulfill({ json: { ...(await res.json()), missing_pushes: { count: 9, first: "2026-10-12T09:10:00+05:30", last: "2026-10-20T17:29:00+05:30", saved_at: "2026-10-11T18:00:00+05:30" } } }); });
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload(); await p.waitForSelector("#worker");
  const banner = p.locator(".missing-banner");
  await banner.waitFor();
  console.log("banner:", (await banner.innerText()).replace(/\s+/g, " ").slice(0, 160));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/recovery-banner.png` });
  await banner.getByRole("button", { name: "Check and recover" }).click();
  const dlg = p.getByRole("dialog", { name: "Recover pushed entries" });
  await dlg.locator(".recovery-sum").waitFor();
  console.log("summary:", (await dlg.locator(".recovery-sum").innerText()).replace(/\s+/g, " "));
  if (!(await dlg.innerText()).includes("(AutoRecovered)")) throw new Error("the other name should be said");
  if (SHOTS) await dlg.screenshot({ path: `${SHOTS}/recovery-dialog.png` });
  // untick one, put the other back
  await dlg.getByLabel("Recover AAA-05 on sheet 13").uncheck();
  await dlg.getByRole("button", { name: "Put 1 entry back on the manpower sheet" }).click();
  await p.waitForFunction(() => document.querySelector(".queue tbody")?.innerText.includes("AAA-04"));
  const rows = await p.locator(".queue tbody tr").allInnerTexts();
  console.log("waiting now:", rows.map((r) => r.replace(/\s+/g, " ").slice(0, 60)).join(" | "));
  if (rows.length !== 1 || !rows[0].includes("AAA-04")) throw new Error("only AAA-04 should be back");
  // the Recover… link in the status bar opens it too
  await p.getByRole("button", { name: "Recover…" }).click();
  await dlg.locator(".recovery-sum").waitFor();
  if (!(await dlg.getByLabel("Recover AAA-04 on sheet 12").isChecked() === false)) throw new Error("already waiting: not ticked again");
  console.log("Recover… link opens it; the entry already waiting is not ticked again: yes");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("recovery e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
