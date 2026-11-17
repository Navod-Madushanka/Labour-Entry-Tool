// "Whose manpower sheet is this?" on small screens: the dialog fits the window, scrolls, and the
// Push button stays in view. Made-up data and made-up supervisor names.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/supervisor-dialog-small.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  for (let i = 0; i < 40; i++) await p.request.post(BASE + "api/supervisors", { data: { name: `Supervisor ${String.fromCharCode(65 + (i % 26))}${i}` } });
  await p.reload(); await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "16", exact: true }).click();
  await p.locator("#worker").fill("AAA-03"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.keyboard.press("Control+a"); await p.keyboard.type("03-11-00-00-P"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelector(".queue tbody")?.innerText.includes("AAA-03"));
  await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled, null, { timeout: 20000 });

  for (const [w, h, label] of [[1366, 600, "short laptop"], [1280, 520, "very short"], [1280, 420, "zoomed in / tiny"], [390, 700, "phone"], [360, 560, "small phone"]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.reload(); await p.waitForSelector("#worker"); // a fresh dialog each time (the waiting entry is kept)
    await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled, null, { timeout: 20000 });
    await p.locator(".push-bar button").click();
    const dlg = p.getByRole("dialog", { name: "Whose manpower sheet is this?" });
    await dlg.waitFor();
    const lost = dlg.locator("details.lost-pick");
    if (await lost.count()) { // the tallest the dialog gets: the lost-time reasons shown
      if (!(await lost.evaluate((d) => d.open))) await lost.locator("summary").click();
      await p.waitForFunction(() => document.querySelector("details.lost-pick")?.open);
    }
    await p.waitForTimeout(200);
    const box = await dlg.boundingBox();
    const scrolls = await dlg.evaluate((d) => d.scrollHeight > d.clientHeight && getComputedStyle(d).overflowY === "auto");
    // pick a supervisor near the end of the list, then the Push button must be in view
    await dlg.getByRole("radio").last().scrollIntoViewIfNeeded();
    await dlg.getByRole("radio").last().click();
    const btn = dlg.locator(".actions button.primary");
    const bb = await btn.boundingBox();
    const inView = bb && bb.y >= 0 && bb.y + bb.height <= h + 1 && box.y >= 0 && box.y + box.height <= h + 1;
    console.log(`${label} ${w}x${h}: dialog ${Math.round(box.height)} px tall, fits: ${box.y >= 0 && box.y + box.height <= h + 1}, scrolls: ${scrolls}, Push in view: ${Boolean(inView)} (${(await btn.innerText()).slice(0, 40)})`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/sup-dialog-${w}x${h}.png` });
    if (!inView) throw new Error(`Push button out of view at ${w}x${h}`);
    if (h <= 420 && !scrolls) throw new Error(`the dialog should scroll at ${w}x${h} (taller than the window)`);
    // the last lost-time chip can be reached by scrolling the dialog
    const lastChip = dlg.locator(".lost-chips button").last();
    if (await lastChip.count()) {
      // scrolled to the end, the last reason sits in the window and above the Push bar
      const ok = await dlg.evaluate((d) => {
        d.scrollTop = d.scrollHeight;
        const chip = [...d.querySelectorAll(".lost-chips button")].pop().getBoundingClientRect();
        const bar = d.querySelector(".actions").getBoundingClientRect();
        return { ok: chip.bottom <= bar.top + 1 && chip.top >= 0 && chip.bottom <= innerHeight, chip: [chip.top, chip.bottom], bar: [bar.top, bar.bottom], sh: d.scrollHeight, ch: d.clientHeight, st: d.scrollTop, open: d.querySelector("details.lost-pick")?.open };
      });
      if (!ok.ok) throw new Error("lost-time chips out of reach " + JSON.stringify(ok));
    }
    await dlg.getByRole("button", { name: /Cancel|Close/ }).first().click().catch(() => p.keyboard.press("Escape"));
    await dlg.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  console.log("errors:", errs.length ? errs : "none");
  if (errs.length) throw new Error(errs[0]);
  await b.close();
  console.log("supervisor-dialog-small e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
