// Typed client for the backend API (backend/app/api). Types mirror the Pydantic models.

export type CellValue = string | number | boolean | null;
export type Severity = "BLOCK" | "WARN" | "INFO";

export interface Issue {
  rule: string;
  severity: Severity;
  message: string;
  sheet: string | null;
  cell: string | null;
  calling_name: string | null;
  suggestion: string | null;
  plain: { title: string; where: string; what: string; fix: string };
}

export interface Status {
  connected: boolean;
  mode: "live" | "demo";
  workbook: string | null;
  error: string | null;
  unsaved_changes: boolean;
  backup: string | null;
}

export type CodeStatus = "valid" | "missing" | "error" | "zero" | "invalid";

export interface Worker {
  row: number;
  block: number;
  calling_name: string;
  person: string;
  name: CellValue;
  trade_group: CellValue; // from the calling name's letter (INR-01: Rigger), else trade_column
  trade_column?: CellValue; // what Labour Detail's trade column says
  trade_source?: "name" | "column";
  employee_code: CellValue;
  code_status: CodeStatus;
  bp?: CellValue; // Labour Detail's Business Partner (the labour supplier billed)
}

/** Calling-name trade letters (R: Rigger) and Labour Detail's letters with no trade yet. */
export interface TradeLetters {
  letters: Record<string, string>;
  known: Record<string, string>;
  unmatched: Record<string, number>;
}

export interface Master {
  workbook: string;
  month: string;
  holidays: string[];
  sheets: string[];
  workers: Worker[];
  activities: string[];
  day_types: string[];
  check_activities: boolean; // false: this workbook is kept without activity codes
  places: Record<string, string>; // activity-code suffix -> place name, e.g. P -> Parking area
  descriptions?: Record<string, string>; // activity code -> description (office's own, else MasterFormat title)
  place_order?: string[]; // place suffixes bottom to top, for the flowline (the PM's order)
  plan?: Record<string, Record<string, number>>; // trade -> week (Monday) -> planned people a day
  rates?: Rates; // standard costing rates for this workbook's labour source ({} when none)
  quantities?: Record<string, Record<string, number>>; // code -> week (Monday) -> quantity done
  units?: Record<string, string>; // code -> unit
  norms?: Record<string, { hours: number; source: string }>; // code -> norm hours per unit
  limits?: { week_hours: number; week_ot: number; days_in_row: number; rest_hours: number }; // fatigue limits
}

export interface Place {
  suffix: string;
  name: string;
  codes: number; // codes in the activity list with it
  used: number; // entry lines this month with it
  example: string;
}

export interface PlacesView {
  project: string | null;
  places: Place[];
  new: string[]; // never asked about: the start page asks once
}

export interface DayHeader {
  sheet: string;
  date: string | null;
  date_raw: CellValue;
  day_type: CellValue;
  sheet_no: CellValue;
  prepared_by: CellValue;
  project: CellValue;
}

export interface ActivityLine {
  row: number;
  code: CellValue;
  hours: CellValue;
}

export interface Entry {
  sheet: string;
  block: number;
  row: number;
  calling_name: string | null;
  time_in: CellValue;
  time_out: CellValue;
  activities: ActivityLine[];
  additional: CellValue;
  remark: CellValue;
}

export interface Computed {
  total: number;
  effective: number;
  ot_raw: number | null;
  activity_hours: number;
  zidle: number | null;
}

export interface EntryView {
  entry: Entry;
  computed: Computed | null;
  issues: Issue[];
}

export interface DayView {
  header: DayHeader;
  expected_date: string | null;
  expected_day_type: string | null;
  header_issues: Issue[];
  entries: EntryView[];
}

export interface ActivityInput {
  code: string | null;
  hours: number | null;
}

export interface EntryInput {
  sheet: string;
  calling_name: string;
  time_in: number | null;
  time_out: number | null;
  activities: ActivityInput[];
  additional: number | null;
  remark: string | null;
  overwrite: boolean;
  acknowledged: string[];
}

