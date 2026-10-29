// Excel-style sums in the number boxes: "=16-7" -> 9, shown live, written as the number.
//   python -m app.main --demo fixtures/sanitized/indian_2026-10.json    (fresh server)
//   node e2e/formulas.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/");
  await p.getByPlaceholder("Your name").fill("Tester");
  await p.keyboard.press("Enter");
  await p.waitForSelector(".modal", { state: "detached" });
  await p.getByRole("tab", { name: "30", exact: true }).click();
  const codes = await p.evaluate(async () => (await (await fetch("/api/master")).json()).activities.slice(5, 7));

  await p.locator("#worker").fill("INB-01");
  await p.locator("#worker").press("Enter");
  await p.locator("#in").fill("7");
  await p.locator("#out").fill("21");
  await p.locator('[aria-label="Activity 1"]').fill(codes[0]);
  await p.locator('[aria-label="Hours 1"]').fill("=21-16");
  console.log("live hint:", await p.locator("table.lines .hint").first().innerText());
  await p.locator('[aria-label="Activity 2"]').fill(codes[1]); // leaving Hours 1 turns it into the number
  console.log("hours 1 after leaving the box:", await p.locator('[aria-label="Hours 1"]').inputValue());
  await p.locator('[aria-label="Hours 2"]').fill("=16-7-1");
  await p.locator('[aria-label="Hours 2"]').press("Enter"); // adds the worker straight from the formula
  await p.waitForSelector(".queue .pill.ok", { timeout: 8000 });
  console.log("queued:", (await p.locator(".queue tbody tr").first().innerText()).replace(/\s+/g, " "));

  // A wrong formula is caught before anything is added.
  await p.locator("#worker").fill("INB-02");
  await p.locator("#worker").press("Enter");
  await p.locator('[aria-label="Hours 1"]').fill("=16-");
  console.log("wrong formula:", await p.locator("table.lines .error-text").first().innerText());
  await p.keyboard.press("Escape");

  await p.getByRole("button", { name: /Push 1 entry/ }).click();
  await p.waitForSelector(".result.ok");
  const written = await p.evaluate(async () =>
    (await (await fetch("/api/days/30")).json()).entries.filter((v) => v.entry.calling_name === "INB-01").map((v) => v.entry.activities.filter((a) => a.code).map((a) => a.hours)),
  );
  console.log("written hours:", JSON.stringify(written), "errors:", errs);
  await b.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
