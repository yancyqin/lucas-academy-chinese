// Prerecorded narration (a real human-sounding voice, already read slowly).
// Used for whole verses when a lesson has recordings; single words and lessons
// without recordings keep using the browser's speech synthesis.
import { stop as stopSpeech } from './speech.js?v=7';

// One shared element for the whole page, so starting a verse always replaces
// whatever was playing — rapid taps can never stack two voices.
let player = null;

// A generation counter so a late error from a superseded verse cannot trigger
// the fallback for the verse that is playing now.
let gen = 0;

// True while a recording is the sound on this page — playing or paused. It is
// how pauseRecorded() knows whether the pause button belongs to it or to the
// speech synthesiser.
let active = false;

// Where a verse's recording lives. A verse may name its own file; otherwise the
// path is derived from the lesson: assets/audio/<lesson id>/verse-NN.mp3.
// A lesson without an `audio` field has no recordings yet — returns null.
export function verseAudioSrc(lesson, verse) {
  if (verse.audio) return verse.audio;
  if (!lesson.audio) return null;
  const config = lesson.audio === true ? {} : lesson.audio;
  const dir = config.dir || `assets/audio/${lesson.id}`;
  return `${dir}/verse-${String(verse.n).padStart(2, '0')}.${config.ext || 'mp3'}`;
}

export function stopRecorded() {
  gen += 1;
  active = false;
  if (player) player.pause();
}

// Hold the verse where it is; the next play continues from the same spot.
// Returns false when a recording is not what is sounding, so the page can ask
// the speech synthesiser instead.
export function pauseRecorded() {
  if (!active || !player || player.paused) return false;
  player.pause();
  return true;
}

export function resumeRecorded() {
  if (!active || !player || !player.paused) return false;
  const started = player.play();
  if (started && typeof started.catch === 'function') started.catch(() => {});
  return true;
}

// Play a recording from its start. Call this directly inside a click handler:
// iOS only allows playback that a user gesture started. `onFallback` runs if
// the file cannot be loaded or played, so the lesson still speaks; `onEnded`
// runs when this recording finishes on its own, so a caller showing a stop
// button can put it back.
export function playRecorded(src, onFallback, onEnded) {
  stopSpeech(); // never let synthesis and a recording overlap
  gen += 1;
  active = true;
  const mine = gen;

  if (!player) {
    player = new Audio();
    player.preload = 'auto';
  }
  player.pause();

  // A broken file rejects play() *and* fires an error event; the reader should
  // only hear the fallback once.
  let spoke = false;
  const fallback = () => {
    if (spoke || mine !== gen) return;
    spoke = true;
    active = false;
    onFallback();
  };
  player.onerror = fallback;
  player.onended = () => {
    if (mine !== gen) return;
    active = false;
    if (onEnded) onEnded();
  };

  // Re-assigning the same src does not rewind, so seek explicitly. Before any
  // data has loaded the seek is only remembered, which is exactly what we want.
  if (!player.src.endsWith(src)) player.src = src;
  try {
    player.currentTime = 0;
  } catch {
    // Safari can refuse a seek before metadata arrives; playback still starts.
  }
  player.playbackRate = 1; // the slow reading pace is baked into the file

  const started = player.play();
  if (started && typeof started.catch === 'function') {
    started.catch(fallback); // includes the AbortError from an interrupted play
  }
}