export interface EntryPlan {
  input: EntryInput;
  block: number | null;
  row: number | null;
  old: Record<string, CellValue>;
  preview: Computed | null;
  day_count: number | null;
  bp_day: boolean | null;
  issues: Issue[];
  blocking: Issue[];
  unconfirmed: Issue[];
  ok: boolean;
  changes: Record<string, [CellValue, CellValue]>;
}

export interface ReadBack {
  sheet: string;
  calling_name: string;
  row: number;
  ok: boolean;
  effective: CellValue;
  zidle: CellValue;
  ot: CellValue;
  mismatches: string[];
}

export interface CommitResult {
  status: "rejected" | "dry_run" | "unchanged" | "written" | "failed";
  plans: EntryPlan[];
  batch_id: number | null;
  backup: string | null;
  readback: ReadBack[];
  error: string | null;
  seconds: number;
}

export interface Batch {
  id: number;
  created_at: string;
  user: string;
  workbook: string;
  kind: "write" | "undo";
  status: "pending" | "done" | "failed";
  undo_of: number | null;
  undone_by: number | null;
  note: string | null;
  cells: number;
  calling_names: string[];
  sheets: string[];
}

export interface UndoResult {
  status: "undone" | "conflict" | "rejected" | "failed";
  batch_id: number;
  undo_batch_id: number | null;
  conflicts: string[];
  error: string | null;
  note: string | null;
}

export interface HeaderFixResult {
  status: "written" | "unchanged" | "rejected" | "failed";
  batch_id: number | null;
  changes: Record<string, [CellValue, CellValue]>;
  error: string | null;
}

export interface CodeProposal {
  row: number;
  calling_name: string;
  current: CellValue;
  status: CodeStatus;
  proposed: string | null;
  source: "registration" | "base code" | null;
  found_in: string | null;
  notes: string[];
  conflicts: string[];
  selectable: boolean;
}

export interface IdConflict {
  kind: "name differs" | "one character" | "not found";
  registration: string;
  calling_name: string;
  worker: string | null;
  message: string;
}

export interface CodesResponse {
  files: string[];
  proposals: CodeProposal[];
  conflicts: IdConflict[];
}

export interface CodeWriteResult {
  status: "written" | "rejected" | "failed";
  batch_id: number | null;
  written: Record<string, [CellValue, CellValue]>;
  problems: string[];
  mismatches: string[];
  error: string | null;
}

export interface RegistrationReport {
  files: { name: string; kind: string; sheets: { title: string; kind: string; rows: number }[] }[];
  rows: number;
  no_hyphen: number;
  next_numbers: Record<string, string>;
  issues: Issue[];
  by_rule: Record<string, number>;
  missing: string[];
}

export interface MedicalRequest {
  base: string;
  start: string;
  days: number;
  time_in: number;
  time_out: number;
  activity: string;
  remark: string | null;
  skip_holidays: boolean;
  acknowledged: Record<string, string[]>;
}

export interface MedicalPlan {
  base: string;
  name: string | null;
  row: number | null;
  new_row: boolean;
  new_row_cells: string[];
  entries: EntryInput[];
  plans: EntryPlan[];
  skipped: string[];
  later: string[];
  notes: string[];
  problems: string[];
}

export interface MedicalResult {
  status: "written" | "rejected" | "failed";
  plan: MedicalPlan;
  row: CodeWriteResult | null;
  entries: CommitResult | null;
  error: string | null;
}

export interface BookInfo {
  name: string;
  mode: "live" | "demo";
  month: string | null;
  ready: boolean;
  check_activities: boolean;
  active: boolean;
}

export interface SetupState {
  workbook: string | null; // the active workbook
  check_activities: boolean; // its activity codes and hours are checked
  books: BookInfo[]; // every workbook open in this session
  path: string | null;
  mode: "live" | "demo" | null;
  month: string | null;
  month_note: string | null;
  month_confirmed: boolean; // false: the start page asks which month the workbook is for
  month_source: string | null; // "file name", "sheet dates", "you"

  holidays: string[];
  registration_files: string[];
  live_available: boolean;
  browse_available: boolean;
  open_workbooks: string[];
  excel_note: string | null; // Excel didn't answer (an open dialog), so open workbooks are unknown
  ready: boolean;
}

export type PlainIssue = Issue;

