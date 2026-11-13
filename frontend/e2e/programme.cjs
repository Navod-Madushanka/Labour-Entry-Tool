// As-built programme (roadmap #2): Gantt from the sheets, manpower histogram with the planned line
// pasted from a look-ahead, S-curves, flowline with the PM's place order, charts saved as images.
// Made-up data:  cd backend && python ../scripts/demo_two_books.py   then  node e2e/programme.cjs [shots]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 60000 });
  await p.getByRole("tab", { name: "As-built programme" }).click();

  // Gantt: one row per activity, sorted by first day
  const rows = await p.locator("svg.gantt .gantt-row").count();
  console.log("gantt rows:", rows);
  if (rows < 2) throw new Error("no programme bars");

  // planned headcount pasted from Excel: a trade row of the look-ahead
  await p.locator(".plan-editor summary").click();
  const first = p.locator(".plan-grid input").first();
  await first.focus();
  await p.evaluate(() => {
    const el = document.querySelector(".plan-grid input");
    const dt = new DataTransfer();
    const trade = document.querySelector(".plan-grid tbody th").textContent;
    dt.setData("text", `${trade}\t3\t4\t5\t6\t6`);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const vals = await p.locator(".plan-grid tbody tr").first().locator("input").evaluateAll((els) => els.map((e) => e.value));
  console.log("pasted:", vals.join(" "));
  if (vals[0] !== "3" || vals[1] !== "4") throw new Error("paste did not fill the row");
  await p.getByRole("button", { name: "Save planned headcount" }).click();
  await p.locator(".plan-editor >> text=Saved.").waitFor();
  await p.locator(".legend >> text=Planned").first().waitFor();
  const plan = await p.evaluate(async () => (await (await fetch("/api/master")).json()).plan);
  console.log("plan:", JSON.stringify(plan));

  // the S-curves and the flowline open on demand (Deeper analysis)
  if (await p.locator(".card", { hasText: "S-curves" }).count()) throw new Error("S-curves should start closed");
  await p.getByRole("button", { name: "+ S-curves" }).click();
  await p.getByRole("button", { name: "+ Flowline" }).click();
  // S-curves: hours and % modes
  await p.getByRole("button", { name: "% of its total" }).click();
  await p.locator("text=100%").first().waitFor();

  // flowline: move a place up and save the order for the project
  const before = await p.locator(".flow-order li span").allInnerTexts();
  await p.locator(".flow-order li button[aria-label^='Move'][aria-label$='up']:not([disabled])").first().click();
  await p.getByRole("button", { name: "Save order" }).click();
  await p.locator(".flow-order >> text=Saved for this project.").waitFor();
  const order = await p.evaluate(async () => (await (await fetch("/api/master")).json()).place_order);
  console.log("place order:", before.join(" < "), "->", JSON.stringify(order));
  if (order.length < 2) throw new Error("order not saved");

  // a chart saved as a picture
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator(".card", { hasText: "As-built programme" }).getByRole("button", { name: "Save image" }).click()]);
  console.log("image:", dl.suggestedFilename());
  if (!dl.suggestedFilename().endsWith(".png")) throw new Error("no png");

  await p.locator(".card", { hasText: "As-built programme" }).first().screenshot({ path: out + "/programme-gantt.png" });
  await p.locator(".card", { hasText: "Manpower histogram" }).first().screenshot({ path: out + "/programme-histogram.png" });
  await p.locator(".card", { hasText: "S-curves" }).getByRole("button", { name: "Hours", exact: true }).click();
  await p.locator(".card", { hasText: "S-curves" }).first().screenshot({ path: out + "/programme-scurve.png" });
  await p.locator(".card", { hasText: "Flowline" }).first().screenshot({ path: out + "/programme-flowline.png" });

  // put things back for the next run
  await p.evaluate(async () => {
    const post = (u, body) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await post("/api/setup/plan", { plan: {} });
    await post("/api/setup/place-order", { order: [] });
  });
  console.log("programme e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
