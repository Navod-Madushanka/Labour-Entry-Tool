import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Batch, type CommitResult, type EntryInput, type EntryPlan, type Issue, type Master, type Status, type Worker } from "./api";
import { Batches } from "./components/Batches";
import { CrewDialog } from "./components/CrewDialog";
import { DayBar } from "./components/DayBar";
import { DayList } from "./components/DayList";
import { EntryForm } from "./components/EntryForm";
import { NamePrompt } from "./components/NamePrompt";
import { CommitResultView, Queue, type QueueItem } from "./components/Queue";
import { StatusBar } from "./components/StatusBar";
import { clearInput, emptyForm, forWorker, fromEntry, fromInput, isOvernight, toInput, type FormState } from "./form";
import { topActivities, type Month } from "./history";
import { formatShift, parseClock } from "./time";

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: remembered for this page only */
    }
  },
};

const HEADER_RULES = ["H01", "H02"];
const FIX_FIELD: Record<string, string> = { H01: "date", H02: "day_type", H03: "sheet_no" };

function defaultSheet(master: Master): string {
  const saved = store.get("labour.sheet");
  if (saved && master.sheets.includes(saved)) return saved;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const today = String(now.getDate());
  return ym === master.month && master.sheets.includes(today) ? today : master.sheets[0];
}

