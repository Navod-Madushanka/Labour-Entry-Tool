// One-click site report (roadmap #4): week picker, rule-written "what changed" lines with links to
// their tables, one A4 page when printed (checked by printing to PDF), the monthly labour return.
// Made-up data:  cd backend && python ../scripts/demo_two_books.py 8012 big   then  node e2e/site-report.cjs [shots]
const { chromium } = require("playwright");
const fs = require("fs");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.waitForFunction(() => /\((\d+) of \1\)/.test(document.querySelector(".analysis")?.textContent ?? ""), null, { timeout: 90000 });

  await p.locator(".analysis-tools").getByRole("button", { name: "Site report" }).click();
  const sheet = p.locator(".report-sheet");
  await sheet.waitFor();
  const period = await p.getByLabel("Period").evaluate((s) => s.options[s.selectedIndex].text);
  const lines = await sheet.locator(".rs-changes li").allInnerTexts();
  console.log("period:", period);
  console.log("what changed:\n  " + lines.map((l) => l.replace(/\s*table →$/, "")).join("\n  "));
  if (lines.length < 3) throw new Error("too few lines");
  await sheet.screenshot({ path: out + "/site-report.png" });

  // printed: exactly one A4 page
  await p.evaluate(() => document.body.classList.add("printing"));
  await p.emulateMedia({ media: "print" });
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(out + "/site-report.pdf", pdf);
  console.log("report pages:", pages(pdf));
  if (pages(pdf) !== 1) throw new Error("the report is not one page");
  await p.emulateMedia({ media: "screen" });

  // the whole month, and the monthly labour return (landscape, one page)
  await p.getByLabel("Period").selectOption("month");
  await sheet.locator("h1", { hasText: "Monthly site labour report" }).waitFor();
  await p.getByRole("button", { name: "Monthly labour return" }).click();
  await p.locator(".return-sheet").waitFor();
  const rows = await p.locator(".rs-return tbody tr").count();
  console.log("return rows (days):", rows);
  await p.locator(".return-sheet").screenshot({ path: out + "/labour-return.png" });
  await p.emulateMedia({ media: "print" });
  const ret = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(out + "/labour-return.pdf", ret);
  console.log("return pages:", pages(ret));
  if (pages(ret) !== 1) throw new Error("the return is not one page");
  await p.emulateMedia({ media: "screen" });
  await p.evaluate(() => document.body.classList.remove("printing"));

  // a line's link opens the table behind it
  await p.keyboard.press("Escape");
  await p.locator(".report-portal").waitFor({ state: "detached" });
  await p.locator(".analysis-tools").getByRole("button", { name: "Site report" }).click();
  await sheet.locator(".rs-changes li", { hasText: "OT" }).first().getByRole("button", { name: "table →" }).click();
  await p.locator(".report-portal").waitFor({ state: "detached" });
  const tab = await p.locator(".subtabs [aria-selected=true]").first().innerText();
  console.log("opened view:", tab);
  if (tab !== "Overtime") throw new Error("the link did not open the overtime table");
  console.log("site-report e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
