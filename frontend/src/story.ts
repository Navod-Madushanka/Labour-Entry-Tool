// The daily story: a small reward for entering data. Pushing workers to Excel earns hidden points;
// chapters unlock at the thresholds below (the first after 15 workers), and now and then a push
// "finds" an item. Text only, kept in this browser (localStorage), one story per day.
import { store } from "./store";

export interface Story {
  title: string;
  chapters: { title: string; text: string }[];
}

export interface Item {
  icon: string;
  name: string;
  note: string;
}

/** Chapter 1 opens once 15 workers have been pushed today. The later chapters need hidden points:
 * one per worker pushed and half a point more for each entry without warnings. */
export const FIRST_CHAPTER_WORKERS = 15;
export const THRESHOLDS = [0, 40, 70, 105, 145, 190, 240];

export const STORIES: Story[] = [
  {
    title: "The Case of the Vanishing Helmets",
    chapters: [
      {
        title: "A Bare Head at Dawn",
        text: "Monday, 6:58 a.m. Supervisor Bandara arrived at the site and reached for his yellow helmet. The hook was empty. \"Who took my helmet?\" he asked. Nobody answered. A crow on the crane looked away, a little too quickly. Bandara wrote in his notebook: Suspect No. 1 – the crow. Then he crossed it out. \"Crows don't wear helmets,\" he said. The crow said nothing. It was clearly guilty of something.",
      },
      {
        title: "The Second Helmet",
        text: "By 10 a.m. a second helmet was gone: the new site engineer's, still with the sticker on. \"It was brand new!\" he cried. The tea lady said she had seen something shiny flying past the cement store. The mason said it was a drone. The helper said it was the engineer's career. The engineer did not laugh. Bandara opened his notebook again and wrote: Suspect No. 2 – the drone that does not exist.",
      },
      {
        title: "Clues in the Sand",
        text: "Behind the cement store, Bandara found three things: a bottle cap, a spoon and one yellow feather. \"Yellow feather,\" he whispered. \"Our helmets are yellow.\" The carpenter pointed out that helmets do not have feathers. Bandara ignored him. Great detectives are always misunderstood. He put the feather in a plastic bag and labelled it EVIDENCE, then labelled the bag EVIDENCE BAG, just to be safe.",
      },
      {
        title: "The Stakeout",
        text: "That night Bandara hid behind the concrete mixer with a torch and three packets of biscuits. At midnight he heard a scratching sound. At 12:05 he ate the first packet. At 1:30 the mixer suddenly rumbled. Bandara screamed. It was only the night watchman starting it by mistake. Both men screamed. The crow, watching from the crane, laughed so hard it nearly fell off.",
      },
      {
        title: "The Shiny Collection",
        text: "On Thursday the rigger climbed the tower crane to fix a light. He came down very slowly, holding something. \"Sir,\" he said, \"you should see this.\" On top of the crane was a nest. In the nest: four helmets, nine spoons, a watch, the engineer's sunglasses and one tape measure still measuring something. Bandara looked up. The crow looked down. It was wearing the engineer's helmet. It fitted quite well.",
      },
      {
        title: "Negotiations",
        text: "Getting the helmets back was not easy. The crow would not come down. Bandara offered rice. The crow wanted biscuits. Bandara offered biscuits. The crow wanted the good biscuits. After forty minutes and a packet of chocolate creams, one helmet dropped down. \"One packet, one helmet,\" Bandara sighed. The accountant was told the money was for \"site safety equipment\". Technically, that was true.",
      },
      {
        title: "Employee of the Month",
        text: "By Friday every helmet was back, and the crow had eaten more biscuits than the whole site. The workers made it a tiny helmet from a coconut shell, and it now sits on the crane every morning, inspecting the site. Nobody has lost a spoon since. On the notice board there is a new photo: EMPLOYEE OF THE MONTH – CROW. Bandara says it is a joke. He also says hello to it every morning.",
      },
    ],
  },
  {
    title: "The Concrete Mixer That Wanted to Sing",
    chapters: [
      {
        title: "A Strange Noise",
        text: "It started on a quiet Tuesday. The old concrete mixer, the one everyone called Uncle Mixer, made a new sound: not \"grrrr\" but something like \"la-la-laaa\". The mason stopped mixing. The helper dropped his shovel. \"Did the mixer just… sing?\" Nobody wanted to say yes. The mixer said \"la-laaa\" again. Then, very clearly, it went off-key.",
      },
      {
        title: "The Expert",
        text: "The site called a mechanic. He listened for ten minutes with his eyes closed, nodding like a music teacher. \"The drum bearing is worn,\" he said. \"But also, he has a good voice. A bit flat on the high notes.\" He charged for one hour of repair and two hours of \"vocal assessment\". The accountant is still trying to find the right cost code for that.",
      },
      {
        title: "Requests",
        text: "Word spread. By Wednesday workers from the next site came to listen during lunch. Someone asked for a famous baila song. The mixer went \"grrr-la-grrr\". \"That's it!\" shouted the carpenter, and started dancing. Soon half the site was clapping along while the mixer turned and sang. The safety officer arrived, saw the dancing, and wrote: \"Unusual activity – but morale very high.\"",
      },
      {
        title: "Stage Fright",
        text: "On Thursday the project manager visited. Everyone wanted to show him the singing mixer. They switched it on. Nothing. Just a normal, boring \"grrrr\". \"It sings, sir, really!\" said the helper. The manager raised one eyebrow. The mixer stayed silent all through his visit. The moment his car left the gate, it sang the loudest \"LA-LA-LAAA\" of its life.",
      },
      {
        title: "The Rival",
        text: "Then a brand-new mixer arrived: shiny, quiet, with a digital screen. The workers called it Mr. Modern. It did not sing. It beeped. Uncle Mixer went silent for two whole days. \"He is jealous,\" said the tea lady, and gave him a little oil, like a cup of tea. The next morning Uncle Mixer sang again, softly, and Mr. Modern beeped along in perfect time.",
      },
      {
        title: "The Duet",
        text: "By Saturday the two mixers had a routine: Uncle Mixer sang the tune, Mr. Modern beeped the rhythm. The workers named their band \"Cement & Beats\". Someone filmed it and sent it to the family group chat. By evening the video had reached three districts and one aunty abroad, who wanted to know if the mixers were single.",
      },
      {
        title: "The Grand Finale",
        text: "At the end-of-month party the mixers gave a full concert: four songs, one encore and a dramatic pause where Uncle Mixer nearly ran out of diesel. The project manager came back, heard everything, and clapped the loudest. \"Fine,\" he said, \"the mixer can sing.\" Then he quietly added a line to the budget: \"Mixer maintenance (and voice lessons)\".",
      },
    ],
  },
  {
    title: "Operation Tea Break",
    chapters: [
      {
        title: "The Empty Flask",
        text: "Every day at exactly 10 a.m., the site's big tea flask was full. And every day at exactly 10:05, it was mysteriously empty, before most workers had a single cup. \"This is a crime,\" said the steel fixer, holding his empty cup. \"A crime against tea.\" The site agreed. Operation Tea Break had begun.",
      },
      {
        title: "The Suspects",
        text: "A list was made. Suspect 1: the security guard, who always looked suspiciously happy at 10:06. Suspect 2: the surveyor, who carried a very large bottle \"for water\". Suspect 3: the site dog, Rocky, who once ate a whole packet of sugar. Rocky was interviewed first. He wagged his tail. This was considered neither a yes nor a no.",
      },
      {
        title: "The Trap",
        text: "The workers set a trap. They filled the flask with very strong, very bitter tea, the kind that could wake a building. At 10:02 they hid behind the scaffolding. At 10:04 footsteps came. At 10:05 someone said \"CHHH!\", a sound only bitter tea can cause. Everyone jumped out shouting \"GOTCHA!\" It was the project manager.",
      },
      {
        title: "A Surprising Confession",
        text: "The project manager put the cup down slowly. \"I can explain,\" he said. Every morning he had a meeting with head office at 10:10, and the tea was the only thing that kept him awake. \"Four cups,\" he admitted. \"Sometimes five.\" The steel fixer shook his head sadly. \"Sir,\" he said, \"we could have shared.\"",
      },
      {
        title: "The Negotiation",
        text: "A meeting was called to settle the tea situation. Minutes were taken. Proposal 1: a second flask. Proposal 2: a tea timetable. Proposal 3, from Rocky the dog: more biscuits (he barked twice, which was counted as a vote). After an hour of serious discussion, everyone agreed the meeting had been too long and they needed tea.",
      },
      {
        title: "The New System",
        text: "The new rule was simple: two flasks, one for the workers and one marked MANAGER, with a little drawing of a sleepy face. The tea lady made the manager's extra strong. For the first time in months, every worker got a cup at 10 a.m. Rocky got a biscuit. The security guard looked disappointed, which raised some new questions.",
      },
      {
        title: "Case Closed",
        text: "On Friday the manager arrived with a gift: a third, giant flask with a ribbon. \"For the team,\" he said. Tea time became the best ten minutes of the day, and the site finished the slab two days early. The head office asked for the secret. The manager wrote back: \"Tea. And sharing it.\" Rocky was officially promoted to Tea Inspector.",
      },
    ],
  },
];

