import {
  isCatalogDbAvailable,
  searchCatalogDb,
  searchCatalogDbBySubject,
  searchCatalogDbBySubjects,
} from "./catalog-db.js";

const DEFAULT_OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";
const DEFAULT_RESULT_LIMIT = 6;
const MAX_RESULT_LIMIT = 10;
const DEFAULT_RECOMMENDATION_LIMIT = 20;
const MAX_RECOMMENDATION_LIMIT = 24;
const MAX_RECOMMENDATION_TAGS = 4;
const MAX_RECOMMENDATION_EXACT_TAGS = 2;
const MAX_RECOMMENDATION_FALLBACK_TAGS = 3;
const MIN_RECOMMENDATION_RESULTS_PER_TAG = 5;
const MAX_RECOMMENDATION_RESULTS_PER_TAG = 12;
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
  /^open_syllabus_project$/i,
  /^open syllabus project$/i,
  /^general$/i,
  /^reference$/i,
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

function buildTitleSearchTerm(query) {
  const trimmed = normalizeString(query).replace(/\*+$/g, "");

  if (!trimmed) {
    return "";
  }

  return `${trimmed}*`;
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

function isUsefulSubject(subject) {
  if (!subject || subject.length < 3 || subject.length > 64) {
    return false;
  }

  const letters = Array.from(subject).filter((character) =>
    /\p{L}/u.test(character),
  ).length;

  if (letters < 3) {
    return false;
  }

  return !NOISY_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));
}

