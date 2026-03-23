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
  scaleTagWeights,
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
};

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

function buildConnectionRatioMap(
  books: Pick<Book, "id" | "authors" | "genres" | "series">[],
) {
  const tagFrequency = new Map<string, number>();

  for (const book of books) {
    for (const author of book.authors) {
      tagFrequency.set(author, (tagFrequency.get(author) ?? 0) + 1);
    }
    for (const genre of book.genres) {
      tagFrequency.set(genre, (tagFrequency.get(genre) ?? 0) + 1);
    }
    if (book.series) {
      tagFrequency.set(book.series, (tagFrequency.get(book.series) ?? 0) + 1);
    }
  }

  let totalConnections = 0;
  const rawCounts = new Map<number, number>();

  for (const book of books) {
    let connections = 0;
    for (const author of book.authors) {
      connections += tagFrequency.get(author) ?? 0;
    }
    for (const genre of book.genres) {
      connections += tagFrequency.get(genre) ?? 0;
    }
    if (book.series) {
      connections += tagFrequency.get(book.series) ?? 0;
    }
    rawCounts.set(book.id, connections);
    totalConnections += connections;
  }

  const meanConnections =
    books.length > 0 ? totalConnections / books.length : 0;

  const connectionRatios = new Map<number, number>();
  for (const [id, count] of rawCounts) {
    connectionRatios.set(id, meanConnections > 0 ? count / meanConnections : 1);
  }

  return connectionRatios;
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
    right.predictiveRatingCount - left.predictiveRatingCount
  );
}

function finalizeRanks(books: ScoredBook[]) {
  return books.map(
    (
      {
        predictiveStarRating: _predictiveStarRating,
        predictiveRatingCount: _predictiveRatingCount,
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
  signalWeights: SignalWeights,
  connectionRatios: Map<number, number>,
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
      const bayesian = bayesianScore(
        predictiveBook.starRating ?? GLOBAL_MEAN,
        predictiveBook.ratingCount ?? 0,
        GLOBAL_MEAN,
        smoothingFactors.get(book.id) ?? SMOOTHING_FACTOR,
      );
      const scaledWeights = scaleTagWeights(
        signalWeights,
        connectionRatios.get(book.id) ?? 1,
      );
      const fullScore = scoreBook(
        bayesian,
        preferences.author,
        preferences.genre,
        preferences.series,
        book.myRating,
        book.progress,
        book.readCount ?? 0,
        scaledWeights,
      );

      if (!archiveMode) {
        return {
          ...book,
          predictiveStarRating: predictiveBook.starRating ?? 0,
          predictiveRatingCount: predictiveBook.ratingCount ?? 0,
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
  const connectionRatios = buildConnectionRatioMap(books);
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
          connectionRatio: connectionRatios.get(displayBook.id) ?? 1,
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
      signalWeights,
      connectionRatios,
    ),
    readBooks: buildRankedCollection(
      books.filter((book) => book.read),
      predictiveBooksById,
      genreInterests,
      authorExperiences,
      seriesExperiences,
      smoothingFactors,
      signalWeights,
      connectionRatios,
      true,
    ),
  };
}
