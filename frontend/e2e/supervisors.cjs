// Whose manpower sheet: asked at push (pick or type a supervisor), then found again on the
// Supervisors page, laid out like the paper; a sheet can be moved to another supervisor.
// Made-up data:
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/supervisors.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "AAA-02 out 18:00 on the paper" : undefined));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.setItem("labour.user", "Tester"); for (const k of Object.keys(localStorage)) if (k.startsWith("labour.queue")) localStorage.removeItem(k); });
  await p.reload();
  await p.waitForSelector('input[aria-label="Activity 1"]', { timeout: 15000 });
  await p.getByRole("tab", { name: "4", exact: true }).click();
  const add = async (name, tin, tout) => {
    await p.locator("#worker").fill(name); await p.keyboard.press("Enter");
    await p.keyboard.type(tin); await p.keyboard.press("Enter");
    await p.keyboard.type(tout); await p.keyboard.press("Enter");
    const hint = await p.locator('input[aria-label="Activity 1"]').getAttribute("placeholder");
    if (!hint.includes("Enter to use")) await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    await p.waitForFunction((n) => [...document.querySelectorAll(".queue tbody tr")].some((r) => r.textContent.includes(n)), name, { timeout: 10000 })
      .catch(async (e) => {
        const state = await p.evaluate(() => ({
          focus: document.activeElement?.getAttribute("aria-label") || document.activeElement?.id,
          inputs: [...document.querySelectorAll("input")].slice(0, 8).map((i) => `${i.getAttribute("aria-label") || i.id}=${i.value}`).join(" | "),
          queue: document.querySelector(".queue tbody")?.innerText,
        }));
        console.log("STUCK at", name, "| hint:", hint, "|", JSON.stringify(state));
        await p.screenshot({ path: `${out}/stuck.png` });
        throw e;
      });
  };
  const push = async (supervisor, { chip } = {}) => {
    await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled);
    await p.locator(".push-bar button").click();
    const dlg = p.getByRole("dialog", { name: "Whose manpower sheet is this?" });
    await dlg.waitFor();
    if (chip) await dlg.getByRole("radio", { name: chip }).click();
    else await p.getByLabel("Supervisor", { exact: true }).fill(supervisor);
    await p.waitForTimeout(300); await p.screenshot({ path: `${out}/supervisor-dialog.png` });
    await dlg.getByRole("button", { name: new RegExp(`^Push \\d+ (entry|entries) for ${chip ?? supervisor}$`) }).click();
    await p.waitForFunction(() => !document.querySelector(".queue tbody tr"), null, { timeout: 15000 });
  };

  await add("AAA-01", "7", "19"); await add("AAA-02", "7", "19");
  await push("Kamal Perera");
  await add("AAA-03", "8", "17");
  await push("Nimal");
  // Kamal again, picked from the list this time
  await add("AAA-04", "7", "19");
  await push(null, { chip: "Kamal Perera" });

  await p.getByRole("link", { name: "Supervisors" }).click();
  await p.waitForSelector("table.sup-index tbody tr");
  const rows = await p.locator("table.sup-index tbody tr").allInnerTexts();
  console.log("index:", rows.map((r) => r.replace(/\s+/g, " ")).join(" | "));
  if (rows.length !== 2) throw new Error("expected 2 sheets (Kamal, Nimal on sheet 4)");
  await p.getByLabel("Supervisor", { exact: true }).selectOption("Kamal Perera");
  const kamal = p.locator('.mp-day[data-supervisor="Kamal Perera"]');
  await kamal.waitFor();
  const names = await kamal.locator(".mp-grid thead tr").first().innerText();
  console.log("Kamal's sheet:", names.replace(/\s+/g, " "));
  for (const n of ["AAA-01", "AAA-02", "AAA-04"]) if (!names.includes(n)) throw new Error(`${n} missing on Kamal's sheet`);
  if (names.includes("AAA-03")) throw new Error("AAA-03 is Nimal's");
  await p.screenshot({ path: `${out}/supervisor-sheet.png`, fullPage: true });

  // Nimal's sheet was Kamal's really: move it
  await p.getByLabel("Supervisor", { exact: true }).selectOption("");
  await p.getByLabel("New supervisor for sheet 4 of Nimal").fill("Kamal Perera");
  await p.locator('.mp-day[data-supervisor="Nimal"] button', { hasText: "Move" }).click();
  await p.waitForFunction(() => document.querySelectorAll("table.sup-index tbody tr").length === 1);
  const all = await (await p.request.get(BASE + "api/supervisor-sheets")).json();
  console.log("after move:", all.map((o) => `${o.calling_name}:${o.supervisor}`).join(", "));
  if (all.length !== 4 || all.some((o) => o.supervisor !== "Kamal Perera")) throw new Error("move failed");

  // Search: a worker shows the sheets they are on, highlighted
  await p.getByLabel("Search sheets").fill("aaa-03");
  await p.waitForSelector(".sup-hits");
  console.log("search:", (await p.locator(".sup-hits").innerText()).replace(/\s+/g, " "));
  if (!(await p.locator(".manpower.record mark", { hasText: "AAA-03" }).count())) throw new Error("search hit not highlighted");
  await p.getByLabel("Search sheets").fill("zzz");
  await p.waitForSelector("text=No sheet matches.");
  await p.getByLabel("Search sheets").fill("");

  // Review: matches the paper, then a problem with a note
  const sheet = p.locator('.mp-day[data-supervisor="Kamal Perera"]');
  await sheet.getByRole("button", { name: "✓ Matches the paper" }).click();
  await p.waitForSelector("table.sup-index >> text=✓ Matches the paper");
  await sheet.getByRole("button", { name: "⚠ Problem…" }).click();
  await p.waitForSelector("table.sup-index >> text=AAA-02 out 18:00 on the paper");
  await p.getByLabel("Review").selectOption("problem");
  if ((await p.locator("table.sup-index tbody tr").count()) !== 1) throw new Error("review filter");
  await p.getByLabel("Review").selectOption("");
  await sheet.getByRole("button", { name: "✓ Matches the paper" }).click();
  await p.waitForSelector("text=all reviewed");
  await p.screenshot({ path: `${out}/supervisor-review.png`, fullPage: true });
  // the sheet changes after the review (a worker given to another supervisor): review again
  const a4 = all.find((o) => o.calling_name === "AAA-04");
  await p.request.post(BASE + "api/supervisor-sheets/reassign", { data: { ids: [a4.id], supervisor: "Nimal" } });
  await p.reload(); await p.waitForSelector("table.sup-index tbody tr");
  const idx = (await p.locator("table.sup-index").innerText()).replace(/\s+/g, " ");
  console.log("after a change:", idx);
  if (!idx.includes("Changed since review") || !idx.includes("Not reviewed")) throw new Error("change since review not shown");

  // Analysis: hours by supervisor, and the supervisor filter
  await p.getByRole("link", { name: "Analysis" }).click();
  await p.getByRole("tab", { name: "Supervisors" }).click();
  const table = (await p.locator(".analysis .card", { hasText: "Hours by supervisor" }).innerText()).replace(/\s+/g, " ");
  console.log("analysis:", table.slice(0, 300));
  if (!table.includes("Kamal Perera") || !table.includes("Nimal")) throw new Error("supervisors missing in analysis");
  if (!/Kamal Perera 1 0 0 /.test(table)) throw new Error("Kamal's sheet changed after its review: not counted as reviewed");
  await p.screenshot({ path: `${out}/supervisor-analysis-table.png`, fullPage: true });
  const width = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (width > 0) throw new Error(`the page is ${width}px wider than the window`);
  await p.getByLabel("Supervisor filter").selectOption("Nimal");
  await p.getByRole("tab", { name: "Overview" }).click();
  await p.screenshot({ path: `${out}/supervisor-analysis.png`, fullPage: true });
  console.log("supervisors e2e: ok; errors:", errs);
  await b.close();
})().catch((e) => { console.log("FAILED", e.message, (e.stack || "").split("\n").find((l) => l.includes("supervisors.cjs"))); process.exit(1); });
