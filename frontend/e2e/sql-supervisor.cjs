// The SQL panel and supervisors: entries pushed from Kamal's and Nimal's sheets, found with
// WHERE supervisor = "Kamal", corrected with UPDATE … WHERE supervisor = 'Kamal', and pushed again:
// the corrections stay Kamal's (the push only asks a supervisor for the new entries). Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/sql-supervisor.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("labour.user", "Tester"); });
  await p.reload(); await p.waitForSelector('input[aria-label="Activity 1"]', { timeout: 15000 });
  await p.waitForFunction(() => !document.querySelector(".statusbar")?.innerText.includes("Loading month"), null, { timeout: 60000 });
  await p.getByRole("tab", { name: "4", exact: true }).click();
  const add = async (name, tin, tout) => {
    await p.locator("#worker").fill(name); await p.keyboard.press("Enter");
    await p.keyboard.type(tin); await p.keyboard.press("Enter");
    await p.keyboard.type(tout); await p.keyboard.press("Enter");
    const hint = await p.locator('input[aria-label="Activity 1"]').getAttribute("placeholder");
    if (!hint.includes("Enter to use")) await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    await p.waitForFunction((n) => [...document.querySelectorAll(".queue tbody tr")].some((r) => r.textContent.includes(n)), name, { timeout: 10000 });
  };
  const dialog = async () => {
    await p.waitForFunction(() => !document.querySelector(".push-bar button")?.disabled, null, { timeout: 30000 });
    await p.locator(".push-bar button").click();
    const dlg = p.getByRole("dialog", { name: "Whose manpower sheet is this?" });
    await dlg.waitFor();
    return dlg;
  };
  const pushed = () => p.waitForFunction(() => !document.querySelector(".queue tbody tr"), null, { timeout: 20000 });
  const owners = () => p.evaluate(async () => Object.fromEntries((await (await fetch("/api/supervisor-sheets")).json()).filter((o) => o.sheet === "4").map((o) => [o.calling_name, o.supervisor])));
  const sqlRun = async (q) => {
    const ed = p.getByLabel("SQL query");
    await ed.click(); await p.keyboard.press("Control+a"); await p.keyboard.press("Delete");
    await p.keyboard.type(q); await p.keyboard.press("Escape"); await p.keyboard.press("Control+Enter");
  };

  // two sheets pushed the usual way
  await add("AAA-01", "7", "19"); await add("AAA-02", "7", "19");
  let dlg = await dialog();
  await p.getByLabel("Supervisor", { exact: true }).fill("Kamal");
  await dlg.getByRole("button", { name: /^Push 2 entries for Kamal$/ }).click(); await pushed();
  await add("AAA-03", "8", "17");
  dlg = await dialog();
  await p.getByLabel("Supervisor", { exact: true }).fill("Nimal");
  await dlg.getByRole("button", { name: /^Push 1 entry for Nimal$/ }).click(); await pushed();
  console.log("owners after the pushes:", JSON.stringify(await owners()));

  // SELECT with the supervisor, double quotes as in MySQL
  await p.keyboard.press("Control+k");
  await p.waitForFunction(() => location.hash === "#codes/sql");
  await sqlRun('SELECT day, calling_name, supervisor FROM entries WHERE supervisor = "Kamal" AND day = 4;');
  await p.waitForSelector(".sqlws-result .sqlws-grid tbody tr");
  const got = await p.locator(".sqlws-result .sqlws-grid tbody tr").allInnerTexts();
  console.log("Kamal's on day 4:", got.map((r) => r.replace(/\s+/g, " ")).join(" | "));
  if (got.length !== 2 || !got.every((r) => r.includes("Kamal"))) throw new Error("expected Kamal's two entries");
  await sqlRun("SELECT * FROM supervisors");
  await p.waitForSelector(".sqlws-result .sqlws-grid tbody tr");
  console.log("supervisors:", (await p.locator(".sqlws-result .sqlws-grid tbody").innerText()).replace(/\s+/g, " "));
  if (SHOTS) await p.locator(".sqlws").screenshot({ path: `${SHOTS}/sql-supervisors.png` });

  // UPDATE only Kamal's, to the waiting list
  await sqlRun("UPDATE entries SET remark = 'checked' WHERE supervisor = 'Kamal' AND day = 4");
  await p.waitForSelector(".pending-block");
  await p.locator(".sqlws-pending .actions button.primary").click();
  await p.waitForSelector(".sqlws .ok-text");

  // plus one new entry: the push asks a supervisor for that one only
  await p.getByRole("link", { name: "Entry" }).click();
  await p.getByRole("tab", { name: "4", exact: true }).click();
  await add("AAA-05", "7", "16");
  dlg = await dialog();
  const note = (await dlg.locator(".sup-kept").innerText()).replace(/\s+/g, " ");
  console.log("dialog:", note);
  if (!/2 of them are corrections .* stay with Kamal \(2\)/.test(note)) throw new Error("the corrections are not shown as kept");
  await p.getByLabel("Supervisor", { exact: true }).fill("Nimal");
  if (SHOTS) await dlg.screenshot({ path: `${SHOTS}/push-kept.png` });
  await dlg.getByRole("button", { name: "Push 3 entries: 1 for Nimal, 2 kept" }).click(); await pushed();
  let o = await owners();
  console.log("owners:", JSON.stringify(o));
  if (o["AAA-01"] !== "Kamal" || o["AAA-02"] !== "Kamal" || o["AAA-05"] !== "Nimal" || o["AAA-03"] !== "Nimal") throw new Error("owners changed");

  // only corrections: no supervisor needed
  await p.keyboard.press("Control+k");
  await p.waitForFunction(() => location.hash === "#codes/sql");
  await sqlRun("UPDATE entries SET out = '18:00' WHERE supervisor = 'Kamal' AND day = 4");
  await p.waitForSelector(".pending-block");
  await p.locator(".sqlws-pending .actions button.primary").click();
  await p.waitForSelector(".sqlws .ok-text");
  await p.getByRole("link", { name: "Entry" }).click();
  dlg = await dialog();
  await dlg.getByRole("button", { name: "Push 2 corrections, keeping Kamal" }).click(); await pushed();
  o = await owners();
  if (o["AAA-01"] !== "Kamal" || o["AAA-02"] !== "Kamal") throw new Error("corrections moved");
  console.log("corrections pushed, still Kamal's");
  if (errs.length) throw new Error(errs.join("\n"));
  console.log("ok");
  await b.close();
})();