export interface HealthReport {
  source: { source_name: string };
  month: string;
  holidays: string[];
  stats: {
    workers: number;
    entries: number;
    complete_entries: number;
    sheets_with_entries: number;
    by_rule: Record<string, number>;
    by_severity: Record<string, number>;
  };
  issues: PlainIssue[];
}

export interface ReadinessCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  title: string;
  detail: string;
}

export interface Readiness {
  checks: ReadinessCheck[];
  ready: boolean;
  next_sheet: string | null;
}

export interface TimeCardSheet {
  sheet: string;
  cell: string | null;
  current: CellValue;
  practice: boolean;
  note: string | null;
}

export interface PrintJob {
  running: boolean;
  practice: boolean;
  sheet: string | null;
  total: number;
  done: number;
  current: string | null;
  printed: string[];
  stopped: boolean;
  paused: boolean; // waits after the card being printed
  left: string[]; // not printed yet, after a stop or an error
  error: string | null;
}

/** A supervisor offered at push: used before (latest first), or typed in by hand. */
export interface Supervisor {
  name: string;
  last_used: string | null;
}

/** A pushed entry and whose manpower sheet (paper) it came from. */
export interface Owned {
  id: number;
  sheet: string;
  calling_name: string;
  supervisor: string;
  created_at: string;
  user: string;
  batch_id: number | null;
  entry: EntryInput; // as pushed
}

