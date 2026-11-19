// Supervisors: manpower sheets entered day by day. Kamal hands in two sheets a day, Nimal one
// (made-up pushes through the API, as the push dialog does): full days are green with the count,
// a day with fewer sheets than usual is amber, a working day with none is red; clicking a cell
// opens that sheet. Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/supervisor-calendar.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const push = async (sheet, names, supervisor) => {
    const entries = names.map((n) => ({ sheet, calling_name: n, time_in: 7, time_out: 17, activities: [{ code: "03-11-00-00-P", hours: 9 }], acknowledged: ["W01", "W02", "W03", "W05", "W10"] }));
    const r = await (await p.request.post(BASE + "api/entries", { data: { user: "Tester", entries, supervisor } })).json();
    if (r.status !== "written") throw new Error(`push ${sheet} ${supervisor}: ${r.status} ${JSON.stringify(r.plans?.flatMap((x) => x.issues.map((i) => i.rule)))}`);
  };
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester"));
  // Kamal: two sheets on the 5th and 6th, one on the 7th; Nimal: one on the 5th and 7th, none on the 6th
  await push("5", ["AAA-04", "AAA-05"], "Kamal"); await push("5", ["AAA-06"], "Kamal");
  await push("6", ["AAA-04", "AAA-05"], "Kamal"); await push("6", ["AAA-06"], "Kamal");
  await push("7", ["AAA-04", "AAA-05"], "Kamal");
  await push("5", ["AAA-07"], "Nimal"); await push("7", ["AAA-07"], "Nimal");

  await p.goto(BASE + "app/#supervisors");
  await p.evaluate(() => localStorage.removeItem("labour.sup.cal"));
  await p.reload();
  await p.locator(".sup-cal").waitFor({ timeout: 30000 });
  const list = async () => (await p.locator(".sup-today-list li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  // opens on the latest day entered (the 7th): Kamal has 1 of his usual 2, Nimal is complete
  const head = (await p.locator(".sup-today-head").innerText()).replace(/\s+/g, " ");
  console.log("day 7:", head, "|", (await list()).join(" || "));
  if (!/1 of 2 supervisors complete/.test(head)) throw new Error("summary for the 7th");
  const l7 = await list();
  if (!/Kamal.*1 of 2 sheets entered/.test(l7[0]) || !/Nimal.*Entered · 1 sheet/.test(l7[1])) throw new Error("day 7 lines (short first)");
  // the day strip: the 6th is part-done, the 5th done; pick the 6th: Nimal not entered comes first
  const cls = async (d) => p.locator(".sup-day").nth(d - 1).getAttribute("class");
  console.log("strip 5:", await cls(5), "| 6:", await cls(6));
  if (!/d-done/.test(await cls(5)) || !/d-part/.test(await cls(6))) throw new Error("day strip colours");
  await p.locator(".sup-day").nth(5).click();
  const l6 = await list();
  console.log("day 6:", l6.join(" || "));
  if (!/Nimal.*Not entered/.test(l6[0]) || !/Kamal.*Entered · 2 sheets/.test(l6[1])) throw new Error("day 6 lines");
  if (SHOTS) await p.locator(".sup-cal").screenshot({ path: `${SHOTS}/supervisor-day.png` });
  // the whole month as a grid
  await p.getByRole("button", { name: "Whole month" }).click();
  const cell = (sup, day) => p.locator(".sup-cal-grid tbody tr", { has: p.locator(`th:has-text("${sup} ")`) }).locator("td").nth(Number(day) - 1);
  const k5 = await cell("Kamal", 5).getAttribute("class"), k7 = await cell("Kamal", 7).innerText(), n6 = await cell("Nimal", 6).getAttribute("class");
  console.log("grid: Kamal 5", k5, "| Kamal 7", k7, "| Nimal 6", n6);
  if (k5 !== "c-full" || k7.trim() !== "1/2" || n6 !== "c-missing") throw new Error("month grid");
  if (SHOTS) await p.locator(".sup-cal").screenshot({ path: `${SHOTS}/supervisor-month.png` });
  // back to one day and open Kamal's sheet of the 5th
  await p.locator(".sup-day").nth(4).click();
  await p.locator(".sup-today-list li", { hasText: "Kamal" }).getByRole("button", { name: "Open" }).click();
  await p.locator('.mp-day[data-sheet="5"][data-supervisor="Kamal"]').waitFor();
  console.log("Open shows Kamal's sheet 5: yes");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("supervisor-calendar e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
