import type { Book } from "./books-api";
import { buildSiteBookAggregates, type SiteBookAggregate } from "./site-books";

export type CatalogSearchResult = {
  id: string;
  title: string;
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

function toSiteCatalogResult(book: SiteBookAggregate): SiteCatalogResult {
  return {
    id: book.id,
    title: book.title,
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

export function searchCatalog(
  books: Book[],
  query: string,
  limit = 10,
): CatalogSearchResponse {
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return {
      provider: "book-ranker",
      query,
      results: [],
    };
  }

  const results = buildSiteCatalogResults(books)
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
