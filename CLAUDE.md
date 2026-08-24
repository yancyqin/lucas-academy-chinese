# CLAUDE.md

Tap-to-learn Chinese reading app for kids (Lucas Academy). Static, vanilla JS ES
modules, no build. Run: `python3 serve.py 8099`, or `npx wrangler dev --port 8098`
when working on the English parallel (that half needs the Worker).

## Architecture

- `index.html` — single page: header + three toggles (拼音 / English · NIV /
  默写) + tab pills, `#content`, the `#panel` bottom sheet for word details, and
  `#bible-credit` for the Bible version notice.
- `js/app.js` — renders tabs from the lesson registry, renders paragraphs
  (art placeholder + verses of clickable word buttons), drives the word panel,
  the English layer, dictation mode, and the per-verse record controls.
- `js/speech.js` — `speak(text, rate)` wrapper over `speechSynthesis` (zh-CN
  voice, picked lazily because iOS loads voices async).
- `js/audio.js` — prerecorded verse narration: one shared `Audio` element, so a
  new verse always replaces the playing one. `verseAudioSrc()` resolves
  `verse.audio` first, else `<lesson.audio.dir>/verse-NN.mp3` (default dir
  `assets/audio/<lesson id>`); a lesson with no `audio` field returns null and
  keeps using synthesis. `playRecorded()` also plays the reader's own clips —
  it takes any src, so one element still means one voice at a time.
- `js/niv.js` — English parallel: asks `/api/passage` for one paragraph at a
  time, keeps the verses in a session Map, and fails soft (see gotchas).
- `js/record.js` — the reader's own voice via `MediaRecorder`. Session-only by
  design: clips are blob URLs in a Map, never uploaded, never persisted.
- `worker/index.js` — YouVersion proxy. `GET /api/passage?translation=NIV&ref=MRK.4.1-9`
  fans out one upstream request per verse (a range comes back as one unnumbered
  block that cannot be split reliably), caches each in the edge Cache API, and
  returns YouVersion's version metadata for the credit footer. Everything else
  falls through to `env.ASSETS`.
- `lessons/index.js` — registry array; one entry per tab.
- `lessons/<id>.js` — lesson content: `paragraphs[].verses[].tokens` (pre-
  segmented words; punctuation = own token) + `dict` (word → pinyin/meaning/
  usage) + `explain` (verse number → plain-English explanation, written by hand)
  + `passage` (`{ book, chapter }`, the YouVersion id parts). `artPrompt` per
  paragraph is data for future AI illustration generation — images intentionally
  not generated yet, placeholder box renders.

## Gotchas / conventions

- Every internal ES-module import carries a `?v=N` cache token (same convention
  as lucasgame-academy) — bump it on any JS/content change if this ever deploys
  to iPads; serve.py also sends `Cache-Control: no-store`.
- `app.js` console.warns `dict missing: …` when a token has no dict entry —
  check the browser console after adding/editing a lesson.
- Speech requires a user gesture on iOS; all speak() and playRecorded() calls
  are click-driven (never behind an await, or iOS drops the gesture). The same
  goes for `getUserMedia` — `startRecording()` is called straight from the click.
  Sound cannot be verified in the headless Browser pane — test on a real device.
  The pane blocks microphone capture outright, so recording only ever proves
  itself on a device.
- Whole-verse playback prefers the recording and falls back to synthesis if the
  file fails to load; single words are always synthesized. Recordings are
  already read slowly (CosyVoice speed 0.85), so they play at rate 1. They are
  generated in the private `lucas-academy-media` repo — see its README:
  `lucas-narrate` + `scripts/publish_narration.sh` write `assets/audio/<lesson>/`.
- **NIV text is licensed: never commit it, never cache it into a repo file.** It
  is fetched per read and cached server-side only, and YouVersion's copyright
  notice has to be on screen wherever its text is — that is what `#bible-credit`
  is for, including when only the word panel is showing English.
- `YVP_APP_KEY` is server-only (`.dev.vars` locally, `wrangler secret put` in
  production). It must never reach browser JavaScript.
- `assets.run_worker_first: ["/api/*"]` in wrangler.jsonc is load-bearing: the
  asset handler would otherwise answer `/api/*` with a 404 before the Worker runs.
- The English layer fails soft on purpose: a 404 (no Worker — the python dev
  server) or 503 (no app key) latches "no English for this session" so one lesson
  does not fire a request per paragraph, while a 5xx or a dropped connection stays
  retryable. The Chinese lesson never depends on it.
- Recordings and 默写 mode are session-scoped together: a reload clears the clips,
  so `setDictation(false)` runs at startup even though the browser restores the
  checkbox. Do not "improve" this by persisting clips — a child's voice should
  not outlive the lesson.
- Kid UX: big touch targets, no non-interactive chrome; tabs are pill buttons
  (a dashed "下一课 · soon" pill marks upcoming lessons). The record buttons are
  not rendered at all where the microphone is unavailable.
