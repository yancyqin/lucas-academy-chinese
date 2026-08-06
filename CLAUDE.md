# CLAUDE.md

Tap-to-learn Chinese reading app for kids (Lucas Academy). Static, vanilla JS ES
modules, no build. Run: `python3 serve.py 8099`.

## Architecture

- `index.html` — single page: header + tab pills, `#content`, and the `#panel`
  bottom sheet for word details.
- `js/app.js` — renders tabs from the lesson registry, renders paragraphs
  (art placeholder + verses of clickable word buttons), drives the word panel.
- `js/speech.js` — `speak(text, rate)` wrapper over `speechSynthesis` (zh-CN
  voice, picked lazily because iOS loads voices async).
- `js/audio.js` — prerecorded verse narration: one shared `Audio` element, so a
  new verse always replaces the playing one. `verseAudioSrc()` resolves
  `verse.audio` first, else `<lesson.audio.dir>/verse-NN.mp3` (default dir
  `assets/audio/<lesson id>`); a lesson with no `audio` field returns null and
  keeps using synthesis.
- `lessons/index.js` — registry array; one entry per tab.
- `lessons/<id>.js` — lesson content: `paragraphs[].verses[].tokens` (pre-
  segmented words; punctuation = own token) + `dict` (word → pinyin/meaning/
  usage). `artPrompt` per paragraph is data for future AI illustration
  generation — images intentionally not generated yet, placeholder box renders.

## Gotchas / conventions

- Every internal ES-module import carries a `?v=N` cache token (same convention
  as lucasgame-academy) — bump it on any JS/content change if this ever deploys
  to iPads; serve.py also sends `Cache-Control: no-store`.
- `app.js` console.warns `dict missing: …` when a token has no dict entry —
  check the browser console after adding/editing a lesson.
- Speech requires a user gesture on iOS; all speak() and playRecorded() calls
  are click-driven (never behind an await, or iOS drops the gesture).
  Sound cannot be verified in the headless Browser pane — test on a real device.
- Whole-verse playback prefers the recording and falls back to synthesis if the
  file fails to load; single words are always synthesized. Recordings are
  already read slowly (CosyVoice speed 0.85), so they play at rate 1. They are
  generated in the private `lucas-academy-media` repo — see its README:
  `lucas-narrate` + `scripts/publish_narration.sh` write `assets/audio/<lesson>/`.
- Kid UX: big touch targets, no non-interactive chrome; tabs are pill buttons
  (a dashed "下一课 · soon" pill marks upcoming lessons).
