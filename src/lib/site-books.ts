import type { Book } from "./books-api";

export type SiteBookAggregate = {
  id: string;
  title: string;
  authors: string[];
  genres: string[];
  averageRating?: number;
  ratingsCount?: number;
  hasUnreadEntry: boolean;
  sourceBookIds: number[];
};

function normalizeIdentityPart(value: string) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function buildRatingStats(books: Book[]) {
  const ratings = books.flatMap((book) =>
    book.myRating != null && Number.isFinite(book.myRating) ? [Number(book.myRating)] : [],
  );

  if (ratings.length === 0) {
    return {};
  }

  const total = ratings.reduce((sum, rating) => sum + rating, 0);

  return {
    averageRating: Number((total / ratings.length).toFixed(2)),
    ratingsCount: ratings.length,
  };
}

export function buildBookIdentityKey(book: Pick<Book, "title" | "authors">) {
  const title = normalizeIdentityPart(book.title);
  const authors = uniqueStrings(book.authors)
    .map(normalizeIdentityPart)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  return `${title}::${authors}`;
}

export function buildSiteBookAggregates(books: Book[]): SiteBookAggregate[] {
  const groupedBooks = new Map<string, Book[]>();

  for (const book of books) {
    const identityKey = buildBookIdentityKey(book);

    if (!identityKey) {
      continue;
    }

    const currentGroup = groupedBooks.get(identityKey) ?? [];
    currentGroup.push(book);
    groupedBooks.set(identityKey, currentGroup);
  }

  return Array.from(groupedBooks.entries())
    .map(([identityKey, grouped]) => {
      const representative = grouped[0];
      const genres = uniqueStrings(grouped.flatMap((book) => book.genres));
      const ratingStats = buildRatingStats(grouped);

      return {
        id: `site:${identityKey}`,
        title: representative.title,
        authors: [...representative.authors],
        genres,
        ...ratingStats,
        hasUnreadEntry: grouped.some((book) => !book.read),
        sourceBookIds: grouped.map((book) => book.id),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function applySiteRatingStats(books: Book[]) {
  const ratingStatsByIdentity = new Map(
    buildSiteBookAggregates(books).map((aggregate) => [
      buildBookIdentityKey({
        title: aggregate.title,
        authors: aggregate.authors,
      }),
      {
        averageRating: aggregate.averageRating,
        ratingsCount: aggregate.ratingsCount,
      },
    ]),
  );

  return books.map((book) => {
    const nextBook: Book = {
      ...book,
      authors: [...book.authors],
      genres: [...book.genres],
      moods: [...book.moods],
    };
    const ratingStats = ratingStatsByIdentity.get(buildBookIdentityKey(book));

    if (ratingStats?.ratingsCount != null) {
      nextBook.starRating = ratingStats.averageRating;
      nextBook.ratingCount = ratingStats.ratingsCount;
    } else {
      delete nextBook.starRating;
      delete nextBook.ratingCount;
    }

    delete nextBook.catalogInfoLink;
    delete nextBook.statsUpdatedAt;

    return nextBook;
  });
}