function isGenreLikeSubject(subject) {
  const normalized = subject.toLocaleLowerCase();

  return GENRE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function extractSearchSubjects(rawResult) {
  const result =
    rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)
      ? rawResult
      : null;

  return uniqueStrings(
    normalizeStringArray(result?.subject)
      .map(toDisplayLabel)
      .filter(isUsefulSubject),
  );
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
  const subjects = extractSearchSubjects(result);
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

function normalizeDbResult(row) {
  const title = normalizeString(row.title);

  if (!title) {
    return null;
  }

  const authors = (row.authors ?? []).map(normalizeString).filter(Boolean);
  const rawSubjects = (row.subjects ?? [])
    .map(toDisplayLabel)
    .filter(isUsefulSubject);
  const subjects = uniqueStrings(rawSubjects);
  const genres = subjects.filter(isGenreLikeSubject).slice(0, MAX_GENRE_COUNT);
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

function mergeNormalizedSearchResult(current, incoming) {
  return {
    ...current,
    authors:
      current.authors.length > 0
        ? uniqueStrings(current.authors)
        : uniqueStrings(incoming.authors),
    genres: uniqueStrings([...current.genres, ...incoming.genres]).slice(
      0,
      MAX_GENRE_COUNT,
    ),
    tags: uniqueStrings([...current.tags, ...incoming.tags]).slice(0, MAX_TAG_COUNT),
    topics: uniqueStrings([...current.topics, ...incoming.topics]).slice(
      0,
      MAX_TOPIC_COUNT,
    ),
    usersCount: current.usersCount ?? incoming.usersCount,
    description: current.description ?? incoming.description,
    infoLink: current.infoLink ?? incoming.infoLink,
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

function escapeSearchLiteral(value) {
  return normalizeString(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildExactSubjectQuery(tags) {
  return tags.map((tag) => `subject:"${escapeSearchLiteral(tag)}"`).join(" AND ");
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

function mergeRecommendationResult(current, incoming) {
  return {
    result: mergeNormalizedSearchResult(current.result, incoming.result),
    subjects: uniqueStrings([...current.subjects, ...incoming.subjects]),
    exactQueryTags: new Set([...current.exactQueryTags, ...incoming.exactQueryTags]),
    fallbackQueryTags: new Set([
      ...current.fallbackQueryTags,
      ...incoming.fallbackQueryTags,
    ]),
  };
}

async function fetchRecommendationPlan(endpoint, userAgent, plan, limit) {
  const url = new URL(endpoint);

  if (plan.kind === "exact") {
    url.searchParams.set("q", buildExactSubjectQuery(plan.tags));
  } else {
    url.searchParams.set("subject", plan.tags[0]);
  }

  url.searchParams.set("fields", SEARCH_FIELDS);
  url.searchParams.set("limit", String(limit));

  return fetchOpenLibraryDocs(url, userAgent);
}

async function fetchOpenLibraryDocs(url, userAgent) {
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
  return Array.isArray(payload?.docs) ? payload.docs : [];
}

export async function searchOpenLibraryCatalog(query, options = {}) {
  const trimmedQuery = normalizeString(query);
  const limit = clampLimit(options.limit);

  if (!trimmedQuery) {
    return {
      provider: "openlibrary",
      query,
      results: [],
    };
  }

  if (await isCatalogDbAvailable()) {
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

  const endpoint = options.endpoint ?? DEFAULT_OPEN_LIBRARY_URL;
  const userAgent =
    options.userAgent ??
    process.env.OPEN_LIBRARY_USER_AGENT ??
    "book-ranker/0.1.0 openlibrary-lookup";
  const url = new URL(endpoint);
  url.searchParams.set("title", buildTitleSearchTerm(trimmedQuery));
  url.searchParams.set("fields", SEARCH_FIELDS);
  url.searchParams.set("limit", String(limit));
  const docs = await fetchOpenLibraryDocs(url, userAgent);

  return {
    provider: "openlibrary",
    query,
    results: docs
      .map(normalizeSearchResult)
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

  if (tags.length === 0) {
    return {
      provider: "openlibrary",
      query: "",
      results: [],
    };
  }

  if (await isCatalogDbAvailable()) {
    return await searchRecommendationsFromDb(tags, limit);
  }

  const endpoint = options.endpoint ?? DEFAULT_OPEN_LIBRARY_URL;
  const userAgent =
    options.userAgent ??
    process.env.OPEN_LIBRARY_USER_AGENT ??
    "book-ranker/0.1.0 openlibrary-lookup";

  const prioritizedTags = sortRecommendationTags(tags);
  const exactTags = prioritizedTags.slice(0, MAX_RECOMMENDATION_EXACT_TAGS);
  const requiredTags = prioritizedTags.filter((tag) => !isBroadRecommendationTag(tag));
  const exactPlans = [];

  if (exactTags.length > 1) {
    exactPlans.push({
      kind: "exact",
      tags: exactTags,
    });
  }

  for (const tag of requiredTags.slice(0, MAX_RECOMMENDATION_EXACT_TAGS)) {
    exactPlans.push({
      kind: "exact",
      tags: [tag],
    });
  }

  if (exactPlans.length === 0) {
    exactPlans.push({
      kind: "exact",
      tags: [prioritizedTags[0]],
    });
  }

  const fallbackPlans = prioritizedTags
    .slice(0, MAX_RECOMMENDATION_FALLBACK_TAGS)
    .map((tag) => ({
      kind: "fallback",
      tags: [tag],
    }));
  const perTagLimit = Math.max(
    MIN_RECOMMENDATION_RESULTS_PER_TAG,
    Math.min(
      MAX_RECOMMENDATION_RESULTS_PER_TAG,
      Math.ceil((limit * 2) / tags.length),
    ),
  );

  const byIdentity = new Map();

  async function collectPlans(plans) {
    const docsByPlan = await Promise.all(
      plans.map(async (plan) => ({
        plan,
        docs: await fetchRecommendationPlan(
          endpoint,
          userAgent,
          plan,
          perTagLimit,
        ),
      })),
    );

    for (const { plan, docs } of docsByPlan) {
      for (const doc of docs) {
        const result = normalizeSearchResult(doc);

        if (!result) {
          continue;
        }

        const identityKey = normalizeIdentityKey(result.title, result.authors);
        const current = byIdentity.get(identityKey);
        const nextEntry = {
          result,
          subjects: extractSearchSubjects(doc),
          exactQueryTags: new Set(plan.kind === "exact" ? plan.tags : []),
          fallbackQueryTags: new Set(plan.kind === "fallback" ? plan.tags : []),
        };

        byIdentity.set(
          identityKey,
          current ? mergeRecommendationResult(current, nextEntry) : nextEntry,
        );
      }
    }
  }

  await collectPlans(exactPlans);

  if (byIdentity.size < limit) {
    await collectPlans(fallbackPlans);
  }

  let rankedResults = Array.from(byIdentity.values()).map((entry) => {
    const matchedTags = tags.filter((tag) => {
      return (
        entry.exactQueryTags.has(tag) ||
        entry.fallbackQueryTags.has(tag) ||
        subjectMatchScore(entry.subjects, tag) > 0
      );
    });
    const matchedRequiredTags = requiredTags.filter((tag) => matchedTags.includes(tag));
    const tagsForDisplay = uniqueStrings([...matchedTags, ...entry.result.tags]).slice(
      0,
      MAX_TAG_COUNT,
    );
    const topicsForDisplay = uniqueStrings([
      ...matchedTags,
      ...entry.result.topics,
      ...entry.result.tags,
      ...entry.subjects,
    ]).slice(0, MAX_TOPIC_COUNT);

    return {
      ...entry.result,
      tags: tagsForDisplay,
      topics: topicsForDisplay,
      _matchedTagCount: matchedTags.length,
      _matchedRequiredTagCount: matchedRequiredTags.length,
      _exactQueryTagCount: entry.exactQueryTags.size,
      _queryTagCount: uniqueStrings([
        ...entry.exactQueryTags,
        ...entry.fallbackQueryTags,
      ]).length,
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
          right._exactQueryTagCount - left._exactQueryTagCount ||
          right._queryTagCount - left._queryTagCount ||
          (right.usersCount ?? 0) - (left.usersCount ?? 0) ||
          left.title.localeCompare(right.title)
        );
      })
      .slice(0, limit)
      .map(
        ({
          _matchedTagCount,
          _matchedRequiredTagCount,
          _exactQueryTagCount,
          _queryTagCount,
          ...result
        }) => result,
      ),
  };
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
          subjects: row.subjects ?? [],
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
          subjects: row.subjects ?? [],
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
