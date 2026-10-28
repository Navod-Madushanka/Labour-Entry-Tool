# Roadmap: ideas agreed but not built yet

Ideas discussed with the office and parked for later. Nothing here is built. [PLAN.md](PLAN.md)
is still the spec for what exists.

## 1. New stories every day, without updating the software

**Problem.** The daily story (frontend `src/story.ts`) has 3 built-in stories. The office cannot
pull the software from GitHub every day to get new ones.

**Plan (free, no API key).** The repository is public, so GitHub serves its files for free:

1. Add `stories/stories.json` to the repository, using the same shape as `STORIES` in `story.ts`:
   `[{ "title": "...", "chapters": [{ "title": "...", "text": "..." }, ...] }]`, with 7 chapters
   each.
2. Once a day, the tool downloads
   `https://raw.githubusercontent.com/Navod-Madushanka/Labour-Entry-Tool/main/stories/stories.json`
   (GitHub sends CORS headers, so the browser can fetch it directly) and keeps it in
   localStorage.
3. Today's story is picked from the downloaded list by date. Without internet, or if the download
   fails, the tool uses the last downloaded copy, then the built-in stories. Entry never waits on
   it.
4. Treat the file as plain text: show titles and text only (no HTML), check the shape, and cap
   the size (e.g. 200 KB).
5. Seed the file with about 30 stories (a month), so nobody needs to write any at first. New
   stories are added by editing the file on github.com in the browser; every PC gets them the next
   day.

**Not chosen: AI-generated stories.** They need an API key. Free tiers are rate-limited or change
often, and paid ones cost about 1 US cent a day. The text also can't be checked before workers
read it.

## 2. Software updates from `start.bat` (optional)

The same idea for the software itself: `start.bat` runs `git fetch` on start and, when a newer
version exists, asks "A new version is available. Update now? (Y/N)". Asking matters, so that an
update doesn't land in the middle of a month's data entry. It would run `git pull` and
`pip install -e backend` only on Y.

## 3. Still open from earlier

- The Windows `.exe` (PLAN.md Phase 5): on hold until the office has checked the software.
- Live-Excel smoke test on the office PC: `scripts/excel_smoke.py` on a copy of the workbook.
- Office questions: 2026 holiday list, overtime on Saturday medical days, the `INC-46 M` line.
- A list of activity descriptions for the manpower sheet's Description column (the workbook
  only has the codes).
