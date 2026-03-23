import type {
  AuthorExperienceMap,
  Book,
  GenreInterestMap,
  SeriesExperienceMap,
} from "./books-api";
import {
  archiveReadinessFromScores,
  averageTagPreference,
  bayesianScore,
  buildTagSmoothingFactorMap,
  capArchiveScore,
  GLOBAL_MEAN,
  learnSignalWeights,
  realizeArchiveScore,
  scoreBook,
  SMOOTHING_FACTOR,
  type SignalWeights,
} from "./scoring";

export type RankedBook = Book & {
  score: number;
  rank: number;
  archiveLabel?: string;
};

type BookAnalyticsOptions = {
  books: Book[];
  genreInterests: GenreInterestMap;
  authorExperiences: AuthorExperienceMap;
  seriesExperiences: SeriesExperienceMap;
};

type ScoredBook = RankedBook & {
  predictiveStarRating: number;
  predictiveRatingCount: number;
  scoredTagCount: number;
  connectedTagPairCount: number;
};

const GENRE_CONNECTION_SCALE_BOOST = 0.5;
const GENRE_CONNECTION_SCALE_RATE = 0.7;

export type BookAnalytics = {
  predictiveBooks: Book[];
  signalWeights: SignalWeights;
  rankedBooks: RankedBook[];
  readBooks: RankedBook[];
};

function buildPredictiveBook(book: Book): Book {
  const rating = book.myRating;
  const averageRating = book.starRating;
  const ratingsCount = book.ratingCount;

  if (
    rating == null ||
    averageRating == null ||
    ratingsCount == null ||
    !Number.isFinite(averageRating) ||
    !Number.isFinite(ratingsCount) ||
    ratingsCount <= 0
  ) {
    return book;
  }

  const predictiveCount = Math.max(0, ratingsCount - 1);

  if (predictiveCount === 0) {
    const nextBook: Book = {
      ...book,
      authors: [...book.authors],
      genres: [...book.genres],
      moods: [...book.moods],
    };

    delete nextBook.starRating;
    delete nextBook.ratingCount;
    return nextBook;
  }

  const predictiveAverage =
    (averageRating * ratingsCount - rating) / predictiveCount;

  return {
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
    moods: [...book.moods],
    starRating: Number(predictiveAverage.toFixed(2)),
    ratingCount: predictiveCount,
  };
}

function countScoredTagsForBook(
  book: Pick<Book, "authors" | "genres" | "series">,
  authorExperiences: AuthorExperienceMap,
  genreInterests: GenreInterestMap,
  seriesExperiences: SeriesExperienceMap,
) {
  const scoredAuthors = new Set(
    book.authors.filter((author) => authorExperiences[author] != null),
  ).size;
  const scoredGenres = new Set(
    book.genres.filter((genre) => genreInterests[genre] != null),
  ).size;
  const scoredSeries =
    book.series && seriesExperiences[book.series] != null ? 1 : 0;

  return scoredAuthors + scoredGenres + scoredSeries;
}

function uniqueScoredGenres(
  book: Pick<Book, "genres">,
  genreInterests: GenreInterestMap,
) {
  return Array.from(
    new Set(book.genres.filter((genre) => genreInterests[genre] != null)),
  );
}

function buildGenrePairKey(left: string, right: string) {
  return left.localeCompare(right) <= 0
    ? `${left}\u0000${right}`
    : `${right}\u0000${left}`;
}

