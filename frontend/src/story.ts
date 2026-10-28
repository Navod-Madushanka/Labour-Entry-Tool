// The daily story: a small reward for entering data. Pushing workers to Excel earns hidden points;
// chapters unlock as they grow (the first after 15 workers), and now and then a push "finds" an
// item. Progress is kept in this browser (localStorage), one story per day.
//
// The stories are traditional tales, retold, in stories/stories.json at the top of the repository.
// That file is built into the app for offline use, and a fresh copy is fetched from GitHub at most
// once a day, so new stories reach every PC without updating the software (ROADMAP.md §1).
import builtIn from "../../stories/stories.json";
import { store } from "./store";

export interface Story {
  title: string;
  source?: string; // where the tale comes from
  chapters: { title: string; text: string }[];
}

export interface Item {
  icon: string;
  name: string;
  note: string;
}

const STORIES_URL = "https://raw.githubusercontent.com/Navod-Madushanka/Labour-Entry-Tool/main/stories/stories.json";
const MAX_BYTES = 500_000;

/** Chapter 1 opens once 15 workers have been pushed today. The later chapters need hidden points:
 * one per worker pushed and half a point more for each entry without warnings. */
export const FIRST_CHAPTER_WORKERS = 15;
export const THRESHOLDS = [0, 40, 70, 105, 145, 190, 240];
export const MAX_CHAPTERS = THRESHOLDS.length;

const short = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Only well-formed stories, shown as plain text: a downloaded file is never trusted as it is. */
export function validStories(data: unknown): Story[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (s): s is Story =>
        s !== null &&
        typeof s === "object" &&
        short(s.title, 120) &&
        (s.source === undefined || short(s.source, 400)) &&
        Array.isArray(s.chapters) &&
        s.chapters.length >= 1 &&
        s.chapters.length <= MAX_CHAPTERS &&
        s.chapters.every((c: unknown) => c !== null && typeof c === "object" && short((c as Story["chapters"][0]).title, 120) && short((c as Story["chapters"][0]).text, 4000)),
    )
    .slice(0, 500)
    .map((s) => ({ title: s.title, source: s.source, chapters: s.chapters.map((c) => ({ title: c.title, text: c.text })) }));
}

const BUILT_IN = validStories(builtIn);

function stories(): Story[] {
  const fetched = validStories(read("labour.stories", null));
  return fetched.length ? fetched : BUILT_IN;
}

/** Fetch the stories file at most once a day; quietly keep the old copy when offline. */
export async function refreshStories(): Promise<void> {
  if (store.get("labour.stories.day") === today()) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(STORIES_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok || text.length > MAX_BYTES) return;
    const list = validStories(JSON.parse(text));
    if (!list.length) return;
    store.set("labour.stories", JSON.stringify(list));
    store.set("labour.stories.day", today());
  } catch {
    /* offline or blocked: the last copy (or the built-in one) is used */
  }
}

export const ITEMS: Item[] = [
  { icon: "🍲", name: "Nasreddin's cauldron", note: "Officially dead. Still makes good soup." },
  { icon: "🧥", name: "The coat that ate dinner", note: "A little soup on the sleeve." },
  { icon: "💍", name: "The ring from the Hodja's house", note: "It was inside all along." },
  { icon: "🫏", name: "A donkey that faces backwards", note: "Knows the way better than you." },
  { icon: "🪙", name: "Two jingling coins", note: "Payment for the smell of soup." },
  { icon: "🍬", name: "A bag of the king's 'sand'", note: "Tastes a lot like sugar." },
  { icon: "🥭", name: "A golden mango", note: "Tested and fit for a king." },
  { icon: "🥚", name: "An egg from the royal pond", note: "Laid by a minister." },
  { icon: "🪨", name: "The rock nobody could lift", note: "Still in the farmer's field." },
  { icon: "🔥", name: "Pol Bae Muna's torch", note: "Woke up the river. Twice." },
  { icon: "🧺", name: "A basket of seed paddy", note: "Sown by stretcher." },
  { icon: "🏺", name: "The pot from the goat case", note: "In pieces. Case solved." },
];

interface DayState {
  workers: number; // pushed today
  points: number;
  chapters: number; // unlocked so far today
  story?: string; // today's story title, fixed once the first chapter opens
}

export interface Award {
  chapters: number[]; // newly unlocked chapter indexes
  item: Item | null;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Today's story: a different one each day, in turn. Once a chapter is open the story stays the
 * same for the day, even if a new stories file arrives. */
export function todaysStory(date = new Date()): Story {
  const list = stories();
  const kept = dayState().story;
  const same = kept ? list.find((s) => s.title === kept) ?? BUILT_IN.find((s) => s.title === kept) : undefined;
  if (same) return same;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return list[day % list.length];
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = store.get(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const storyEnabled = () => store.get("labour.story.off") !== "1";
export const setStoryEnabled = (on: boolean) => store.set("labour.story.off", on ? "0" : "1");
export const dayState = (): DayState => ({ workers: 0, points: 0, chapters: 0, ...read(`labour.story.${today()}`, {}) });
export const foundItems = (): string[] => read("labour.items", [] as string[]);

/** Points for a push: one per worker written, half more for each one without warnings. */
export function award(written: number, clean: number, random = Math.random): Award {
  const state = dayState();
  const story = todaysStory();
  const total = Math.min(story.chapters.length, MAX_CHAPTERS);
  state.workers += written;
  state.points += written + 0.5 * clean;
  const before = state.chapters;
  const reached = (n: number) => (n === 0 ? state.workers >= FIRST_CHAPTER_WORKERS : state.points >= THRESHOLDS[n]);
  while (state.chapters < total && reached(state.chapters)) state.chapters += 1;
  if (state.chapters > 0) state.story = story.title;
  store.set(`labour.story.${today()}`, JSON.stringify(state));
  let item: Item | null = null;
  const owned = foundItems();
  const left = ITEMS.filter((i) => !owned.includes(i.name));
  if (left.length && written >= 3 && random() < Math.min(0.3, written / 50)) {
    item = left[Math.floor(random() * left.length)];
    store.set("labour.items", JSON.stringify([...owned, item.name]));
  }
  return { chapters: Array.from({ length: state.chapters - before }, (_, i) => before + i), item };
}
