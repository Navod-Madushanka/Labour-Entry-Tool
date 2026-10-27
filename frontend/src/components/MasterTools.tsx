import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CodeWriteResult, type CodesResponse, type RegistrationReport, type Severity } from "../api";

const CODE_RE = /^(X\d{5}|XIN\d{3})$/;
const STATUS: Record<string, string> = { missing: "blank", error: "#N/A", zero: "0", invalid: "invalid" };

interface Props {
  user: string;
  onChanged: () => void; // codes were written: refresh master data and status
}

/** Phase 4: propose and write missing employee codes; check the registration files. */
export function MasterTools({ user, onChanged }: Props) {
  const [codes, setCodes] = useState<CodesResponse | null>(null);
  const [report, setReport] = useState<RegistrationReport | null>(null);
  const [rules, setRules] = useState<Record<string, { severity: Severity; title: string }>>({});
  const [values, setValues] = useState<Record<number, string>>({}); // row -> code to write
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<CodeWriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, r, rl] = await Promise.all([api.codes(), api.registration(), api.rules()]);
      setCodes(c);
      setReport(r);
      setRules(rl);
      setValues(Object.fromEntries(c.proposals.map((p) => [p.row, p.proposed ?? ""])));
      setPicked(new Set(c.proposals.filter((p) => p.selectable).map((p) => p.row)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chosen = useMemo(
    () =>
      (codes?.proposals ?? []).filter(
        (p) => picked.has(p.row) && CODE_RE.test((values[p.row] ?? "").trim().toUpperCase()),
      ),
    [codes, picked, values],
  );

  const write = async () => {
    const lines = chosen.map((p) => `${p.calling_name} (row ${p.row}): ${STATUS[p.status] ?? p.status} → ${values[p.row].trim().toUpperCase()}`);
    if (!window.confirm(`Write ${chosen.length} employee code(s) into Labour Detail column G?\n\n${lines.join("\n")}\n\nA backup is made first; you can undo the batch.`)) return;
    setBusy(true);
    try {
      const res = await api.writeCodes(
        chosen.map((p) => ({ row: p.row, calling_name: p.calling_name, code: values[p.row].trim().toUpperCase() })),
        user,
      );
      setResult(res);
      if (res.status === "written") {
        onChanged();
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const issuesByRule = useMemo(() => {
    const groups = new Map<string, RegistrationReport["issues"]>();
    for (const i of report?.issues ?? []) groups.set(i.rule, [...(groups.get(i.rule) ?? []), i]);
    return groups;
  }, [report]);

  if (error) return <section className="error-text">Could not load: {error}</section>;
  if (!codes || !report) return <section className="muted">Loading…</section>;

  const proposals = codes.proposals;
  return (
    <>
      <section>
        <div className="section-head">
          <h2>
            Employee codes <span className="muted">({proposals.length} rows in Labour Detail without a valid code)</span>
          </h2>
          <button className="link" onClick={load}>
            Refresh
          </button>
        </div>
        <p className="muted small">
          Proposals come from the registration files ({codes.files.join(", ") || "none loaded"}) by calling name, or from the
          base code for role codes like <code>INC-46 M</code>. You can also type a code the office gave you. Nothing is
          written until you press the button and confirm.
        </p>
        {result && (
          <div className={`result ${result.status === "written" && !result.mismatches.length ? "ok" : "bad"}`} role="status">
            <div className="result-head">
              <strong>
                {result.status === "written"
                  ? `Written: ${Object.keys(result.written).length} code(s) (batch ${result.batch_id}). Undo it from Recent batches on the Entry page.`
                  : result.status === "rejected"
                    ? "Not written:"
                    : `Failed: ${result.error}`}
              </strong>
              <button className="link" onClick={() => setResult(null)}>
                Close
              </button>
            </div>
            {[...result.problems, ...result.mismatches].map((m) => (
              <div key={m}>{m}</div>
            ))}
          </div>
        )}
        {proposals.length ? (
          <div className="table-wrap">
            <table className="plain">
              <thead>
                <tr>
                  <th />
                  <th>Row</th>
                  <th>Calling name</th>
                  <th>Now</th>
                  <th>Code to write</th>
                  <th>From</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const value = values[p.row] ?? "";
                  const valid = CODE_RE.test(value.trim().toUpperCase());
                  const hard = p.conflicts.length > 0 && p.proposed !== null;
                  return (
                    <tr key={p.row} className={picked.has(p.row) && valid ? "row-ok" : hard ? "row-block" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Write code for ${p.calling_name}`}
                          disabled={!valid}
                          checked={picked.has(p.row) && valid}
                          onChange={() =>
                            setPicked((s) => {
                              const next = new Set(s);
                              if (next.has(p.row)) next.delete(p.row);
                              else next.add(p.row);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>{p.row}</td>
                      <td>
                        <b>{p.calling_name}</b>
                      </td>
                      <td>
                        <span className="badge warn small">{STATUS[p.status] ?? p.status}</span>
                      </td>
                      <td>
                        <input
                          aria-label={`Code for ${p.calling_name}`}
                          value={value}
                          placeholder="X12345 / XIN123"
                          size={10}
                          onChange={(e) => {
                            const v = e.target.value;
                            setValues((all) => ({ ...all, [p.row]: v }));
                            if (CODE_RE.test(v.trim().toUpperCase())) setPicked((s) => new Set(s).add(p.row));
                          }}
                        />
                      </td>
                      <td className="small">{p.source ? `${p.source}: ${p.found_in}` : "—"}</td>
                      <td className="small">
                        {p.conflicts.map((c) => (
                          <div key={c} className={p.proposed ? "error-text" : "muted"}>
                            {c}
                          </div>
                        ))}
                        {p.notes.map((n) => (
                          <div key={n} className="warn-text">
                            {n}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ok-text">Every worker in Labour Detail has a valid employee code.</p>
        )}
        <div className="actions">
          <button className="primary" disabled={busy || !chosen.length} onClick={write}>
            Write {chosen.length} code{chosen.length === 1 ? "" : "s"} to Labour Detail
          </button>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>
            Registration vs Labour Detail <span className="muted">({codes.conflicts.length} ID conflicts)</span>
          </h2>
          <a href="/api/codes/conflicts.csv">Download CSV for the office</a>
        </div>
        {codes.conflicts.length ? (
          <ul className="issues">
            {codes.conflicts.map((c, n) => (
              <li key={n} className={`issue ${c.kind === "not found" ? "INFO" : "WARN"}`}>
                <b>{c.kind}</b> {c.message} <span className="muted small">({c.registration})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No conflicts. Only registration rows of this workbook's groups are compared (calling names are authoritative;
            IDs are a cross-check).
          </p>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>
            Registration check <span className="muted">({report.rows} rows, {report.issues.length} issues)</span>
          </h2>
          <a href="/api/registration.csv">Download CSV</a>
        </div>
        <ul className="small file-list">
          {report.files.map((f) => (
            <li key={f.name}>
              <b>{f.name}</b>: {f.sheets.map((s) => `${s.title.trim()} (${s.kind}, ${s.rows})`).join(", ")}
            </li>
          ))}
          {report.missing.map((m) => (
            <li key={m} className="error-text">
              Not found: {m} (set registration_files in config.yaml)
            </li>
          ))}
        </ul>
        {[...issuesByRule].map(([rule, issues]) => (
          <details key={rule} open={issues.length <= 12}>
            <summary>
              <span className={`sev ${issues[0].severity}`}>{rule}</span> {rules[rule]?.title ?? rule}{" "}
              <span className="muted">({issues.length})</span>
            </summary>
            <div className="table-wrap">
              <table className="plain">
                <tbody>
                  {issues.map((i, n) => (
                    <tr key={n}>
                      <td className="small nowrap">
                        {i.sheet}!{i.cell}
                      </td>
                      <td>
                        <b>{i.calling_name}</b>
                      </td>
                      <td>{i.message}</td>
                      <td className="muted small">{i.suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
        {Object.keys(report.next_numbers).length > 0 && (
          <div className="chips next-numbers">
            <span className="muted small">Next free calling names:</span>
            {Object.values(report.next_numbers).map((n) => (
              <span key={n} className="chip static">
                {n}
              </span>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
