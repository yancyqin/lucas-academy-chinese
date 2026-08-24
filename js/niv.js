// English parallel text for a whole verse, fetched from this app's own
// /api/passage proxy (worker/index.js). The NIV is licensed, so it is never
// stored in the repo — it arrives at read time and lives only in this Map for
// the session.
//
// Everything here fails soft: no network, no Worker (the plain python dev
// server), or no app key configured all end the same way — the Chinese lesson
// keeps working and the English line simply says it is unavailable.
const TRANSLATION = 'NIV';

const verses = new Map(); // 'MRK.4.1' -> English text
const inFlight = new Map(); // ref -> Promise, so two paragraphs never double-fetch
let attribution = null; // { abbreviation, title, copyright, youVersionDeepLink, ... }
let offline = false; // a hard failure: stop asking for the rest of the lesson

// A lesson says which book and chapter it is: { book: 'MRK', chapter: 4 }.
export function lessonHasEnglish(lesson) {
  return Boolean(lesson && lesson.passage && lesson.passage.book && lesson.passage.chapter);
}

function verseId(lesson, n) {
  return `${lesson.passage.book}.${lesson.passage.chapter}.${n}`;
}

// The verse text already fetched, or undefined. Rendering uses this first so a
// verse that is already known appears with no flicker.
export function englishVerse(lesson, n) {
  if (!lessonHasEnglish(lesson)) return undefined;
  return verses.get(verseId(lesson, n));
}

export function englishAttribution() {
  return attribution;
}

export function englishOffline() {
  return offline;
}

// Fetch one contiguous run of verses (a paragraph). Resolves to true when at
// least one verse arrived, false when the English parallel is unavailable.
export async function loadEnglish(lesson, verseNumbers) {
  if (!lessonHasEnglish(lesson) || offline) return false;

  const wanted = verseNumbers.filter(n => !verses.has(verseId(lesson, n)));
  if (!wanted.length) return true;

  const first = Math.min(...wanted);
  const last = Math.max(...wanted);
  const ref = first === last
    ? `${lesson.passage.book}.${lesson.passage.chapter}.${first}`
    : `${lesson.passage.book}.${lesson.passage.chapter}.${first}-${last}`;

  if (inFlight.has(ref)) return inFlight.get(ref);

  const request = fetchRef(ref).finally(() => inFlight.delete(ref));
  inFlight.set(ref, request);
  return request;
}

async function fetchRef(ref) {
  const url = `/api/passage?translation=${TRANSLATION}&ref=${encodeURIComponent(ref)}`;
  let payload;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      // 404 = no Worker at all (the plain python dev server), 503 = no app key
      // configured. Neither can change while the page is open, so stop asking;
      // a 5xx from upstream might work next time, so that one is not latched.
      if (response.status === 404 || response.status === 503) offline = true;
      return false;
    }
    payload = await response.json();
  } catch {
    return false; // lost connection — worth retrying on the next paragraph
  }

  if (!payload || !Array.isArray(payload.verses)) return false;

  const [book, chapter] = ref.split('.');
  payload.verses.forEach(verse => {
    if (verse && typeof verse.text === 'string' && verse.text) {
      verses.set(`${book}.${chapter}.${verse.n}`, verse.text);
    }
  });
  if (payload.translation) attribution = payload.translation;
  return true;
}
