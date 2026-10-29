// Own times for one "also for" worker: right-click (or click) the chip, set In/Out, push.
//   python -m app.main --demo fixtures/sanitized/indian_2026-10.json    (fresh server)
//   node e2e/own-times.cjs [screenshot-dir]
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const out = process.argv[2] || ".";

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/");
  await p.getByPlaceholder("Your name").fill("Tester");
  await p.keyboard.press("Enter");
  await p.waitForSelector(".modal", { state: "detached" });
  await p.getByRole("tab", { name: "30", exact: true }).click();
  const code = await p.evaluate(async () => (await (await fetch("/api/master")).json()).activities[5]);

  await p.locator("#worker").fill("INB-01, INB-02, INB-05");
  await p.locator("#worker").press("Enter");
  await p.locator("#in").fill("7");
  await p.locator("#out").fill("19");
  await p.locator('[aria-label="Activity 1"]').fill(code); // hours left to fill themselves

  // Right-click INB-05: own times 8 to 17.
  await p.locator(".also .chip", { hasText: "INB-05" }).click({ button: "right" });
  await p.getByLabel("Time In for INB-05").fill("8");
  await p.getByLabel("Time Out for INB-05").fill("17");
  await p.getByLabel("Time Out for INB-05").press("Enter");
  console.log("chips:", (await p.locator(".also .chip").allInnerTexts()).map((t) => t.replace(/\s*×$/, "")).join(" | "));
  await p.screenshot({ path: `${out}/own_times.png` });

  // Click INB-02, then cancel: it keeps the shared times.
  await p.locator(".also .chip", { hasText: "INB-02" }).getByRole("button", { name: "INB-02", exact: true }).click();
  await p.getByRole("button", { name: "Cancel" }).click();

  await p.locator(".entry .actions button.primary").click(); // Add 3 workers
  await p.waitForFunction(() => document.querySelectorAll(".queue .pill.ok").length === 3, null, { timeout: 10000 });
  await p.getByRole("button", { name: /Push 3 entries/ }).click();
  await p.waitForSelector(".result.ok");
  const day = await p.evaluate(async () =>
    (await (await fetch("/api/days/30")).json()).entries
      .filter((v) => ["INB-01", "INB-02", "INB-05"].includes(v.entry.calling_name))
      .map((v) => `${v.entry.calling_name} ${v.entry.time_in}-${v.entry.time_out} hours ${v.entry.activities.filter((a) => a.code).map((a) => a.hours).join("+")}`),
  );
  console.log(day.join("\n"));
  console.log("errors:", errs);
  await b.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
