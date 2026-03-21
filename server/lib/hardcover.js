import { HttpError } from "./http.js";

const DEFAULT_HARDCOVER_URL = "https://api.hardcover.app/v1/graphql";
const MAX_BOOK_AUTOCOMPLETE_RESULTS = 25;
const DEFAULT_SEARCH_BOOKS_QUERY = `
  query SearchBooks(
    $query: String!
    $perPage: Int!
    $page: Int!
  ) {
    search(
      query: $query
      query_type: "Book"
      per_page: $perPage
      page: $page
    ) {
      results
    }
  }
`;

const CUSTOM_SEARCH_BOOKS_QUERY = `
  query SearchBooks(
    $query: String!
    $perPage: Int!
    $page: Int!
    $fields: String!
    $weights: String!
    $sort: String!
  ) {
    search(
      query: $query
      query_type: "Book"
      per_page: $perPage
      page: $page
      fields: $fields
      weights: $weights
      sort: $sort
    ) {
      results
    }
  }
`;

const AUTOCOMPLETE_SEARCH_FIELDS = "title,alternative_titles,author_names";
const AUTOCOMPLETE_SEARCH_WEIGHTS = "8,2,1";
const AUTOCOMPLETE_SEARCH_SORT = "_text_match:desc,users_count:desc";

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function normalizeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function normalizeForMatch(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeSearchResult(rawResult) {
  const hit =
    rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)
      ? rawResult
      : null;
  const result =
    hit?.document && typeof hit.document === "object" && !Array.isArray(hit.document)
      ? hit.document
      : hit;
  const title = typeof result?.title === "string" ? result.title.trim() : "";

  if (!title) {
    return null;
  }

  const authors = normalizeStringArray(result.author_names);
  const genres = normalizeStringArray(result.genres);
  const tags = normalizeStringArray(result.tags);
  const moods = normalizeStringArray(result.moods);
  const topics = uniqueStrings([...genres, ...tags, ...moods]);
  const coverUrl =
    typeof result?.image?.url === "string" ? result.image.url : undefined;

  return {
    id:
      result?.id != null && (typeof result.id === "string" || Number.isFinite(Number(result.id)))
        ? String(result.id)
        : `${title}::${authors[0] ?? ""}`,
    title,
    authors,
    genres,
    tags,
    moods,
    topics,
    averageRating: normalizeNumber(result.rating),
    ratingsCount: normalizeNumber(result.ratings_count),
    usersCount: normalizeNumber(result.users_count),
    description:
      typeof result?.description === "string" ? result.description.trim() : undefined,
    coverUrl,
  };
}

function dedupeResults(results) {
  const deduped = new Map();

  for (const result of results) {
    const key = `${result.title.toLowerCase()}::${(result.authors[0] ?? "").toLowerCase()}`;
    const existing = deduped.get(key);

    if (!existing || (result.ratingsCount ?? 0) > (existing.ratingsCount ?? 0)) {
      deduped.set(key, result);
    }
  }

  return Array.from(deduped.values());
}

