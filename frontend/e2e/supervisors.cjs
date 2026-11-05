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
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
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
    await p.waitForFunction((n) => [...document.querySelectorAll(".queue tbody tr")].some((r) => r.textContent.includes(n)), name);
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
  console.log("supervisors e2e: ok; errors:", errs);
  await b.close();
})().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
