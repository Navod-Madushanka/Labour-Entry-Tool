// The tool saves by itself with no page open (the page used to do it, and only while it noticed):
// a write through the API, nobody watching, saved within seconds. Made-up data.
//   cd backend && python ../scripts/demo_two_books.py      (fresh server)
//   node e2e/autosave-no-page.cjs
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const j = async (path, data) => (await fetch(BASE + path, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : undefined)).json();
  await j("api/autosave", { on: true });
  const r = await j("api/entries", { user: "Tester", entries: [{ sheet: "22", calling_name: "AAA-09", time_in: 7, time_out: 17, activities: [{ code: "03-11-00-00-P", hours: 9 }], acknowledged: ["W01", "W02", "W03", "W05", "W10"] }] });
  if (r.status !== "written") throw new Error("push: " + r.status);
  const t0 = Date.now();
  let s = await j("api/status");
  console.log("right after the push: unsaved", s.unsaved_changes);
  while (s.unsaved_changes && Date.now() - t0 < 20000) { await new Promise((x) => setTimeout(x, 500)); s = await j("api/status"); }
  console.log(`saved by the tool after ${((Date.now() - t0) / 1000).toFixed(1)} s with no page open: ${!s.unsaved_changes} (saved_at ${s.saved_at})`);
  if (s.unsaved_changes) throw new Error("not saved by itself");
  console.log("autosave-no-page e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
