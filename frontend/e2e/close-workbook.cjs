// Take workbooks off the list from the top-bar workbook menu (three made-up workbooks open).
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/close-workbook.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const asked = []; p.on('dialog', d => { asked.push(d.message().split("\n")[0]); d.accept(); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  const books = async () => (await p.evaluate(async () => (await (await fetch('/api/setup')).json()).books.map(b => b.name.replace("Labour Entry Sheet October 2026 - ", "") + (b.active ? "*" : ""))));
  console.log("open:", await books());

  // Something waiting in DEMO A (the one in use).
  await p.locator('#worker').fill("AAA-01"); await p.keyboard.press('Enter');
  await p.keyboard.type('7'); await p.keyboard.press('Enter'); await p.keyboard.type('19'); await p.keyboard.press('Enter');
  await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.waitForSelector('.queue tbody tr');

  // Close DEMO C, which is not in use: no warning about the queue, the entry screen stays.
  await p.locator(".book-current").click();
  console.log("menu:", (await p.locator(".book-list .book-name").allInnerTexts()).map(t => t.replace(/\s+/g, " ")));
  await p.screenshot({ path: out + "/book-menu.png" });
  await p.getByRole("button", { name: "Close Labour Entry Sheet October 2026 - DEMO C.json" }).click();
  await p.waitForFunction(() => !document.querySelector(".book-list"));
  await p.waitForTimeout(500);
  console.log("after closing C:", await books(), "| asked:", asked.splice(0));
  if ((await books()).join() !== "DEMO B.json,DEMO A.json*") throw new Error("C should be gone, A still in use");
  if (!(await p.locator('.queue tbody').innerText()).includes("AAA-01")) throw new Error("A's queue should stay");

  // Close DEMO A, the one in use, with an entry waiting: asked twice (close, drop the entry).
  await p.locator(".book-current").click();
  await p.getByRole("button", { name: "Close Labour Entry Sheet October 2026 - DEMO A.json" }).click();
  await p.waitForSelector("text=Check activity codes and hours"); // DEMO B, not checked yet: its start page
  console.log("after closing A:", await books(), "| asked:", asked.splice(0));

  // Close the last one from the start page: back to choosing a workbook.
  await p.waitForFunction(() => !document.body.innerText.includes("Reading every sheet"), null, { timeout: 20000 });
  await p.getByRole("button", { name: /^Change$/ }).click();
  await p.locator(".open-books li", { hasText: "DEMO B" }).getByRole("button", { name: "Close" }).click();
  await p.waitForFunction(() => !document.querySelector(".open-books"));
  console.log("after closing B:", await books(), "| drop zone shown:", await p.locator(".drop").count() > 0);
  console.log("errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
