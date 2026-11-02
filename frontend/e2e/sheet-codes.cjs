// No activity code in a workbook that needs one: a warning to confirm before Push. On the manpower
// sheet: rename a code, add a code row, tick a worker onto it, untick. Made-up data only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/sheet-codes.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "7", exact: true }).click();
  const pushReady = () => p.evaluate(() => !document.querySelector(".push-bar button")?.disabled);
  const settle = () => p.waitForFunction(() => !document.querySelector(".queue tbody")?.innerText.includes("checking"));

  // AAA-01 with a code, AAA-02 added with Ctrl+Enter and no code
  await p.locator("#worker").fill("AAA-01"); await p.keyboard.press("Enter");
  await p.keyboard.type("7"); await p.keyboard.press("Enter"); await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.keyboard.type("03-11-00-00"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelector(".queue tbody")?.innerText.includes("AAA-01"));
  await p.locator("#worker").fill("AAA-02"); await p.keyboard.press("Enter");
  await p.keyboard.type("7"); await p.keyboard.press("Enter"); await p.keyboard.type("19"); await p.keyboard.press("Control+Enter");
  await p.waitForFunction(() => document.querySelector(".queue tbody")?.innerText.includes("AAA-02"));
  await settle();
  const row = (await p.locator(".queue tbody tr", { hasText: "AAA-02" }).innerText()).replace(/\s+/g, " ");
  console.log("AAA-02 without a code:", row.slice(0, 160));
  if (!/No activity code/i.test(await p.locator(".queue").innerText())) throw new Error("no warning for a missing code");
  if (await pushReady()) throw new Error("push allowed without confirming the missing code");
  console.log("push held until confirmed: yes");

  // tick AAA-02 on 03-11-00-00 on the sheet: the warning goes, the whole day is on the code
  await p.getByLabel("AAA-02 on 03-11-00-00").check();
  await settle();
  const q2 = (await p.locator(".queue tbody tr", { hasText: "AAA-02" }).innerText()).replace(/\s+/g, " ");
  console.log("ticked:", q2.slice(0, 120));
  if (!q2.includes("03-11-00-00 · 11")) throw new Error("tick did not put the day on the code");
  await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled);
  console.log("push ready after the tick: yes");

  // add a new code row and move AAA-01 onto it
  await p.getByLabel("Add an activity code to sheet 7").fill("03-20-00-00-c-8");
  await p.keyboard.press("Enter");
  await p.getByLabel("AAA-01 on 03-20-00-00-C-8").check();
  await settle();
  const q1 = (await p.locator(".queue tbody tr", { hasText: "AAA-01" }).innerText()).replace(/\s+/g, " ");
  console.log("AAA-01 on the new code:", q1.slice(0, 120));
  if (!q1.includes("03-20-00-00-C-8 · 11") || q1.includes("03-11-00-00 ·")) throw new Error("not moved to the new code");

  // rename 03-11-00-00 (AAA-02) to 03-11-00-00-P from the code cell
  await p.getByRole("button", { name: "Change code 03-11-00-00", exact: true }).click();
  await p.keyboard.press("Control+a"); await p.keyboard.type("03-11-00-00-P"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => [...document.querySelectorAll(".queue tbody tr")].some((r) => r.innerText.includes("AAA-02") && r.innerText.includes("03-11-00-00-P")));
  await settle();
  const q3 = (await p.locator(".queue tbody tr", { hasText: "AAA-02" }).innerText()).replace(/\s+/g, " ");
  console.log("renamed:", q3.slice(0, 120));
  if (!q3.includes("03-11-00-00-P")) throw new Error("rename failed");

  // untick AAA-01: no code again -> warning, push held
  await p.getByLabel("AAA-01 on 03-20-00-00-C-8").uncheck();
  await settle();
  if (await pushReady()) throw new Error("push allowed after unticking the only code");
  console.log("untick -> warning again, push held: yes");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("sheet-codes e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
