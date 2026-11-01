// Out exactly 22:00 -> -1 in Additional hours (src/form.ts dinnerFix). Made-up form values only.
//   node tests/dinner.test.cjs
const { buildSync } = require("esbuild");
const path = require("path");
const os = require("os");
const fs = require("fs");
const assert = require("assert/strict");

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dinnertest-")), "form.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/form.ts")], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "error" });
const F = require(out);
const form = (o) => ({ ...F.emptyForm(), timeIn: "7", ...o });

// 22 fills -1 and "dinner"; worked hours 22-7-1-1 = 13
let r = F.dinnerFix(form({ timeOut: "22" }), false);
assert.equal(r.form.additional, "-1");
assert.equal(r.form.remark, "dinner");
assert.equal(r.auto, true);
assert.equal(F.workedHours(r.form), 13);
for (const t of ["22:00", "22.00", "2200", "22.0"]) assert.equal(F.dinnerFix(form({ timeOut: t }), false).form.additional, "-1", t);

// an existing remark is kept; a typed Additional is never replaced
assert.equal(F.dinnerFix(form({ timeOut: "22", remark: "late pour" }), false).form.remark, "late pour");
assert.equal(F.dinnerFix(form({ timeOut: "22", additional: "0" }), false), null);

// other Out times: nothing (Excel already takes 2 h after 22:00)
for (const t of ["19", "21.75", "22.25", "23", ""]) assert.equal(F.dinnerFix(form({ timeOut: t }), false), null, t);
// 22:00 the next day (46) is past 22 already: nothing
assert.equal(F.dinnerFix(form({ timeIn: "23", timeOut: "22" }), false), null);
assert.equal(F.dinnerFix(form({ timeOut: "22", overnight: true }), false), null);

// Out changed away from 22: the automatic values are taken out again
r = F.dinnerFix(form({ timeOut: "22.5", additional: "-1", remark: "dinner" }), true);
assert.equal(r.form.additional, "");
assert.equal(r.form.remark, "");
assert.equal(r.auto, false);
// ...but not if they were changed by hand
r = F.dinnerFix(form({ timeOut: "19", additional: "-1.5", remark: "dinner" }), true);
assert.equal(r.form.additional, "-1.5");
r = F.dinnerFix(form({ timeOut: "19", additional: "-1", remark: "dinner and rain" }), true);
assert.equal(r.form.additional, "");
assert.equal(r.form.remark, "dinner and rain");
// not filled automatically -> left alone
assert.equal(F.dinnerFix(form({ timeOut: "19", additional: "-1", remark: "dinner" }), false), null);

console.log("dinner: all passed");
