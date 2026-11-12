// Place names of the code endings, edited from Codes & registration: rename, add an ending, clear
// one; the entry screen shows the new name. Made-up data only.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/places-edit.cjs [screenshot-dir]
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
const SHOTS = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole("link", { name: "Codes & registration" }).click();
  await p.getByRole("tab", { name: "Trades, places & activity codes" }).click();
  const card = p.locator(".places-card");
  await card.getByLabel("Place for -P").waitFor();
  console.log("before:", (await card.locator("tbody").innerText()).replace(/\s+/g, " ").slice(0, 160));
  await card.getByLabel("Place for -P").fill("Car park");
  await card.getByLabel("Place for -C-8").fill("");
  await card.getByLabel("New code ending").fill("-s");
  await card.getByLabel("Place for the new ending").fill("Skywalk");
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/places-edit.png` });
  await card.getByRole("button", { name: "Save place names" }).click();
  await card.locator(".ok-text").waitFor();
  const after = (await card.locator("tbody").innerText()).replace(/\s+/g, " ");
  console.log("after:", after.slice(0, 200));
  const vals = await card.locator("tbody input[aria-label^='Place for -']").evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label").slice(10)}=${e.value}`));
  console.log("saved names:", vals.join(", "));
  if (!vals.includes("-P=Car park") || !vals.includes("-S=Skywalk") || !vals.includes("-C-8=")) throw new Error("names not saved as edited");
  const master = await (await p.request.get(BASE + "api/master")).json();
  console.log("master places:", JSON.stringify(master.places));
  if (master.places.P !== "Car park" || master.places["C-8"] || master.places.S !== "Skywalk") throw new Error("master not updated");
  // the entry screen: the code's place label
  await p.getByRole("link", { name: "Entry" }).click();
  await p.locator("#worker").fill("AAA-01"); await p.keyboard.press("Enter");
  await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  await p.keyboard.type("03-11-00-00-P");
  await p.waitForFunction(() => document.querySelector(".hint.place")?.innerText === "Concrete Forming · Car park");
  console.log("entry shows:", await p.locator(".hint.place").first().innerText());
  if (errs.length) throw new Error(errs.join("\n"));
  await b.close();
  console.log("places-edit e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
