// Pronunciation via the browser's built-in speech synthesis (works offline on iPad).
let zhVoice = null;

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

export function speak(text, rate = 0.9) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  if (zhVoice) u.voice = zhVoice;
  u.rate = rate;
  speechSynthesis.speak(u);
}

export function stop() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
