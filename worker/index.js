// YouVersion passage proxy. The Chinese text of every lesson is public-domain
// CUV shipped in lessons/, but the English parallel (NIV) is licensed: it must
// be requested at read time and may not be stored in the repo. The app key is
// server-only — it never reaches browser JavaScript.
//
// Same integration as the lucas-academy-bible worker: api.youversion.com/v1
// with an X-YVP-App-Key header. NIV is Bible id 111.
const YOUVERSION_API = 'https://api.youversion.com/v1';
const VERSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PASSAGE_TTL_SECONDS = 30 * 24 * 60 * 60;

// Only the translations a lesson may ask for. Adding one is a line here plus
// its YouVersion Bible id.
const TRANSLATIONS = Object.freeze({
  NIV: { key: 'NIV', label: 'NIV', bibleId: 111 },
  NIRV: { key: 'NIRV', label: 'NIrV', bibleId: 110 },
});

// Book.chapter.verse, optionally a verse range: MRK.4.1 or MRK.4.1-9.
const REF_PATTERN = /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)(?:-(\d+))?$/;

// One request per verse goes upstream, so a range is capped well under the
// Workers subrequest budget. Lessons ask paragraph by paragraph (≤ 12 verses).
const MAX_RANGE = 25;

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, headers });
}

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireTranslation(key) {
  const translation = TRANSLATIONS[key];
  if (!translation) {
    throw new RequestError(400, 'invalid_translation', 'That Bible translation is not supported.');
  }
  return translation;
}

function requireRef(ref) {
  const match = REF_PATTERN.exec(ref);
  if (!match) {
    throw new RequestError(400, 'invalid_ref', 'That passage reference is not supported.');
  }
  const [, book, chapter, firstText, lastText] = match;
  const first = Number(firstText);
  const last = Number(lastText ?? firstText);
  if (last < first) {
    throw new RequestError(400, 'invalid_ref', 'That passage reference is not supported.');
  }
  if (last - first + 1 > MAX_RANGE) {
    throw new RequestError(400, 'range_too_wide', `Ask for at most ${MAX_RANGE} verses at a time.`);
  }
  return { book, chapter: Number(chapter), first, last };
}

function requireKey(env) {
  if (!env.YVP_APP_KEY) {
    throw new RequestError(
      503,
      'not_configured',
      'The English parallel is not configured on this server yet.',
    );
  }
  return env.YVP_APP_KEY;
}

async function youVersionJson(path, appKey) {
  const response = await fetch(`${YOUVERSION_API}${path}`, {
    headers: { Accept: 'application/json', 'X-YVP-App-Key': appKey },
  });
  if (!response.ok) {
    throw new RequestError(502, 'upstream_error', 'That passage could not be loaded. Please try again.');
  }
  return response.json();
}

// Cached upstream GET. Scripture text and version metadata never change, so a
// hit here is the normal case and YouVersion is asked once per edge location.
// The cache key is a same-origin URL — Cache API needs a real, valid URL.
async function cachedJson(request, path, appKey, cacheName, ttl) {
  const cache = caches.default;
  const key = new Request(new URL(`/__yv-cache/${cacheName}`, request.url).toString(), {
    method: 'GET',
  });

  const hit = await cache.match(key);
  if (hit) return { value: await hit.json(), cache: 'HIT' };

  const value = await youVersionJson(path, appKey);
  await cache.put(
    key,
    new Response(JSON.stringify(value), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `max-age=${ttl}`,
      },
    }),
  );
  return { value, cache: 'MISS' };
}

// Title / abbreviation / copyright / link. YouVersion requires the notice it
// returns to be shown wherever its text is, so the app renders this verbatim.
async function getMetadata(request, env, translation) {
  const { value } = await cachedJson(
    request,
    `/bibles/${translation.bibleId}`,
    requireKey(env),
    `bible-${translation.bibleId}`,
    VERSION_TTL_SECONDS,
  );
  return {
    key: translation.key,
    label: translation.label,
    id: value.id ?? translation.bibleId,
    abbreviation: value.abbreviation ?? translation.label,
    title: value.title ?? translation.label,
    copyright: value.copyright ?? '',
    promotionalContent: value.promotional_content ?? '',
    youVersionDeepLink:
      value.youversion_deep_link ?? `https://www.bible.com/versions/${translation.bibleId}`,
  };
}

async function getVerse(request, env, translation, verseId) {
  const { value } = await cachedJson(
    request,
    `/bibles/${translation.bibleId}/passages/${encodeURIComponent(verseId)}` +
      '?format=text&include_headings=false&include_notes=false',
    requireKey(env),
    `passage-${translation.bibleId}-${verseId}`,
    PASSAGE_TTL_SECONDS,
  );
  if (!value?.content) {
    throw new RequestError(502, 'upstream_error', 'That passage could not be loaded. Please try again.');
  }
  return { reference: value.reference ?? verseId, text: String(value.content).trim() };
}

// A verse range comes back verse by verse: `format=text` returns a range as one
// unnumbered block, which cannot be split back apart reliably, so each verse is
// its own upstream request (and its own cache entry).
export async function getPassage(request, env, translationKey, ref) {
  const translation = requireTranslation(translationKey);
  const { book, chapter, first, last } = requireRef(ref);
  requireKey(env);

  const verseNumbers = [];
  for (let n = first; n <= last; n += 1) verseNumbers.push(n);

  const [metadata, ...verses] = await Promise.all([
    getMetadata(request, env, translation),
    ...verseNumbers.map(n => getVerse(request, env, translation, `${book}.${chapter}.${n}`)),
  ]);

  return {
    ref,
    reference: verses.length === 1 ? verses[0].reference : `${book} ${chapter}:${first}-${last}`,
    translation: metadata,
    verses: verseNumbers.map((n, i) => ({ n, text: verses[i].text })),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/passage') {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET' } });
      }
      try {
        const passage = await getPassage(
          request,
          env,
          url.searchParams.get('translation') ?? 'NIV',
          url.searchParams.get('ref') ?? '',
        );
        return json(passage, {
          // The browser may reuse a passage for a session; the edge cache above
          // is what actually spares YouVersion the traffic.
          headers: { 'Cache-Control': 'public, max-age=3600' },
        });
      } catch (error) {
        if (error instanceof RequestError) {
          if (error.status >= 500) console.error('passage', error);
          return json({ error: error.code, message: error.message }, { status: error.status });
        }
        console.error('passage', error);
        return json(
          { error: 'passage_unavailable', message: 'That passage could not be loaded. Please try again.' },
          { status: 502 },
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
