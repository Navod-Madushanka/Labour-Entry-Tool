// Analysis "Back": each filter or tab change is a history step; "← Back" and the browser's Back
// undo them one at a time, with no page reload; Back past the first leaves Analysis. Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/analysis-back.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.setItem("labour.analysis.view", "overview"); });
  await p.reload(); await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 60000 });
  await p.evaluate(() => (window.__same = true)); // gone if the page reloads
  const chips = () => p.locator(".filter-chips .chip").allInnerTexts().then((x) => x.map((t) => t.replace(/\s*✕/, "").replace(/\s+/g, " ").trim()));
  const back = p.locator(".analysis-back");
  if (!(await back.isDisabled())) throw new Error("Back should start disabled");

  // three steps: a trade, a place, another tab
  const trade = await p.locator(".filters select").first().locator("option").nth(1).textContent();
  await p.locator(".filters select").first().selectOption(trade);
  const placeSel = p.locator(".filters label", { hasText: "Place" }).locator("select");
  const place = await placeSel.locator("option").nth(1).textContent();
  await placeSel.selectOption(place);
  await p.getByRole("tab", { name: "As-built programme" }).click();
  console.log("filtered:", (await chips()).join(" | "));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/analysis-back.png` });

  // ← Back: the tab first, then the place, with the trade kept
  await back.click();
  await p.waitForFunction(() => document.querySelector('.analysis [role=tab][aria-selected=true]')?.textContent !== "As-built programme");
  await back.click();
  await p.waitForFunction(() => document.querySelectorAll(".filter-chips .chip").length === 1);
  console.log("after 2× Back:", (await chips()).join(" | "));
  if (!(await chips())[0].includes(trade)) throw new Error("the trade filter should stay");

  // the browser's Back button too
  await p.goBack();
  await p.waitForFunction(() => !document.querySelector(".filter-chips .chip"));
  console.log("browser Back: no filters;", "Back disabled:", await back.isDisabled());
  if (!(await back.isDisabled())) throw new Error("Back should be disabled at the start");
  // and Forward brings the trade back
  await p.goForward();
  await p.waitForFunction(() => document.querySelectorAll(".filter-chips .chip").length === 1);
  console.log("browser Forward: back to", (await chips()).join(" | "));
  if (!(await p.evaluate(() => window.__same))) throw new Error("the page reloaded");
  console.log("no page reload: yes");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("analysis-back e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
