import { useState } from "react";
import { FIRST_CHAPTER_WORKERS, ITEMS, dayState, foundItems, setStoryEnabled, todaysStory, type Award } from "../story";

/** The corner note after a push that unlocked something, and the reader with today's chapters. */
export function StoryNote({ award, onRead, onClose }: { award: Award; onRead: () => void; onClose: () => void }) {
  const story = todaysStory();
  const last = award.chapters[award.chapters.length - 1];
  return (
    <div className="story-note" role="status">
      <button className="link story-x" onClick={onClose} aria-label="Close">
        ×
      </button>
      {last !== undefined && (
        <>
          <div className="story-kicker">📖 New chapter unlocked</div>
          <b>{story.chapters[last].title}</b>
          <div className="actions">
            <button className="small primary" onClick={onRead}>
              Read it
            </button>
            <button className="small" onClick={onClose}>
              Later
            </button>
          </div>
        </>
      )}
      {award.item && (
        <div className="story-item">
          You found <b>{award.item.icon} {award.item.name}</b>
          <div className="muted small">{award.item.note}</div>
        </div>
      )}
    </div>
  );
}

export function StoryReader({ start, onClose, onTurnOff }: { start?: number; onClose: () => void; onTurnOff: () => void }) {
  const story = todaysStory();
  const unlocked = dayState().chapters;
  const [n, setN] = useState(Math.min(start ?? unlocked - 1, unlocked - 1));
  const owned = foundItems();
  const chapter = n >= 0 ? story.chapters[n] : null;
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal story-modal" role="dialog" aria-label="Today's story">
        <div className="section-head">
          <h2>📖 {story.title}</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {chapter ? (
          <article className="story-text">
            <div className="story-kicker">
              Chapter {n + 1} of {story.chapters.length}
            </div>
            <h3>{chapter.title}</h3>
            <p>{chapter.text}</p>
            {story.source && <p className="story-source">{story.source}</p>}
          </article>
        ) : (
          <p className="muted">
            Today's story is still hidden. Push your first {FIRST_CHAPTER_WORKERS} workers of the day to Excel to unlock chapter 1.
          </p>
        )}
        <div className="actions">
          <button disabled={n <= 0} onClick={() => setN(n - 1)}>
            ← Previous
          </button>
          <button disabled={n >= unlocked - 1} onClick={() => setN(n + 1)}>
            Next →
          </button>
          <span className="muted small">
            {unlocked < story.chapters.length
              ? `${unlocked} of ${story.chapters.length} chapters. Keep entering to unlock the next one.`
              : "You finished today's story! A new one starts tomorrow."}
          </span>
        </div>
        <details className="story-items">
          <summary>
            Things you found ({owned.length} of {ITEMS.length})
          </summary>
          <ul>
            {ITEMS.map((i) =>
              owned.includes(i.name) ? (
                <li key={i.name}>
                  {i.icon} <b>{i.name}</b> <span className="muted small">{i.note}</span>
                </li>
              ) : (
                <li key={i.name} className="muted">
                  ❔ still hidden somewhere on site
                </li>
              ),
            )}
          </ul>
        </details>
        <p className="small">
          <button
            className="link"
            onClick={() => {
              setStoryEnabled(false);
              onTurnOff();
            }}
          >
            Turn the story off
          </button>
        </p>
      </div>
    </div>
  );
}
