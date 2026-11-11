// The supervisor question at push: the last three used on top ("Recent"), then everyone A–Z in a
// row per first letter; typing a name narrows them. Made-up data:
//   cd backend && python ../scripts/demo_two_books.py    then  node e2e/supervisor-order.cjs [shots]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  // used in this order (the latest last): Ruwan, Amal, Nimal, Kamal; typed by hand: Zahir, Bandara, Asela
  const push = async (name, sup) => {
    const r = await p.request.post(BASE + "api/entries", { data: { user: "Tester", supervisor: sup, entries: [
      { sheet: "6", calling_name: name, time_in: 7, time_out: 19, activities: [{ code: "03-11-00-00-P", hours: 11 }], additional: null, remark: null, overwrite: true, acknowledged: ["W01", "W02", "W03", "W04", "W05", "W06", "W07", "W08", "W09", "W10"] }] } });
    const j = await r.json();
    if (j.status !== "written") throw new Error(`push for ${sup}: ${j.status} ${JSON.stringify(j.plans?.[0]?.issues?.map((i) => i.rule))}`);
  };
  await push("AAA-01", "Ruwan"); await push("AAA-02", "Amal"); await push("AAA-03", "Nimal"); await push("AAA-04", "Kamal");
  for (const n of ["Zahir", "Bandara", "Asela"]) await p.request.post(BASE + "api/supervisors", { data: { name: n } });

  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector('input[aria-label="Activity 1"]', { timeout: 15000 });
  await p.getByRole("tab", { name: "6", exact: true }).click();
  await p.locator("#worker").fill("AAA-05"); await p.keyboard.press("Enter");
  await p.keyboard.type("7"); await p.keyboard.press("Enter"); await p.keyboard.type("19"); await p.keyboard.press("Enter");
  const hint = await p.locator('input[aria-label="Activity 1"]').getAttribute("placeholder");
  if (!hint.includes("Enter to use")) await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  await p.waitForSelector(".queue tbody tr");
  await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled);
  await p.locator(".push-bar button").click();
  const dlg = p.getByRole("dialog", { name: "Whose manpower sheet is this?" });
  await dlg.locator(".sup-row").first().waitFor();
  const rows = await dlg.locator(".sup-row").evaluateAll((els) => els.map((e) => [e.querySelector(".sup-row-label").textContent, [...e.querySelectorAll("button")].map((x) => x.textContent)]));
  console.log("rows:", JSON.stringify(rows));
  const want = [["Recent", ["Kamal", "Nimal", "Amal"]], ["A", ["Asela"]], ["B", ["Bandara"]], ["R", ["Ruwan"]], ["Z", ["Zahir"]]];
  if (JSON.stringify(rows) !== JSON.stringify(want)) throw new Error("expected " + JSON.stringify(want));
  await p.waitForTimeout(300); await p.screenshot({ path: `${out}/supervisor-order.png` });
  // typing narrows: "a" … then "ban" leaves Bandara
  await p.getByLabel("Supervisor", { exact: true }).fill("ban");
  const left = await dlg.locator(".sup-row button").allInnerTexts();
  console.log("typed ban:", left.join(", "));
  if (left.join() !== "Bandara") throw new Error("typing should narrow to Bandara");
  console.log("supervisor-order e2e: ok; errors:", errs);
  await b.close();
})().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
