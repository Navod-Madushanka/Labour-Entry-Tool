# Frontend (Phase 3): the entry UI

React + TypeScript + Vite. `npm run build` writes the static files to `backend/app/static/app/`,
which FastAPI serves at `/` (PLAN.md §3). The built files are committed, so the office PC only
needs Python; Node is only needed to change the UI.

```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173/app/ with /api proxied to the backend on :8000
npm run build      # type-check, then rebuild backend/app/static/app/
```

| File | What it is |
|---|---|
| `src/api.ts` | typed client; the types mirror the Pydantic models |
| `src/form.ts` | entry form state ↔ `EntryInput` |
| `src/time.ts` | HH:MM ↔ decimal hours, overnight, 15-minute steps |
| `src/history.ts` | month stats and suggestions from the loaded day sheets |
| `src/search.ts` | worker search (calling name, name, employee code) |
| `src/components/` | status bar, day bar + header banner, entry form, queue, day list, crew dialog, batches |

Every number the UI shows comes from the server (`/api/preview`, `/api/days`). The only rule
computed in the browser is effective hours, to prefill an activity's hours while typing.

`e2e/ui-smoke.cjs` drives the keyboard flow with Playwright against a demo server (see its header).
