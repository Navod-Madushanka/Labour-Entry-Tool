// Sharing with the PM and QS (roadmap #10): folder and evening time, "Write it now", the files in
// the folder, and the read-only report at /viewer. Made-up data:
//   cd backend && python ../scripts/demo_two_books.py 8012 big   then  node e2e/share-report.cjs [shots]
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "shared-reports-"));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.getByRole("tab", { name: "Share with PM & QS" }).click();
  await p.getByLabel("Report folder").fill(folder);
  await p.getByLabel("Write it every evening at").check();
  await p.getByLabel("Report time").fill("18:45");
  await p.locator(".share-card").first().getByRole("button", { name: "Save" }).click();
  await p.locator(".share-card >> text=Saved.").first().waitFor();
  await p.getByRole("button", { name: "Write it now" }).click();
  await p.locator(".share-card >> text=Last written").waitFor({ timeout: 60000 });
  const files = fs.readdirSync(folder);
  console.log("files:", files.join(" | "));
  if (files.length !== 2) throw new Error("a dated report and a 'latest' copy expected");
  await p.locator(".analysis").screenshot({ path: out + "/share-settings.png" });

  const v = await b.newPage({ viewport: { width: 1100, height: 1000 } });
  await v.goto(BASE + "viewer");
  const text = await v.locator("main").innerText();
  console.log("viewer:", text.split("\n").slice(0, 4).join(" | "));
  if (!/month to date/i.test(text)) throw new Error("no report at /viewer");
  if (/AAA-\d/.test(text)) throw new Error("calling names in the report");
  await v.screenshot({ path: out + "/viewer.png", fullPage: true });

  // switch the evening report off again
  await p.evaluate(async () => fetch("/api/report/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: "", time: "18:30", enabled: false, rupees: false, lan: false }) }));
  fs.rmSync(folder, { recursive: true, force: true });
  console.log("share-report e2e:", errs.length ? "errors " + errs : "ok");
  await b.close();
  if (errs.length) process.exit(1);
})();
