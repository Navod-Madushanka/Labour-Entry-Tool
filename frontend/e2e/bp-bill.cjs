// The BP Bill sheet and a supplier's claim against the day sheets (roadmap #8). Made-up files built
// from the demo's day sheets: a BP Bill in another layout than the first guess (day counts, header
// lower down) with one planted mistake, and a claim with one over-claim.
//   cd backend && python ../scripts/demo_two_books.py   then  node e2e/bp-bill.cjs [shots]
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  // the day sheets as the tool sees them: calling name -> day -> effective hours
  const sheets = await p.evaluate(async () => {
    const m = await (await fetch("/api/master")).json();
    const out = {};
    for (const s of m.sheets) {
      const d = await (await fetch(`/api/days/${s}`)).json();
      for (const v of d.entries) if (v.entry.calling_name && v.computed?.effective > 0) (out[v.entry.calling_name] ??= {})[s] = v.computed.effective;
    }
    return out;
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bpbill-"));
  fs.writeFileSync(path.join(dir, "sheets.json"), JSON.stringify(sheets));
  const names = Object.keys(sheets).sort();
  const planted = names[0], over = names[1];
  execFileSync("python3", ["-c", `
import json, sys
from openpyxl import Workbook
sheets = json.load(open(sys.argv[1]))
wb = Workbook(); ws = wb.active; ws.title = "BP Bill"
ws["A1"] = "MADE-UP COMPANY"; ws["A2"] = "BP BILL"; ws["A4"] = "Month: October 2026"
head = ["Sr", "Calling Name", "Employee Name", "Trade"] + list(range(1, 32)) + ["Total Days", "Rate", "Amount"]
for c, v in enumerate(head, 1): ws.cell(6, c, v)
for i, name in enumerate(sorted(sheets), 1):
    r = 6 + i
    ws.cell(r, 1, i); ws.cell(r, 2, name); ws.cell(r, 3, "Person " + str(i)); ws.cell(r, 4, "Helper")
    days = {int(k): v for k, v in sheets[name].items()}
    total = 0
    for d in range(1, 32):
        n = 1 if days.get(d, 0) >= 6 else 0
        if name == sys.argv[2] and d == 30: n = 1  # planted: a day billed with no work
        if n: ws.cell(r, 4 + d, n); total += n
    ws.cell(r, 36, total); ws.cell(r, 37, 3000); ws.cell(r, 38, total * 3000)
wb.save(sys.argv[3])
`, path.join(dir, "sheets.json"), planted, path.join(dir, "Workbook copy.xlsx")]);
  const claim = ["Business partner,Calling name,Days billed,Hours billed",
    ...names.map((n) => `MADE-UP BP,${n},${Object.values(sheets[n]).filter((h) => h >= 6).length + (n === over ? 2 : 0)},`)].join("\n");
  fs.writeFileSync(path.join(dir, "claim.csv"), claim);

  await p.getByRole("link", { name: "Analysis" }).click();
  await p.getByRole("tab", { name: "BP bill check" }).click();
  await p.locator('input[aria-label="Workbook copy with the BP Bill"]').setInputFiles(path.join(dir, "Workbook copy.xlsx"));
  await p.locator(".bp-card >> text=worker").filter({ hasText: "on the BP Bill" }).first().waitFor({ timeout: 30000 });
  const found = await p.locator(".bp-card p.small", { hasText: "sheet BP Bill" }).innerText();
  console.log("found:", found);
  if (!found.includes("header row 6") || !found.includes("day counts")) throw new Error("layout not found as expected");
  const diffs = await p.locator(".bp-card", { hasText: "BP Bill sheet" }).locator("tbody tr").allInnerTexts();
  console.log("differences:", diffs.map((d) => d.replace(/\s+/g, " ")).join(" | "));
  if (!diffs.some((d) => d.includes(planted) && d.includes("30"))) throw new Error("the planted day 30 was not found");

  await p.locator('input[aria-label="Supplier claim"]').setInputFiles(path.join(dir, "claim.csv"));
  const claimCard = p.locator(".bp-card", { hasText: "Against the supplier" });
  await claimCard.locator("p.small, p.error-text").filter({ hasText: /to check\.|\S/ }).last().waitFor();
  await claimCard.locator("text=to check.").waitFor({ timeout: 15000 }).catch(async () => console.log("claim card now:", (await claimCard.innerText()).slice(-300)));
  const claimRows = await p.locator(".bp-card", { hasText: "Against the supplier" }).locator("tbody tr").allInnerTexts();
  console.log("claim:", claimRows.map((d) => d.replace(/\s+/g, " ")).join(" | "));
  if (!claimRows.some((d) => d.includes(over) && d.includes("2 day(s) more"))) throw new Error("the over-claim was not found");
  await p.locator(".analysis").screenshot({ path: out + "/bp-bill.png", fullPage: false });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("bp-bill e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
