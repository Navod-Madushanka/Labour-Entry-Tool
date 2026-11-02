// "Reload from Excel": shows that it is working, then says what changed, and the page shows the
// new data (here a worker written to the workbook behind the page's back). Made-up data only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/reload.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "9", exact: true }).click();
  await p.waitForSelector(".day-date");
  const count = async () => (await p.locator(".daybar .muted").first().innerText()).match(/(\d+) worker/)?.[1];
  const before = await count();

  // nothing changed: it still says so
  const btn = p.getByRole("button", { name: /Reload from Excel/ });
  await btn.click();
  await p.waitForSelector(".toast");
  console.log("no change:", await p.locator(".toast").innerText());
  if (!/no changes/.test(await p.locator(".toast").innerText())) throw new Error("expected 'no changes'");
  await p.getByRole("button", { name: "Dismiss" }).click();

  // a worker written to sheet 9 by someone else (as if typed in Excel)
  const res = await p.request.post(BASE + "api/entries", { data: { user: "Excel", dry_run: false, entries: [
    { sheet: "9", calling_name: "AAA-05", time_in: 7, time_out: 19, activities: [{ code: "03-11-00-00", hours: 11 }], additional: null, remark: null, overwrite: false, acknowledged: ["W02", "W03", "W04", "W05", "W06", "W07", "W08", "W10"] },
  ] } });
  console.log("written behind the page:", (await res.json()).status);
  if ((await count()) !== before) throw new Error("page changed before reload?");

  await btn.click();
  const busy = await p.locator(".daybar button[aria-busy=true]").count().catch(() => 0);
  await p.waitForSelector(".toast");
  const msg = await p.locator(".toast").innerText();
  console.log("after reload:", msg, "| button showed progress:", busy > 0);
  if (!/1 new/.test(msg)) throw new Error("expected '1 new'");
  await p.waitForFunction((n) => document.querySelector(".daybar .muted")?.innerText.includes(`${n} worker`), String(Number(before) + 1));
  console.log("workers on sheet 9:", before, "->", await count());
  await p.waitForFunction(() => !document.querySelector(".daybar button[aria-busy=true]"), null, { timeout: 60000 });
  console.log("button back:", (await btn.innerText()).trim());
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("reload e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
