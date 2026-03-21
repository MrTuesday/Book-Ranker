import { HttpError } from "./http.js";

const DEFAULT_GOODREADS_URL = "https://www.goodreads.com";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const SEARCH_RESULTS_PER_PAGE = 10;
const MAX_BOOK_AUTOCOMPLETE_RESULTS = 8;
const MAX_CONCURRENT_DETAIL_REQUESTS = 4;
const HTML_CACHE_TTL_MS = 5 * 60 * 1000;
const IGNORED_GOODREADS_LABELS = new Set([
  "audiobook",
  "audiobooks",
  "book club",
  "book clubs",
]);

const textCache = new Map();

const htmlEntityMap = new Map([
  ["&amp;", "&"],
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&apos;", "'"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&nbsp;", " "],
  ["&mdash;", " - "],
  ["&ndash;", "-"],
]);

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(amp|quot|#39|apos|lt|gt|nbsp|mdash|ndash);/g,
    (entity) => htmlEntityMap.get(entity) ?? entity,
  );
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

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

function filterGoodreadsLabels(values) {
  return uniqueStrings(values).filter(
    (value) => !IGNORED_GOODREADS_LABELS.has(normalizeForMatch(value)),
  );
}

function normalizedStringSet(values) {
  return new Set(
    normalizeStringArray(values)
      .map((value) => normalizeForMatch(value))
      .filter(Boolean),
  );
}

function getCachedText(cacheKey) {
  const cached = textCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    textCache.delete(cacheKey);
    return null;
  }

  return cached.text;
}

function setCachedText(cacheKey, text, ttlMs = HTML_CACHE_TTL_MS) {
  textCache.set(cacheKey, {
    text,
    expiresAt: Date.now() + ttlMs,
  });
}

function extractBookId(url) {
  const match = String(url ?? "").match(/\/book\/show\/(\d+)/i);
  return match?.[1];
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function normalizeGoodreadsUrl(baseUrl, href) {
  const absolute = absoluteUrl(baseUrl, href);

  try {
    const url = new URL(absolute);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return absolute;
  }
}

function dedupeResults(results) {
  const deduped = new Map();

  for (const result of results) {
    const key = `${normalizeForMatch(result.title)}::${normalizeForMatch(result.authors[0] ?? "")}`;
    const existing = deduped.get(key);

    if (!existing || (result.ratingsCount ?? 0) > (existing.ratingsCount ?? 0)) {
      deduped.set(key, result);
    }
  }

  return Array.from(deduped.values());
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
      (right.ratingsCount ?? 0) - (left.ratingsCount ?? 0) ||
      (right.averageRating ?? 0) - (left.averageRating ?? 0) ||
      left.title.localeCompare(right.title)
    );
  });
}

function referenceMatchScore(reference, result) {
  const referenceTitle = normalizeForMatch(reference?.title);
  const resultTitle = normalizeForMatch(result?.title);
  const referenceAuthors = normalizedStringSet(reference?.authors);
  const resultAuthors = normalizedStringSet(result?.authors);
  let score = 0;

  if (referenceTitle && resultTitle) {
    if (resultTitle === referenceTitle) {
      score += 100;
    } else if (
      resultTitle.startsWith(referenceTitle) ||
      referenceTitle.startsWith(resultTitle)
    ) {
      score += 70;
    } else if (
      resultTitle.includes(referenceTitle) ||
      referenceTitle.includes(resultTitle)
    ) {
      score += 35;
    }
  }

  if (referenceAuthors.size > 0 && resultAuthors.size > 0) {
    let sharedAuthorCount = 0;

    for (const author of referenceAuthors) {
      if (resultAuthors.has(author)) {
        sharedAuthorCount += 1;
      }
    }

    if (sharedAuthorCount > 0) {
      score += 30 + sharedAuthorCount * 10;
    }
  }

  score += Math.min(result?.ratingsCount ?? 0, 1_000_000) / 1_000_000;
  return score;
}

