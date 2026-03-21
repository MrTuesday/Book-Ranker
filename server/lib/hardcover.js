import { HttpError } from "./http.js";

const DEFAULT_HARDCOVER_URL = "https://api.hardcover.app/v1/graphql";
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

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeSearchResult(rawResult) {
  const result =
    rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)
      ? rawResult
      : null;
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

  if (typeof results === "string") {
    try {
      const parsed = JSON.parse(results);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
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

    if (response.status === 401 || response.status === 403) {
      throw new HttpError(response.status, "Hardcover token is invalid or expired.");
    }

    if (response.status === 429) {
      throw new HttpError(429, "Hardcover rate limit reached. Try again shortly.");
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

  return {
    searchBooks,
  };
}
