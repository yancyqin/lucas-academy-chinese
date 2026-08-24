import { speak, speakSequence, stop } from './speech.js?v=5';
import { playRecorded, stopRecorded, verseAudioSrc } from './audio.js?v=2';
import { loadEnglish, englishVerse, englishAttribution, englishOffline, lessonHasEnglish } from './niv.js?v=1';
import {
  isSupported as micSupported,
  hasClip,
  clipUrl,
  startRecording,
  stopRecording,
  recordingNow,
} from './record.js?v=1';
import lessons from '../lessons/index.js?v=8';

const PUNCT_RE = /^[，。、：；？！…—─（）《》「」『』""'',.!?;:()\-\s]+$/;
const PINYIN_STORAGE_KEY = 'lucas-academy-chinese.pinyin-visible';
const ENGLISH_STORAGE_KEY = 'lucas-academy-chinese.english-visible';
const HIGHLIGHTS_STORAGE_KEY = 'lucas-academy-chinese.highlighted-words';
const WORDBOOK_MINIMIZED_STORAGE_KEY = 'lucas-academy-chinese.wordbook-minimized';

const tabsEl = document.getElementById('tabs');
const contentEl = document.getElementById('content');
const creditEl = document.getElementById('bible-credit');

const panelEl = document.getElementById('panel');
const panelWord = document.getElementById('panel-word');
const panelPinyin = document.getElementById('panel-pinyin');
const panelMeaning = document.getElementById('panel-meaning');
const panelUsage = document.getElementById('panel-usage');
const panelSentence = document.getElementById('panel-sentence');
const panelEnglish = document.getElementById('panel-english');
const panelNiv = document.getElementById('panel-niv');
const panelNivRow = document.getElementById('panel-niv-row');
const panelExplain = document.getElementById('panel-explain');
const pinyinToggle = document.getElementById('pinyin-toggle');
const englishToggle = document.getElementById('english-toggle');
const dictationToggle = document.getElementById('dictation-toggle');
const highlightButton = document.getElementById('btn-highlight');
const unhighlightButton = document.getElementById('btn-unhighlight');
const wordbookEl = document.getElementById('wordbook');
const wordbookListEl = document.getElementById('wordbook-list');
const wordbookCountEl = document.getElementById('wordbook-count');
const wordbookMinimizeButton = document.getElementById('wordbook-minimize');

let activeLesson = null;
let selectedSpan = null;
let current = null; // { word, sentence }
let highlightedWords = readHighlights();
let wordbookMinimized = readWordbookMinimized();

// The English-parallel and record controls of the lesson on screen, by verse
// number, so an English line arriving from the network (or a finished recording)
// can be dropped straight into the right row.
let verseRows = new Map(); // n -> { verse, en, explain, mine, record }

function readHighlights() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIGHLIGHTS_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter(item => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveHighlights() {
  try {
    localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, JSON.stringify([...highlightedWords]));
  } catch {
    // Reading still works if a browser has local storage disabled.
  }
}

function setPinyinVisible(visible) {
  document.body.classList.toggle('show-pinyin', visible);
  pinyinToggle.checked = visible;
  try {
    localStorage.setItem(PINYIN_STORAGE_KEY, String(visible));
  } catch {
    // Keep the current page setting even if it cannot be persisted.
  }
}

function restorePinyinPreference() {
  try {
    setPinyinVisible(localStorage.getItem(PINYIN_STORAGE_KEY) === 'true');
  } catch {
    setPinyinVisible(false);
  }
}

// ---------- English parallel (NIV) ----------
let englishVisible = false;
// Set once any NIV text has actually been shown: YouVersion's copyright notice
// has to appear wherever its text does, including from the word panel alone.
let englishShown = false;

function setEnglishVisible(visible) {
  englishVisible = visible;
  document.body.classList.toggle('show-english', visible);
  englishToggle.checked = visible;
  try {
    localStorage.setItem(ENGLISH_STORAGE_KEY, String(visible));
  } catch {
    // The page still shows English even if the choice cannot be persisted.
  }
  if (visible) loadLessonEnglish();
  else renderCredit();
}

