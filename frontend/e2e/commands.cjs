// The command box on made-up data: suggestions, the explanation card (synonyms), the preview,
// errors, running COPY / SET / SHOW, and what a push writes.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/commands.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); localStorage.setItem("labour.commands.open", "1"); });
  await p.reload();
  await p.waitForSelector('input[aria-label="Command"]');
  await p.waitForFunction(() => !document.body.innerText.includes("Loading month"), null, { timeout: 30000 });
  const box = p.getByLabel("Command");
  const card = () => p.locator(".command-card").first().innerText();
  const preview = () => p.locator(".command-preview").innerText();

  // Suggestions and the card while typing.
  await box.click(); await box.type("ins");
  console.log("suggestions for 'ins':", (await p.locator(".command-suggest li").allInnerTexts()).map(s => s.split("\n")[0]).slice(0, 3));
  await box.type("ert");
  const c1 = await card();
  console.log("card for 'insert':", c1.split("\n").slice(0, 2).join(" | "));
  if (!c1.includes("ADD") || !c1.includes('"insert" means ADD')) throw new Error("insert should explain ADD");
  await box.fill("");

  // An error with a hint.
  await box.type("sett out 20");
  console.log("error:", await preview());
  if (!/Did you mean "set"/.test(await preview())) throw new Error("no hint for a typo");
  await box.fill("");

  // COPY two workers from day 2 to day 6.
  await box.type("copy AAA-01, AAA-02 from 2 to 6");
  console.log("preview:", (await preview()).replace(/\s+/g, " "));
  await p.locator(".command-card").first().screenshot({ path: out + "/command-card.png" });
  await box.press("Enter");
  await p.waitForFunction(() => [...document.querySelectorAll('.queue tbody tr')].filter((r) => r.cells[0].textContent.trim() === "6").length === 2);
  console.log("queued:", (await p.$$eval('.queue tbody tr', rs => rs.map(r => r.cells[0].textContent.trim() + " " + r.cells[1].textContent.trim() + " " + r.cells[2].textContent.trim()))).join(" / "));

  // SET on what is waiting: out 20, hours follow.
  await box.type("change out 20 for AAA-01, AAA-02 on 6");
  console.log("preview:", (await preview()).replace(/\s+/g, " "));
  await box.press("Enter");
  await p.waitForFunction(() => [...document.querySelectorAll('.queue tbody tr')].every((r) => r.innerText.includes("20:00")));
  console.log("after SET:", (await p.$$eval('.queue tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, " ").slice(0, 50)))).join(" / "));

  // SHOW lists without changing.
  await box.type("show AAA on 1-3 where out = 19");
  await box.press("Enter");
  await p.waitForSelector(".command-rows");
  console.log("show:", await p.locator(".command-rows p").first().innerText(), "| rows:", await p.locator(".command-rows tbody tr").count());
  await p.screenshot({ path: out + "/commands.png", fullPage: false });

  // Push and read back what the workbook holds.
  await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled, null, { timeout: 15000 });
  await p.locator('.push-bar button').click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  const day6 = await p.evaluate(async () => (await (await fetch('/api/days/6')).json()).entries.map(v => [v.entry.calling_name, v.entry.time_in, v.entry.time_out, v.entry.activities.filter(a => a.code).map(a => `${a.code}:${a.hours}`).join()]));
  console.log("Excel day 6:", JSON.stringify(day6));
  if (JSON.stringify(day6) !== JSON.stringify([["AAA-01", 7, 20, "03-11-00-00-P:12"], ["AAA-02", 7, 20, "03-11-00-00-P:12"]])) throw new Error("unexpected write");
  console.log("errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
