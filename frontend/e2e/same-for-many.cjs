// "Same entry for several workers": names typed at once, the "also for" row, then one push.
//   python -m app.main --demo fixtures/sanitized/indian_2026-10.json    (fresh server)
//   node e2e/same-for-many.cjs [screenshot-dir]
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const out = process.argv[2] || ".";

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/");
  await p.getByPlaceholder("Your name").fill("Tester");
  await p.keyboard.press("Enter");
  await p.waitForSelector(".modal", { state: "detached" });
  await p.getByRole("tab", { name: "28", exact: true }).click();
  await p.waitForSelector("text=Sheet 28");
  const codes = await p.evaluate(async () => (await (await fetch("/api/master")).json()).activities.slice(5, 7));

  // 1. Three names typed at once, then times and two activities, all by keyboard.
  await p.locator("#worker").focus();
  await p.keyboard.type("INB-01, INB-02, INB-05");
  await p.keyboard.press("Enter");
  const chips = await p.locator(".also .chip").allInnerTexts();
  console.log("also chips:", chips.map((c) => c.replace(/\s*×$/, "")).join(", "));
  await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.type("19"); await p.keyboard.press("Enter");
  await p.keyboard.type(codes[0]); await p.keyboard.press("Enter");
  await p.keyboard.type(codes[1]); await p.keyboard.press("Enter");
  console.log("button:", await p.locator(".entry .actions button.primary").innerText());
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelectorAll(".queue tbody tr").length === 3);

  // 2. One worker, then two more added in the "also for" row.
  await p.keyboard.type("INB-06"); await p.keyboard.press("Enter");
  const also = p.getByLabel("Add another worker with the same entry");
  await also.fill("INB-07"); await also.press("Enter");
  await also.fill("INB-08"); await also.press("Enter");
  await also.press("Enter"); // empty: on to Time In
  console.log("focus after the also row:", await p.evaluate(() => document.activeElement.id));
  await p.locator(".entry .actions button.primary").click();
  await p.waitForFunction(() => document.querySelectorAll(".queue tbody tr").length === 6);

  // 3. A name that does not exist is reported, the others are still picked.
  await p.locator("#worker").fill("INB-09, XYZ-99");
  await p.locator("#worker").press("Enter");
  console.log("error:", await p.locator(".entry [role=alert]").first().innerText());
  await p.keyboard.press("Escape");

  await p.waitForFunction(() => document.querySelectorAll(".queue .pill.ok").length === 6, null, { timeout: 15000 });
  await p.screenshot({ path: `${out}/same_for_many.png`, fullPage: true });
  await p.getByRole("button", { name: /Push 6 entries/ }).click();
  await p.waitForSelector(".result.ok");
  const day = await p.evaluate(async () =>
    (await (await fetch("/api/days/28")).json()).entries.map((v) => [v.entry.calling_name, v.entry.time_in, v.entry.time_out, v.entry.activities.filter((a) => a.code).map((a) => `${a.code}:${a.hours}`).join(" ")]),
  );
  for (const row of day) console.log(" ", row.join(" | "));
  console.log("written:", day.length, "errors:", errs);
  await b.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