/** The latest review of a supervisor's sheet (checked against the paper). */
export interface Review {
  id: number;
  sheet: string;
  supervisor: string;
  status: "ok" | "problem" | "cleared";
  note: string | null;
  user: string;
  created_at: string;
  fingerprint: string; // the sheet as reviewed: another one now means it changed since
  history: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

// Labour Detail and the day sheets as last received, with their ETag. A re-read that finds Excel
// unchanged answers "304" and the very same object comes back: the screen keeps it (no new state,
// nothing drawn again, no JSON parsed). One copy per path, shared with the screen's own state.
const held = new Map<string, { tag: string; data: unknown }>();

async function getHeld<T>(path: string, fresh: boolean): Promise<T> {
  const was = held.get(path);
  const res = await fetch(fresh ? `${path}?fresh=true` : path, {
    cache: "no-store", // the browser's own cache would hand back a copy, not this object
    headers: was ? { "If-None-Match": was.tag } : undefined,
  });
  if (res.status === 304 && was) return was.data as T;
  const data = await parse<T>(res);
  const tag = res.headers.get("ETag");
  if (tag) held.set(path, { tag, data });
  else held.delete(path);
  return data;
}

/** A file sent as the raw request body (no multipart). */
async function send<T>(path: string, file: File): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  return parse<T>(
    await fetch(`${path}${sep}filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    }),
  );
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export interface ExportTable {
  name: string;
  note?: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface SuggestOffer {
  tier: string | null;
  prefilled: boolean;
  kept: boolean;
  rank?: number;
}

export interface SuggestLogLine {
  workbook: string;
  sheet: string;
  keys: number;
  worker_keys: number;
  ms: number;
  also: number;
  lines: number;
  time?: SuggestOffer;
  code?: SuggestOffer;
  record?: SuggestOffer;
}

export interface SuggestOfferSummary {
  shown: number;
  kept: number;
  prefilled: number;
  prefill_kept: number;
  tiers: Record<string, { shown: number; kept: number }>;
}

export interface SuggestLogSummary {
  days: number;
  file: string;
  entries: number;
  workers: number;
  keys_per_entry: number | null;
  keys_per_worker: number | null;
  worker_keys: number | null;
  seconds_per_entry: number | null;
  time: SuggestOfferSummary;
  code: SuggestOfferSummary;
  record: SuggestOfferSummary;
  first: string | null;
  last: string | null;
}

export const api = {
  previousMonth: () => call<{ source: string | null; days: Record<string, DayView> }>("GET", "/api/previous-month"),
  logSuggestion: (line: SuggestLogLine) => call<{ ok: boolean }>("POST", "/api/suggest-log", line),
  suggestLogSummary: (days = 30) => call<SuggestLogSummary>("GET", `/api/suggest-log/summary?days=${days}`),
  /** The Analysis tables as an .xlsx file. */
  exportAnalysis: async (title: string, sheets: ExportTable[]): Promise<Blob> => {
    const res = await fetch("/api/analysis/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, sheets }),
    });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  },
  status: () => call<Status>("GET", "/api/status"),
  master: (fresh = false) => getHeld<Master>("/api/master", fresh),
  day: (sheet: string, fresh = false) => getHeld<DayView>(`/api/days/${encodeURIComponent(sheet)}`, fresh),
  preview: (entries: EntryInput[]) =>
    call<{ plans: EntryPlan[] }>("POST", "/api/preview", { entries }).then((r) => r.plans),
  // owners: "sheet|calling name" -> supervisor for entries that keep theirs (corrections)
  commit: (entries: EntryInput[], user: string, dryRun = false, supervisor?: string, owners?: Record<string, string>) =>
    call<CommitResult>("POST", "/api/entries", { entries, user, dry_run: dryRun, supervisor: supervisor || null, owners: owners ?? null }),
  tradeLetters: () => call<TradeLetters>("GET", "/api/setup/trade-letters"),
  saveTradeLetters: (letters: Record<string, string>) => call<TradeLetters>("POST", "/api/setup/trade-letters", { letters }),
  supervisors: () => call<Supervisor[]>("GET", "/api/supervisors"),
  addSupervisor: (name: string) => call<Supervisor[]>("POST", "/api/supervisors", { name }),
  removeSupervisor: (name: string) => call<Supervisor[]>("POST", "/api/supervisors/remove", { name }),
  renameSupervisor: (old: string, name: string) => call<Supervisor[]>("POST", "/api/supervisors/rename", { old, new: name }),
  supervisorSheets: () => call<Owned[]>("GET", "/api/supervisor-sheets"),
  supervisorReviews: () => call<Review[]>("GET", "/api/supervisor-reviews"),
  reviewSheet: (r: { sheet: string; supervisor: string; status: Review["status"]; note?: string | null; fingerprint: string; user: string }) =>
    call<Review[]>("POST", "/api/supervisor-reviews", r),
  reassignSheets: (ids: number[], supervisor: string) =>
    call<Owned[]>("POST", "/api/supervisor-sheets/reassign", { ids, supervisor }),
  batches: (limit = 20) => call<Batch[]>("GET", `/api/batches?limit=${limit}`),
  undo: (batchId: number, user: string) =>
    call<UndoResult>("POST", `/api/batches/${batchId}/undo`, { user }),
  headerFix: (sheet: string, fields: string[], user: string) =>
    call<HeaderFixResult>("POST", `/api/days/${encodeURIComponent(sheet)}/header-fix`, {
      user,
      fields,
      approve: true,
    }),
  save: () => call<{ saved: boolean }>("POST", "/api/save"),
  medicalPreview: (req: MedicalRequest) => call<MedicalPlan>("POST", "/api/medical/preview", req),
  medical: (req: MedicalRequest, user: string) =>
    call<MedicalResult>("POST", "/api/medical", { ...req, user, approve: true }),
  rules: () => call<Record<string, { severity: Severity; title: string }>>("GET", "/api/rules"),
  registration: () => call<RegistrationReport>("GET", "/api/registration"),
  codes: () => call<CodesResponse>("GET", "/api/codes"),
  writeCodes: (items: { row: number; calling_name: string; code: string }[], user: string) =>
    call<CodeWriteResult>("POST", "/api/codes/write", { items, user, approve: true }),
  setup: () => call<SetupState>("GET", "/api/setup"),
  setupUpload: (file: File, practice: boolean) =>
    send<SetupState>(`/api/setup/upload?practice=${practice}`, file),
  setupBrowse: (practice: boolean) =>
    call<{ cancelled: boolean; state?: SetupState }>("POST", "/api/setup/browse", { practice }),
  setupOpen: (name: string) => call<SetupState>("POST", "/api/setup/open", { name }),
  setupCheck: () => call<HealthReport>("POST", "/api/setup/check"),
  setupMonth: (month: string) => call<SetupState>("POST", "/api/setup/month", { month }),
  setupHolidays: (holidays: string[]) => call<SetupState>("POST", "/api/setup/holidays", { holidays }),
  setupRegistration: (file: File) => send<SetupState>("/api/setup/registration", file),
  setupReadiness: () => call<Readiness>("GET", "/api/setup/readiness"),
  setupReady: (ready: boolean) => call<SetupState>("POST", "/api/setup/ready", { ready }),
  setupSwitch: (name: string) => call<SetupState>("POST", "/api/setup/switch", { name }),
  setupClose: (name: string) => call<SetupState>("POST", "/api/setup/close", { name }),
  addActivities: (codes: string[], user: string) =>
    call<{ status: "written" | "rejected" | "failed"; added: Record<string, string>; problems: string[]; mismatches: string[]; error: string | null }>(
      "POST", "/api/activities/add", { codes, user, approve: true }),
  setupPlaces: () => call<PlacesView>("GET", "/api/setup/places"),
  setupProgress: () => call<{ done?: number; total?: number; step?: string }>("GET", "/api/setup/progress"),
  saveSetupPlaces: (names: Record<string, string>) => call<SetupState>("POST", "/api/setup/places", { names }),
  descriptions: () => call<DescriptionsView>("GET", "/api/setup/descriptions"),
  savePlaceOrder: (order: string[]) => call<SetupState>("POST", "/api/setup/place-order", { order }),
  savePlan: (plan: Record<string, Record<string, number>>) => call<SetupState>("POST", "/api/setup/plan", { plan }),
  rates: () => call<RatesView>("GET", "/api/setup/rates"),
  lostTime: () => call<LostView>("GET", "/api/lost-time"),
  bpBillCheck: () => call<BillCheck>("GET", "/api/bp-bill/check"),
  bpBillCheckFile: (file: File) => send<BillCheck>("/api/bp-bill/check-file", file),
  saveBpLayout: (fix: Partial<Record<"header_row" | "name_col" | "first_day_col" | "total_days_col" | "total_hours_col" | "bp_col", number>> & { mode?: string }) =>
    call<{ ok: boolean }>("POST", "/api/bp-bill/layout", fix),
  bpClaim: (file: File) => send<{ source: string; rows: ClaimCheck[] }>("/api/bp-bill/claim", file),
  reportSettings: () => call<ReportState>("GET", "/api/report/settings"),
  saveReportSettings: (body: ReportSettings) => call<ReportState>("POST", "/api/report/settings", body),
  writeReport: () => call<ReportState>("POST", "/api/report/write"),
  historyMonths: () => call<MonthInfo[]>("GET", "/api/history"),
  saveHistory: () => call<{ month: MonthInfo; note: string | null }>("POST", "/api/history/save"),
  importHistory: async (file: File) => {
    const res = await fetch(`/api/history/import?filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `${res.status} ${res.statusText}`);
    return (await res.json()) as { month: MonthInfo; note: string | null };
  },
  deleteHistory: (id: number) => call<MonthInfo[]>("DELETE", `/api/history/${id}`),
  historyRows: (ids: number[]) => call<{ rows: HistoryRow[]; quantities: HistoryQuantity[] }>("GET", `/api/history/rows?ids=${ids.join(",")}`),
  historyCarry: () => call<Record<string, number>>("GET", "/api/history/carry"),
  saveLimits: (body: { week_hours: number; week_ot: number; days_in_row: number; rest_hours: number }) => call<unknown>("POST", "/api/setup/limits", body),
  saveQuantities: (body: { quantities: Record<string, Record<string, number>>; units: Record<string, string>; norms: Record<string, { hours: number; source: string }> }) =>
    call<SetupState>("POST", "/api/setup/quantities", body),
  setLostTime: (body: { user: string; sheet: string; supervisor?: string | null; causes: string[]; note?: string | null }) =>
    call<LostView>("POST", "/api/lost-time", body),
  saveRates: (body: Omit<RatesView, "source" | "known" | "worker_rates" | "other_sources">) => call<RatesView>("POST", "/api/setup/rates", body),
  saveDescriptions: (descriptions: Record<string, string>) => call<SetupState>("POST", "/api/setup/descriptions", { descriptions }),
  setupOptions: (check_activities: boolean) => call<SetupState>("POST", "/api/setup/options", { check_activities }),
  timecards: () => call<TimeCardSheet[]>("GET", "/api/timecards"),
  timecardList: (file: File) => send<{ names: string[]; source: string }>("/api/timecards/list", file),
  printCards: (sheet: string, cell: string, names: string[], copies: number, user: string) =>
    call<PrintJob>("POST", "/api/timecards/print", { sheet, cell, names, copies, user }),
  printJob: () => call<PrintJob>("GET", "/api/timecards/job"),
  stopPrinting: () => call<PrintJob>("POST", "/api/timecards/stop"),
  pausePrinting: () => call<PrintJob>("POST", "/api/timecards/pause"),
  resumePrinting: () => call<PrintJob>("POST", "/api/timecards/resume"),
};