export function App() {
  const [user, setUser] = useState(() => store.get("labour.user") ?? "");
  const [askName, setAskName] = useState(() => !store.get("labour.user"));
  const [status, setStatus] = useState<Status | null>(null);
  const [master, setMaster] = useState<Master | null>(null);
  const [sheet, setSheetState] = useState("1");
  const [month, setMonth] = useState<Month>({});
  const [form, setForm] = useState<FormState>(emptyForm);
  const [focusToken, setFocusToken] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [headerAck, setHeaderAck] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<CommitResult | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const nextId = useRef(1);
  const loading = useRef(new Set<string>());

  const fail = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
  const refreshStatus = useCallback(() => api.status().then(setStatus).catch(fail), []);
  const refreshBatches = useCallback(() => api.batches().then(setBatches).catch(() => undefined), []);
  const reloadDay = useCallback(
    (s: string) =>
      api.day(s).then((d) => setMonth((m) => ({ ...m, [s]: d }))).catch(fail),
    [],
  );

  // Start: status, master, the chosen sheet, then the rest of the month in the background.
  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 10000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (!status?.connected || master) return;
    api
      .master()
      .then((m) => {
        setMaster(m);
        setSheetState(defaultSheet(m));
        refreshBatches();
      })
      .catch(fail);
  }, [status?.connected, master, refreshBatches]);

  useEffect(() => {
    if (!master) return;
    let cancelled = false;
    (async () => {
      for (const s of [sheet, ...master.sheets.filter((x) => x !== sheet)]) {
        if (cancelled) return;
        if (loading.current.has(s)) continue;
        loading.current.add(s);
        try {
          const d = await api.day(s);
          setMonth((m) => ({ ...m, [s]: d })); // keep it even if the loop was restarted
        } catch {
          loading.current.delete(s);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [master, sheet]);

  const setSheet = (s: string) => {
    setSheetState(s);
    store.set("labour.sheet", s);
    if (!month[s]) reloadDay(s);
    setForm((f) => ({ ...f, overwrite: false }));
  };

  // Day navigation with Alt+Left / Alt+Right.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!master || !e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const i = master.sheets.indexOf(sheet) + (e.key === "ArrowLeft" ? -1 : 1);
      if (i >= 0 && i < master.sheets.length) setSheet(master.sheets[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const day = month[sheet];
  const withHeaderAck = useCallback(
    (i: EntryInput): EntryInput =>
      headerAck[i.sheet] ? { ...i, acknowledged: [...new Set([...i.acknowledged, ...HEADER_RULES])] } : i,
    [headerAck],
  );
  const headerAcks = headerAck[sheet] ? HEADER_RULES : [];

  // Re-check the whole queue on the server whenever it changes (batch entries see each other).
  const queueKey = JSON.stringify(queue.map((q) => withHeaderAck(q.input)));
  useEffect(() => {
    if (!queue.length) return;
    let stale = false;
    const timer = setTimeout(() => {
      api
        .preview(queue.map((q) => withHeaderAck(q.input)))
        .then((plans) => {
          if (stale) return;
          setQueue((items) => (items.length === plans.length ? items.map((it, n) => ({ ...it, plan: plans[n] })) : items));
        })
        .catch(fail);
    }, 120);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey]);

  const addToQueue = (inputs: EntryInput[], plans: (EntryPlan | null)[] = []) => {
    setQueue((items) => {
      let next = [...items];
      inputs.forEach((input, n) => {
        const item = { id: nextId.current++, input, plan: plans[n] ?? null };
        const at = next.findIndex((q) => q.input.sheet === input.sheet && q.input.calling_name === input.calling_name);
        if (at >= 0) next[at] = item;
        else next = [...next, item];
      });
      return next;
    });
    setResult(null);
  };

  const workerByName = useMemo(() => new Map(master?.workers.map((w) => [w.calling_name, w])), [master]);

  const onQueue = (input: EntryInput) => {
    addToQueue([input]);
    setForm((f) => forWorker(f, null)); // keep times and activities for the next worker
    setFocusToken((t) => t + 1);
  };

  const commit = async (dryRun: boolean) => {
    if (!queue.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.commit(queue.map((q) => withHeaderAck(q.input)), user, dryRun);
      setResult(res);
      if (res.status === "written" || res.status === "unchanged") {
        const sheets = new Set(queue.map((q) => q.input.sheet));
        setQueue([]);
        await Promise.all([...sheets].map(reloadDay));
        refreshBatches();
        refreshStatus();
      } else {
        setQueue((items) => items.map((it, n) => ({ ...it, plan: res.plans[n] ?? it.plan })));
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (b: Batch) => {
    if (!window.confirm(`Undo batch #${b.id} (${b.cells} cells on sheet ${b.sheets.join(", ")})?`)) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.undo(b.id, user);
      if (res.status === "undone") setMessage(`Batch #${b.id} undone.`);
      else setMessage(`Undo ${res.status}: ${res.error ?? res.conflicts.join("; ")}`);
      await Promise.all(b.sheets.map(reloadDay));
      refreshBatches();
      refreshStatus();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const fixHeader = async (issues: Issue[]) => {
    if (!day) return;
    const fields = issues.map((i) => FIX_FIELD[i.rule]).filter(Boolean);
    const lines = [
      fields.includes("date") && `F3 date: ${day.header.date ?? "blank"} → ${day.expected_date}`,
      fields.includes("day_type") && `H3 day type: ${String(day.header.day_type)} → ${day.expected_day_type}`,
      fields.includes("sheet_no") && `F4 sheet no.: ${String(day.header.sheet_no)} → ${sheet}`,
    ].filter(Boolean);
    if (!window.confirm(`Write these header cells on sheet ${sheet}?\n\n${lines.join("\n")}\n\nA backup is made first and you can undo it.`)) return;
    setBusy(true);
    try {
      const res = await api.headerFix(sheet, fields, user);
      setMessage(res.status === "written" ? `Header of sheet ${sheet} fixed.` : `Header fix ${res.status}: ${res.error ?? ""}`);
      await reloadDay(sheet);
      refreshBatches();
      refreshStatus();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!window.confirm("Save the workbook in Excel now?")) return;
    try {
      await api.save();
      setMessage("Workbook saved.");
      refreshStatus();
    } catch (e) {
      fail(e);
    }
  };

  const activityOrder = useMemo(() => {
    if (!master) return [];
    const counts = topActivities(month);
    return [...master.activities].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  }, [master, month]);

  const formIn = parseClock(form.timeIn);
  const formOut = parseClock(form.timeOut);
  const firstCode = form.lines.find((l) => l.code.trim())?.code.trim();
  const formSummary =
    formIn !== null && formOut !== null
      ? `${formatShift(formIn, formOut + (isOvernight(form) ? 24 : 0))}${firstCode ? `, ${firstCode}` : ""}`
      : null;

  return (
    <>
      <StatusBar
        status={status}
        user={user}
        historyLoaded={Object.keys(month).length}
        historyTotal={master?.sheets.length ?? 0}
        onSave={save}
        onChangeUser={() => setAskName(true)}
      />
      {askName && (
        <NamePrompt
          initial={user}
          onDone={(name) => {
            setUser(name);
            store.set("labour.user", name);
            setAskName(false);
            setFocusToken((t) => t + 1);
          }}
        />
      )}
      <main>
        {message && (
          <div className="toast" role="status">
            {message}{" "}
            <button className="link" onClick={() => setMessage(null)}>
              Dismiss
            </button>
          </div>
        )}
        {!master ? (
          <p className="muted">{status && !status.connected ? "Open the workbook in Excel; this page retries every 10 seconds." : "Loading…"}</p>
        ) : (
          <>
            <DayBar
              sheets={master.sheets}
              sheet={sheet}
              counts={Object.fromEntries(master.sheets.map((s) => [s, month[s]?.entries.length]))}
              day={day}
              acknowledged={Boolean(headerAck[sheet])}
              onPick={setSheet}
              onAcknowledge={() => setHeaderAck((a) => ({ ...a, [sheet]: true }))}
              onFix={fixHeader}
            />
            <EntryForm
              master={master}
              sheet={sheet}
              day={day}
              month={month}
              form={form}
              setForm={setForm}
              headerAcks={headerAcks}
              activityOrder={activityOrder}
              onQueue={onQueue}
              onCrew={() => setCrewOpen(true)}
              focusToken={focusToken}
              dialogOpen={askName || crewOpen}
            />
            {result && <CommitResultView result={result} onClose={() => setResult(null)} />}
            <Queue
              items={queue}
              busy={busy}
              onAck={(id, rule) =>
                setQueue((items) =>
                  items.map((it) => {
                    if (it.id !== id) return it;
                    const acks = it.input.acknowledged.includes(rule)
                      ? it.input.acknowledged.filter((r) => r !== rule)
                      : [...it.input.acknowledged, rule];
                    return { ...it, input: { ...it.input, acknowledged: acks } };
                  }),
                )
              }
              onOverwrite={(id) =>
                setQueue((items) => items.map((it) => (it.id === id ? { ...it, input: { ...it.input, overwrite: true } } : it)))
              }
              onEdit={(id) => {
                const it = queue.find((q) => q.id === id);
                const w = it && workerByName.get(it.input.calling_name);
                if (!it || !w) return;
                setSheet(it.input.sheet);
                setForm(fromInput(it.input, w));
                setQueue((items) => items.filter((q) => q.id !== id));
              }}
              onRemove={(id) => setQueue((items) => items.filter((q) => q.id !== id))}
              onCommit={commit}
              onClear={() => setQueue([])}
            />
            <DayList
              day={day}
              onEdit={(v) => {
                const w = v.entry.calling_name ? workerByName.get(v.entry.calling_name) : undefined;
                if (w) setForm(fromEntry(v.entry, w, true));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onClear={(v) => v.entry.calling_name && addToQueue([clearInput(sheet, v.entry.calling_name)])}
            />
            <Batches batches={batches} busy={busy} onUndo={undo} />
            {crewOpen && (
              <CrewDialog
                master={master}
                sheet={sheet}
                day={day}
                month={month}
                formSummary={formSummary}
                onSameAsForm={(workers: Worker[]) => {
                  addToQueue(workers.map((w) => toInput(forWorker(form, w), sheet)!));
                  setCrewOpen(false);
                }}
                onCopyYesterday={(workers: Worker[]) => {
                  const prev = month[String(Number(sheet) - 1)];
                  const inputs = workers.flatMap((w) => {
                    const e = prev?.entries.find((v) => v.entry.calling_name === w.calling_name)?.entry;
                    const exists = day?.entries.some((v) => v.entry.calling_name === w.calling_name);
                    return e ? [toInput(fromEntry(e, w, Boolean(exists)), sheet)!] : [];
                  });
                  addToQueue(inputs);
                  setCrewOpen(false);
                }}
                onClose={() => setCrewOpen(false)}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}

