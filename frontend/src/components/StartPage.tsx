import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type CodeProposal,
  type HealthReport,
  type Issue,
  type Readiness,
  type SetupState,
  type Severity,
} from "../api";
import { store } from "../store";

type Step = "choose" | "check" | "ready";
const HEADER = ["H01", "H02", "H03"];
const FIELD: Record<string, string> = { H01: "date", H02: "day_type", H03: "sheet_no" };
const CODES = ["M02", "W07"];
const ICON = { ok: "✓", warn: "!", fail: "✗" };

interface Props {
  initial: SetupState;
  onDone: (state: SetupState) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function monthLabel(month: string | null): string {
  if (!month) return "unknown month";
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function sheetDate(month: string | null, sheet: string | null): Date | null {
  if (!month || !sheet || !/^\d+$/.test(sheet)) return null;
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, Number(sheet));
  return d.getMonth() === m - 1 ? d : null;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function where(i: Issue): string {
  const place = i.sheet && !/^\d+$/.test(i.sheet) ? `${i.sheet}!${i.cell ?? ""}` : [i.sheet && `Sheet ${i.sheet}`, i.cell].filter(Boolean).join(" ");
  return [place, i.calling_name].filter(Boolean).join(" · ");
}

/** Choose the workbook -> check it and fix what can be fixed -> readiness -> entry. */
export function StartPage({ initial, onDone }: Props) {
  const [setup, setSetup] = useState(initial);
  const [step, setStep] = useState<Step>(initial.workbook ? "check" : "choose");
  const [practice, setPractice] = useState(!initial.live_available || initial.mode === "demo");
  const [user, setUser] = useState(() => store.get("labour.user") ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [rules, setRules] = useState<Record<string, { severity: Severity; title: string }>>({});
  const started = useRef(false);

  useEffect(() => {
    api.rules().then(setRules).catch(() => undefined);
  }, []);

  // Dropping a file anywhere on the page must not make the browser open it instead.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(message(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const check = useCallback(async () => {
    setStep("check");
    setReady(null);
    const res = await run("Reading every sheet and checking it…", async () => {
      const r = await api.setupCheck();
      setSetup(await api.setup());
      return r;
    });
    if (res) setReport(res);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back on the start page with a workbook already chosen: check it straight away.
  useEffect(() => {
    if (initial.workbook && !started.current) {
      started.current = true;
      check();
    }
  }, [initial.workbook, check]);

  const chosen = (s: SetupState | undefined) => {
    if (!s) return;
    setSetup(s);
    setReport(null);
    check();
  };

  const saveUser = (name: string) => {
    setUser(name);
    if (name.trim()) store.set("labour.user", name.trim());
  };

  const toReadiness = async () => {
    setStep("ready");
    const r = await run("Checking the automation…", api.setupReadiness);
    if (r) setReady(r);
  };

  const start = async () => {
    const s = await run("Opening the entry screen…", () => api.setupReady(true));
    if (!s) return;
    if (ready?.next_sheet) store.set("labour.sheet", ready.next_sheet);
    onDone(s);
  };

  return (
    <main className="start">
      <header className="start-head">
        <h1>Labour Entry</h1>
        <ol className="steps">
          {(["choose", "check", "ready"] as Step[]).map((s, n) => (
            <li key={s} className={s === step ? "active" : ""}>
              {n + 1}. {s === "choose" ? "Choose the workbook" : s === "check" ? "Check and fix" : "Ready"}
            </li>
          ))}
        </ol>
      </header>

      {setup.workbook && step !== "choose" && (
        <p className="chosen">
          <b>{setup.workbook}</b> · {monthLabel(setup.month)} ·{" "}
          {setup.mode === "live" ? "writes into the workbook open in Excel" : "practice copy (Excel is not changed)"}{" "}
          <button className="link" onClick={() => setStep("choose")} disabled={!!busy}>
            Change
          </button>
          {setup.month_note && <span className="warn-text block">{setup.month_note}</span>}
        </p>
      )}

      {error && (
        <div className="banner BLOCK">
          <p>{error}</p>
          {step === "check" && (
            <div className="actions">
              <button onClick={check}>Check again</button>
            </div>
          )}
        </div>
      )}
      {busy && <p className="busy">{busy}</p>}

      {step === "choose" && (
        <ChooseStep
          setup={setup}
          practice={practice}
          setPractice={setPractice}
          user={user}
          setUser={saveUser}
          busy={!!busy}
          onFile={(f) => run(`Reading ${f.name}…`, () => api.setupUpload(f, practice)).then(chosen)}
          onBrowse={() =>
            run("Waiting for the file dialog (it may open behind this window)…", () => api.setupBrowse(practice)).then(
              (r) => r && !r.cancelled && chosen(r.state),
            )
          }
          onOpen={(name) => run(`Connecting to ${name}…`, () => api.setupOpen(name)).then(chosen)}
        />
      )}

      {step === "check" && report && !busy && (
        <CheckStep
          setup={setup}
          report={report}
          rules={rules}
          user={user}
          setUser={saveUser}
          run={run}
          onChanged={check}
          onSetup={setSetup}
          onContinue={toReadiness}
        />
      )}

      {step === "ready" && ready && !busy && (
        <section className="card">
          <h2>{ready.ready ? "Ready to enter data" : "Not ready yet"}</h2>
          <ul className="checks">
            {ready.checks.map((c) => (
              <li key={c.id} className={c.status}>
                <span className="icon">{ICON[c.status]}</span>
                <div>
                  <b>{c.title}</b>
                  <div className="muted">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          {ready.ready ? (
            <div className="go">
              <p>
                Everything the tool needs is in place.
                {ready.next_sheet && <> Entry starts at <b>sheet {ready.next_sheet}</b>.</>}
              </p>
              <button className="primary big" onClick={start} autoFocus>
                Start entering data
              </button>
            </div>
          ) : (
            <div className="actions">
              <button onClick={check}>Back to the fixes</button>
              <button onClick={start}>Start anyway</button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

// --- step 1 ------------------------------------------------------------------------------------

interface ChooseProps {
  setup: SetupState;
  practice: boolean;
  setPractice: (v: boolean) => void;
  user: string;
  setUser: (v: string) => void;
  busy: boolean;
  onFile: (f: File) => void;
  onBrowse: () => void;
  onOpen: (name: string) => void;
}

function ChooseStep({ setup, practice, setPractice, user, setUser, busy, onFile, onBrowse, onOpen }: ChooseProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const live = setup.live_available && !practice;
  const nameMissing = !user.trim();

  const browse = () => {
    if (setup.browse_available) onBrowse();
    else input.current?.click();
  };

  return (
    <section className="card">
      <div className="field name-field">
        <label htmlFor="start-user">Your name (kept with every change)</label>
        <input
          id="start-user"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="e.g. Navod"
          autoFocus={nameMissing}
        />
      </div>

      <div
        className={`drop${over ? " over" : ""}${busy || nameMissing ? " disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f && !busy && !nameMissing) onFile(f);
        }}
      >
        <p className="drop-title">Drop the labour entry workbook (.xlsb) here</p>
        <p className="muted">or</p>
        <button className="primary" onClick={browse} disabled={busy || nameMissing}>
          Browse…
        </button>
        <input
          ref={input}
          type="file"
          accept=".xlsb"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
        {nameMissing && <p className="warn-text small">Type your name first.</p>}
      </div>

      {live && setup.open_workbooks.length > 0 && (
        <div className="open-books">
          <h3>Open in Excel now</h3>
          {setup.open_workbooks.map((name) => (
            <button key={name} onClick={() => onOpen(name)} disabled={busy || nameMissing}>
              Use {name}
            </button>
          ))}
        </div>
      )}

      <label className="check practice">
        <input
          type="checkbox"
          checked={practice}
          disabled={!setup.live_available || busy}
          onChange={(e) => setPractice(e.target.checked)}
        />{" "}
        Practice mode: work on a copy in memory, Excel and the file are not changed
      </label>
      <p className="muted small">
        {!setup.live_available
          ? "Excel can't be used from this computer, so the tool runs in practice mode."
          : live
            ? setup.browse_available
              ? "Browse… opens the workbook in Excel if it isn't open yet. A dropped file must already be open in Excel: entries go into the open workbook."
              : "A dropped file must already be open in Excel: entries go into the open workbook."
            : "Nothing you enter is saved anywhere. Use it to try the tool."}
      </p>
    </section>
  );
}

// --- step 2 ------------------------------------------------------------------------------------

interface CheckProps {
  setup: SetupState;
  report: HealthReport;
  rules: Record<string, { severity: Severity; title: string }>;
  user: string;
  setUser: (v: string) => void;
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
  onChanged: () => void;
  onSetup: (s: SetupState) => void;
  onContinue: () => void;
}

function CheckStep({ setup, report, rules, user, setUser, run, onChanged, onSetup, onContinue }: CheckProps) {
  const issues = report.issues;
  const header = issues.filter((i) => HEADER.includes(i.rule));
  const codes = issues.filter((i) => CODES.includes(i.rule));
  const rest = issues.filter((i) => !HEADER.includes(i.rule) && !CODES.includes(i.rule));
  const other = rest.filter((i) => i.severity === "BLOCK");
  const warns = rest.filter((i) => i.severity === "WARN");
  const info = rest.filter((i) => i.severity === "INFO");
  const errors = issues.filter((i) => i.severity === "BLOCK").length;
  const warnings = issues.filter((i) => i.severity === "WARN").length;
  const s = report.stats;
  const needName = !user.trim();

  const bySheet = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of header) m.set(i.sheet ?? "", [...(m.get(i.sheet ?? "") ?? []), i]);
    return [...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [header]);

  const fixSheets = async (sheets: [string, Issue[]][]) => {
    const done = await run(`Fixing ${sheets.length === 1 ? `sheet ${sheets[0][0]}` : `${sheets.length} sheets`}…`, async () => {
      for (const [sheet, list] of sheets) {
        const res = await api.headerFix(sheet, [...new Set(list.map((i) => FIELD[i.rule]))], user.trim());
        if (res.status === "failed" || res.status === "rejected") throw new Error(`Sheet ${sheet}: ${res.error ?? res.status}`);
      }
      return true;
    });
    if (done) onChanged();
  };

  const setHolidays = async (dates: string[]) => {
    const st = await run("Saving the holidays…", () => api.setupHolidays(dates));
    if (st) {
      onSetup(st);
      onChanged();
    }
  };

  const inMonth = setup.holidays.filter((d) => d.startsWith(report.month));

  return (
    <>
      <section className="card">
        <h2>
          {errors === 0 && warnings === 0
            ? "No problems found"
            : `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`}
        </h2>
        <p className="muted">
          {s.workers} workers in Labour Detail; {s.entries} worker-days entered on {s.sheets_with_entries} sheets.
        </p>
        <div className="holidays">
          <span>Holidays this month:</span>
          {inMonth.length === 0 && <span className="muted">none set</span>}
          {inMonth.map((d) => (
            <span key={d} className="chip static">
              {d}{" "}
              <button className="link" title="Remove" onClick={() => setHolidays(setup.holidays.filter((x) => x !== d))}>
                ×
              </button>
            </span>
          ))}
          <input
            type="date"
            aria-label="Add a holiday"
            min={`${report.month}-01`}
            max={`${report.month}-31`}
            onChange={(e) => e.target.value && setHolidays([...setup.holidays, e.target.value])}
          />
        </div>
      </section>

      {needName && (header.length > 0 || codes.length > 0) && (
        <section className="card">
          <div className="field name-field">
            <label htmlFor="check-user">Your name (needed to make fixes)</label>
            <input id="check-user" value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
        </section>
      )}

      {bySheet.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h2>Sheet dates and day types: the tool can fix these</h2>
            <button className="primary" disabled={needName} onClick={() => fixSheets(bySheet)}>
              Fix all {bySheet.length} sheet{bySheet.length === 1 ? "" : "s"}
            </button>
          </div>
          <p className="muted small">A wrong date or day type makes overtime come out wrong. Each fix can be undone.</p>
          <ul className="fix-list">
            {bySheet.map(([sheet, list]) => {
              const date = sheetDate(report.month, sheet);
              const h02 = list.find((i) => i.rule === "H02");
              const markedHoliday = !!h02 && h02.message.includes("marked Holiday");
              const maybeHoliday = !!h02 && date && (date.getDay() !== 0 || markedHoliday);
              return (
                <li key={sheet}>
                  <div>
                    <b>Sheet {sheet}</b>
                    {list.map((i) => (
                      <div key={i.rule} className={`issue ${i.severity}`}>
                        {i.message} {i.suggestion && <span className="fix">→ {i.suggestion}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="row-actions">
                    <button disabled={needName} onClick={() => fixSheets([[sheet, list]])}>
                      Fix
                    </button>
                    {maybeHoliday && date && !setup.holidays.includes(iso(date)) && (
                      <button title="Mark this date as a holiday instead" onClick={() => setHolidays([...setup.holidays, iso(date)])}>
                        {markedHoliday ? "Keep as holiday" : "It's a holiday"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {codes.length > 0 && (
        <CodeFixer setup={setup} codeIssues={codes} user={user} run={run} onSetup={onSetup} onChanged={onChanged} />
      )}

      {other.length > 0 && <ExcelIssues issues={other} rules={rules} mode={setup.mode} />}

      {warns.length > 0 && (
        <details className="card">
          <summary>
            {warns.length} warning{warns.length === 1 ? "" : "s"} on days already entered: worth a look, not required
          </summary>
          <IssueGroups issues={warns} rules={rules} />
        </details>
      )}

      {info.length > 0 && (
        <details className="card">
          <summary>
            {info.length} note{info.length === 1 ? "" : "s"} (no action needed)
          </summary>
          <IssueGroups issues={info} rules={rules} />
        </details>
      )}

      <div className="actions footer">
        <button onClick={onChanged}>Check again</button>
        <button className="primary" onClick={onContinue}>
          {other.length || header.length ? "Continue anyway" : "Continue"}
        </button>
      </div>
    </>
  );
}

function ExcelIssues({ issues, rules, mode }: { issues: Issue[]; rules: CheckProps["rules"]; mode: SetupState["mode"] }) {
  return (
    <section className="card">
      <h2>Fix these in Excel</h2>
      <p className="muted small">
        {mode === "live"
          ? "Change them in the open workbook, then press Check again. They are on days already entered; you can still go on and enter new days."
          : "This is a practice copy: fix them in Excel, save, and drop the file here again. You can also go on and try the tool."}
      </p>
      <IssueGroups issues={issues} rules={rules} />
    </section>
  );
}

function IssueGroups({ issues, rules }: { issues: Issue[]; rules: CheckProps["rules"] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) m.set(i.rule, [...(m.get(i.rule) ?? []), i]);
    return [...m.entries()];
  }, [issues]);
  return (
    <div className="groups">
      {groups.map(([rule, list]) => (
        <IssueGroup key={rule} rule={rule} title={rules[rule]?.title ?? rule} list={list} />
      ))}
    </div>
  );
}

function IssueGroup({ rule, title, list }: { rule: string; title: string; list: Issue[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  return (
    <div className="group">
      <h3 className="group-title">
        <span className={`sev ${list[0].severity}`}>{rule}</span> {title} <span className="muted">({list.length})</span>
      </h3>
      <ul className="issues">
        {shown.map((i, n) => (
          <li key={n} className={`issue ${i.severity}`}>
            <span className="where">{where(i)}</span> {i.message}
            {i.suggestion && <span className="fix"> → {i.suggestion}</span>}
          </li>
        ))}
      </ul>
      {list.length > shown.length && (
        <button className="link" onClick={() => setAll(true)}>
          Show all {list.length}
        </button>
      )}
    </div>
  );
}

// --- employee codes from the registration files --------------------------------------------------

interface CodeProps {
  setup: SetupState;
  codeIssues: Issue[];
  user: string;
  run: CheckProps["run"];
  onSetup: (s: SetupState) => void;
  onChanged: () => void;
}

function CodeFixer({ setup, codeIssues, user, run, onSetup, onChanged }: CodeProps) {
  const [proposals, setProposals] = useState<CodeProposal[] | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const workers = new Set(codeIssues.filter((i) => i.rule === "M02").map((i) => i.calling_name)).size;
  const files = setup.registration_files;

  const load = useCallback(() => {
    if (!files.length) return;
    api
      .codes()
      .then((c) => setProposals(c.proposals))
      .catch(() => setProposals([]));
  }, [files.length]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    let last: SetupState | undefined;
    for (const f of Array.from(list)) last = (await run(`Reading ${f.name}…`, () => api.setupRegistration(f))) ?? last;
    if (last) onSetup(last);
  };

  const ready = (proposals ?? []).filter((p) => p.selectable && p.proposed);
  const write = async () => {
    const lines = ready.map((p) => `${p.calling_name}: ${p.proposed}`);
    if (!window.confirm(`Write ${ready.length} employee code(s) into Labour Detail column G?\n\n${lines.join("\n")}\n\nA backup is made first; the batch can be undone.`)) return;
    const res = await run("Writing the codes…", () =>
      api.writeCodes(ready.map((p) => ({ row: p.row, calling_name: p.calling_name, code: p.proposed! })), user.trim()),
    );
    if (res && res.status !== "written") window.alert(res.error ?? res.problems.join("\n"));
    if (res) onChanged();
  };

  return (
    <section className="card">
      <h2>Employee codes</h2>
      <p>
        {workers > 0 ? `${workers} worker${workers === 1 ? "" : "s"} ha${workers === 1 ? "s" : "ve"} no valid employee code` : "Some upload lines have no employee code"}
        : their hours can be entered, but the ERP upload lines stay blank. The tool can find the codes in the
        registration files.
      </p>
      <div
        className={`drop small-drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        Drop registration files (.xlsx) here, or{" "}
        <button className="link" onClick={() => input.current?.click()}>
          browse
        </button>
        <input ref={input} type="file" accept=".xlsx,.xlsm" multiple hidden onChange={(e) => add(e.target.files).then(() => (e.target.value = ""))} />
        {files.length > 0 && (
          <div className="muted small">Using: {files.map((f) => f.split(/[\\/]/).pop()).join(", ")}</div>
        )}
      </div>
      {proposals && (
        <>
          {ready.length > 0 ? (
            <>
              <ul className="code-list">
                {ready.map((p) => (
                  <li key={p.row}>
                    <b>{p.calling_name}</b> → {p.proposed} <span className="muted small">({p.source === "registration" ? p.found_in : "same person's other line"})</span>
                  </li>
                ))}
              </ul>
              <button className="primary" disabled={!user.trim()} onClick={write}>
                Write {ready.length} code{ready.length === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <p className="muted">No codes found for them in these files.</p>
          )}
          {proposals.length > ready.length && (
            <p className="muted small">
              {proposals.length - ready.length} need a look by hand: see the Codes &amp; registration tab after you start.
            </p>
          )}
        </>
      )}
    </section>
  );
}
