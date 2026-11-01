// Waiting entries survive a reload, a page crash and a switch to another workbook; closing the
// workbook drops them (after asking). Made-up data.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/queue-restore.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const asked = []; p.on('dialog', d => { asked.push(d.message().split("\n")[0]); d.accept(); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.locator("#worker").waitFor();
  await p.getByRole('tab', { name: '10', exact: true }).click();
  for (const name of ["AAA-01", "AAA-02"]) {
    await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
    await p.keyboard.press('Control+a'); await p.keyboard.type('7'); await p.keyboard.press('Enter');
    await p.keyboard.press('Control+a'); await p.keyboard.type('19'); await p.keyboard.press('Enter');
    await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.waitForFunction((n) => document.querySelector('.queue tbody')?.innerText.includes(n), name);
  }
  const count = () => p.evaluate(() => document.querySelectorAll('.queue tbody tr').length);

  await p.reload(); // as if the page was reloaded or the browser restarted
  await p.locator(".toast", { hasText: "Restored 2 entries" }).waitFor();
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length === 2);
  console.log("after reload:", await count(), "|", (await p.locator(".toast").innerText()).split(".")[0]);

  // To DEMO C and back: the entries wait for A.
  const switchTo = async (n) => { await p.locator(".book-current").click(); await p.locator(".book-list .book-name", { hasText: n }).click(); };
  await switchTo("DEMO C.json");
  await p.waitForSelector("text=Check activity codes and hours");
  console.log("switched to C without being asked:", asked.length === 0);
  await p.getByRole("button", { name: /^Change$/ }).click().catch(() => {});
  await p.locator(".open-books li", { hasText: "DEMO A" }).getByRole("button", { name: /DEMO A/ }).click();
  await p.locator("#worker").waitFor();
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length === 2, null, { timeout: 15000 });
  console.log("back on A:", await count(), "waiting");

  // A crash of the page (the error screen's Reload): still there.
  await p.evaluate(() => { location.reload(); });
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length === 2, null, { timeout: 15000 });
  console.log("after a crash and reload:", await count());

  // Closing A drops them, after asking.
  await p.locator(".book-current").click();
  await p.getByRole("button", { name: "Close Labour Entry Sheet October 2026 - DEMO A.json" }).click();
  await p.waitForSelector("text=Check activity codes and hours");
  console.log("asked on close:", asked.join(" / "));
  const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("labour.queue.")));
  console.log("saved queues left:", left);
  if (left.some((k) => k.includes("DEMO A"))) throw new Error("closed workbook's queue should be gone");
  console.log("errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