export interface DescriptionRow {
  code: string;
  standard: string | null; // MasterFormat title
  custom: string | null; // the office's own
  lines: number; // activity lines with the code this month
}

export interface DescriptionsView {
  project: string | null;
  codes: DescriptionRow[];
}

/** Standard costing rates (not pay): daily rate per trade, optional per worker, and multipliers. */
export interface Rates {
  trades?: Record<string, number>;
  workers?: Record<string, number>; // calling name -> Labour Detail's Daily Rate (when used)
  ot?: number; // overtime on a normal day or Saturday
  sunday?: number;
  holiday?: number;
  day_hours?: number; // hours in a standard day (daily rate / day_hours = hourly rate)
}

export interface RatesView {
  source: string;
  trades: Record<string, number>;
  known: string[];
  use_worker_rates: boolean;
  worker_rates: number;
  ot: number;
  sunday: number;
  holiday: number;
  day_hours: number;
  other_sources: string[];
}

/** A lost-time cause and who is responsible for it (roadmap #5). */
export interface Cause {
  id: string;
  label: string;
  party: string;
}

/** Why a supervisor sheet has unallocated hours (supervisor set) or what disrupted a day. */
export interface Lost {
  sheet: string;
  supervisor: string | null;
  causes: string[];
  note: string | null;
  user: string;
  created_at: string;
}

