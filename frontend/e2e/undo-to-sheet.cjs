// Undo puts the undone entries back on the manpower sheet: edit and push again, or discard the
// sheet. Made-up data.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/undo-to-sheet.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const asked = []; p.on('dialog', d => { asked.push(d.message()); d.accept(); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.locator("#worker").waitFor();
  await p.getByRole('tab', { name: '12', exact: true }).click();
  const rows = () => p.evaluate(() => document.querySelectorAll('.queue tbody tr').length);
  const add = async (name, out) => {
    await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
    await p.keyboard.press('Control+a'); await p.keyboard.type('7'); await p.keyboard.press('Enter');
    await p.keyboard.press('Control+a'); await p.keyboard.type(out); await p.keyboard.press('Enter');
    await p.keyboard.press('Control+a'); await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.waitForFunction((n) => document.querySelector('.queue tbody')?.innerText.includes(n), name);
  };
  const push = async () => {
    await p.waitForFunction(() => !document.querySelector('.queue tbody')?.innerText.includes("checking"));
    for (const btn of await p.locator('.queue button', { hasText: /^✓ / }).all()) await btn.click().catch(() => {});
    await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled, null, { timeout: 20000 });
    await p.locator('.push-bar button').click();
    await p.getByLabel("Supervisor", { exact: true }).fill("Demo Supervisor"); await p.keyboard.press("Enter");
    await p.waitForFunction(() => !document.querySelector('.queue tbody tr'), null, { timeout: 30000 });
  };
  for (const n of ["AAA-05", "AAA-06"]) await add(n, '19');
  await push();
  console.log("pushed, waiting:", await rows());

  // Undo from the recent writes: both come back to the manpower sheet
  await p.locator(".batches li", { hasText: "write" }).first().getByRole("button", { name: "Undo" }).click();
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length === 2, null, { timeout: 30000 });
  console.log("asked:", asked[asked.length - 1].includes("back onto the manpower sheet"));
  const toast = await p.locator(".toast").innerText();
  console.log("message:", toast.split("\n")[0]);
  if (!/2 entries are back on the manpower sheet/.test(toast)) throw new Error("no message about the entries");
  const day = await p.evaluate(async () => (await (await fetch("/api/days/12")).json()).entries.filter((e) => ["AAA-05", "AAA-06"].includes(e.entry.calling_name) && e.entry.time_in !== null).length);
  if (day) throw new Error("undo should have taken them out of Excel");

  // edit one (re-add AAA-05 with another Out time), push again: back in Excel with the new time
  await add("AAA-05", '18');
  if (await rows() !== 2) throw new Error("the edit should replace the waiting entry");
  await push();
  const out = await p.evaluate(async () => (await (await fetch("/api/days/12")).json()).entries.find((e) => e.entry.calling_name === "AAA-05").entry.time_out);
  console.log("pushed again, AAA-05 out:", out);
  if (out !== 18) throw new Error("the edited entry should be in Excel");

  // undo once more, then discard the sheet: nothing waits and nothing is in Excel
  await p.locator(".batches li", { hasText: "write" }).first().getByRole("button", { name: "Undo" }).click();
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length === 2, null, { timeout: 30000 });
  await p.getByRole("button", { name: /Discard sheet 12/ }).click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  console.log("discarded, waiting:", await rows());
  console.log("errors:", errs);
  if (errs.length) throw new Error(errs[0]);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
