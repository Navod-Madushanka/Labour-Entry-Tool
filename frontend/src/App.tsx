import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type BookInfo, type Batch, type CommitResult, type EntryInput, type EntryPlan, type Issue, type Master, type Status, type Worker } from "./api";
import { Batches } from "./components/Batches";
import { CrewDialog } from "./components/CrewDialog";
import { DayBar } from "./components/DayBar";
import { DayList } from "./components/DayList";
import { EntryForm } from "./components/EntryForm";
import { ActivityAdder } from "./components/ActivityAdder";
import { MasterTools } from "./components/MasterTools";
import { TimeCards } from "./components/TimeCards";
import { ManpowerSheet } from "./components/ManpowerSheet";
import { MedicalDialog } from "./components/MedicalDialog";
import { DayBuilder } from "./components/DayBuilder";
import { NamePrompt } from "./components/NamePrompt";
import { CommitResultView, Queue, type QueueItem } from "./components/Queue";
import { StatusBar } from "./components/StatusBar";
import { StoryNote, StoryReader } from "./components/StoryCorner";
import { award as storyAward, dayState, refreshStories, setStoryEnabled, storyEnabled, todaysStory, type Award } from "./story";
import { clearInput, emptyForm, forWorker, fromEntry, fromInput, isOvernight, toInput, type FormState } from "./form";
import { topActivities, type Month } from "./history";
import { store } from "./store";
import { formatShift, parseClock } from "./time";

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

interface AppProps {
  books: BookInfo[];
  onSwitch: (name: string) => void;
  onAddWorkbook: () => void;
  onCloseBook: (name: string) => void;
  onChangeWorkbook: () => void;
}

