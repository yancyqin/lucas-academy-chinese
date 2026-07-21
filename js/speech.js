// Pronunciation via the browser's built-in speech synthesis (works offline on iPad).
let zhVoice = null;

// A generation counter so a newer request cancels any paced sequence still running.
let gen = 0;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  zhVoice =
    voices.find(v => v.lang === 'zh-CN' && /Ting|婷/i.test(v.name)) ||
    voices.find(v => v.lang === 'zh-CN') ||
    voices.find(v => v.lang && v.lang.startsWith('zh')) ||
    null;
}

if ('speechSynthesis' in window) {
  pickVoice();
  // iOS loads voices asynchronously
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

function utter(text, rate) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  if (zhVoice) u.voice = zhVoice;
  u.rate = rate;
  return u;
}

// Speak the whole text as one utterance.
export function speak(text, rate = 0.9) {
  if (!('speechSynthesis' in window)) return;
  gen += 1; // cancel any running paced sequence
  speechSynthesis.cancel();
  speechSynthesis.speak(utter(text, rate));
}

// Speak the parts one at a time with a silent gap between them.
// iOS clamps very low `rate`, so the GAP is what actually makes this much
// slower — and breaking at character/word boundaries makes each tone clear.
export function speakSequence(parts, rate = 0.5, gapMs = 350) {
  if (!('speechSynthesis' in window)) return;
  gen += 1;
  const mine = gen;
  speechSynthesis.cancel();
  const items = parts.filter(p => p && p.trim());
  let i = 0;
  const next = () => {
    if (mine !== gen || i >= items.length) return; // superseded or finished
    const u = utter(items[i], rate);
    u.onend = () => {
      if (mine !== gen) return;
      i += 1;
      setTimeout(next, gapMs);
    };
    speechSynthesis.speak(u);
  };
  next();
}

export function stop() {
  if (!('speechSynthesis' in window)) return;
  gen += 1;
  speechSynthesis.cancel();
}
