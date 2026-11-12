// Lost-time reasons (roadmap #5): at push, a reason for the sheet's unallocated hours and the day's
// disruption; the day strip marks the day; Analysis → Lost time shows hours by cause and party,
// disrupted against clean days, and lets a reason be changed; the site report has a line on it.
// Made-up data:  cd backend && python ../scripts/demo_two_books.py   then  node e2e/lost-time.cjs [shots]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload();
  await p.waitForSelector('input[aria-label="Activity 1"]', { timeout: 15000 });
  await p.getByRole("tab", { name: "5", exact: true }).click();

  // one worker, 07:00-19:00 (11 h), only 8 h on the code: 3 h unallocated
  await p.locator("#worker").fill("AAA-01"); await p.keyboard.press("Enter");
  await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.locator('input[aria-label="Activity 1"]').fill("03-11-00-00-P");
  await p.locator('input[aria-label="Hours 1"]').fill("8");
  await p.locator('input[aria-label="Activity 2"]').focus(); await p.keyboard.press("Enter");
  await p.waitForFunction(() => [...document.querySelectorAll(".queue tbody tr")].some((r) => r.textContent.includes("AAA-01")), null, { timeout: 10000 });

  await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled, null, { timeout: 15000 });
  await p.locator(".push-bar button").click();
  const dlg = p.getByRole("dialog", { name: "Whose manpower sheet is this?" });
  await dlg.waitFor();
  await p.getByLabel("Supervisor", { exact: true }).fill("Kamal");
  await dlg.locator(".lost-pick summary").click();
  const badge = await dlg.locator(".lost-pick .badge").innerText();
  console.log("dialog:", badge);
  if (!badge.startsWith("3 h unallocated")) throw new Error("3 h unallocated expected");
  await dlg.getByRole("group", { name: "Reason for the unallocated hours" }).getByRole("button", { name: "Waiting for concrete" }).click();
  await dlg.getByRole("group", { name: "What disrupted the day" }).getByRole("button", { name: "Rain or weather" }).click();
  await dlg.getByLabel("Lost time note").fill("pour delayed by rain");
  await dlg.screenshot({ path: out + "/lost-time-push.png" });
  await dlg.getByRole("button", { name: /^Push 1 entry for Kamal$/ }).click();
  await p.waitForFunction(() => !document.querySelector(".queue tbody tr"), null, { timeout: 15000 });

  // the day strip marks day 5
  await p.locator('.days .day.disrupted:has-text("5")').waitFor();
  console.log("day 5 title:", await p.locator('.days .day.disrupted').first().getAttribute("title"));

  // Analysis → Lost time
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.getByRole("tab", { name: "Lost time" }).click();
  const causeRow = await p.locator("table tbody tr", { hasText: "Waiting for concrete" }).first().innerText();
  console.log("by cause:", causeRow.replace(/\s+/g, " "));
  if (!causeRow.includes("Supplier") || !/\b3\b/.test(causeRow)) throw new Error("3 h of waiting for concrete expected");
  await p.locator(".disrupted-list >> text=Day 5").waitFor();
  await p.locator(".analysis").screenshot({ path: out + "/lost-time-view.png" });

  // change the reason afterwards
  await p.getByLabel("Reason for Kamal, day 5").selectOption("plant");
  await p.locator("text=Saved: day 5, Kamal.").waitFor();
  await p.locator("table tbody tr", { hasText: "Plant breakdown" }).first().waitFor();

  // the site report has a line on it
  await p.locator(".analysis-tools").getByRole("button", { name: "Site report" }).click();
  const line = await p.locator(".rs-changes li", { hasText: "Disrupted" }).first().innerText();
  console.log("report:", line.replace(/\s*table →$/, ""));
  await p.keyboard.press("Escape");
  console.log("lost-time e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