function restoreEnglishPreference() {
  try {
    setEnglishVisible(localStorage.getItem(ENGLISH_STORAGE_KEY) === 'true');
  } catch {
    setEnglishVisible(false);
  }
}

// Fetch the English text for the lesson on screen one paragraph at a time and
// fill each line in as it arrives, so the reader sees the first scene while the
// rest is still loading.
async function loadLessonEnglish() {
  const lesson = activeLesson;
  if (!lesson || !englishVisible || !lessonHasEnglish(lesson)) {
    renderCredit();
    return;
  }
  renderCredit();
  for (const para of lesson.paragraphs) {
    const numbers = para.verses.map(v => v.n);
    await loadEnglish(lesson, numbers);
    if (lesson !== activeLesson) return; // the reader changed lessons mid-flight
    numbers.forEach(n => fillEnglish(lesson, n));
    renderCredit();
    if (englishOffline()) return; // no English server in this session — stop asking
  }
}

function fillEnglish(lesson, n) {
  const row = verseRows.get(n);
  if (!row) return;
  const text = englishVerse(lesson, n);
  row.en.textContent = '';
  if (text) {
    row.en.classList.remove('pending');
    row.en.append(el('span', 'en-tag', 'NIV'), text);
    englishShown = true;
  } else {
    row.en.classList.add('pending');
    row.en.textContent = englishOffline() ? '' : '…';
  }
}

function renderCredit() {
  const attribution = englishAttribution();
  creditEl.textContent = '';

  if (englishShown && attribution) {
    creditEl.append(
      el('p', 'bible-credit-title', `${attribution.title} (${attribution.abbreviation})`),
    );
    if (attribution.copyright) creditEl.append(el('p', 'bible-credit-line', attribution.copyright));
    const link = document.createElement('a');
    link.className = 'bible-credit-link';
    link.href = attribution.youVersionDeepLink;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'YouVersion';
    creditEl.append(link);
    creditEl.hidden = false;
    return;
  }

  if (englishVisible && activeLesson && lessonHasEnglish(activeLesson)) {
    creditEl.append(
      el(
        'p',
        'bible-credit-note',
        englishOffline()
          ? 'The English parallel needs the lesson server — the Chinese lesson works without it.'
          : 'Loading the English parallel…',
      ),
    );
    creditEl.hidden = false;
    return;
  }

  creditEl.hidden = true;
}

// ---------- 默写 (dictation) ----------
// Hides the Chinese text so the reader can write it down from audio — their own
// recording or the lesson narration — and reveal it to check. Session only,
// like the recordings: a mode with nothing recorded yet would only confuse.
function setDictation(on) {
  document.body.classList.toggle('dictation', on);
  dictationToggle.checked = on;
  if (on) {
    closePanel(); // the panel spells out the whole sentence — that is the answer
  } else {
    document.querySelectorAll('.verse.revealed').forEach(row => row.classList.remove('revealed'));
  }
}

// ---------- your own voice ----------
// Session-only recordings, one verse at a time; the recording button shows ⏹.
let recordingButton = null;

function clipKey(lesson, verse) {
  return `${lesson.id}:${verse.n}`;
}

function markRecording(button) {
  clearRecording();
  recordingButton = button;
  button.textContent = button.dataset.stopLabel;
  button.title = 'Stop recording';
  button.classList.add('recording');
}

function clearRecording(button) {
  if (!recordingButton || (button && button !== recordingButton)) return;
  recordingButton.textContent = recordingButton.dataset.idleLabel;
  recordingButton.title = recordingButton.dataset.idleTitle;
  recordingButton.classList.remove('recording');
  recordingButton = null;
}

// Same button starts and stops. Called straight from the click so iOS still
// counts it as a gesture when the microphone prompt appears.
function toggleRecording(lesson, verse, row) {
  const key = clipKey(lesson, verse);
  if (recordingNow() === key) {
    stopRecording();
    return;
  }
  stopVerse(); // never record the app's own voice back through the speaker
  row.note.hidden = true;
  markRecording(row.record);
  startRecording(key, {
    onDone: () => {
      clearRecording(row.record);
      row.mine.hidden = !hasClip(key);
    },
    onError: () => {
      clearRecording(row.record);
      row.note.textContent = 'No microphone here — needs https and permission.';
      row.note.hidden = false;
    },
  });
}

