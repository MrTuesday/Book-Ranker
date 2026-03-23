const DEFAULT_OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";
const DEFAULT_RESULT_LIMIT = 6;
const MAX_RESULT_LIMIT = 10;
const MAX_TOPIC_COUNT = 12;
const MAX_TAG_COUNT = 8;
const MAX_GENRE_COUNT = 6;
const SEARCH_FIELDS = [
  "key",
  "title",
  "author_name",
  "subject",
  "first_publish_year",
  "edition_count",
].join(",");

const NOISY_SUBJECT_PATTERNS = [
  /^open library/i,
  /^reading level-/i,
  /^juvenile works$/i,
  /^pictorial works$/i,
  /^characters?$/i,
  /^specimens$/i,
  /^translations into /i,
  /^spanish language materials$/i,
  /^untranslated$/i,
];

const GENRE_KEYWORDS = [
  "fiction",
  "fantasy",
  "science fiction",
  "sci-fi",
  "mystery",
  "thriller",
  "romance",
  "horror",
  "historical",
  "history",
  "biography",
  "memoir",
  "poetry",
  "classics",
  "graphic novel",
  "graphic novels",
  "comics",
  "adventure",
  "young adult",
  "children",
];

function clampLimit(value, fallback = DEFAULT_RESULT_LIMIT) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(parsed)));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function toDisplayLabel(value) {
  const trimmed = normalizeString(value);

  if (!trimmed) {
    return "";
  }

  const shouldRetitle =
    trimmed === trimmed.toLocaleLowerCase() ||
    trimmed === trimmed.toLocaleUpperCase();

  if (!shouldRetitle) {
    return trimmed;
  }

  return trimmed
    .toLocaleLowerCase()
    .replace(
      /(^|[\s/(:,-])(\p{L})/gu,
      (_match, boundary, letter) => `${boundary}${letter.toLocaleUpperCase()}`,
    );
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map(normalizeString).filter(Boolean)
    : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isUsefulSubject(subject) {
  if (!subject || subject.length > 48) {
    return false;
  }

  return !NOISY_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));
}

function isGenreLikeSubject(subject) {
  const normalized = subject.toLocaleLowerCase();

  return GENRE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function normalizeSearchResult(rawResult) {
  const result =
    rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)
      ? rawResult
      : null;
  const title = normalizeString(result?.title);

  if (!title) {
    return null;
  }

  const authors = normalizeStringArray(result?.author_name);
  const subjects = uniqueStrings(
    normalizeStringArray(result?.subject)
      .map(toDisplayLabel)
      .filter(isUsefulSubject),
  );
  const genres = subjects.filter(isGenreLikeSubject).slice(0, MAX_GENRE_COUNT);
  const tags = subjects.slice(0, MAX_TAG_COUNT);
  const topics = subjects.slice(0, MAX_TOPIC_COUNT);
  const key = normalizeString(result?.key);
  const editionCount = Number.isFinite(Number(result?.edition_count))
    ? Number(result.edition_count)
    : undefined;
  const firstPublishYear = Number.isFinite(Number(result?.first_publish_year))
    ? Number(result.first_publish_year)
    : undefined;
  const description =
    firstPublishYear != null ? `First published ${firstPublishYear}.` : undefined;

  return {
    id: key ? `openlibrary:${key}` : `openlibrary:${title}::${authors[0] ?? ""}`,
    title,
    authors,
    genres,
    tags,
    moods: [],
    topics,
    ...(editionCount != null ? { usersCount: editionCount } : {}),
    ...(description ? { description } : {}),
    ...(key ? { infoLink: `https://openlibrary.org${key}` } : {}),
  };
}

export async function searchOpenLibraryCatalog(query, options = {}) {
  const trimmedQuery = normalizeString(query);
  const limit = clampLimit(options.limit);
  const endpoint = options.endpoint ?? DEFAULT_OPEN_LIBRARY_URL;
  const userAgent =
    options.userAgent ??
    process.env.OPEN_LIBRARY_USER_AGENT ??
    "book-ranker/0.1.0 openlibrary-lookup";

  if (!trimmedQuery) {
    return {
      provider: "openlibrary",
      query,
      results: [],
    };
  }

  const url = new URL(endpoint);
  url.searchParams.set("title", trimmedQuery);
  url.searchParams.set("fields", SEARCH_FIELDS);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Open Library lookup failed (${response.status}).`);
  }

  const payload = await response.json();
  const docs = Array.isArray(payload?.docs) ? payload.docs : [];

  return {
    provider: "openlibrary",
    query,
    results: docs
      .map(normalizeSearchResult)
      .filter((result) => result !== null)
      .slice(0, limit),
  };
}
