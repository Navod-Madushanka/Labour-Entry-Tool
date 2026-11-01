// The empty worker box lists who is probably next (↓ + Enter picks; a plain Enter never does), and
// a waiting entry whose code differs from 3+ of the worker's usual crew gets a "⚠ crew" mark.
// Made-up data (the 250-worker book: crews of 10, one code per crew).
//   cd backend && python ../scripts/demo_two_books.py 8012 big
//   node e2e/next-and-crew.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const prev = await (await p.request.get(BASE + "api/previous-month")).json();
  console.log("previous month in the demo:", prev.source, Object.keys(prev.days).length, "days");
  if (Object.keys(prev.days).length !== 7) throw new Error("previous month not carried");
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("tab", { name: "21", exact: true }).click(); // an empty day after 20 filled ones
  const a1 = 'input[aria-label="Activity 1"]';
  const add = async (name, code) => {
    await p.locator("#worker").fill(name); await p.keyboard.press("Enter");
    await p.waitForFunction(() => document.activeElement?.id === "in");
    await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    await p.waitForFunction((s) => document.activeElement === document.querySelector(s), a1);
    if (code) await p.keyboard.type(code);
    else if (!(await p.locator(a1).getAttribute("placeholder")).includes("Enter to use")) await p.keyboard.press("ArrowDown");
    await p.waitForFunction((s) => document.querySelector(s).value !== "" || document.querySelector(s).placeholder.includes("Enter to use"), a1);
    await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    await p.waitForFunction((n) => document.querySelector(".queue tbody")?.innerText.includes(n), name);
  };

  // crew 0 = AAA-001..AAA-010: the first three take the crew's code
  await add("AAA-001");
  // the empty box now lists the crew first
  await p.locator("#worker").focus();
  await p.waitForSelector(".dropdown .dropdown-head");
  const list = (await p.locator(".dropdown li[role=option] b").allInnerTexts()).slice(0, 5);
  console.log("probably next:", list.join(", "));
  if (!list.slice(0, 3).every((n) => /^AAA-0(0[2-9]|10)$/.test(n))) throw new Error("crew not first: " + list);
  await p.keyboard.press("Enter");
  if (await p.evaluate(() => document.querySelector(".worker-card"))) throw new Error("a plain Enter picked a guess");
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter");
  await p.waitForSelector(".worker-card");
  console.log("↓ Enter picked:", (await p.locator(".worker-card b").first().innerText()));
  await p.keyboard.press("Escape");

  await add("AAA-002"); await add("AAA-003"); await add("AAA-005"); await add("AAA-006");
  // the next one: the crew agrees -> the box is filled ("n/n crew today")
  await p.locator("#worker").fill("AAA-004"); await p.keyboard.press("Enter");
  await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  const ph = await p.locator(a1).getAttribute("placeholder");
  const why = await p.locator(a1).getAttribute("title");
  console.log("4th worker, code box:", ph, "|", why);
  if (!ph.includes("Enter to use") || !/([2-9])\/\1 crew today/.test(why)) throw new Error("expected a confident fill; queue: " + (await p.locator(".queue tbody").innerText()).replace(/\s+/g, " ") + " | chips: " + (await p.locator(".code-chips").innerText()).replace(/\s+/g, " "));
  // ...but a different code is typed: the manpower sheet marks it
  await p.keyboard.type("09-54-00-00-P"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  await p.waitForSelector(".crew-mismatch");
  console.log("mark:", await p.locator(".crew-mismatch").first().getAttribute("title"));
  if ((await p.locator(".crew-mismatch").count()) !== 1) throw new Error("only the odd one out is marked");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("next-and-crew e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
