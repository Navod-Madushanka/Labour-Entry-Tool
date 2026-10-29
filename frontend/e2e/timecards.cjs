// Time cards: a list like "INB-01 to INB-20", one card per worker (practice mode: nothing printed).
//   python -m app.main --demo fixtures/sanitized/indian_2026-10.json    (fresh server)
//   node e2e/timecards.cjs [screenshot-dir]
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const out = process.argv[2] || ".";

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + "/");
  await p.getByPlaceholder("Your name").fill("Tester");
  await p.keyboard.press("Enter");
  await p.waitForSelector(".modal", { state: "detached" });
  await p.getByRole("link", { name: "Time cards" }).click();
  await p.waitForSelector("section.timecards #tc-sheet");
  console.log("sheet:", await p.locator("#tc-sheet").inputValue(), "| cell:", await p.locator("#tc-cell").inputValue());
  await p.locator("#tc-names").fill("INB-01 to INB-20, XYZ-99");
  console.log("list:", (await p.locator(".tc-list").innerText()).replace(/\s+/g, " "));
  await p.locator("#tc-names").fill("INB-01 to INB-20");
  await p.getByRole("button", { name: /Print \d+ time cards/ }).click();
  await p.waitForSelector(".tc-progress");
  await p.waitForTimeout(400);
  console.log("while running:", (await p.locator(".tc-progress").innerText()).replace(/\s+/g, " "));
  await p.screenshot({ path: `${out}/timecards_running.png` });
  await p.waitForSelector(".tc-progress.done", { timeout: 20000 });
  console.log("done:", (await p.locator(".tc-progress").innerText()).replace(/\s+/g, " "));
  await p.screenshot({ path: `${out}/timecards_done.png` });
  console.log("errors:", errs);
  await b.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
