import { speak, speakSequence, stop } from './speech.js?v=4';
import lessons from '../lessons/index.js?v=4';

const PUNCT_RE = /^[，。、：；？！…—─（）《》「」『』""'',.!?;:()\-\s]+$/;
const PINYIN_STORAGE_KEY = 'lucas-academy-chinese.pinyin-visible';
const HIGHLIGHTS_STORAGE_KEY = 'lucas-academy-chinese.highlighted-words';

const tabsEl = document.getElementById('tabs');
const contentEl = document.getElementById('content');

const panelEl = document.getElementById('panel');
const panelWord = document.getElementById('panel-word');
const panelPinyin = document.getElementById('panel-pinyin');
const panelMeaning = document.getElementById('panel-meaning');
const panelUsage = document.getElementById('panel-usage');
const panelSentence = document.getElementById('panel-sentence');
const pinyinToggle = document.getElementById('pinyin-toggle');
const highlightButton = document.getElementById('btn-highlight');
const unhighlightButton = document.getElementById('btn-unhighlight');
const wordbookEl = document.getElementById('wordbook');
const wordbookListEl = document.getElementById('wordbook-list');
const wordbookCountEl = document.getElementById('wordbook-count');

let activeLesson = null;
let selectedSpan = null;
let current = null; // { word, sentence }
let highlightedWords = readHighlights();

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

// ---------- word panel ----------
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('btn-say').addEventListener('click', () => current && speak(current.word, 0.9));
// "Slower" reads the word one character at a time with a pause — iOS clamps the
// speech rate, so the pause is what makes it genuinely much slower.
document.getElementById('btn-slow').addEventListener('click', () => current && speakSequence([...current.word], 0.5, 350));
document.getElementById('btn-sentence').addEventListener('click', () => current && speak(current.sentence, 0.85));
// Slow whole-sentence: read the verse word by word with a pause between words.
document.getElementById('btn-sentence-slow').addEventListener('click', () => current && speakSequence(current.words, 0.55, 300));
pinyinToggle.addEventListener('change', () => setPinyinVisible(pinyinToggle.checked));
highlightButton.addEventListener('click', () => current && setWordHighlight(current.word, true));
unhighlightButton.addEventListener('click', () => current && setWordHighlight(current.word, false));

function closePanel() {
  panelEl.classList.remove('open');
  if (selectedSpan) selectedSpan.classList.remove('selected');
  selectedSpan = null;
  current = null;
  stop();
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
function showWord(span, word, verseTokens, tokenIndex) {
  openWordPanel(word, verseTokens, tokenIndex, span);
}

// Core panel opener, shared by text taps and Wordbook clicks. When verseTokens
// is null (no sentence context) the panel just shows the word + its meaning.
function openWordPanel(word, verseTokens, tokenIndex, span) {
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
      sentence: verseTokens.join(''),
      words: verseTokens.filter(t => !PUNCT_RE.test(t)),
    };
  } else {
    current = { word, sentence: word, words: [word] };
  }

  syncHighlightButtons();
  panelEl.classList.add('open');
  speak(word, 0.9);
}

// First verse occurrence of a word — gives a Wordbook entry its example sentence.
function findFirstOccurrence(word) {
  for (const para of activeLesson.paragraphs) {
    for (const v of para.verses) {
      const idx = v.tokens.indexOf(word);
      if (idx !== -1) return { tokens: v.tokens, index: idx };
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

function renderLesson(lesson) {
  activeLesson = lesson;
  closePanel();
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
      play.addEventListener('click', () => speak(v.tokens.join(''), 0.85));

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
          w.addEventListener('click', () => showWord(w, tok, v.tokens, i));
          text.append(w);
        }
      });

      row.append(play, el('span', 'verse-num', String(v.n)), text);
      sec.append(row);
    });

    contentEl.append(sec);
  });

  warnMissingDictEntries(lesson);
  renderWordbook();
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
      openWordPanel(word, occ ? occ.tokens : null, occ ? occ.index : -1, null);
    });
    wordbookListEl.append(item);
  });

  wordbookCountEl.textContent = String(entries.length);
  wordbookEl.hidden = false;
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
selectLesson(location.hash.slice(1));
