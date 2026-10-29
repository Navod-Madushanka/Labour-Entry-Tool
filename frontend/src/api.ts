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
  trade_group: CellValue;
  employee_code: CellValue;
  code_status: CodeStatus;
}

export interface Master {
  workbook: string;
  month: string;
  holidays: string[];
  sheets: string[];
  workers: Worker[];
  activities: string[];
  day_types: string[];
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

export interface DayBuild {
  sheet: string;
  day_type: string | null;
  window: number;
  sunday_shift: [number, number] | null;
  crews: {
    time_in: number;
    time_out: number;
    activities: { code: string; hours: number | null }[];
    members: { calling_name: string; from_sheet: string; ticked: boolean }[];
  }[];
  already_entered: number;
  candidates: number;
  ticked: number;
}

export interface SetupState {
  workbook: string | null;
  path: string | null;
  mode: "live" | "demo" | null;
  month: string | null;
  month_note: string | null;
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
  error: string | null;
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

export const api = {
  status: () => call<Status>("GET", "/api/status"),
  master: (fresh = false) => call<Master>("GET", `/api/master${fresh ? "?fresh=true" : ""}`),
  day: (sheet: string, fresh = false) =>
    call<DayView>("GET", `/api/days/${encodeURIComponent(sheet)}${fresh ? "?fresh=true" : ""}`),
  preview: (entries: EntryInput[]) =>
    call<{ plans: EntryPlan[] }>("POST", "/api/preview", { entries }).then((r) => r.plans),
  commit: (entries: EntryInput[], user: string, dryRun = false) =>
    call<CommitResult>("POST", "/api/entries", { entries, user, dry_run: dryRun }),
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
  dayBuild: (sheet: string, window = 3) =>
    call<DayBuild>("GET", `/api/days/${encodeURIComponent(sheet)}/build?window=${window}`),
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
  setupHolidays: (holidays: string[]) => call<SetupState>("POST", "/api/setup/holidays", { holidays }),
  setupRegistration: (file: File) => send<SetupState>("/api/setup/registration", file),
  setupReadiness: () => call<Readiness>("GET", "/api/setup/readiness"),
  setupReady: (ready: boolean) => call<SetupState>("POST", "/api/setup/ready", { ready }),
  timecards: () => call<TimeCardSheet[]>("GET", "/api/timecards"),
  printCards: (sheet: string, cell: string, names: string[], copies: number, user: string) =>
    call<PrintJob>("POST", "/api/timecards/print", { sheet, cell, names, copies, user }),
  printJob: () => call<PrintJob>("GET", "/api/timecards/job"),
  stopPrinting: () => call<PrintJob>("POST", "/api/timecards/stop"),
};
