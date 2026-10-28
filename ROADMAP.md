# Roadmap

Ideas discussed with the office: what is parked, and what is left of what was built.
[PLAN.md](PLAN.md) is still the spec for what exists.

## 1. New stories every day: built (28 Oct 2026)

`stories/stories.json` is built into the app and fetched from GitHub at most once a day (see
CHANGELOG). Still to do:

- **More stories.** Today's file has 3 collections of traditional tales (Nasreddin Hodja, Andare,
  Mahadenamutta), so the story repeats every 3 days.
- **Classic funny stories in their original words.** These are public domain: O. Henry's "The
  Ransom of Red Chief", Jerome K. Jerome's "Three Men in a Boat" (Uncle Podger hangs a picture,
  the cheese, packing), Mark Twain's "The Celebrated Jumping Frog" and "How I Edited an
  Agricultural Paper", Stephen Leacock's "My Financial Career", George Borrow's "The Turkish
  Jester" (Nasreddin, 1884) and H. Parker's "Village Folk-Tales of Ceylon" (1910–14, Gamarala
  tales). Their texts are on Project Gutenberg, but the cloud session that built this could not
  reach gutenberg.org, wikisource.org or wikipedia.org. Allow them in the environment's network
  settings, or add the texts by hand.
- **How to add a story:** edit `stories/stories.json` on github.com. Each story needs a unique
  `title`, an optional `source` (credit), and 1 to 7 `chapters` of `{ "title", "text" }`. The
  test `backend/tests/test_stories.py` checks the format. Every PC gets the new file the next
  day.

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
