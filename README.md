# Lucas Academy Chinese · 中文阅读

A tap-to-learn Chinese reading app. Each lesson is a tab; every word in the text
can be tapped to hear its pronunciation (browser speech synthesis, works offline
on iPad) and see an English explanation — the word's meaning plus how it is used
in that sentence. Whole sentences can be read alongside the **NIV** English text
with a plain-language explanation, and in 默写 mode the text hides so a reader can
write the verse back from the audio — the app reading it aloud, or their own voice.

## Run

```bash
python3 serve.py 8099
# open http://localhost:8099
```

Static site, no build step, no dependencies. The English parallel needs the
Worker, so to work on that run the app through Wrangler instead:

```bash
npx wrangler dev --port 8098
```

## Reading controls

- Tap the 🔊 next to a verse to hear the whole verse. Mark 4 plays a recorded
  Mandarin narration read slowly for children; lessons without recordings use
  the browser's built-in voice, and so does every single-word playback.

- Turn on **拼音** in the page header to show pinyin above every word. The preference is remembered on the device.
- Turn on **English · NIV** to show, under each verse, the NIV English of the
  whole sentence plus a plain-English explanation of it. Tapping a word shows the
  same pair for that sentence in the word panel, whether or not the toggle is on.
  Also remembered on the device.
- Turn on **默写 · Dictation** to hide the Chinese text behind a ✍️ blank, and
  read it to yourself: the 🔊 beside the verse plays it at speed, **🐢 Slower**
  reads it word by word with a pause between words — slow enough to write from —
  and 🎧 Mine still plays your own recording. Tap 🐢 again for another pass (while
  it is reading, the same button stops it), write the verse down, then tap the
  blank to check. This mode always starts off, because the recordings it goes
  with last only for the session.
- Tap a word, then choose **Mark** or **Unmark** in its word panel. Marked vocabulary stays highlighted across lessons and is saved in the browser’s local storage.

### Recording yourself

Each verse has a **🎤 Record** button; after recording, **🎧 Mine** plays it back
and 🎤 records a new take over it. Clips are held in memory for the session only
— nothing is uploaded and nothing is written to storage, so they are gone on
reload. The microphone needs a secure origin (https, or localhost) and the
browser's permission; where it is unavailable the buttons are not shown.

## English parallel (NIV)

The Chinese text of every lesson is public-domain CUV and ships in `lessons/`.
The NIV is licensed, so it is **never stored in this repo**: `worker/index.js`
fetches it per verse from YouVersion at read time, caches it at the edge, and
passes YouVersion's own copyright notice through to the footer the app shows
below the lesson.

The app key is server-only and never reaches browser JavaScript. Configure
production with:

```bash
npx wrangler secret put YVP_APP_KEY
```

For local work put `YVP_APP_KEY=...` in `.dev.vars` (gitignored; see
`.dev.vars.example`). The same key is used by the `lucas-academy-bible` Worker.
NIV is YouVersion Bible id `111`, NIrV is `110`.

The client asks for one paragraph at a time — `GET /api/passage?translation=NIV&ref=MRK.4.1-9`
— and the Worker fetches each verse separately, because YouVersion returns a
verse *range* as one unnumbered block that cannot be split apart reliably.

Without the Worker (plain `serve.py`, or no connection) the English line stays
empty, the footer says so, and everything else keeps working.

## Deploy

```bash
npx wrangler deploy
```

Production: <https://chinese.lucasacademy.org>

## Adding a lesson

1. Copy `lessons/mark-3.js` to `lessons/<id>.js` and fill in:
   - `passage` — `{ book: 'MRK', chapter: 4 }`, the YouVersion book code and
     chapter, so verse `n` can be requested as `MRK.4.<n>`. Leave it out and the
     lesson simply has no English parallel.
   - `paragraphs[]` — each has `artCaption` (shown on the placeholder),
     `artPrompt` (saved for generating the illustration later), and `verses[]`.
   - Each verse is `{ n, tokens: [...] }` — one word per token; punctuation is
     its own token (rendered non-clickable).
   - `dict` — one entry per distinct word: `{ pinyin, meaning, usage }`.
   - `explain` — one plain-English sentence or two per verse number, shown under
     the NIV line. Written here by hand: the API supplies scripture text only.
2. Import it in `lessons/index.js` and add it to the exported array.
   To give the lesson recorded narration, add
   `audio: { dir: 'assets/audio/<id>' }` and drop `verse-NN.mp3` files there
   (generated in the private `lucas-academy-media` repo). A single verse can
   also point at its own file with `audio: '...'`.
3. Bump the `?v=` cache token in `index.html` / `js/app.js` / `lessons/index.js`
   if deploying anywhere cached (iPads cache ES modules aggressively).

The app logs `dict missing: …` to the console if any token lacks a dictionary
entry — check the console after adding a lesson.

## Lessons

- **马可福音 3:1–19** (和合本 神版) — Mark 3:1–19
- **马可福音 3:20–35** (和合本 神版) — Mark 3:20–35
- **马可福音 4** (CUV 简体中文) — Mark 4
