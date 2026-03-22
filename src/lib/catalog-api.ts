import { buildCatalogIdentityKey, type CatalogBook } from "./catalog-memory";
import type { Book } from "./books-api";
import { buildSiteBookAggregates, type SiteBookAggregate } from "./site-books";

export type CatalogSearchResult = {
  id: string;
  title: string;
  series?: string;
  seriesNumber?: number;
  authors: string[];
  genres: string[];
  tags: string[];
  moods: string[];
  topics: string[];
  averageRating?: number;
  ratingsCount?: number;
  usersCount?: number;
  description?: string;
  coverUrl?: string;
  infoLink?: string;
};

export type CatalogSearchResponse = {
  provider: string;
  query: string;
  results: CatalogSearchResult[];
};

export type SiteCatalogResult = CatalogSearchResult & {
  hasUnreadEntry: boolean;
  sourceBookIds: number[];
};

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function toSiteCatalogResult(book: SiteBookAggregate): SiteCatalogResult {
  return {
    id: book.id,
    title: book.title,
    ...(book.series ? { series: book.series } : {}),
    ...(book.seriesNumber != null ? { seriesNumber: book.seriesNumber } : {}),
    authors: [...book.authors],
    genres: [...book.genres],
    tags: [],
    moods: [],
    topics: [...book.genres],
    averageRating: book.averageRating,
    ratingsCount: book.ratingsCount,
    usersCount: book.sourceBookIds.length,
    hasUnreadEntry: book.hasUnreadEntry,
    sourceBookIds: [...book.sourceBookIds],
  };
}

function toMemoryCatalogResult(book: CatalogBook): SiteCatalogResult {
  const identityKey = buildCatalogIdentityKey(book);

  return {
    id: `site:${identityKey}`,
    title: book.title,
    ...(book.series ? { series: book.series } : {}),
    ...(book.seriesNumber != null ? { seriesNumber: book.seriesNumber } : {}),
    authors: [...book.authors],
    genres: [...book.genres],
    tags: [],
    moods: [],
    topics: [...book.genres],
    hasUnreadEntry: false,
    sourceBookIds: [],
  };
}

function mergeCatalogResult(
  current: SiteCatalogResult,
  incoming: SiteCatalogResult,
): SiteCatalogResult {
  return {
    ...current,
    title: incoming.title,
    ...(incoming.series || current.series
      ? { series: incoming.series ?? current.series }
      : {}),
    ...(incoming.seriesNumber != null || current.seriesNumber != null
      ? { seriesNumber: incoming.seriesNumber ?? current.seriesNumber }
      : {}),
    authors:
      incoming.authors.length > 0
        ? uniqueStrings(incoming.authors)
        : uniqueStrings(current.authors),
    genres: uniqueStrings([...current.genres, ...incoming.genres]),
    topics: uniqueStrings([...current.topics, ...incoming.topics]),
    averageRating: current.averageRating ?? incoming.averageRating,
    ratingsCount: current.ratingsCount ?? incoming.ratingsCount,
    usersCount: current.usersCount ?? incoming.usersCount,
    hasUnreadEntry: current.hasUnreadEntry || incoming.hasUnreadEntry,
    sourceBookIds: Array.from(
      new Set([...current.sourceBookIds, ...incoming.sourceBookIds]),
    ),
  };
}

function catalogMatchScore(result: CatalogSearchResult, normalizedQuery: string) {
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedTitle = normalizeSearchValue(result.title);
  const normalizedAuthors = normalizeSearchValue(result.authors.join(" "));
  const combined = `${normalizedTitle} ${normalizedAuthors}`.trim();

  if (normalizedTitle === normalizedQuery) {
    return 6;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 5;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 4;
  }

  if (normalizedAuthors.startsWith(normalizedQuery)) {
    return 3;
  }

  if (normalizedAuthors.includes(normalizedQuery)) {
    return 2;
  }

  if (combined.includes(normalizedQuery)) {
    return 1;
  }

  return 0;
}

export function buildSiteCatalogResults(books: Book[]) {
  return buildSiteBookAggregates(books).map(toSiteCatalogResult);
}

export function buildCatalogResults(
  books: Book[],
  catalogBooks: CatalogBook[] = [],
) {
  const byIdentity = new Map<string, SiteCatalogResult>();

  for (const result of buildSiteCatalogResults(books)) {
    const identityKey = buildCatalogIdentityKey({
      title: result.title,
      authors: result.authors,
    });

    byIdentity.set(identityKey, result);
  }

  for (const catalogBook of catalogBooks) {
    const identityKey = buildCatalogIdentityKey(catalogBook);
    const nextResult = toMemoryCatalogResult(catalogBook);
    const current = byIdentity.get(identityKey);

    byIdentity.set(
      identityKey,
      current ? mergeCatalogResult(current, nextResult) : nextResult,
    );
  }

  return Array.from(byIdentity.values());
}

export function searchCatalog(
  books: Book[],
  query: string,
  limit = 10,
  catalogBooks: CatalogBook[] = [],
): CatalogSearchResponse {
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return {
      provider: "book-ranker",
      query,
      results: [],
    };
  }

  const results = buildCatalogResults(books, catalogBooks)
    .map((result) => ({
      result,
      matchScore: catalogMatchScore(result, normalizedQuery),
    }))
    .filter(({ matchScore }) => matchScore > 0)
    .sort((left, right) => {
      return (
        right.matchScore - left.matchScore ||
        (right.result.ratingsCount ?? 0) - (left.result.ratingsCount ?? 0) ||
        left.result.title.localeCompare(right.result.title)
      );
    })
    .slice(0, Math.max(1, limit))
    .map(({ result }) => result);

  return {
    provider: "book-ranker",
    query,
    results,
  };
}
