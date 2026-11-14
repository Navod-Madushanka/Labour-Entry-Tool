// Helpers for the tests written for the 250-worker made-up demo
// (`cd backend && python ../scripts/demo_two_books.py 8012 big`).

/** Stop with a clear message unless the server is the big demo. Started without `big`, the demo
 * has 12 workers, three filled days and no September book, so these tests would fail later with
 * confusing messages (no run carried, no previous month, no usual crew, no OT change). */
async function requireBigDemo(base) {
  const res = await fetch(new URL("api/previous-month", base));
  const prev = res.ok ? await res.json() : {};
  if (!/September 2026 - DEMO A/.test(prev.source ?? "")) {
    console.error("This test needs the big made-up demo:  cd backend && python ../scripts/demo_two_books.py 8012 big");
    process.exit(2);
  }
}

/** Wait until the Entry page has every day sheet (the app loads them one by one after the page
 * opens). Usual crews and code suggestions come from the last 10 days, so until days 11-20 are in
 * they are worked out from part of the month and can change while the test types. */
async function waitForAllDays(page) {
  await page.waitForFunction(() => {
    const tabs = [...document.querySelectorAll('.daybar [role="tab"]')];
    return tabs.length > 0 && tabs.every((t) => !(t.getAttribute("title") ?? "").startsWith("not loaded yet"));
  }, null, { timeout: 60000 });
}

module.exports = { requireBigDemo, waitForAllDays };
