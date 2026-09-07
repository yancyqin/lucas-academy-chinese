// The reader's own voice — one recording for the whole app.
//
// It outlives the page on purpose: the clip is kept in local storage as a data
// URL, so closing the window does not throw it away, and there is only ever ONE
// clip — a new take replaces the previous one. Nothing is ever uploaded.
//
// Playback runs through Web Audio instead of an <audio> element because a quiet
// recording has to be made LOUDER: an element's volume only ever turns sound
// down (1 is its maximum), while a gain node multiplies. How much gain a clip
// needs is measured from the clip itself — see measureGain() — so a whisper
// recorded at arm's length and a verse shouted into the microphone both come
// back at a comfortable level.
const STORAGE_KEY = 'lucas-academy-chinese.my-recording';

// Loudness we bring every clip up to, measured as RMS (the average) rather than
// the peak, because a peak is usually one thump on the table.
const TARGET_RMS = 0.14; // ≈ −17 dBFS: clear on an iPad speaker
const MAX_GAIN = 12; // ~22 dB of rescue; past that a quiet clip is only noise
const SILENCE = 0.008; // ignore the room tone before and after the reading

// A take stops itself here, and a clip bigger than this is kept for the session
// but not saved: local storage holds about 5 MB in total for the whole site.
const MAX_SECONDS = 180;
const MAX_STORED_CHARS = 3_500_000;

// Safari wants audio/mp4; Chrome and Firefox want webm/opus. An unsupported
// mimeType makes the constructor throw, so pick one the browser admits to.
const PREFERRED_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];

// { src: data URL, type, seconds, gain: number|null, stored: boolean }
let clip = readStored();

let recorder = null;
let recording = false;
let startedAt = 0;
let limitTimer = null;

export function isSupported() {
  return Boolean(
    typeof MediaRecorder !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function',
  );
}

export function hasClip() {
  return Boolean(clip);
}

// Seconds of the saved take, for the button label. 0 when there is no clip.
export function clipSeconds() {
  return clip ? clip.seconds : 0;
}

// False when the clip was too long to keep — it still plays this session.
export function clipStored() {
  return Boolean(clip && clip.stored);
}

export function recordingNow() {
  return recording;
}

// How long the take in progress has been running, for the live counter.
export function recordingSeconds() {
  return recording ? Math.floor((Date.now() - startedAt) / 1000) : 0;
}

export const maxSeconds = MAX_SECONDS;

// ---------- storage ----------
function readStored() {
  try {
    // JSON.parse(null) returns null instead of throwing, so an empty slot has
    // to be checked, not caught.
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved.src !== 'string') return null;
    return {
      src: saved.src,
      type: saved.type || '',
      seconds: Number(saved.seconds) || 0,
      gain: typeof saved.gain === 'number' ? saved.gain : null,
      stored: true,
    };
  } catch {
    return null;
  }
}

// Returns false when the browser would not keep it (too long, or storage off).
function save() {
  if (!clip) return false;
  if (clip.src.length > MAX_STORED_CHARS) return false;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ src: clip.src, type: clip.type, seconds: clip.seconds, gain: clip.gain }),
    );
    return true;
  } catch {
    return false; // local storage disabled, or full
  }
}

export function discard() {
  stopPlaying();
  clip = null;
  buffer = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove if storage is unavailable.
  }
}

// ---------- recording ----------
function pickMimeType() {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return PREFERRED_TYPES.find(type => MediaRecorder.isTypeSupported(type));
}

