import {
  isCatalogDbAvailable,
  searchCatalogDb,
  searchCatalogDbBySubject,
  searchCatalogDbBySubjects,
} from "./catalog-db.js";
import { sanitizeSubjectTags } from "./subject-tags.js";

const DEFAULT_RESULT_LIMIT = 6;
const MAX_RESULT_LIMIT = 10;
const DEFAULT_RECOMMENDATION_LIMIT = 20;
const MAX_RECOMMENDATION_LIMIT = 24;
const MAX_RECOMMENDATION_TAGS = 4;
const MAX_RECOMMENDATION_EXACT_TAGS = 2;
const MAX_RECOMMENDATION_FALLBACK_TAGS = 3;
const MIN_RECOMMENDATION_RESULTS_PER_TAG = 5;
const MAX_TOPIC_COUNT = 12;
const MAX_TAG_COUNT = 8;
const MAX_GENRE_COUNT = 6;

const BROAD_RECOMMENDATION_TAG_PATTERNS = [
  /^academic$/i,
  /^art$/i,
  /^biography$/i,
  /^classics?$/i,
  /^fiction$/i,
  /^general$/i,
  /^history$/i,
  /^literature$/i,
  /^non[-\s]?fiction$/i,
  /^philosophy$/i,
  /^politics$/i,
  /^science$/i,
  /^theory$/i,
];

function clampLimit(value, fallback = DEFAULT_RESULT_LIMIT) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(parsed)));
}

function clampRecommendationLimit(value, fallback = DEFAULT_RECOMMENDATION_LIMIT) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(MAX_RECOMMENDATION_LIMIT, Math.floor(parsed)));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map(normalizeString).filter(Boolean)
    : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tokenizeSearchLabel(value) {
  return normalizeString(value)
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
}

function normalizeIdentityKey(title, authors) {
  return `${normalizeString(title).toLocaleLowerCase()}::${uniqueStrings(
    normalizeStringArray(authors).map((value) => value.toLocaleLowerCase()),
  ).join("|")}`;
}

function normalizeDbResult(row) {
  const title = normalizeString(row.title);

  if (!title) {
    return null;
  }

  const authors = (row.authors ?? []).map(normalizeString).filter(Boolean);
  const sanitized = sanitizeSubjectTags(row.subjects ?? []);
  const subjects = uniqueStrings(sanitized.subjects);
  const genres = sanitized.genres.slice(0, MAX_GENRE_COUNT);
  const tags = subjects.slice(0, MAX_TAG_COUNT);
  const topics = subjects.slice(0, MAX_TOPIC_COUNT);
  const key = normalizeString(row.key);
  const description =
    row.publishYear != null ? `First published ${row.publishYear}.` : undefined;

  return {
    id: key ? `openlibrary:${key}` : `openlibrary:${title}::${authors[0] ?? ""}`,
    title,
    authors,
    genres,
    tags,
    moods: [],
    topics,
    ...(row.series ? { series: normalizeString(row.series) } : {}),
    ...(row.seriesNumber != null ? { seriesNumber: row.seriesNumber } : {}),
    ...(description ? { description } : {}),
    ...(key ? { infoLink: `https://openlibrary.org${key}` } : {}),
  };
}

function isBroadRecommendationTag(tag) {
  return BROAD_RECOMMENDATION_TAG_PATTERNS.some((pattern) => pattern.test(tag));
}

function recommendationTagPriority(tag) {
  const normalized = normalizeString(tag);
  const tokens = tokenizeSearchLabel(normalized);
  const broadPenalty = isBroadRecommendationTag(normalized) ? 3 : 0;

  return (
    tokens.length * 3 +
    Math.min(Math.floor(normalized.length / 6), 4) -
    broadPenalty
  );
}

function sortRecommendationTags(tags) {
  return [...tags].sort((left, right) => {
    return (
      recommendationTagPriority(right) - recommendationTagPriority(left) ||
      right.length - left.length ||
      left.localeCompare(right)
    );
  });
}