function extractScriptJson(html, id) {
  const match = String(html ?? "").match(
    new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`),
  );

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractJsonLd(html) {
  const match = String(html ?? "").match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function resolveApolloRef(state, ref) {
  const key = ref?.__ref;
  return typeof key === "string" ? state?.[key] ?? null : null;
}

function resolveContributorNames(state, book) {
  const edges = [
    book?.primaryContributorEdge,
    ...(Array.isArray(book?.secondaryContributorEdges)
      ? book.secondaryContributorEdges
      : []),
  ].filter(Boolean);
  const authorEdges = edges.filter((edge) => {
    const role = String(edge?.role ?? "").trim().toLocaleLowerCase();
    return !role || role.includes("author");
  });
  const preferredEdges = authorEdges.length > 0 ? authorEdges : edges;

  return uniqueStrings(
    preferredEdges
      .map((edge) => resolveApolloRef(state, edge?.node))
      .map((contributor) =>
        contributor && typeof contributor.name === "string"
          ? contributor.name.trim()
          : "",
      )
      .filter(Boolean),
  );
}

function parseSearchResultRow(baseUrl, rowHtml) {
  const hrefMatch = rowHtml.match(/<a class="bookTitle"[^>]*href="([^"]+)"/);
  const titleMatch = rowHtml.match(
    /<a class="bookTitle"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/,
  );
  const authorMatches = Array.from(
    rowHtml.matchAll(/<a class="authorName"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/g),
  );
  const miniratingMatch = rowHtml.match(
    /<span class="minirating">([\s\S]*?)<\/span>/,
  );
  const coverMatch = rowHtml.match(/class="bookCover"[^>]+src="([^"]+)"/);

  if (!hrefMatch || !titleMatch) {
    return null;
  }

  const infoLink = normalizeGoodreadsUrl(baseUrl, decodeHtmlEntities(hrefMatch[1]));
  const title = stripTags(titleMatch[1]);
  const authors = authorMatches.map((match) => stripTags(match[1])).filter(Boolean);
  const minirating = stripTags(miniratingMatch?.[1] ?? "");
  const averageRating = normalizeNumber(
    minirating.match(/([0-9.]+)\s+avg rating/i)?.[1],
  );
  const ratingsCount = normalizeNumber(
    minirating.match(/([\d,]+)\s+ratings?/i)?.[1]?.replace(/,/g, ""),
  );
  const bookId = extractBookId(infoLink);

  if (!title) {
    return null;
  }

  return {
    id: bookId ? `goodreads:${bookId}` : `goodreads:${infoLink}`,
    title,
    authors,
    genres: [],
    tags: [],
    moods: [],
    topics: [],
    averageRating,
    ratingsCount,
    description: undefined,
    coverUrl: coverMatch ? decodeHtmlEntities(coverMatch[1]) : undefined,
    infoLink,
  };
}

function parseSearchResultsPage(baseUrl, html) {
  const rows = Array.from(
    String(html ?? "").matchAll(
      /<tr itemscope[^>]*itemtype=['"]http:\/\/schema\.org\/Book['"][^>]*>([\s\S]*?)<\/tr>/g,
    ),
  );

  return rows
    .map((row) => parseSearchResultRow(baseUrl, row[1]))
    .filter((result) => result !== null);
}

function parseBookPage(baseUrl, html, fallbackResult = {}) {
  const nextData = extractScriptJson(html, "__NEXT_DATA__");
  const jsonLd = extractJsonLd(html);
  const state = nextData?.props?.pageProps?.apolloState;
  const bookKey =
    state && typeof state === "object"
      ? Object.keys(state).find((key) => key.startsWith("Book:"))
      : null;
  const book = bookKey ? state[bookKey] : null;
  const work = resolveApolloRef(state, book?.work);
  const title =
    (typeof book?.titleComplete === "string" && book.titleComplete.trim()) ||
    (typeof book?.title === "string" && book.title.trim()) ||
    (typeof jsonLd?.name === "string" && jsonLd.name.trim()) ||
    fallbackResult.title ||
    "";
  const contributorAuthors = resolveContributorNames(state, book);
  const jsonLdAuthors = normalizeStringArray(
    Array.isArray(jsonLd?.author)
      ? jsonLd.author.map((author) => author?.name)
      : [jsonLd?.author?.name],
  );
  const authors = uniqueStrings(
    contributorAuthors.length > 0
      ? [...contributorAuthors, ...normalizeStringArray(fallbackResult.authors)]
      : [...jsonLdAuthors, ...normalizeStringArray(fallbackResult.authors)],
  );
  const genres = filterGoodreadsLabels(
    Array.isArray(book?.bookGenres)
      ? book.bookGenres
          .map((entry) =>
            typeof entry?.genre?.name === "string" ? entry.genre.name.trim() : "",
          )
          .filter(Boolean)
      : [],
  );
  const description =
    (typeof book?.['description({"stripped":true})'] === "string" &&
      book['description({"stripped":true})'].trim()) ||
    (typeof book?.description === "string" && stripTags(book.description)) ||
    (typeof jsonLd?.description === "string" && jsonLd.description.trim()) ||
    fallbackResult.description;
  const averageRating = normalizeNumber(
    work?.stats?.averageRating ??
      jsonLd?.aggregateRating?.ratingValue ??
      fallbackResult.averageRating,
  );
  const ratingsCount = normalizeNumber(
    work?.stats?.ratingsCount ??
      jsonLd?.aggregateRating?.ratingCount ??
      fallbackResult.ratingsCount,
  );
  const coverUrl =
    (typeof book?.imageUrl === "string" && book.imageUrl) ||
    (typeof jsonLd?.image === "string" && jsonLd.image) ||
    fallbackResult.coverUrl;
  const infoLink =
    (typeof book?.webUrl === "string" && book.webUrl) ||
    (typeof jsonLd?.url === "string" && jsonLd.url) ||
    fallbackResult.infoLink;
  const tags = [...genres];
  const topics = uniqueStrings([...genres, ...tags]);
  const bookId = extractBookId(infoLink);

  if (!title) {
    return null;
  }

  return {
    id: fallbackResult.id ?? (bookId ? `goodreads:${bookId}` : `goodreads:${title}`),
    title,
    authors,
    genres,
    tags,
    moods: [],
    topics,
    averageRating,
    ratingsCount,
    description,
    coverUrl,
    infoLink: infoLink ? normalizeGoodreadsUrl(baseUrl, infoLink) : undefined,
  };
}

async function mapWithConcurrency(items, concurrency, mapItem) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        results[currentIndex] = await mapItem(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

export function createGoodreadsClient(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.GOODREADS_BASE_URL ?? DEFAULT_GOODREADS_URL;
  const userAgent =
    options.userAgent ?? process.env.GOODREADS_USER_AGENT ?? DEFAULT_USER_AGENT;
  const provider = "goodreads-scraper";

  async function requestText(url) {
    const cached = getCachedText(url);

    if (cached) {
      return cached;
    }

    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
        "User-Agent": userAgent,
      },
      redirect: "follow",
    });

    if (response.status === 429) {
      throw new HttpError(429, "Goodreads rate limit reached. Try again shortly.");
    }

    if (response.status === 403) {
      throw new HttpError(502, "Goodreads blocked the scrape request.");
    }

    if (!response.ok) {
      throw new HttpError(502, `Goodreads scrape failed (${response.status}).`);
    }

    const text = await response.text();
    setCachedText(url, text);
    return text;
  }

  async function fetchBookDetails(infoLink, fallbackResult) {
    const html = await requestText(infoLink);
    return parseBookPage(baseUrl, html, fallbackResult) ?? fallbackResult;
  }

  async function enrichBooks(results) {
    return mapWithConcurrency(
      results,
      MAX_CONCURRENT_DETAIL_REQUESTS,
      async (result) => {
        if (!result?.infoLink) {
          return result;
        }

        try {
          return await fetchBookDetails(result.infoLink, result);
        } catch {
          return result;
        }
      },
    );
  }

  async function searchBooks(rawQuery, options = {}) {
    const query = String(rawQuery ?? "").trim();

    if (!query) {
      return [];
    }

    const perPage = Math.max(1, Math.min(24, Number(options.perPage) || 10));
    const pageCount = Math.max(1, Math.ceil(perPage / SEARCH_RESULTS_PER_PAGE));
    const pages = await Promise.all(
      Array.from({ length: pageCount }, async (_, index) => {
        const page = index + 1;
        const url = new URL("/search", baseUrl);
        url.searchParams.set("q", query);
        url.searchParams.set("search_type", "books");
        if (page > 1) {
          url.searchParams.set("page", String(page));
        }
        return requestText(url.toString());
      }),
    );

    const searchResults = dedupeResults(
      pages.flatMap((html) => parseSearchResultsPage(baseUrl, html)),
    ).slice(0, perPage);

    if (options.enrich === false) {
      return searchResults;
    }

    return dedupeResults(await enrichBooks(searchResults)).slice(0, perPage);
  }

  async function autocompleteBooksByTitle(rawQuery, options = {}) {
    const query = String(rawQuery ?? "").trim();

    if (!query) {
      return [];
    }

    const limit = Math.max(
      1,
      Math.min(MAX_BOOK_AUTOCOMPLETE_RESULTS, Number(options.limit) || 6),
    );
    const results = await searchBooks(query, { perPage: limit });
    return results.slice(0, limit);
  }

  async function resolveBookMetadata(reference = {}) {
    const title =
      typeof reference?.title === "string" ? reference.title.trim() : "";
    const authors = normalizeStringArray(reference?.authors);
    const infoLink =
      typeof reference?.infoLink === "string" && reference.infoLink.trim()
        ? normalizeGoodreadsUrl(baseUrl, reference.infoLink)
        : "";

    if (infoLink) {
      try {
        return await fetchBookDetails(infoLink, { title, authors, infoLink });
      } catch {
        // Fall through to title/author lookup if the saved link no longer works.
      }
    }

    const query = [title, authors[0]].filter(Boolean).join(" ").trim();

    if (!query) {
      return null;
    }

    const results = await searchBooks(query, { perPage: 5, enrich: false });

    if (results.length === 0) {
      return null;
    }

    const bestResult = [...results].sort((left, right) => {
      return referenceMatchScore(reference, right) - referenceMatchScore(reference, left);
    })[0] ?? null;

    if (!bestResult?.infoLink) {
      return bestResult;
    }

    try {
      return await fetchBookDetails(bestResult.infoLink, bestResult);
    } catch {
      return bestResult;
    }
  }

  return {
    provider,
    autocompleteBooksByTitle,
    searchBooks,
    enrichBooks,
    resolveBookMetadata,
  };
}