export interface LostView {
  causes: Cause[];
  items: Lost[];
}

/** A month kept in the history (roadmap #9). */
export interface MonthInfo {
  id: number;
  kind: string;
  month: string;
  source: string;
  saved_at: string;
  entries: number;
  workers: number;
  hours: number;
  ot: number;
}

export interface HistoryRow {
  month_id: number;
  sheet: string;
  day: number;
  date: string | null;
  day_type: string | null;
  calling_name: string;
  person: string;
  trade: string | null;
  bp: string | null;
  supervisor: string | null;
  time_in: number | null;
  time_out: number | null;
  worked: number;
  ot: number;
  zidle: number;
  lines: [string, number | null][];
}

export interface HistoryQuantity {
  month_id: number;
  code: string;
  week: string;
  qty: number;
  unit: string | null;
}

/** Sharing with the PM and QS (roadmap #10). */
export interface ReportSettings {
  folder: string;
  time: string; // HH:MM
  enabled: boolean;
  rupees: boolean;
  lan: boolean;
}

export interface ReportState extends ReportSettings {
  last_at: string | null;
  last_file: string | null;
  last_error: string | null;
  lan_active: boolean;
  viewer_url: string | null;
}

/** The BP Bill sheet against the day sheets (roadmap #8). */
export interface BillLayout {
  sheet: string;
  header_row: number | null;
  name_col: number | null;
  day_cols: Record<string, number>;
  total_days_col: number | null;
  total_hours_col: number | null;
  amount_col: number | null;
  bp_col: number | null;
  mode: "hours" | "days";
  notes: string[];
}

export interface BillDifference {
  name: string;
  day: number | null;
  bill: number | null;
  sheets: number | null;
  note: string;
}

export interface BillCheck {
  source: string;
  layout: BillLayout;
  layout_text: string;
  workers: number;
  differences: BillDifference[];
}

export interface ClaimCheck {
  bp: string;
  name: string;
  billed_days: number | null;
  sheet_days: number;
  billed_hours: number | null;
  sheet_hours: number;
  note: string;
}