function subjectMatchScore(subjects, tag) {
  const normalizedTag = normalizeString(tag).toLocaleLowerCase();

  if (!normalizedTag) {
    return 0;
  }

  const tagTokens = tokenizeSearchLabel(normalizedTag);

  for (const subject of subjects) {
    const normalizedSubject = normalizeString(subject).toLocaleLowerCase();

    if (!normalizedSubject) {
      continue;
    }

    if (normalizedSubject === normalizedTag) {
      return 5;
    }

    if (normalizedSubject.includes(normalizedTag)) {
      return 4;
    }

    if (
      tagTokens.length > 1 &&
      tagTokens.every((token) => normalizedSubject.includes(token))
    ) {
      return 3;
    }

    if (
      !isBroadRecommendationTag(normalizedTag) &&
      normalizedTag.includes(normalizedSubject) &&
      normalizedSubject.length >= 6
    ) {
      return 2;
    }
  }

  return 0;
}

export async function searchOpenLibraryCatalog(query, options = {}) {
  const trimmedQuery = normalizeString(query);
  const limit = clampLimit(options.limit);

  if (!trimmedQuery || !(await isCatalogDbAvailable())) {
    return {
      provider: "openlibrary",
      query,
      results: [],
    };
  }

  const rows = await searchCatalogDb(trimmedQuery, limit);

  return {
    provider: "openlibrary",
    query,
    results: rows
      .map(normalizeDbResult)
      .filter((result) => result !== null)
      .slice(0, limit),
  };
}

export async function searchOpenLibraryRecommendations(selectedTags, options = {}) {
  const tags = uniqueStrings(
    Array.isArray(selectedTags)
      ? selectedTags.map(normalizeString).filter(Boolean)
      : [],
  ).slice(0, MAX_RECOMMENDATION_TAGS);
  const limit = clampRecommendationLimit(options.limit);

  if (tags.length === 0 || !(await isCatalogDbAvailable())) {
    return {
      provider: "openlibrary",
      query: "",
      results: [],
    };
  }

  return searchRecommendationsFromDb(tags, limit);
}

async function searchRecommendationsFromDb(tags, limit) {
  const prioritizedTags = sortRecommendationTags(tags);
  const requiredTags = prioritizedTags.filter(
    (tag) => !isBroadRecommendationTag(tag),
  );
  const byIdentity = new Map();

  // Try multi-tag search first
  if (prioritizedTags.length > 1) {
    const multiResults = await searchCatalogDbBySubjects(
      prioritizedTags.slice(0, MAX_RECOMMENDATION_EXACT_TAGS),
      limit,
    );

    for (const row of multiResults) {
      const result = normalizeDbResult(row);

      if (result) {
        byIdentity.set(normalizeIdentityKey(result.title, result.authors), {
          result,
          subjects: sanitizeSubjectTags(row.subjects ?? []).subjects,
        });
      }
    }
  }

  // Fill with single-tag searches
  for (const tag of prioritizedTags.slice(0, MAX_RECOMMENDATION_FALLBACK_TAGS)) {
    if (byIdentity.size >= limit * 2) {
      break;
    }

    const rows = await searchCatalogDbBySubject(
      tag,
      Math.max(MIN_RECOMMENDATION_RESULTS_PER_TAG, limit),
    );

    for (const row of rows) {
      const result = normalizeDbResult(row);

      if (!result) {
        continue;
      }

      const identityKey = normalizeIdentityKey(result.title, result.authors);

      if (!byIdentity.has(identityKey)) {
        byIdentity.set(identityKey, {
          result,
          subjects: sanitizeSubjectTags(row.subjects ?? []).subjects,
        });
      }
    }
  }

  let rankedResults = Array.from(byIdentity.values()).map((entry) => {
    const matchedTags = tags.filter(
      (tag) => subjectMatchScore(entry.subjects, tag) > 0,
    );
    const matchedRequiredTags = requiredTags.filter((tag) =>
      matchedTags.includes(tag),
    );

    return {
      ...entry.result,
      _matchedTagCount: matchedTags.length,
      _matchedRequiredTagCount: matchedRequiredTags.length,
    };
  });

  if (requiredTags.length > 0) {
    const requiredMatches = rankedResults.filter(
      (result) => result._matchedRequiredTagCount > 0,
    );

    if (requiredMatches.length > 0) {
      rankedResults = requiredMatches;
    }
  }

  return {
    provider: "openlibrary",
    query: tags.join(", "),
    results: rankedResults
      .sort((left, right) => {
        return (
          right._matchedRequiredTagCount - left._matchedRequiredTagCount ||
          right._matchedTagCount - left._matchedTagCount ||
          left.title.localeCompare(right.title)
        );
      })
      .slice(0, limit)
      .map(
        ({ _matchedTagCount, _matchedRequiredTagCount, ...result }) => result,
      ),
  };
}
