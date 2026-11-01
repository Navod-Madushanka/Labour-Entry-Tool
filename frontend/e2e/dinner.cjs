// Out exactly 22:00 fills -1 in Additional hours and "dinner" in Remarks; worked hours drop by 1.
// Changing Out away from 22 takes them out again; clearing Additional by hand is left alone.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/dinner.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "7", exact: true }).click();
  const vals = () => p.evaluate(() => [document.querySelector("#additional").value, document.querySelector("#remark")?.value ?? null]);

  await p.locator("#worker").fill("AAA-01"); await p.keyboard.press("Enter");
  await p.locator("#in").fill("7"); await p.locator("#out").fill("22");
  await p.waitForFunction(() => document.querySelector("#additional").value === "-1");
  console.log("Out 22 ->", await vals());
  await p.waitForFunction(() => document.querySelector(".big-number")?.innerText.startsWith("13"));
  console.log("worked:", (await p.locator(".big-number").innerText()).replace(/\s+/g, " "));

  await p.locator("#out").fill("21");
  await p.waitForFunction(() => document.querySelector("#additional").value === "");
  console.log("Out 21 ->", await vals());

  await p.locator("#out").fill("22");
  await p.waitForFunction(() => document.querySelector("#additional").value === "-1");
  await p.locator("#additional").fill(""); // no dinner taken
  await p.waitForTimeout(300);
  const [add] = await vals();
  if (add !== "") throw new Error("cleared Additional was filled again");
  console.log("cleared by hand stays cleared");

  // Typed through and added: the queued entry has -1
  await p.locator("#additional").fill("-1");
  await p.locator('input[aria-label="Activity 1"]').fill("03-11-00-00");
  await p.locator('input[aria-label="Activity 1"]').press("Enter");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelector(".queue tbody")?.innerText.includes("AAA-01"));
  console.log("queued:", (await p.locator(".queue tbody tr", { hasText: "AAA-01" }).innerText()).replace(/\s+/g, " "));
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("dinner e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