// Let go of the microphone as soon as a clip is finished, so the browser's
// recording indicator turns off between takes.
function releaseStream(stream) {
  stream.getTracks().forEach(track => track.stop());
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Start a take. Call this straight from a click handler: iOS only grants
// microphone access to a user gesture. `onDone()` runs when the clip is ready
// (with `stored` false if it was too long to keep). `onError(reason)` runs with
// 'mic' when there is no microphone to record with, and 'failed' when there was
// one but nothing usable came out of it — two different things to tell a reader.
export async function startRecording({ onDone, onError } = {}) {
  if (!isSupported()) {
    if (onError) onError('mic');
    return;
  }
  await stopRecording(); // one microphone, one take at a time

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // Permission denied, no microphone, or an insecure origin (the microphone
    // needs https or localhost).
    if (onError) onError('mic');
    return;
  }

  const mimeType = pickMimeType();
  const chunks = [];
  let mine;
  try {
    mine = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 64000, // mono speech; keeps a long take inside storage
    });
  } catch {
    releaseStream(stream);
    if (onError) onError('mic');
    return;
  }

  // A second take can be started while this one is still stopping, and its
  // `stop` event lands afterwards — so only ever clear the shared state if it
  // is still pointing at this recorder.
  const finish = () => {
    releaseStream(stream);
    clearTimeout(limitTimer);
    if (recorder === mine) {
      recorder = null;
      recording = false;
    }
  };

  recorder = mine;
  recording = true;
  startedAt = Date.now();
  limitTimer = setTimeout(() => {
    if (recorder === mine) stopRecording();
  }, MAX_SECONDS * 1000);

  mine.ondataavailable = event => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  mine.onerror = () => {
    finish();
    if (onError) onError('failed');
  };
  mine.onstop = async () => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    finish();
    if (!chunks.length) {
      if (onError) onError('failed');
      return;
    }
    try {
      const blob = new Blob(chunks, { type: chunks[0].type || mimeType || '' });
      const src = await readAsDataUrl(blob);
      stopPlaying();
      buffer = null; // the decoded copy belongs to the take being replaced
      clip = { src, type: blob.type, seconds, gain: null, stored: false };
      clip.stored = save();
      if (onDone) onDone();
    } catch {
      if (onError) onError('failed');
    }
  };
  mine.start();
}

export async function stopRecording() {
  if (!recorder) return;
  clearTimeout(limitTimer);
  if (recorder.state !== 'inactive') recorder.stop();
  else recording = false;
}

// ---------- playback, at a level you can actually hear ----------
let ctx = null;
let buffer = null; // the decoded clip, kept so a replay starts instantly
let source = null;
let playGen = 0;
let playing = false;
let paused = false;

function ensureContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Created or woken inside the click, which is what iOS requires; the decode
  // that follows may take as long as it likes.
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// How much louder this clip has to be. RMS over the parts that are not silence,
// so leading room tone does not make a normal reading look quiet.
function measureGain(audio) {
  const data = audio.getChannelData(0);
  let sum = 0;
  let counted = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = Math.abs(data[i]);
    if (value < SILENCE) continue;
    sum += data[i] * data[i];
    counted += 1;
  }
  if (!counted) return 1;
  const rms = Math.sqrt(sum / counted);
  if (!rms) return 1;
  return Math.min(MAX_GAIN, Math.max(1, TARGET_RMS / rms));
}

export function isPlaying() {
  return playing;
}

// Play the saved take. Call it straight from a click: the audio context has to
// be woken by the gesture. `onEnded` runs when it finishes on its own.
export function playClip({ onEnded, onError } = {}) {
  if (!clip) return false;
  const context = ensureContext();
  if (!context) {
    if (onError) onError();
    return false;
  }
  stopPlaying();
  const mine = playGen;
  playing = true;

  (async () => {
    try {
      if (!buffer) {
        const bytes = await (await fetch(clip.src)).arrayBuffer();
        buffer = await context.decodeAudioData(bytes);
      }
      if (mine !== playGen) return; // stopped, or another play took over
      if (clip.gain === null) {
        clip.gain = measureGain(buffer);
        save(); // measured once, then remembered with the clip
      }

      const node = context.createBufferSource();
      node.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = clip.gain;
      // The gain is set from the average, so the loudest moments can still go
      // over — the compressor rides those instead of letting them crackle.
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      node.connect(gain).connect(limiter).connect(context.destination);
      node.onended = () => {
        if (mine !== playGen) return;
        playing = false;
        paused = false;
        if (onEnded) onEnded();
      };
      source = node;
      node.start();
    } catch {
      if (mine !== playGen) return;
      playing = false;
      if (onError) onError();
    }
  })();

  return true;
}

// Hold the clip where it is: suspending the context freezes playback, and the
// same context is used for nothing else. Returns false when the clip is not
// what is sounding, so the page can ask the other players instead.
export function pausePlaying() {
  if (!playing || paused || !ctx) return false;
  paused = true;
  ctx.suspend();
  return true;
}

export function resumePlaying() {
  if (!playing || !paused || !ctx) return false;
  paused = false;
  ctx.resume();
  return true;
}

export function stopPlaying() {
  playGen += 1;
  playing = false;
  paused = false;
  if (source) {
    try {
      source.stop();
    } catch {
      // Already finished; nothing to stop.
    }
    source.disconnect();
    source = null;
  }
  // A context left suspended by a pause would swallow the next play.
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