function parseResults(results) {
  if (Array.isArray(results)) {
    return results;
  }

  if (results && typeof results === "object" && !Array.isArray(results)) {
    return Array.isArray(results.hits) ? results.hits : [];
  }

  if (typeof results === "string") {
    try {
      const parsed = JSON.parse(results);
      if (Array.isArray(parsed)) {
        return parsed;
      }

      return parsed && typeof parsed === "object" && Array.isArray(parsed.hits)
        ? parsed.hits
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function autocompleteMatchRank(query, result) {
  const normalizedQuery = normalizeForMatch(query);
  const normalizedTitle = normalizeForMatch(result.title);

  if (!normalizedQuery || !normalizedTitle) {
    return 0;
  }

  if (normalizedTitle === normalizedQuery) {
    return 5;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 4;
  }

  if (normalizedTitle.split(" ").some((word) => word.startsWith(normalizedQuery))) {
    return 3;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 2;
  }

  return 0;
}

function sortAutocompleteResults(query, results) {
  return [...results].sort((left, right) => {
    return (
      autocompleteMatchRank(query, right) - autocompleteMatchRank(query, left) ||
      (right.usersCount ?? 0) - (left.usersCount ?? 0) ||
      (right.ratingsCount ?? 0) - (left.ratingsCount ?? 0) ||
      (right.averageRating ?? 0) - (left.averageRating ?? 0) ||
      left.title.localeCompare(right.title)
    );
  });
}

export function createHardcoverClient(options = {}) {
  const token = options.token ?? process.env.HARDCOVER_API_TOKEN;
  const endpoint = options.endpoint ?? process.env.HARDCOVER_GRAPHQL_URL ?? DEFAULT_HARDCOVER_URL;
  const userAgent =
    options.userAgent ??
    process.env.HARDCOVER_USER_AGENT ??
    "book-ranker/0.1.0 hardcover-proxy";

  async function request(query, variables) {
    if (!token) {
      throw new HttpError(
        503,
        "HARDCOVER_API_TOKEN is not configured on the backend.",
      );
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: token,
        "User-Agent": userAgent,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (response.status === 401) {
      throw new HttpError(response.status, "Hardcover token is invalid or expired.");
    }

    if (response.status === 429) {
      throw new HttpError(429, "Hardcover rate limit reached. Try again shortly.");
    }

    if (response.status === 403) {
      let message = "Hardcover request was rejected by the API.";

      try {
        const errorPayload = await response.json();

        if (typeof errorPayload?.error === "string" && errorPayload.error.trim()) {
          message = errorPayload.error.trim();
        }
      } catch {
        // ignore parse failures and keep the fallback message
      }

      throw new HttpError(502, message);
    }

    if (!response.ok) {
      throw new HttpError(502, `Hardcover request failed (${response.status}).`);
    }

    const payload = await response.json();

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const firstError = payload.errors[0];
      const message =
        typeof firstError?.message === "string"
          ? firstError.message
          : "Hardcover query failed.";
      throw new HttpError(502, message);
    }

    return payload.data ?? {};
  }

  async function searchBooks(rawQuery, options = {}) {
    const query = String(rawQuery ?? "").trim();

    if (!query) {
      return [];
    }

    const perPage = Math.max(1, Math.min(25, Number(options.perPage) || 10));
    const page = Math.max(1, Number(options.page) || 1);
    const hasCustomSearchConfig =
      typeof options.fields === "string" &&
      typeof options.weights === "string" &&
      typeof options.sort === "string";

    const data = await request(
      hasCustomSearchConfig ? CUSTOM_SEARCH_BOOKS_QUERY : DEFAULT_SEARCH_BOOKS_QUERY,
      hasCustomSearchConfig
        ? {
            query,
            perPage,
            page,
            fields: options.fields,
            weights: options.weights,
            sort: options.sort,
          }
        : {
            query,
            perPage,
            page,
          },
    );
    const results = parseResults(data.search?.results);

    return dedupeResults(
      results
        .map(normalizeSearchResult)
        .filter((result) => result !== null),
    );
  }

  async function autocompleteBooksByTitle(rawQuery, options = {}) {
    const query = String(rawQuery ?? "").trim();

    if (!query) {
      return [];
    }

    const limit = Math.max(1, Math.min(MAX_BOOK_AUTOCOMPLETE_RESULTS, Number(options.limit) || 10));
    const fetchLimit = Math.max(limit, MAX_BOOK_AUTOCOMPLETE_RESULTS);
    const results = await searchBooks(query, {
      perPage: fetchLimit,
      fields: AUTOCOMPLETE_SEARCH_FIELDS,
      weights: AUTOCOMPLETE_SEARCH_WEIGHTS,
      sort: AUTOCOMPLETE_SEARCH_SORT,
    });

    return sortAutocompleteResults(query, results).slice(0, limit);
  }

  return {
    autocompleteBooksByTitle,
    searchBooks,
  };
}
