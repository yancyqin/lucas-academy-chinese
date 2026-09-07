# CLAUDE.md

Tap-to-learn Chinese reading app for kids (Lucas Academy). Static, vanilla JS ES
modules, no build. Run: `python3 serve.py 8099`, or `npx wrangler dev --port 8098`
when working on the English parallel (that half needs the Worker).

## Architecture

- `index.html` — single page: header + three toggles (拼音 / English · NIV /
  默写) + the `#voice` recording bar + tab pills, `#content`, the `#panel` bottom
  sheet for word details, and `#bible-credit` for the Bible version notice.
- `js/app.js` — renders tabs from the lesson registry, renders paragraphs
  (art placeholder + verses of clickable word buttons), drives the word panel,
  the English layer, dictation mode, the pause switch, and the header's
  recording bar.
- `js/speech.js` — `speak(text, rate, onEnd)` and `speakSequence(parts, rate,
  gapMs, onDone)` over `speechSynthesis` (zh-CN voice, picked lazily because iOS
  loads voices async), plus `pause()` / `resume()`. A generation counter drops
  the callbacks of a read that a newer one supersedes, so a button only ever
  resets itself.
- `js/audio.js` — prerecorded verse narration: one shared `Audio` element, so a
  new verse always replaces the playing one, with `pauseRecorded()` /
  `resumeRecorded()` for the pause switch. `verseAudioSrc()` resolves
  `verse.audio` first, else `<lesson.audio.dir>/verse-NN.mp3` (default dir
  `assets/audio/<lesson id>`); a lesson with no `audio` field returns null and
  keeps using synthesis.
- `js/niv.js` — English parallel: asks `/api/passage` for one paragraph at a
  time, keeps the verses in a session Map, and fails soft (see gotchas).
- `js/record.js` — the reader's own voice via `MediaRecorder`: ONE clip for the
  whole app, kept in local storage as a data URL so it survives closing the
  window, replaced by the next take, never uploaded. Playback runs through Web
  Audio with a measured gain (see gotchas), and has its own pause/resume.
- `worker/index.js` — YouVersion proxy. `GET /api/passage?translation=NIV&ref=MRK.4.1-9`
  fans out one upstream request per verse (a range comes back as one unnumbered
  block that cannot be split reliably), caches each in the edge Cache API, and
  returns YouVersion's version metadata for the credit footer. Everything else
  falls through to `env.ASSETS`.
- `lessons/index.js` — registry array; one entry per tab.
- `lessons/<id>.js` — lesson content: `paragraphs[].verses[].tokens` (pre-
  segmented words; punctuation = own token) + `dict` (word → pinyin/meaning/
  usage) + `explain` (verse number → plain-English explanation, written by hand)
  + `passage` (`{ book, chapter }`, the YouVersion id parts). A paragraph with
  `artImage` shows the picture; without one it renders the placeholder box and
  keeps its `artPrompt` ready. Mark 5 includes all six scene illustrations.

## Gotchas / conventions

- Every internal ES-module import carries a `?v=N` cache token (same convention
  as lucasgame-academy) — bump it on any JS/content change if this ever deploys
  to iPads; serve.py also sends `Cache-Control: no-store`. **Every importer of a
  module must name the same token**: the browser keys modules by URL, so two
  spellings load two copies with two sets of module state (two `gen` counters in
  speech.js would stop cancelling each other). A lesson imported by another lesson
  — `mark-3-20-35.js` pulls in `mark-3.js`, `mark-4.js` pulls in `mark-3-20-35.js`,
  `mark-5.js` pulls in `mark-4.js` — has to be bumped in the registry and in that
  lesson together.
- `app.js` console.warns `dict missing: …` when a token has no dict entry —
  check the browser console after adding/editing a lesson.
- Speech requires a user gesture on iOS; all speak() and playRecorded() calls
  are click-driven (never behind an await, or iOS drops the gesture). The same
  goes for `getUserMedia` — `startRecording()` is called straight from the click
  — and for Web Audio: `playClip()` creates/resumes the AudioContext inside the
  click and only then awaits the decode. Sound cannot be verified in the headless
  Browser pane — test on a real device. The pane blocks microphone capture
  outright, so recording only ever proves itself on a device.
- One sound plays at a time, so there is one pause switch: it appears next to
  whatever started the sound (verse 🔊 / 🐢, the panel's 🔊 Sentence, the header's
  🎧) and asks each player in turn — `pauseRecorded() || pauseClip() ||
  pauseSpeech()` — because only the one that is sounding answers true. Synthesis
  pauses mid-word through `speechSynthesis.pause()`, and a paced sequence also
  holds its next word in `held` (in a silent gap there is no utterance to pause).
  Cancelling a *paused* queue wedges it in some browsers, so `stop()` always
  resumes before it cancels.
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
- The reader's recording is global and persistent by request: one clip in local
  storage under `lucas-academy-chinese.my-recording`, `{ src, type, seconds,
  gain }`, where `src` is a data URL (local storage cannot hold a Blob). It is
  capped — a take auto-stops at 3 minutes, `audioBitsPerSecond` is 64 kbps, and a
  clip over ~3.5 MB of base64 is kept in memory for the visit but not saved,
  because the whole origin only gets about 5 MB. It is still never uploaded.
- Clip playback goes through Web Audio, not the `<audio>` element, because a
  quiet recording has to be made LOUDER and an element's volume only attenuates.
  `measureGain()` takes the RMS of the samples above a silence floor (leading room
  tone would otherwise make a normal reading look quiet), aims for `TARGET_RMS`,
  caps at 12×, and a compressor after the gain rides the peaks. The measurement
  is stored with the clip so it happens once.
- 默写 still always starts off, even though the checkbox state would restore: a
  page that opens with its text hidden reads as broken to whoever picks the iPad
  up next.
- 默写 mode has to be able to sound the verse without showing it: the gutter 🔊
  keeps working, and `.verse-slow` (🐢, rendered on every verse but only shown by
  `body.dictation`) reads it word by word — punctuation dropped, gap-paced, always
  synthesized, since a narration file cannot be split into words. Leaving the mode
  stops that read, because its ⏹ goes away with it; a verse playing from 🔊 is left
  alone. The word panel stays closed in 默写 — it spells out the answer.
- Lesson text is 新标点和合本 (CUNPS). Mark 5 was taken from a public CUNPS text and
  checked by generating Mark 4 the same way and diffing it against the lesson
  already in the repo — identical for all 41 verses, once `<e>`/`<i>` markup is
  stripped and “ ” become 「 」. The digital text leaves the parenthesis in 5:41
  open; the printed 和合本 closes it, and the lesson does too.
- Kid UX: big touch targets, no non-interactive chrome; tabs are pill buttons
  (a dashed "下一课 · soon" pill marks upcoming lessons). 🎤 is not rendered where
  the microphone is unavailable (a saved clip still plays), 🗑 asks once before it
  deletes, and the verse pause switch keeps its space while hidden so a line never
  jumps sideways in the middle of a reading.
