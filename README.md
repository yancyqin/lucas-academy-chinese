# Lucas Academy Chinese · 中文阅读

A tap-to-learn Chinese reading app. Each lesson is a tab; every word in the text
can be tapped to hear its pronunciation (browser speech synthesis, works offline
on iPad) and see an English explanation — the word's meaning plus how it is used
in that sentence. Each paragraph reserves a slot for a future AI illustration.

## Run

```bash
python3 serve.py 8099
# open http://localhost:8099
```

Static site, no build step, no dependencies.

## Adding a lesson

1. Copy `lessons/mark-3.js` to `lessons/<id>.js` and fill in:
   - `paragraphs[]` — each has `artCaption` (shown on the placeholder),
     `artPrompt` (saved for generating the illustration later), and `verses[]`.
   - Each verse is `{ n, tokens: [...] }` — one word per token; punctuation is
     its own token (rendered non-clickable).
   - `dict` — one entry per distinct word: `{ pinyin, meaning, usage }`.
2. Import it in `lessons/index.js` and add it to the exported array.
3. Bump the `?v=` cache token in `index.html` / `js/app.js` / `lessons/index.js`
   if deploying anywhere cached (iPads cache ES modules aggressively).

The app logs `dict missing: …` to the console if any token lacks a dictionary
entry — check the console after adding a lesson.

## Lessons

- **马可福音 3:1–19** (和合本 神版) — Mark 3:1–19
