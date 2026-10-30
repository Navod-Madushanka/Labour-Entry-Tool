// Entered on the wrong day: move a sheet's waiting entries to another day from the manpower sheet.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/move-sheet.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const asked = []; p.on('dialog', d => { asked.push(d.message()); d.accept(); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  const add = async (sheet, names) => {
    await p.getByRole('tab', { name: sheet, exact: true }).click();
    for (const name of names) {
      await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
      await p.keyboard.press('Control+a'); await p.keyboard.type('7'); await p.keyboard.press('Enter');
      await p.keyboard.press('Control+a'); await p.keyboard.type('19'); await p.keyboard.press('Enter');
      await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
      await p.waitForFunction(([s, n]) => [...document.querySelectorAll('.queue tbody tr')].some((r) => r.cells[0].textContent.trim() === s && r.textContent.includes(n)), [sheet, name]);
    }
  };
  await add("9", ["AAA-01"]);          // already waiting on the right day
  await add("8", ["AAA-01", "AAA-02"]); // the wrong day
  console.log("heading:", await p.locator(".entry-head h2").innerText());
  const queued = () => p.$$eval('.queue tbody tr', (rs) => rs.map((r) => r.cells[0].textContent.trim() + " " + r.cells[1].textContent.trim()));
  console.log("before:", await queued());

  await p.locator('.mp-day', { has: p.getByLabel("Move sheet 8 to") }).locator('.mp-discard').screenshot({ path: out + "/move-bar.png" });
  await p.getByLabel("Move sheet 8 to").selectOption("9");
  await p.waitForFunction(() => [...document.querySelectorAll('.queue tbody tr')].every((r) => r.cells[0].textContent.trim() === "9"));
  console.log("asked:", asked[0].split("\n").filter(Boolean).join(" / "));
  const after = await queued();
  console.log("after:", after);
  if (after.sort().join() !== "9 AAA-01,9 AAA-02") throw new Error("expected AAA-01 and AAA-02 on sheet 9, once each");
  const heading = await p.locator(".entry-head h2").innerText();
  if (!heading.includes("(sheet 9)")) throw new Error("entry screen should follow to sheet 9: " + heading);
  console.log("entry screen now:", heading.replace(/\s+/g, " "));
  await p.screenshot({ path: out + "/move-sheet.png", fullPage: true });

  await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled, null, { timeout: 15000 });
  await p.locator('.push-bar button').click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  const day = async (s) => p.evaluate(async (s) => (await (await fetch(`/api/days/${s}`)).json()).entries.map(v => v.entry.calling_name), s);
  const d8 = await day("8"), d9 = await day("9");
  console.log("Excel sheet 8:", d8, "sheet 9:", d9);
  if (d8.length || d9.sort().join() !== "AAA-01,AAA-02") throw new Error("pushed to the wrong place");
  console.log("errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
