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
- Speech requires a user gesture on iOS; all speak() calls are click-driven.
  Sound cannot be verified in the headless Browser pane — test on a real device.
- Kid UX: big touch targets, no non-interactive chrome; tabs are pill buttons
  (a dashed "下一课 · soon" pill marks upcoming lessons).
