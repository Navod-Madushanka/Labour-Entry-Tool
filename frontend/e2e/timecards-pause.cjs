// Time cards: pause and resume, then stop and continue from the next card (not from the start).
// Made-up data, practice mode (nothing is printed):
//   cd backend && python ../scripts/demo_two_books.py 8012 big
//   node e2e/timecards-pause.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.getByRole("link", { name: "Time cards" }).click();
  await p.waitForSelector("section.timecards #tc-sheet");
  await p.locator("#tc-names").fill("AAA-001 to AAA-040");
  const job = async () => (await p.request.get(BASE + "api/timecards/job")).json();
  await p.getByRole("button", { name: /Print 40 time cards/ }).click();
  await p.waitForFunction(() => /Printing|Going through/.test(document.querySelector(".tc-progress")?.textContent ?? ""));
  await p.getByRole("button", { name: "⏸ Pause" }).click();
  await p.waitForSelector("text=⏸ Paused after");
  const held = await job();
  await p.waitForTimeout(800);
  if ((await job()).done !== held.done) throw new Error("cards printed while paused");
  console.log("paused:", (await p.locator(".tc-progress").innerText()).replace(/\s+/g, " "));
  await p.screenshot({ path: `${out}/timecards_paused.png` });
  await p.getByRole("button", { name: "▶ Resume" }).click();
  await p.waitForFunction((d) => fetch("/api/timecards/job").then((r) => r.json()).then((j) => j.done > d + 1), held.done);
  await p.getByRole("button", { name: "Stop after this card" }).click();
  const cont = p.getByRole("button", { name: /^▶ Continue from / });
  await cont.waitFor();
  const stopped = await job();
  console.log("stopped:", stopped.done, "of", stopped.total, "| button:", await cont.innerText());
  if (stopped.left.length !== 40 - stopped.done || !(await cont.innerText()).includes(stopped.left[0])) throw new Error("left list wrong");
  await p.screenshot({ path: `${out}/timecards_stopped.png` });
  await cont.click();
  await p.waitForSelector("text=✓ Practice run done", { timeout: 30000 });
  const end = await job();
  const dupes = end.printed.length - new Set(end.printed).size;
  console.log("done:", end.done, "of", end.total, "| printed twice:", dupes);
  if (end.done !== 40 || end.printed.length !== 40 || dupes) throw new Error("continue printed the wrong cards");
  if (await p.getByRole("button", { name: /Continue from/ }).count()) throw new Error("continue still offered");
  console.log("timecards-pause e2e: ok; errors:", errs);
  await b.close();
})().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
