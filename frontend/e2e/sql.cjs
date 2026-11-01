// SQL in the command box on made-up data: multi-line, the card for column names, SELECT with
// GROUP BY, UPDATE into the queue and what a push writes.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/sql.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.setItem("labour.commands.open", "1"); });
  await p.goto(BASE + "app/#");
  await p.locator("#worker").waitFor();
  await p.waitForFunction(() => !document.body.innerText.includes("Loading month"), null, { timeout: 30000 });
  await p.keyboard.press("Control+k");
  const box = p.getByLabel("Command");
  await box.waitFor();
  const preview = () => p.locator(".command-preview").innerText();
  const card = () => p.locator(".command-card").first().innerText();

  // Suggestions name the tables; the card explains a forgiving column name.
  await box.type("SELECT * FROM lab");
  console.log("suggest after FROM:", (await p.locator(".command-suggest li").allInnerTexts()).map((s) => s.split("\n")[0]));
  await box.fill(""); await box.type("SELECT `in times` FROM labor");
  await box.press("ArrowLeft"); for (let i = 0; i < 16; i++) await box.press("ArrowLeft");
  console.log("card:", (await card()).split("\n").slice(0, 2).join(" | "));

  // Multi-line with Shift+Enter: names starting with AAA-0 on day 1, ZIDAL = employee code.
  await box.fill("");
  await box.type("SELECT calling_name, ZIDAL, hours, `ot hours`");
  await box.press("Shift+Enter"); await box.type("FROM labor");
  await box.press("Shift+Enter"); await box.type("WHERE day = 1 AND calling_name LIKE 'AAA-0%' ORDER BY calling_name DESC LIMIT 3");
  console.log("lines in the box:", (await box.inputValue()).split("\n").length, "| preview:", await preview());
  await box.press("Enter");
  await p.locator(".command-rows table").waitFor();
  console.log("result:", await p.locator(".command-rows thead").innerText(), "/", (await p.locator(".command-rows tbody tr").first().innerText()).replace(/\s+/g, " "));

  // GROUP BY with totals.
  await box.fill("SELECT `activity codes`, SUM(Hours) AS Total_Hours, COUNT(*) AS n FROM labor GROUP BY `activity codes` ORDER BY Total_Hours DESC");
  await box.press("End"); await box.press("Enter");
  await p.waitForFunction(() => document.querySelector(".command-rows thead")?.innerText.includes("Total_Hours"));
  console.log("group by:", (await p.locator(".command-rows tbody").innerText()).replace(/\t/g, " ").split("\n").join(" / "));
  await p.screenshot({ path: out + "/sql.png" });
  if (await p.locator(".commands .notice").count()) throw new Error("a SELECT must not say it queued anything");

  // UPDATE into the queue, refused without WHERE, then pushed.
  await box.fill("DELETE FROM labor");
  console.log("no WHERE:", await preview());
  await box.fill("UPDATE labor SET `out times` = '2026-10-02 20:00:00' WHERE calling_name IN ('AAA-01', 'AAA-02') AND `in times` LIKE '2026-10-02%'");
  console.log("preview:", await preview());
  await box.press("End"); await box.press("Enter");
  await p.getByRole("button", { name: /Check and push 2 waiting entries/ }).click();
  await p.locator(".queue tbody tr").first().waitFor();
  await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled, null, { timeout: 15000 });
  await p.locator('.push-bar button').click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  const day2 = await p.evaluate(async () => (await (await fetch('/api/days/2')).json()).entries.filter(v => ["AAA-01", "AAA-02"].includes(v.entry.calling_name)).map(v => [v.entry.calling_name, v.entry.time_out, v.entry.activities[0].hours]));
  console.log("Excel day 2:", JSON.stringify(day2));
  if (JSON.stringify(day2) !== JSON.stringify([["AAA-01", 20, 12], ["AAA-02", 20, 12]])) throw new Error("unexpected write");
  console.log("errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