function toggleMine(lesson, verse, row) {
  const url = clipUrl(clipKey(lesson, verse));
  if (!url) return;
  if (playingButton === row.mine) {
    stopVerse();
    return;
  }
  stopVerse();
  markPlaying(row.mine);
  playRecorded(url, () => clearPlaying(row.mine), () => clearPlaying(row.mine));
}

function readWordbookMinimized() {
  try {
    return localStorage.getItem(WORDBOOK_MINIMIZED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setWordbookMinimized(minimized) {
  wordbookMinimized = minimized;
  wordbookEl.classList.toggle('minimized', minimized);
  wordbookMinimizeButton.textContent = minimized ? '›' : '−';
  const label = minimized ? 'Expand Wordbook' : 'Minimize Wordbook';
  wordbookMinimizeButton.setAttribute('aria-label', label);
  wordbookMinimizeButton.title = label;
  try {
    localStorage.setItem(WORDBOOK_MINIMIZED_STORAGE_KEY, String(minimized));
  } catch {
    // The current page still responds if local storage is unavailable.
  }
}

// ---------- speaking ----------
// The verse button that is currently playing, showing ⏹ instead of 🔊. A
// recording takes a moment to fetch, so the icon flips on the click itself —
// that is the reader's only feedback that the tap registered.
let playingButton = null;

function initToggleButton(button, stopLabel) {
  button.dataset.idleLabel = button.textContent;
  button.dataset.idleTitle = button.title;
  button.dataset.stopLabel = stopLabel;
}

function markPlaying(button) {
  if (playingButton !== button) clearPlaying();
  playingButton = button;
  button.textContent = button.dataset.stopLabel;
  button.title = 'Stop';
  button.classList.add('playing');
}

// Put the button back. With an argument it only clears that button, so a stale
// callback from a superseded verse cannot reset the one now playing.
function clearPlaying(button) {
  if (!playingButton || (button && button !== playingButton)) return;
  playingButton.textContent = playingButton.dataset.idleLabel;
  playingButton.title = playingButton.dataset.idleTitle;
  playingButton.classList.remove('playing');
  playingButton = null;
}

// Stop whatever verse is sounding, recorded or synthesized.
function stopVerse() {
  stopRecorded();
  stop();
  clearPlaying();
}

// Words are always synthesized; a recorded verse would drown them out, so any
// single-word playback stops the verse first.
function say(text, rate) {
  stopVerse();
  speak(text, rate);
}

function saySequence(parts, rate, gapMs) {
  stopVerse();
  speakSequence(parts, rate, gapMs);
}

// Whole verse: play the recording when the lesson has one, otherwise speak it.
// A failed download falls back to synthesis so the verse is never silent.
function playVerse(lesson, verse, button) {
  const sentence = verse.tokens.join('');
  const src = verseAudioSrc(lesson, verse);
  markPlaying(button);
  if (!src) {
    speakVerse(sentence, button);
    return;
  }
  playRecorded(src, () => speakVerse(sentence, button), () => clearPlaying(button));
}

function speakVerse(sentence, button) {
  stopRecorded();
  markPlaying(button); // the fallback path arrives here after markPlaying already ran
  speak(sentence, 0.85, () => clearPlaying(button));
}

// The same button starts and stops the verse.
function toggleVerse(lesson, verse, button) {
  if (playingButton === button) stopVerse();
  else playVerse(lesson, verse, button);
}

// ---------- word panel ----------
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('btn-say').addEventListener('click', () => current && say(current.word, 0.9));
// "Slower" reads the word one character at a time with a pause — iOS clamps the
// speech rate, so the pause is what makes it genuinely much slower.
document.getElementById('btn-slow').addEventListener('click', () => current && saySequence([...current.word], 0.5, 350));
const sentenceButton = document.getElementById('btn-sentence');
initToggleButton(sentenceButton, '⏹ Stop');
sentenceButton.addEventListener('click', () => {
  if (!current) return;
  // current.verse is null only for a Wordbook word that this lesson never uses.
  if (current.verse) toggleVerse(activeLesson, current.verse, sentenceButton);
  else say(current.sentence, 0.85);
});
// Slow whole-sentence: read the verse word by word with a pause between words.
document.getElementById('btn-sentence-slow').addEventListener('click', () => current && saySequence(current.words, 0.55, 300));
pinyinToggle.addEventListener('change', () => setPinyinVisible(pinyinToggle.checked));
englishToggle.addEventListener('change', () => setEnglishVisible(englishToggle.checked));
dictationToggle.addEventListener('change', () => setDictation(dictationToggle.checked));
highlightButton.addEventListener('click', () => current && setWordHighlight(current.word, true));
unhighlightButton.addEventListener('click', () => current && setWordHighlight(current.word, false));
wordbookMinimizeButton.addEventListener('click', () => setWordbookMinimized(!wordbookMinimized));

function closePanel() {
  panelEl.classList.remove('open');
  if (selectedSpan) selectedSpan.classList.remove('selected');
  selectedSpan = null;
  current = null;
  stopVerse();
}

function syncHighlightButtons() {
  const isHighlighted = Boolean(current && highlightedWords.has(current.word));
  highlightButton.hidden = isHighlighted;
  unhighlightButton.hidden = !isHighlighted;
}

function setWordHighlight(word, shouldHighlight) {
  if (shouldHighlight) {
    highlightedWords.add(word);
  } else {
    highlightedWords.delete(word);
  }
  saveHighlights();

  document.querySelectorAll('.word').forEach(button => {
    if (button.dataset.word === word) button.classList.toggle('highlighted', shouldHighlight);
  });
  syncHighlightButtons();
  renderWordbook();
}

// Tapping a word in the text: pass the button span so it gets the selected style.
function showWord(span, word, verse, tokenIndex) {
  openWordPanel(word, verse, tokenIndex, span);
}

// Core panel opener, shared by text taps and Wordbook clicks. When verse is
// null (no sentence context) the panel just shows the word + its meaning.
function openWordPanel(word, verse, tokenIndex, span) {
  const verseTokens = verse ? verse.tokens : null;
  if (selectedSpan) selectedSpan.classList.remove('selected');
  selectedSpan = span || null;
  if (span) span.classList.add('selected');

  const entry = activeLesson.dict[word];
  panelWord.textContent = word;
  panelPinyin.textContent = entry ? entry.pinyin : '';
  panelMeaning.textContent = entry ? entry.meaning : '（词典还没有这个词）';
  panelUsage.textContent = entry && entry.usage ? entry.usage : '';

  // the whole verse, with the chosen word highlighted
  panelSentence.textContent = '';
  if (verseTokens) {
    verseTokens.forEach((tok, i) => {
      if (i === tokenIndex) {
        const mark = document.createElement('mark');
        mark.textContent = tok;
        panelSentence.append(mark);
      } else {
        panelSentence.append(tok);
      }
    });
    current = {
      word,
      verse,
      sentence: verseTokens.join(''),
      words: verseTokens.filter(t => !PUNCT_RE.test(t)),
    };
  } else {
    current = { word, verse: null, sentence: word, words: [word] };
  }

  renderPanelEnglish(verse);
  syncHighlightButtons();
  panelEl.classList.add('open');
  say(word, 0.9);
}

// The whole sentence in English plus its explanation. Tapping a word is a
// direct question about meaning, so this fetches the verse even when the inline
// English parallel is switched off.
function renderPanelEnglish(verse) {
  const explanation = (verse && activeLesson.explain && activeLesson.explain[verse.n]) || '';
  panelExplain.textContent = explanation;
  panelExplain.hidden = !explanation;

  if (!verse || !lessonHasEnglish(activeLesson)) {
    panelNiv.textContent = '';
    panelNivRow.hidden = true;
    panelEnglish.hidden = !explanation;
    return;
  }

  const text = englishVerse(activeLesson, verse.n);
  panelNiv.textContent = text || (englishOffline() ? '' : '…');
  panelNivRow.hidden = !text && englishOffline();
  panelEnglish.hidden = !text && !explanation && englishOffline();
  if (text) {
    englishShown = true;
    renderCredit();
    return;
  }
  if (englishOffline()) return;

  const lesson = activeLesson;
  loadEnglish(lesson, [verse.n]).then(() => {
    // A different lesson may be on screen by now, and its verse 5 is not this
    // verse 5 — leave its rows alone.
    if (lesson !== activeLesson) return;
    fillEnglish(lesson, verse.n);
    renderCredit();
    // Only touch the panel if it is still showing this verse.
    if (!current || current.verse !== verse) return;
    const arrived = englishVerse(lesson, verse.n);
    panelNiv.textContent = arrived || '';
    panelNivRow.hidden = !arrived;
    if (arrived) panelEnglish.hidden = false;
  });
}

// First verse occurrence of a word — gives a Wordbook entry its example sentence.
function findFirstOccurrence(word) {
  for (const para of activeLesson.paragraphs) {
    for (const v of para.verses) {
      const idx = v.tokens.indexOf(word);
      if (idx !== -1) return { verse: v, index: idx };
    }
  }
  return null;
}

// ---------- rendering ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function withChildren(node, ...children) {
  node.append(...children);
  return node;
}

function renderLesson(lesson) {
  activeLesson = lesson;
  closePanel();
  stopRecording();
  clearRecording();
  verseRows = new Map();
  contentEl.textContent = '';

  contentEl.append(
    el('h1', 'lesson-title', lesson.title),
    el('p', 'lesson-subtitle', lesson.subtitle),
  );

  lesson.paragraphs.forEach(para => {
    const sec = el('section', 'para');

    const art = document.createElement('figure');
    art.className = 'para-art';
    if (para.artImage) {
      const image = document.createElement('img');
      image.className = 'para-art-image';
      image.src = para.artImage;
      image.alt = para.artAlt || para.artCaption;
      image.loading = 'lazy';
      image.decoding = 'async';
      art.append(image);
    } else {
      art.append(
        el('div', 'para-art-icon', '🎨'),
        el('div', 'para-art-note', 'AI 插图位置 · illustration coming soon'),
      );
    }
    const caption = document.createElement('figcaption');
    caption.className = 'para-art-caption';
    caption.textContent = para.artCaption;
    art.append(caption);
    sec.append(art);

    para.verses.forEach(v => {
      const row = el('div', 'verse');
      const play = el('button', 'verse-play', '🔊');
      play.title = 'Play verse';
      initToggleButton(play, '⏹');
      play.addEventListener('click', () => toggleVerse(lesson, v, play));

      const text = el('span', 'verse-text');
      v.tokens.forEach((tok, i) => {
        if (PUNCT_RE.test(tok)) {
          text.append(el('span', 'punct', tok));
        } else {
          const w = el('button', 'word');
          const entry = lesson.dict[tok];
          w.dataset.word = tok;
          w.setAttribute('aria-label', entry ? `${tok}，${entry.pinyin}` : tok);
          if (highlightedWords.has(tok)) w.classList.add('highlighted');
          w.append(
            el('span', 'word-pinyin', entry ? entry.pinyin : ''),
            el('span', 'word-text', tok),
          );
          w.addEventListener('click', () => showWord(w, tok, v, i));
          text.append(w);
        }
      });

      // Chinese text, then the reader's own controls, then the English parallel
      // and its explanation — one column beside the play button and verse number.
      const body = el('div', 'verse-body');
      body.append(text);

      // Stands in for the hidden text in 默写 mode and reveals it to check.
      const blank = el('button', 'verse-blank', '✍️ Show');
      blank.addEventListener('click', () => {
        const revealed = row.classList.toggle('revealed');
        blank.textContent = revealed ? '🙈 Hide' : '✍️ Show';
      });
      body.append(blank);

      const en = el('p', 'verse-en');
      const explanation = (lesson.explain && lesson.explain[v.n]) || '';
      const explain = el('p', 'verse-explain', explanation);
      explain.hidden = !explanation;
      body.append(en, explain);

      // The reader's own controls come last, under the whole verse, so the
      // Chinese line and its English stay next to each other.
      const record = el('button', 'verse-record', '🎤 Record');
      record.title = 'Record myself reading this verse';
      initToggleButton(record, '⏹ Stop');
      const mine = el('button', 'verse-mine', '🎧 Mine');
      mine.title = 'Play my recording';
      initToggleButton(mine, '⏹ Stop');
      mine.hidden = !hasClip(clipKey(lesson, v));
      const note = el('span', 'verse-note');
      note.hidden = true;
      // No microphone (or an http origin) means no working button to show.
      if (micSupported()) body.append(withChildren(el('div', 'verse-tools'), record, mine, note));

      const nodes = { verse: v, row, en, explain, record, mine, note };
      verseRows.set(v.n, nodes);
      record.addEventListener('click', () => toggleRecording(lesson, v, nodes));
      mine.addEventListener('click', () => toggleMine(lesson, v, nodes));

      row.append(play, el('span', 'verse-num', String(v.n)), body);
      sec.append(row);
    });

    contentEl.append(sec);
  });

  warnMissingDictEntries(lesson);
  renderWordbook();
  if (englishVisible) loadLessonEnglish();
  else renderCredit();
}

// ---------- wordbook ----------
// Shown from the 2nd lesson on: teacher's vocab + the student's ⭐ words for
// this passage, duplicates removed. Clicking an entry opens the word panel.
function renderWordbook() {
  const lesson = activeLesson;
  const teacherVocab = (lesson && lesson.vocab) || [];
  if (!teacherVocab.length) {
    wordbookEl.hidden = true;
    document.body.classList.remove('has-wordbook');
    return;
  }

  // words that actually appear in this passage
  const inLesson = new Set();
  lesson.paragraphs.forEach(p => p.verses.forEach(v =>
    v.tokens.forEach(t => { if (!PUNCT_RE.test(t)) inLesson.add(t); })
  ));

  const teacher = teacherVocab.filter(w => inLesson.has(w));
  const teacherSet = new Set(teacher);
  const student = [...highlightedWords].filter(w => inLesson.has(w) && !teacherSet.has(w));
  const entries = [...teacher, ...student];

  wordbookListEl.textContent = '';
  entries.forEach(word => {
    const entry = lesson.dict[word];
    const item = el('button', 'wordbook-item');
    item.dataset.word = word;
    item.append(el('span', 'wordbook-word', word));
    const gloss = el('span', 'wordbook-gloss');
    gloss.append(
      el('span', 'wordbook-pinyin', entry ? entry.pinyin : ''),
      el('span', 'wordbook-meaning', entry ? entry.meaning : ''),
    );
    item.append(gloss);
    if (highlightedWords.has(word)) item.append(el('span', 'wordbook-star', '⭐'));
    item.addEventListener('click', () => {
      const occ = findFirstOccurrence(word);
      openWordPanel(word, occ ? occ.verse : null, occ ? occ.index : -1, null);
    });
    wordbookListEl.append(item);
  });

  wordbookCountEl.textContent = String(entries.length);
  wordbookEl.hidden = false;
  setWordbookMinimized(wordbookMinimized);
  document.body.classList.add('has-wordbook');
}

function warnMissingDictEntries(lesson) {
  const missing = new Set();
  lesson.paragraphs.forEach(p => p.verses.forEach(v =>
    v.tokens.forEach(tok => {
      if (!PUNCT_RE.test(tok) && !lesson.dict[tok]) missing.add(tok);
    })
  ));
  if (missing.size) console.warn('dict missing:', [...missing].join(' '));
}

// ---------- tabs ----------
function selectLesson(id) {
  const lesson = lessons.find(l => l.id === id) || lessons[0];
  [...tabsEl.children].forEach(t => t.classList.toggle('active', t.dataset.id === lesson.id));
  location.hash = lesson.id;
  renderLesson(lesson);
}

lessons.forEach(lesson => {
  const pill = el('button', 'tab', lesson.tabTitle || lesson.title);
  pill.dataset.id = lesson.id;
  pill.addEventListener('click', () => selectLesson(lesson.id));
  tabsEl.append(pill);
});
tabsEl.append(el('span', 'tab soon', 'Next · soon'));

restorePinyinPreference();
restoreEnglishPreference();
// A reload restores checkbox state on its own, but the recordings it was made
// for are gone — so dictation always starts off.
setDictation(false);
setWordbookMinimized(wordbookMinimized);
selectLesson(location.hash.slice(1));
