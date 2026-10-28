"""stories/stories.json: the daily story file the app builds in and fetches from GitHub.

The same rules as validStories() in frontend/src/story.ts, so a mistake made while editing the
file on github.com is caught here instead of the story quietly disappearing in the app.
"""

import json

from .conftest import REPO_ROOT

STORIES = REPO_ROOT / "stories" / "stories.json"


def test_stories_file_is_valid():
    assert STORIES.stat().st_size < 500_000
    stories = json.loads(STORIES.read_text(encoding="utf-8"))
    assert isinstance(stories, list) and stories
    titles = [s["title"] for s in stories]
    assert len(titles) == len(set(titles)), "titles must be unique (progress is kept by title)"
    for s in stories:
        assert set(s) <= {"title", "source", "chapters"}, s["title"]
        assert 0 < len(s["title"].strip()) <= 120
        assert "source" not in s or 0 < len(s["source"]) <= 400
        assert 1 <= len(s["chapters"]) <= 7, s["title"]
        for c in s["chapters"]:
            assert set(c) == {"title", "text"}, s["title"]
            assert 0 < len(c["title"].strip()) <= 120
            assert 0 < len(c["text"].strip()) <= 4000
