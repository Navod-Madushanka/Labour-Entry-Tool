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
}

export interface HeaderFixResult {
  status: "written" | "unchanged" | "rejected" | "failed";
  batch_id: number | null;
  changes: Record<string, [CellValue, CellValue]>;
  error: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
};
