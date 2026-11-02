// SQL panel on Codes & registration: tables tree, editor (colours, completion, Ctrl+Enter), result
// grid, Data tab with a WHERE filter and cell editing, changes shown old -> new before they go to
// the waiting list. Made-up data only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/sql-panel.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1100 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("labour.user", "Tester"); });
  await p.reload(); await p.waitForSelector("#worker");
  await p.waitForFunction(() => !document.querySelector(".statusbar")?.innerText.includes("Loading month"), null, { timeout: 60000 });
  await p.getByRole("link", { name: "Codes & registration" }).click();
  await p.waitForSelector(".sqlws-tree");
  const tree = (await p.locator(".sqlws-tree").innerText()).replace(/\s+/g, " ");
  console.log("tree:", tree.slice(0, 160));

  // a query typed with completion, run with Ctrl+Enter
  const ed = p.getByLabel("SQL query");
  await ed.click(); await p.keyboard.press("Control+a"); await p.keyboard.press("Delete");
  await p.keyboard.type("SEL");
  await p.waitForSelector(".sqlws-pop li");
  console.log("completion for SEL:", (await p.locator(".sqlws-pop li").first().innerText()).replace(/\s+/g, " "));
  await p.keyboard.press("Tab");
  await p.keyboard.type(" calling_name, in, out, code FROM entries WHERE calling_name LIKE 'AAA-0%' AND day = 2");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+Enter");
  await p.waitForSelector(".sqlws-grid tbody tr");
  console.log("status:", await p.locator(".sqlws-status").first().innerText());
  const rows = await p.locator(".sqlws-result .sqlws-grid tbody tr").count();
  console.log("rows:", rows, "| first:", (await p.locator(".sqlws-result .sqlws-grid tbody tr").first().innerText()).replace(/\s+/g, " "));
  if (!rows) throw new Error("no result rows");
  if (SHOTS) await p.locator(".sqlws").screenshot({ path: `${SHOTS}/sql-query.png` });

  // an error is shown and marked
  await ed.click(); await p.keyboard.press("Control+a"); await p.keyboard.type("SELECT nme FROM workers");
  await p.keyboard.press("Escape"); await p.keyboard.press("Control+Enter");
  await p.waitForSelector(".sqlws-error");
  console.log("error:", await p.locator(".sqlws-error").innerText());

  // click a table in the tree: Data tab
  await p.locator(".tree-name", { hasText: "workers" }).click();
  await p.waitForSelector(".data-filter");
  console.log("data workers:", await p.locator(".sqlws-status").first().innerText());

  // Data tab on entries with a filter, then edit a cell
  await p.locator(".tree-name", { hasText: "entries" }).click();
  await p.getByLabel("Filter").fill("day = 2 AND calling_name = 'AAA-01'");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelectorAll(".sqlws-result .sqlws-grid tbody tr").length === 1);
  const outCol = await p.locator(".sqlws-result .sqlws-grid thead th").allInnerTexts();
  const ix = outCol.findIndex((t) => t.trim().startsWith("out"));
  const cell = p.locator(".sqlws-result .sqlws-grid tbody tr").first().locator("td").nth(ix);
  console.log("out before:", await cell.innerText());
  await cell.dblclick();
  await p.getByLabel("New out").fill("20:00"); await p.keyboard.press("Enter");
  await p.waitForSelector(".sqlws-pending");
  await p.waitForSelector(".sqlws-grid td.changed");
  console.log("grid still shown, cell marked:", await p.locator(".sqlws-grid td.changed").innerText());
  const pend = (await p.locator(".sqlws-pending").innerText()).replace(/\s+/g, " ");
  console.log("pending:", pend.slice(0, 220));
  if (!/Out 19:00 20:00/.test(pend)) throw new Error("old -> new not shown");
  if (SHOTS) await p.locator(".sqlws").screenshot({ path: `${SHOTS}/sql-pending.png` });

  // UPDATE from the query tab adds to the same list; then everything goes to the waiting list
  await p.getByRole("tab", { name: "Query" }).click();
  await ed.click(); await p.keyboard.press("Control+a");
  await p.keyboard.type("UPDATE entries SET remark = 'rain' WHERE calling_name LIKE 'AAA-0%' AND day = 3");
  await p.keyboard.press("Escape"); await p.keyboard.press("Control+Enter");
  await p.waitForFunction(() => document.querySelectorAll(".pending-block").length === 2);
  const btn = p.locator(".sqlws-pending .actions button.primary");
  console.log("button:", await btn.innerText());
  await btn.click();
  await p.waitForSelector(".sqlws .ok-text");
  console.log("applied:", (await p.locator(".sqlws .ok-text").innerText()).replace(/\s+/g, " "));
  await p.getByRole("link", { name: "Entry" }).click();
  await p.waitForSelector(".queue tbody tr");
  const q = (await p.locator(".queue tbody").innerText());
  console.log("waiting list has AAA-01 day 2 at 20:00:", /AAA-01[\s\S]*07:00–20:00/.test(q), "| rain remarks queued:", (q.match(/\n3\t/g) || []).length >= 0);
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("sql-panel e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
