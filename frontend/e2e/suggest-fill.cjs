// After adding a worker the form is empty, and the next worker's suggested times and code show in
// the empty boxes: Enter takes them. Also cleared after a push.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/suggest-fill.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole('tab', { name: '7', exact: true }).click();
  const values = () => p.evaluate(() => [document.querySelector("#in").value, document.querySelector("#out").value,
    document.querySelector('input[aria-label="Activity 1"]')?.value ?? null]);

  // First worker typed by hand, with times different from their history.
  await p.locator('#worker').fill("AAA-01"); await p.keyboard.press('Enter');
  await p.keyboard.type('8'); await p.keyboard.press('Enter');
  await p.keyboard.type('20'); await p.keyboard.press('Enter');
  await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.waitForSelector('.queue tbody tr');
  const after = await values();
  if (after.join("|") !== "||") throw new Error("form not cleared after adding: " + after);
  console.log("form cleared after adding");

  // AAA-02 usually works with AAA-01: today's times are filled in; Enter, Enter, Enter, Enter.
  await p.locator('#worker').fill("AAA-02"); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector("#in").value === "08:00" && document.activeElement?.id === "in");
  const filled = await values();
  console.log("AAA-02 times filled in:", filled[0], filled[1], "| In selected:",
    await p.evaluate(() => { const i = document.querySelector("#in"); return i.selectionStart === 0 && i.selectionEnd === i.value.length; }));
  await p.keyboard.press('Enter'); // In is right -> Out
  await p.waitForFunction(() => document.activeElement?.id === "out");
  await p.keyboard.press('Enter'); // Out is right -> activity
  await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Activity 1");
  // One partner entered: not enough to fill the box, so Enter alone takes nothing; ↓ picks the
  // first suggestion on purpose.
  console.log("Activity box says:", await p.locator('input[aria-label="Activity 1"]').getAttribute("placeholder"),
    "| chips:", (await p.locator('.code-chips').innerText()).replace(/\s+/g, " ").slice(0, 90));
  await p.keyboard.press('Enter');
  if (await p.locator('input[aria-label="Activity 1"]').inputValue()) throw new Error("a plain Enter took an unsure code");
  await p.keyboard.press('ArrowDown');
  await p.waitForFunction(() => document.querySelector('input[aria-label="Activity 1"]').value !== "");
  await p.keyboard.press('Enter'); // the code -> next box
  await p.waitForSelector('input[aria-label="Activity 2"]:focus');
  await p.keyboard.press('Enter'); // adds the worker
  await p.waitForFunction(() => document.querySelector('.queue tbody').innerText.includes("AAA-02"));
  const row = await p.locator('.queue tbody tr', { hasText: "AAA-02" }).innerText();
  console.log("AAA-02 queued:", row.replace(/\s+/g, " "));
  if (!/08:00.20:00/.test(row) || !row.includes("03-11-00-00-P")) throw new Error("suggestion not used");

  // Wrong suggestion: typing replaces it.
  await p.locator('#worker').fill("AAA-03"); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector("#in").value === "08:00" && document.activeElement?.id === "in");
  await p.keyboard.type('9'); await p.keyboard.press('Enter');
  const typed = await values();
  if (typed[0] !== "09:00" || typed[1] !== "20:00") throw new Error("typing should replace In only: " + typed);
  console.log("typed over the suggestion:", typed[0], typed[1]);
  await p.keyboard.press('Escape'); // clear the form

  // A worker with no partner today: their usual times are suggested.
  await p.locator('#worker').fill("AAA-05"); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector("#in").value !== "");
  console.log("AAA-05 times filled in:", (await values()).slice(0, 2).join("-"), "|", await p.locator("#in").getAttribute("title"));

  // A fast typist: name, Enter and a time straight away still replaces the suggestion.
  await p.keyboard.press('Escape');
  await p.locator('#worker').fill("AAA-06"); await p.keyboard.press('Enter'); await p.keyboard.type('6');
  await p.keyboard.press('Enter');
  const fast = await values();
  if (fast[0] !== "06:00") throw new Error("fast typing should replace the suggestion: " + fast);
  console.log("fast typing replaced it:", fast[0]);
  await p.keyboard.press('Escape');

  // A night-shift worker (19:00-03:00 suggested, "Next day" with it): typing a day shift over it
  // must not keep "Next day" (07:00-19:00 is 11 hours, not 35).
  await p.locator('#worker').fill("AAA-09"); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector("#in").value === "19:00" && document.querySelector("#out").value === "03:00");
  await p.keyboard.type('7'); await p.keyboard.press('Enter');
  await p.keyboard.type('19'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('.big-number')?.textContent?.startsWith('11 '), null, { timeout: 5000 })
    .catch(async () => { throw new Error("night shift typed over: " + await p.locator('.big-number').textContent()); });
  console.log("night-shift suggestion typed over: 11 hours");
  await p.keyboard.press('Escape');

  // Full speed: name, Enter x3 (pick, In, Out), ↓ (code), Enter x2 (next box, add) without waiting.
  await p.locator('#worker').fill("AAA-07");
  for (let i = 0; i < 3; i++) await p.keyboard.press('Enter');
  await p.keyboard.press('ArrowDown');
  for (let i = 0; i < 2; i++) await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('.queue tbody').innerText.includes("AAA-07"), null, { timeout: 5000 })
    .catch(async () => { throw new Error("full-speed keys did not add AAA-07: " + JSON.stringify(await p.evaluate(() => ({ focus: document.activeElement?.id || document.activeElement?.getAttribute("aria-label"), a1: document.querySelector(`input[aria-label="Activity 1"]`)?.value, ph: document.querySelector(`input[aria-label="Activity 1"]`)?.placeholder, w: document.querySelector("#worker").value, q: document.querySelector(".queue tbody")?.innerText })))); });
  console.log("Enter x3, down, Enter x2 at full speed adds the worker");

  // Push: the form is left clean (no worker was being typed).
  await p.locator('#worker').fill("");
  await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled);
  await p.locator('.push-bar button').click();
  await p.getByLabel("Supervisor", { exact: true }).fill("Test Supervisor"); await p.keyboard.press("Enter"); // whose manpower sheet
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  const pushed = await values();
  if (pushed.join("|") !== "||") throw new Error("form not clear after push: " + pushed);
  console.log("form clear after push; errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
