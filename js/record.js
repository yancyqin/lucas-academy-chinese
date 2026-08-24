// Your own voice, for reading a verse back to yourself (默写 practice).
//
// Session-only by design: a clip lives in this Map as a blob URL and is gone on
// reload. Nothing is uploaded, and nothing is written to local storage — a
// child's voice should not outlive the lesson they recorded it in.
const clips = new Map(); // key -> blob URL

// Safari wants audio/mp4; Chrome and Firefox want webm/opus. An unsupported
// mimeType makes the constructor throw, so pick one the browser admits to.
const PREFERRED_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];

let recorder = null;
let recordingKey = null;

export function isSupported() {
  return Boolean(
    typeof MediaRecorder !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function',
  );
}

export function hasClip(key) {
  return clips.has(key);
}

export function clipUrl(key) {
  return clips.get(key) || null;
}

export function recordingNow() {
  return recordingKey;
}

function pickMimeType() {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return PREFERRED_TYPES.find(type => MediaRecorder.isTypeSupported(type));
}

// Let go of the microphone as soon as a clip is finished, so the browser's
// recording indicator turns off between verses.
function releaseStream(stream) {
  stream.getTracks().forEach(track => track.stop());
}

function forget(key) {
  const existing = clips.get(key);
  if (existing) URL.revokeObjectURL(existing);
  clips.delete(key);
}

export function discard(key) {
  forget(key);
}

export function clearAll() {
  [...clips.keys()].forEach(forget);
}

// Start recording `key`. Call this straight from a click handler: iOS only
// grants microphone access to a user gesture. `onDone(key)` runs when the clip
// is ready, `onError(key)` when permission is denied or recording fails.
export async function startRecording(key, { onDone, onError } = {}) {
  if (!isSupported()) {
    if (onError) onError(key);
    return;
  }
  await stopRecording(); // one microphone, one recording at a time

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // Permission denied, no microphone, or an insecure origin (mic needs
    // https or localhost).
    if (onError) onError(key);
    return;
  }

  const mimeType = pickMimeType();
  const chunks = [];
  let mine;
  try {
    mine = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    releaseStream(stream);
    if (onError) onError(key);
    return;
  }

  // Tapping a second verse starts this one while the previous is still stopping,
  // and its `stop` event lands afterwards — so only ever clear the shared state
  // if it is still pointing at this recorder.
  const finish = () => {
    releaseStream(stream);
    if (recorder === mine) {
      recorder = null;
      recordingKey = null;
    }
  };

  recorder = mine;
  recordingKey = key;
  mine.ondataavailable = event => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  mine.onerror = () => {
    finish();
    if (onError) onError(key);
  };
  mine.onstop = () => {
    finish();
    if (!chunks.length) {
      if (onError) onError(key);
      return;
    }
    forget(key); // re-recording replaces the previous take
    clips.set(key, URL.createObjectURL(new Blob(chunks, { type: chunks[0].type || mimeType })));
    if (onDone) onDone(key);
  };
  mine.start();
}

export async function stopRecording() {
  if (!recorder) return;
  if (recorder.state !== 'inactive') recorder.stop();
  else recordingKey = null;
}
