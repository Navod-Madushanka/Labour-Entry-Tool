// Updates: the version button and its panel; with a verified update ready, the bar and "Restart and
// update"; the page reloads by itself when the tool answers on the new version. The update answers
// are faked here (page.route): nothing is downloaded. Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/updates.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");

  // the real server: not the Windows package and no signing key here -> updates off, said plainly
  const real = await (await p.request.get(BASE + "api/update")).json();
  console.log("real state:", real.state, real.current);
  await p.locator(".update-chip > button").click();
  await p.locator(".update-panel >> text=not set up yet").waitFor();
  await p.locator(".update-panel button[aria-label=Close]").click();

  // faked: a verified update is ready
  let installed = false, version = real.current;
  const ready = { ...real, latest: "9.9.1", state: "ready", notes: "## Faster\n- the entry screen", can_install: true, error: null };
  await p.route("**/api/update", (r) => r.fulfill({ json: ready }));
  await p.route("**/api/update/install", (r) => { installed = true; version = "9.9.1"; r.fulfill({ json: { restarting: true } }); });
  await p.route("**/api/status", async (r) => { const res = await r.fetch(); const s = await res.json(); r.fulfill({ json: { ...s, version } }); });
  await p.reload(); await p.waitForSelector("#worker");
  await p.locator(".update-bar >> text=Version 9.9.1 is ready.").waitFor();
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/update-bar.png` });
  await p.getByRole("button", { name: "What's new" }).click();
  await p.locator(".update-panel >> text=the entry screen").waitFor();
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/update-panel.png` });
  await p.locator(".update-panel button[aria-label=Close]").click();

  // Restart and update: the page reloads by itself once the tool answers on the new version
  await p.evaluate(() => (window.__before = true));
  await p.locator(".update-bar").getByRole("button", { name: "Restart and update" }).click();
  await p.waitForFunction(() => !window.__before, null, { timeout: 20000 });
  console.log("installed:", installed, "| page reloaded on the new version: yes");
  if (!installed) throw new Error("install not asked");
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("updates e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
