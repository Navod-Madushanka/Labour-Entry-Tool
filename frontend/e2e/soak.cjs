// A long working day, compressed (made-up data): 11 days x 40 workers entered at full speed with
// the suggestions, a push per day, window switches, the SQL panel and Analysis. After each day:
// server memory, page memory, DOM size, event listeners and timings, to see that nothing grows
// or slows down.
//
//   cd backend && python ../scripts/demo_two_books.py 8012 big      (fresh server)
//   SERVER_PID=<pid> node e2e/soak.cjs [days] [workers-per-day]
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const DAYS = Number(process.argv[2] || 11), PER_DAY = Number(process.argv[3] || 40);
const rss = () => {
  try { return Math.round(Number(fs.readFileSync(`/proc/${process.env.SERVER_PID}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1]) / 1024); } catch { return null; }
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Performance.enable");
  if (process.env.CPU_SLOW) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_SLOW) });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  p.on('response', r => r.status() >= 500 && errs.push(`HTTP ${r.status()} ${r.url()}`));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.locator("#worker").waitFor(); // locators: no element handles kept alive (they would look like a leak)
  await p.waitForFunction(() => !document.body.innerText.includes("Loading month"), null, { timeout: 60000 });
  const metrics = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    return { heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners };
  };
  const rows = [];
  const start = Date.now();
  for (let d = 0; d < DAYS; d++) {
    const sheet = String(21 + d);
    await p.getByRole('tab', { name: sheet, exact: true }).click();
    const picks = [];
    let missed = 0;
    for (let k = 0; k < PER_DAY; k++) {
      const name = `AAA-${String(((d * 17 + k) % 250) + 1).padStart(3, "0")}`;
      const t = Date.now();
      await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.activeElement?.id === 'in');
      picks.push(Date.now() - t);
      await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); // In, Out (suggested)
      // the activity box is filled only when the crew agrees; else ↓ takes the first suggestion
      const hint = await p.locator('input[aria-label="Activity 1"]').getAttribute("placeholder");
      if (!hint?.includes("Enter to use")) await p.keyboard.press('ArrowDown');
      await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
      const ok = await p.waitForFunction((n) => document.querySelector('.queue tbody')?.innerText.includes(n), name, { timeout: 5000 }).then(() => true, () => false);
      if (!ok) { missed++; await p.keyboard.press('Escape'); }
      if (k % 10 === 9) await p.evaluate(() => { window.dispatchEvent(new Event("focus")); }); // back from Excel
    }
    await p.waitForFunction(() => !document.querySelector('.queue tbody')?.innerText.includes("checking"), null, { timeout: 30000 });
    for (const btn of await p.locator('.queue button', { hasText: /^✓ / }).all()) await btn.click().catch(() => {}); // confirm warnings for all
    const t0 = Date.now();
    const canPush = await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled, null, { timeout: 20000 }).then(() => true, () => false);
    if (canPush) {
      await p.locator('.push-bar button').click();
      await p.getByLabel("Supervisor", { exact: true }).fill("Test Supervisor"); await p.keyboard.press("Enter"); // whose manpower sheet
      await p.waitForFunction(() => !document.querySelector('.queue tbody tr'), null, { timeout: 60000 });
    } else { errs.push(`day ${sheet}: push stayed disabled`); await p.getByRole('button', { name: 'Remove all' }).click(); }
    const pushMs = Date.now() - t0;
    // The SQL panel (Ctrl+K from any tab): a query and a command, then Analysis, then back.
    await p.keyboard.press("Control+k");
    await p.waitForFunction(() => location.hash === "#codes/sql" && document.activeElement?.getAttribute("aria-label") === "SQL query");
    await p.keyboard.press("Control+a");
    await p.keyboard.type(`SELECT calling_name, SUM(hours) FROM entries WHERE calling_name = 'AAA-001' GROUP BY calling_name`);
    await p.keyboard.press("Control+Enter");
    const sqlOk = await p.waitForSelector(".sqlws-grid tbody tr", { timeout: 10000 }).then(() => true, () => false);
    if (!sqlOk) errs.push(`day ${sheet}: SQL query gave no rows`);
    await p.keyboard.press("Control+a");
    await p.keyboard.type(`show AAA-001 on 1-31`); await p.keyboard.press("Control+Enter");
    if (process.env.NO_RELOAD) await p.evaluate(() => (location.hash = "#analysis")); else await p.goto(BASE + "app/#analysis");
    await p.locator(".analysis .kpis").first().waitFor({ timeout: 60000 }).catch(() => errs.push(`day ${sheet}: Analysis did not show`));
    if (process.env.NO_RELOAD) await p.evaluate(() => (location.hash = "#")); else await p.goto(BASE + "app/#");
    await p.locator("#worker").waitFor(); // locators: no element handles kept alive (they would look like a leak)
    const m = await metrics();
    const sorted = picks.sort((a, b) => a - b);
    rows.push({ day: sheet, queuedOK: PER_DAY - missed, pickMedianMs: sorted[Math.floor(sorted.length / 2)], pickMaxMs: sorted[sorted.length - 1], pushMs, serverMB: rss(), ...m });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  console.log(`done in ${Math.round((Date.now() - start) / 1000)} s; errors: ${JSON.stringify(errs.slice(0, 10))}`);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
