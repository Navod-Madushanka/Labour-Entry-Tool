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
  await p.locator(".sup-cal").waitFor({ timeout: 30000 });
  const cell = (sup, day) => p.locator(".sup-cal-grid tbody tr", { has: p.locator(`th:text-is("${sup}") , th:has-text("${sup} ")`) }).locator("td").nth(Number(day) - 1);
  const read = async (sup, day) => ({ cls: (await cell(sup, day).getAttribute("class")).replace(" last", ""), text: (await cell(sup, day).innerText()).trim() });
  const k5 = await read("Kamal", 5), k7 = await read("Kamal", 7), n6 = await read("Nimal", 6), n7 = await read("Nimal", 7);
  console.log("Kamal 5:", k5, "| Kamal 7:", k7, "| Nimal 6:", n6, "| Nimal 7:", n7);
  if (k5.cls !== "c-full" || !k5.text.startsWith("2")) throw new Error("Kamal's two sheets on the 5th should be full");
  if (k7.cls !== "c-short" || !k7.text.startsWith("1/2")) throw new Error("Kamal's one sheet on the 7th should be short (1/2)");
  if (n6.cls !== "c-missing") throw new Error("Nimal's 6th should be missing");
  if (n7.cls !== "c-full") throw new Error("Nimal's 7th should be full (usually one)");
  const usual = await p.locator(".sup-cal-grid tbody th", { hasText: "Kamal" }).innerText();
  console.log("Kamal row head:", usual.replace(/\s+/g, " "), "| today line:", await p.locator(".sup-cal-today").innerText());
  if (!/×2/.test(usual)) throw new Error("Kamal usually has 2");
  if (!/Sheet 7.*1 of 2 supervisors complete.*Kamal/.test(await p.locator(".sup-cal-today").innerText())) throw new Error("today line");
  const foot = await p.locator(".sup-cal-grid tfoot td").nth(5).innerText();
  console.log("complete on the 6th:", foot);
  if (SHOTS) await p.locator(".sup-cal").screenshot({ path: `${SHOTS}/supervisor-calendar.png` });
  // click Kamal on the 5th: that sheet opens below
  await cell("Kamal", 5).locator("button").click();
  await p.locator('.mp-day[data-sheet="5"][data-supervisor="Kamal"]').waitFor();
  console.log("click opens Kamal's sheet 5: yes");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("supervisor-calendar e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
