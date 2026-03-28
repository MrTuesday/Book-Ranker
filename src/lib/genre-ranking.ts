import type { Book, GenreInterestMap } from "./books-api";

export type GenreLibraryMetrics = {
  bookCount: number;
  connectivity: number;
};

function uniqueTags(values: Iterable<string>) {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function buildGenreLibraryMetrics(books: Pick<Book, "genres">[]) {
  const bookCounts = new Map<string, number>();
  const connectivity = new Map<string, number>();

  for (const book of books) {
    const genres = uniqueTags(book.genres);

    for (const genre of genres) {
      bookCounts.set(genre, (bookCounts.get(genre) ?? 0) + 1);
      connectivity.set(genre, connectivity.get(genre) ?? 0);
    }

    for (let index = 0; index < genres.length; index += 1) {
      for (
        let pairIndex = index + 1;
        pairIndex < genres.length;
        pairIndex += 1
      ) {
        const left = genres[index];
        const right = genres[pairIndex];

        connectivity.set(left, (connectivity.get(left) ?? 0) + 1);
        connectivity.set(right, (connectivity.get(right) ?? 0) + 1);
      }
    }
  }

  const metrics = new Map<string, GenreLibraryMetrics>();
  const genres = new Set([...bookCounts.keys(), ...connectivity.keys()]);

  for (const genre of genres) {
    metrics.set(genre, {
      bookCount: bookCounts.get(genre) ?? 0,
      connectivity: connectivity.get(genre) ?? 0,
    });
  }

  return metrics;
}

export function compareRankedGenres(
  left: string,
  right: string,
  genreInterests: GenreInterestMap,
  genreMetrics: Map<string, GenreLibraryMetrics>,
) {
  const leftScore = genreInterests[left];
  const rightScore = genreInterests[right];
  const leftMetrics = genreMetrics.get(left);
  const rightMetrics = genreMetrics.get(right);

  return (
    Number(rightScore != null) - Number(leftScore != null) ||
    (rightScore ?? Number.NEGATIVE_INFINITY) -
      (leftScore ?? Number.NEGATIVE_INFINITY) ||
    (rightMetrics?.bookCount ?? 0) - (leftMetrics?.bookCount ?? 0) ||
    left.localeCompare(right)
  );
}

export function rankGenreTags(
  tags: Iterable<string>,
  genreInterests: GenreInterestMap,
  genreMetrics: Map<string, GenreLibraryMetrics>,
) {
  return uniqueTags(tags).sort((left, right) =>
    compareRankedGenres(left, right, genreInterests, genreMetrics),
  );
}
