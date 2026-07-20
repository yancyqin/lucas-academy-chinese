import { speak, stop } from './speech.js?v=1';
import lessons from '../lessons/index.js?v=1';

const PUNCT_RE = /^[，。、：；？！…—─（）《》""'',.!?;:()\-\s]+$/;

const tabsEl = document.getElementById('tabs');
const contentEl = document.getElementById('content');

const panelEl = document.getElementById('panel');
const panelWord = document.getElementById('panel-word');
const panelPinyin = document.getElementById('panel-pinyin');
const panelMeaning = document.getElementById('panel-meaning');
const panelUsage = document.getElementById('panel-usage');
const panelSentence = document.getElementById('panel-sentence');

let activeLesson = null;
let selectedSpan = null;
let current = null; // { word, sentence }

// ---------- word panel ----------
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('btn-say').addEventListener('click', () => current && speak(current.word, 0.9));
document.getElementById('btn-slow').addEventListener('click', () => current && speak(current.word, 0.5));
document.getElementById('btn-sentence').addEventListener('click', () => current && speak(current.sentence, 0.85));

function closePanel() {
  panelEl.classList.remove('open');
  if (selectedSpan) selectedSpan.classList.remove('selected');
  selectedSpan = null;
  current = null;
  stop();
}

function showWord(span, word, verseTokens, tokenIndex) {
  if (selectedSpan) selectedSpan.classList.remove('selected');
  selectedSpan = span;
  span.classList.add('selected');

  const entry = activeLesson.dict[word];
  panelWord.textContent = word;
  panelPinyin.textContent = entry ? entry.pinyin : '';
  panelMeaning.textContent = entry ? entry.meaning : '（词典还没有这个词）';
  panelUsage.textContent = entry && entry.usage ? entry.usage : '';

  // the whole verse, with the tapped word highlighted
  panelSentence.textContent = '';
  verseTokens.forEach((tok, i) => {
    const node = i === tokenIndex ? document.createElement('mark') : document.createTextNode('');
    if (i === tokenIndex) {
      node.textContent = tok;
      panelSentence.append(node);
    } else {
      panelSentence.append(tok);
    }
  });

  current = { word, sentence: verseTokens.join('') };
  panelEl.classList.add('open');
  speak(word, 0.9);
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

    // reserved slot for a future AI illustration of this paragraph
    const art = el('div', 'para-art');
    art.append(
      el('div', 'para-art-icon', '🎨'),
      el('div', 'para-art-caption', para.artCaption),
      el('div', 'para-art-note', 'AI 插图位置 · illustration coming soon'),
    );
    sec.append(art);

    para.verses.forEach(v => {
      const row = el('div', 'verse');
      const play = el('button', 'verse-play', '🔊');
      play.title = '读整节';
      play.addEventListener('click', () => speak(v.tokens.join(''), 0.85));

      const text = el('span', 'verse-text');
      v.tokens.forEach((tok, i) => {
        if (PUNCT_RE.test(tok)) {
          text.append(el('span', 'punct', tok));
        } else {
          const w = el('button', 'word', tok);
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
tabsEl.append(el('span', 'tab soon', '下一课 · soon'));

selectLesson(location.hash.slice(1));
