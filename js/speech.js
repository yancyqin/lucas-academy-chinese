// Pronunciation via the browser's built-in speech synthesis (works offline on iPad).
let zhVoice = null;

// A generation counter so a newer request cancels any paced sequence still running.
let gen = 0;

// Pause state. `held` is the rest of a paced sequence, waiting in its gap for
// the reader to resume; `running` says a sequence is mid-flight even during a
// silent gap, when speechSynthesis itself reports nothing speaking.
let paused = false;
let held = null;
let running = false;

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

// Speak the whole text as one utterance. `onEnd` (optional) runs when this
// utterance finishes on its own — not when a newer request supersedes it.
export function speak(text, rate = 0.9, onEnd) {
  if (!('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }
  reset(); // cancel any running paced sequence
  const mine = gen;
  const u = utter(text, rate);
  if (onEnd) {
    u.onend = () => { if (mine === gen) onEnd(); };
    u.onerror = u.onend; // a voice that fails must not leave the caller waiting
  }
  speechSynthesis.speak(u);
}

// Speak the parts one at a time with a silent gap between them.
// iOS clamps very low `rate`, so the GAP is what actually makes this much
// slower — and breaking at character/word boundaries makes each tone clear.
// `onDone` (optional) runs when the whole sequence finishes on its own — not
// when a newer request supersedes it.
export function speakSequence(parts, rate = 0.5, gapMs = 350, onDone) {
  if (!('speechSynthesis' in window)) {
    if (onDone) onDone();
    return;
  }
  reset();
  const mine = gen;
  running = true;
  const items = parts.filter(p => p && p.trim());
  let i = 0;
  const next = () => {
    if (mine !== gen) return; // superseded
    // Paused in the gap between two words: keep the rest of the verse here
    // until resume() asks for it.
    if (paused) {
      held = next;
      return;
    }
    if (i >= items.length) {
      running = false;
      if (onDone) onDone();
      return;
    }
    const u = utter(items[i], rate);
    u.onend = () => {
      if (mine !== gen) return;
      i += 1;
      setTimeout(next, gapMs);
    };
    u.onerror = u.onend; // one word that fails must not stall the rest
    speechSynthesis.speak(u);
  };
  next();
}

export function stop() {
  if (!('speechSynthesis' in window)) return;
  reset();
}

// Drop everything the previous read left behind. Cancelling a *paused* queue
// wedges it in some browsers, so it is always resumed first.
function reset() {
  gen += 1;
  held = null;
  running = false;
  if (paused) {
    paused = false;
    speechSynthesis.resume();
  }
  speechSynthesis.cancel();
}

// Hold the reading where it is. Mid-word the browser stops the voice itself;
// mid-gap there is nothing to stop, so the sequence simply waits (see above).
// Returns false when synthesis is not what is sounding, which is how the page
// knows to ask the other players instead.
export function pause() {
  if (!('speechSynthesis' in window) || paused) return false;
  if (!speechSynthesis.speaking && !running) return false;
  paused = true;
  speechSynthesis.pause();
  return true;
}

export function resume() {
  if (!('speechSynthesis' in window) || !paused) return false;
  paused = false;
  speechSynthesis.resume();
  const rest = held;
  held = null;
  if (rest) rest();
  return true;
}