export function App({ books, onSwitch, onAddWorkbook, onCloseBook, onChangeWorkbook }: AppProps) {
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
  const [medicalOpen, setMedicalOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const pageOf = (hash: string) => (hash === "#codes" ? "codes" : hash === "#cards" ? "cards" : "entry");
  const [page, setPage] = useState<"entry" | "codes" | "cards">(() => pageOf(window.location.hash));
  const [story, setStory] = useState<Award | null>(null); // the corner note after a push
  const [storyOpen, setStoryOpen] = useState<number | null>(null); // reader, at this chapter
  const [storyOn, setStoryOn] = useState(storyEnabled);
  const nextId = useRef(1);
  useEffect(() => {
    if (storyOn) refreshStories(); // new stories from GitHub, at most once a day
  }, [storyOn]);
  const loading = useRef(new Set<string>());

  const fail = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
  const refreshStatus = useCallback(() => api.status().then(setStatus).catch(fail), []);
  // Enough history for the day list's "most recent first" (the list itself scrolls).
  const refreshBatches = useCallback(() => api.batches(200).then(setBatches).catch(() => undefined), []);
  const reloadDay = useCallback(
    (s: string) =>
      api.day(s).then((d) => setMonth((m) => ({ ...m, [s]: d }))).catch(fail),
    [],
  );

  // Back from Excel (the window gets focus again): read Labour Detail and the open day again, so
  // activity codes, workers and entries changed in Excel show up without "Reload from Excel".
  const lastSync = useRef(0);
  const syncing = useRef(false);
  useEffect(() => {
    const sync = () => {
      // Not while the last re-read is still on its way (on a slow PC reading through Excel can
      // take longer than switching windows): they would only queue up behind each other.
      if (document.visibilityState !== "visible" || !master || syncing.current || Date.now() - lastSync.current < 3000) return;
      lastSync.current = Date.now();
      syncing.current = true;
      Promise.allSettled([
        api.master(true).then(setMaster),
        api.day(sheet, true).then((d) => setMonth((m) => ({ ...m, [sheet]: d }))),
      ]).finally(() => (syncing.current = false));
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [master, sheet]);

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

  useEffect(() => {
    const onHash = () => setPage(pageOf(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  const onQueue = (inputs: EntryInput[]) => {
    addToQueue(inputs);
    // A clean form for the next worker: their own suggested times and code show in the empty boxes
    // (from their usual partners, who may be the workers just added).
    setForm(emptyForm());
    setFocusToken((t) => t + 1);
  };

  const commit = async (dryRun: boolean) => {
    if (!queue.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const sent = queue; // entries added while this runs stay in the queue
      const res = await api.commit(sent.map((q) => withHeaderAck(q.input)), user, dryRun);
      setResult(res);
      const planOf = new Map(sent.map((q, n) => [q.id, res.plans[n]]));
      if (res.status === "written" && storyOn) {
        const clean = res.plans.filter((p) => !p.issues.length).length;
        const won = storyAward(res.readback.length, clean);
        if (won.chapters.length || won.item) setStory(won);
      }
      if (res.status === "written" || res.status === "unchanged") {
        setQueue((items) => items.filter((it) => !planOf.has(it.id)));
        setForm((f) => (f.worker ? f : emptyForm())); // pushed: clear leftovers, keep a worker being typed
        await Promise.all([...new Set(sent.map((q) => q.input.sheet))].map(reloadDay));
        refreshBatches();
        refreshStatus();
      } else {
        setQueue((items) => items.map((it) => ({ ...it, plan: planOf.get(it.id) ?? it.plan })));
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
      if (res.status === "undone") setMessage(`Batch #${b.id} undone.${res.note ? ` ${res.note}` : ""}`);
      else setMessage(`Undo ${res.status}: ${res.error ?? res.conflicts.join("; ")}`);
      const daySheets = b.sheets.filter((s) => master?.sheets.includes(s));
      if (daySheets.length < b.sheets.length) api.master(true).then(setMaster).catch(fail); // Labour Detail
      await Promise.all(daySheets.map(reloadDay));
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

  // A waiting entry back into the form (it leaves the queue until added again), or dropped.
  const editQueued = (id: number) => {
    const it = queue.find((q) => q.id === id);
    const w = it && workerByName.get(it.input.calling_name);
    if (!it || !w) return;
    setSheet(it.input.sheet);
    setForm(fromInput(it.input, w));
    setQueue((items) => items.filter((q) => q.id !== id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const removeQueued = (id: number) => setQueue((items) => items.filter((q) => q.id !== id));

  // Entered on the wrong day: every waiting entry of `from` goes to `to` (a worker already waiting on
  // `to` is replaced), checked again from scratch there (confirmations and overwrite are per day),
  // and the entry screen follows to that day.
  const moveSheet = (from: string, to: string) => {
    setQueue((items) => {
      const names = new Set(items.filter((it) => it.input.sheet === from).map((it) => it.input.calling_name));
      return items
        .filter((it) => !(it.input.sheet === to && names.has(it.input.calling_name)))
        .map((it) =>
          it.input.sheet === from ? { ...it, input: { ...it.input, sheet: to, overwrite: false, acknowledged: [] }, plan: null } : it,
        );
    });
    setResult(null);
    setSheet(to);
  };

  // Entries waiting in the queue belong to this workbook: leaving drops them, so ask first.
  const leave = (go: () => void) => {
    const n = queue.length;
    if (n && !window.confirm(`${n} ${n === 1 ? "entry is" : "entries are"} still waiting to go to Excel. They are dropped if you leave this workbook now. Leave anyway?`)) return;
    go();
  };

  const activityOrder = useMemo(() => {
    if (!master) return [];
    const counts = topActivities(month);
    return [...master.activities].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  }, [master, month]);

  // When each worker on this sheet was last pushed with the tool (from the change log), so the day
  // list can show the newest first. Rows entered in Excel directly have no time and stay below.
  const recentOnSheet = useMemo(() => {
    const out = new Map<string, { rank: number; at: string }>();
    for (const b of batches) {
      if (b.kind !== "write" || b.undone_by || b.status !== "done" || !b.sheets.includes(sheet)) continue;
      if (master && b.workbook !== master.workbook) continue;
      b.calling_names.forEach((name, i) => {
        // batches come newest first; within one, the last added was typed last
        if (!out.has(name)) out.set(name, { rank: b.id * 10000 + i, at: b.created_at });
      });
    }
    return out;
  }, [batches, sheet, master]);

  // Entries waiting for this sheet: what workers are doing today counts for the code suggestions.
  const queuedToday = useMemo(
    () =>
      queue
        .filter((q) => q.input.sheet === sheet)
        .map((q) => ({
          calling_name: q.input.calling_name,
          code: q.input.activities.find((a) => a.code?.trim())?.code?.trim() ?? null,
          time_in: q.input.time_in,
          time_out: q.input.time_out,
        })),
    [queue, sheet],
  );

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
        page={page}
        status={status}
        user={user}
        historyLoaded={Object.keys(month).length}
        historyTotal={master?.sheets.length ?? 0}
        onSave={save}
        onChangeUser={() => setAskName(true)}
        onChangeWorkbook={() => leave(onChangeWorkbook)}
        books={books}
        onSwitch={(name) => leave(() => onSwitch(name))}
        onAddWorkbook={() => leave(onAddWorkbook)}
        // Closing the workbook in use drops its waiting entries (ask); another one: nothing to lose.
        onCloseBook={(name) => (books.find((b) => b.name === name)?.active ? leave(() => onCloseBook(name)) : onCloseBook(name))}
        story={{
          on: storyOn,
          unlocked: dayState().chapters,
          total: todaysStory().chapters.length,
          onOpen: () => {
            if (!storyOn) {
              setStoryEnabled(true);
              setStoryOn(true);
            }
            setStoryOpen(-1);
          },
        }}
      />
      {story && (
        <StoryNote
          award={story}
          onRead={() => {
            setStoryOpen(story.chapters[story.chapters.length - 1] ?? -1);
            setStory(null);
          }}
          onClose={() => setStory(null)}
        />
      )}
      {storyOpen !== null && (
        <StoryReader
          start={storyOpen >= 0 ? storyOpen : undefined}
          onClose={() => setStoryOpen(null)}
          onTurnOff={() => {
            setStoryOn(false);
            setStoryOpen(null);
          }}
        />
      )}
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
        ) : page === "cards" ? (
          <TimeCards master={master} month={month} user={user} />
        ) : page === "codes" ? (
          <>
            <ActivityAdder
              master={master}
              user={user}
              onChanged={() => {
                api.master(true).then(setMaster).catch(fail);
                refreshBatches();
                refreshStatus();
              }}
            />
            <MasterTools
              user={user}
              onChanged={() => {
                api.master(true).then(setMaster).catch(fail);
                refreshBatches();
                refreshStatus();
              }}
            />
            <Batches batches={batches} busy={busy} onUndo={undo} />
          </>
        ) : (
          <>
            <DayBar
              sheets={master.sheets}
              sheet={sheet}
              counts={Object.fromEntries(master.sheets.map((s) => [s, month[s]?.entries.length]))}
              types={Object.fromEntries(master.sheets.map((s) => [s, month[s]?.header.day_type]))}
              day={day}
              acknowledged={Boolean(headerAck[sheet])}
              onPick={setSheet}
              onAcknowledge={() => setHeaderAck((a) => ({ ...a, [sheet]: true }))}
              onFix={fixHeader}
              onReload={() => {
                api.master(true).then(setMaster).catch(fail);
                api.day(sheet, true).then((d) => setMonth((m) => ({ ...m, [sheet]: d }))).catch(fail);
              }}
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
              queued={new Set(queue.filter((q) => q.input.sheet === sheet).map((q) => q.input.calling_name))}
              queuedToday={queuedToday}
              onCrew={() => setCrewOpen(true)}
              onMedical={() => setMedicalOpen(true)}
              onBuild={() => setBuilderOpen(true)}
              focusToken={focusToken}
              dialogOpen={askName || crewOpen || medicalOpen || builderOpen}
            />
            <ManpowerSheet
              items={queue}
              activities={master.check_activities}
              places={master.places}
              month={month}
              busy={busy}
              ready={queue.length > 0 && queue.every((q) => q.plan && !q.plan.blocking.length && !q.plan.unconfirmed.length)}
              onWrite={() => commit(false)}
              onEdit={editQueued}
              onRemove={removeQueued}
              allSheets={master.sheets}
              onMoveSheet={moveSheet}
              onDiscardSheet={(s) => {
                setQueue((items) => items.filter((it) => it.input.sheet !== s));
                setResult(null);
              }}
              onChange={(id, input) => {
                setQueue((items) => items.map((it) => (it.id === id ? { ...it, input, plan: null } : it)));
                setResult(null);
              }}
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
              onAckAll={(rule) =>
                setQueue((items) =>
                  items.map((it) =>
                    it.plan?.unconfirmed.some((i) => i.rule === rule) && !it.input.acknowledged.includes(rule)
                      ? { ...it, input: { ...it.input, acknowledged: [...it.input.acknowledged, rule] } }
                      : it,
                  ),
                )
              }
              onOverwrite={(id) =>
                setQueue((items) => items.map((it) => (it.id === id ? { ...it, input: { ...it.input, overwrite: true } } : it)))
              }
              onEdit={editQueued}
              onRemove={removeQueued}
              onCommit={commit}
              onClear={() => setQueue([])}
            />
            <DayList
              day={day}
              recent={recentOnSheet}
              onEdit={(v) => {
                const w = v.entry.calling_name ? workerByName.get(v.entry.calling_name) : undefined;
                if (w) setForm(fromEntry(v.entry, w, true));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onClear={(v) => v.entry.calling_name && addToQueue([clearInput(sheet, v.entry.calling_name)])}
            />
            <Batches batches={batches} busy={busy} onUndo={undo} />
            {builderOpen && (
              <DayBuilder
                sheet={sheet}
                onQueue={(entries) => {
                  addToQueue(entries);
                  setBuilderOpen(false);
                }}
                onClose={() => setBuilderOpen(false)}
              />
            )}
            {medicalOpen && (
              <MedicalDialog
                master={master}
                sheet={sheet}
                user={user}
                initialWorker={form.worker?.calling_name ?? null}
                onDone={(sheets) => {
                  api.master(true).then(setMaster).catch(fail);
                  Promise.all([...new Set(sheets)].map(reloadDay));
                  refreshBatches();
                  refreshStatus();
                }}
                onClose={() => setMedicalOpen(false)}
              />
            )}
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