function buildGenreConnectionCountMap(
  books: Pick<Book, "genres">[],
  genreInterests: GenreInterestMap,
) {
  const pairCounts = new Map<string, number>();

  for (const book of books) {
    const genres = uniqueScoredGenres(book, genreInterests);

    for (let index = 0; index < genres.length; index += 1) {
      for (
        let pairIndex = index + 1;
        pairIndex < genres.length;
        pairIndex += 1
      ) {
        const key = buildGenrePairKey(genres[index], genres[pairIndex]);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return pairCounts;
}

function buildGenreConnectionMetrics(
  book: Pick<Book, "genres">,
  genreInterests: GenreInterestMap,
  pairCounts: Map<string, number>,
) {
  const genres = uniqueScoredGenres(book, genreInterests);

  if (genres.length < 2) {
    return {
      connectedPairCount: 0,
      genreWeightScale: 1,
    };
  }

  let connectedPairCount = 0;
  const possiblePairCount = (genres.length * (genres.length - 1)) / 2;

  for (let index = 0; index < genres.length; index += 1) {
    for (let pairIndex = index + 1; pairIndex < genres.length; pairIndex += 1) {
      const key = buildGenrePairKey(genres[index], genres[pairIndex]);
      const supportingConnections = Math.max(0, (pairCounts.get(key) ?? 0) - 1);

      if (supportingConnections > 0) {
        connectedPairCount += 1;
      }
    }
  }

  if (connectedPairCount <= 0 || possiblePairCount <= 0) {
    return {
      connectedPairCount: 0,
      genreWeightScale: 1,
    };
  }

  const connectionDensity = connectedPairCount / possiblePairCount;
  const connectionStrength =
    1 - Math.exp(-GENRE_CONNECTION_SCALE_RATE * connectedPairCount);

  return {
    connectedPairCount,
    genreWeightScale:
      1 + GENRE_CONNECTION_SCALE_BOOST * connectionDensity * connectionStrength,
  };
}

function buildPreferenceSignals(
  book: Book,
  authorExperiences: AuthorExperienceMap,
  genreInterests: GenreInterestMap,
  seriesExperiences: SeriesExperienceMap,
) {
  return {
    author: averageTagPreference(book.authors, authorExperiences, {
      excludeMissing: true,
    }),
    genre: averageTagPreference(book.genres, genreInterests, {
      excludeMissing: true,
    }),
    series: averageTagPreference(
      book.series ? [book.series] : [],
      seriesExperiences,
      {
        excludeMissing: true,
      },
    ),
  };
}

function sortScoredBooks(left: ScoredBook, right: ScoredBook) {
  return (
    right.score - left.score ||
    right.predictiveStarRating - left.predictiveStarRating ||
    right.predictiveRatingCount - left.predictiveRatingCount ||
    right.connectedTagPairCount - left.connectedTagPairCount ||
    right.scoredTagCount - left.scoredTagCount
  );
}

function finalizeRanks(books: ScoredBook[]) {
  return books.map(
    (
      {
        predictiveStarRating: _predictiveStarRating,
        predictiveRatingCount: _predictiveRatingCount,
        scoredTagCount: _scoredTagCount,
        connectedTagPairCount: _connectedTagPairCount,
        ...book
      },
      index,
    ) => ({
      ...book,
      rank: index + 1,
    }),
  );
}

function buildRankedCollection(
  sourceBooks: Book[],
  predictiveBooksById: Map<number, Book>,
  genreInterests: GenreInterestMap,
  authorExperiences: AuthorExperienceMap,
  seriesExperiences: SeriesExperienceMap,
  smoothingFactors: Map<number, number>,
  genrePairCounts: Map<string, number>,
  signalWeights: SignalWeights,
  archiveMode = false,
) {
  const scoredBooks: ScoredBook[] = sourceBooks
    .map((book) => {
      const predictiveBook = predictiveBooksById.get(book.id) ?? book;
      const preferences = buildPreferenceSignals(
        book,
        authorExperiences,
        genreInterests,
        seriesExperiences,
      );
      const connectionCount = countScoredTagsForBook(
        book,
        authorExperiences,
        genreInterests,
        seriesExperiences,
      );
      const genreConnection = buildGenreConnectionMetrics(
        book,
        genreInterests,
        genrePairCounts,
      );
      const bayesian = bayesianScore(
        predictiveBook.starRating ?? GLOBAL_MEAN,
        predictiveBook.ratingCount ?? 0,
        GLOBAL_MEAN,
        smoothingFactors.get(book.id) ?? SMOOTHING_FACTOR,
      );
      const fullScore = scoreBook(
        bayesian,
        preferences.author,
        preferences.genre,
        preferences.series,
        genreConnection.genreWeightScale,
        book.myRating,
        book.progress,
        book.readCount ?? 0,
        signalWeights,
      );

      if (!archiveMode) {
        return {
          ...book,
          predictiveStarRating: predictiveBook.starRating ?? 0,
          predictiveRatingCount: predictiveBook.ratingCount ?? 0,
          scoredTagCount: connectionCount,
          connectedTagPairCount: genreConnection.connectedPairCount,
          score: fullScore,
          rank: 0,
        };
      }

      const realizedScore = realizeArchiveScore(
        fullScore,
        book.lastReadYear,
        book.archivedAtYear,
      );
      const score = capArchiveScore(realizedScore, fullScore);
      const archiveReadiness = archiveReadinessFromScores(score, fullScore);

      return {
        ...book,
        predictiveStarRating: predictiveBook.starRating ?? 0,
        predictiveRatingCount: predictiveBook.ratingCount ?? 0,
        scoredTagCount: connectionCount,
        connectedTagPairCount: genreConnection.connectedPairCount,
        score,
        archiveLabel: archiveReadiness.label,
        rank: 0,
      };
    })
    .sort(sortScoredBooks);

  return finalizeRanks(scoredBooks);
}

export function buildBookAnalytics({
  books,
  genreInterests,
  authorExperiences,
  seriesExperiences,
}: BookAnalyticsOptions): BookAnalytics {
  const predictiveBooks = books.map(buildPredictiveBook);
  const predictiveBooksById = new Map(
    predictiveBooks.map((book) => [book.id, book] as const),
  );
  const smoothingFactors = buildTagSmoothingFactorMap(
    predictiveBooks,
    genreInterests,
  );
  const genrePairCounts = buildGenreConnectionCountMap(predictiveBooks, genreInterests);
  const signalWeights = learnSignalWeights(
    books.flatMap((displayBook) => {
      if (displayBook.myRating == null) {
        return [];
      }

      const predictiveBook =
        predictiveBooksById.get(displayBook.id) ?? displayBook;
      const preferences = buildPreferenceSignals(
        displayBook,
        authorExperiences,
        genreInterests,
        seriesExperiences,
      );
      const genreConnection = buildGenreConnectionMetrics(
        displayBook,
        genreInterests,
        genrePairCounts,
      );
      const bayesian = bayesianScore(
        predictiveBook.starRating ?? GLOBAL_MEAN,
        predictiveBook.ratingCount ?? 0,
        GLOBAL_MEAN,
        smoothingFactors.get(displayBook.id) ?? SMOOTHING_FACTOR,
      );

      return [
        {
          bayesian,
          author: preferences.author,
          genre: preferences.genre,
          series: preferences.series,
          genreWeightScale: genreConnection.genreWeightScale,
          target: displayBook.myRating,
        },
      ];
    }),
  );

  return {
    predictiveBooks,
    signalWeights,
    rankedBooks: buildRankedCollection(
      books.filter((book) => !book.read),
      predictiveBooksById,
      genreInterests,
      authorExperiences,
      seriesExperiences,
      smoothingFactors,
      genrePairCounts,
      signalWeights,
    ),
    readBooks: buildRankedCollection(
      books.filter((book) => book.read),
      predictiveBooksById,
      genreInterests,
      authorExperiences,
      seriesExperiences,
      smoothingFactors,
      genrePairCounts,
      signalWeights,
      true,
    ),
  };
}