export const ITEMS: Item[] = [
  { icon: "🪖", name: "A tiny coconut helmet", note: "Sized for a crow. Surprisingly sturdy." },
  { icon: "🍵", name: "A cup of plain tea", note: "Still warm. Nobody knows who made it." },
  { icon: "🥄", name: "The ninth spoon", note: "Returned from the crane nest. Slightly shinier." },
  { icon: "📏", name: "A tape measure", note: "Still measuring something. Do not disturb." },
  { icon: "🍪", name: "One good biscuit", note: "The crow wants it. Don't give in." },
  { icon: "🧤", name: "A lucky left glove", note: "The right one is on another site, also lucky." },
  { icon: "🔩", name: "The bolt that was 'extra'", note: "The engineer says it is fine. Probably." },
  { icon: "🐕", name: "Rocky's tea-inspector badge", note: "Awarded for services to biscuits." },
  { icon: "🎵", name: "A note from Uncle Mixer", note: "Slightly flat, but full of feeling." },
  { icon: "🧱", name: "A perfectly square brick", note: "The mason framed it." },
  { icon: "🔦", name: "The stakeout torch", note: "Batteries eaten by the night watchman. Somehow." },
  { icon: "🏆", name: "Fastest Entry trophy", note: "Made of cardboard and pride." },
];

interface DayState {
  workers: number; // pushed today
  points: number;
  chapters: number; // unlocked so far today
}

export interface Award {
  chapters: number[]; // newly unlocked chapter indexes
  item: Item | null;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Today's story: a different one each day, in turn. */
export function todaysStory(date = new Date()): Story {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return STORIES[day % STORIES.length];
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
  state.workers += written;
  state.points += written + 0.5 * clean;
  const before = state.chapters;
  const reached = (n: number) => (n === 0 ? state.workers >= FIRST_CHAPTER_WORKERS : state.points >= THRESHOLDS[n]);
  while (state.chapters < THRESHOLDS.length && reached(state.chapters)) state.chapters += 1;
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
