// "Same entry also for": suggested and found workers in rows by trade, the main worker's first.
// Made-up data (250 workers, crews of 10, trades in blocks of 10):
//   cd backend && python ../scripts/demo_two_books.py 8012 big    then  node e2e/mates-by-trade.cjs [shots]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload();
  await p.waitForSelector("#worker", { timeout: 20000 });
  await p.getByRole("tab", { name: "21", exact: true }).click();
  await p.locator("#worker").fill("AAA-005"); await p.keyboard.press("Enter");
  await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.waitForSelector(".usual-mates");
  await p.waitForTimeout(800);

  // suggested: the usual crew, in rows by trade
  const sugg = p.locator('.usual-mates [role="group"][aria-label^="Suggested: "]');
  if (await sugg.count()) {
    const labels = await sugg.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    console.log("suggested rows:", labels.join(" | "), "→", (await sugg.first().innerText()).replace(/\s+/g, " ").slice(0, 120));
    if (!labels.every((l) => /^Suggested: \S/.test(l))) throw new Error("a suggested row without its trade");
  } else throw new Error("no usual-crew suggestions");

  // search: two trades, two rows, the main worker's (Carpenter) first
  await p.getByLabel("Add another worker with the same entry").fill("AAA-01");
  const found = p.locator('.usual-mates [role="group"][aria-label^="Found: "]');
  await found.first().waitFor();
  const rows = await found.evaluateAll((els) => els.map((e) => [e.getAttribute("aria-label"), [...e.querySelectorAll("button.mate")].map((x) => x.textContent.trim().split(" ")[1])]));
  console.log("found rows:", JSON.stringify(rows));
  if (rows.length < 2 || rows[0][0] !== "Found: Carpenter") throw new Error("expected rows by trade, Carpenter (the main worker's) first");
  if (rows.some(([label, names]) => !names.length)) throw new Error("empty row");
  await p.locator(".also").screenshot({ path: `${out}/mates-by-trade.png` });
  // the arrows go through the rows in the order shown: Enter adds the first shown
  await p.keyboard.press("Enter");
  const chips = await p.locator(".also .chip-name").allInnerTexts();
  console.log("added:", chips.join(", "));
  if (chips[0] !== rows[0][1][0]) throw new Error("Enter did not take the first worker shown");
  console.log("mates-by-trade e2e: ok; errors:", errs);
  await b.close();
})().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
