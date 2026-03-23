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
  type ConnectionRatios,
  DEFAULT_CONNECTION_RATIOS,
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
  const authorFrequency = new Map<string, number>();
  const genreFrequency = new Map<string, number>();
  const seriesFrequency = new Map<string, number>();

  for (const book of books) {
    for (const author of book.authors) {
      authorFrequency.set(author, (authorFrequency.get(author) ?? 0) + 1);
    }
    for (const genre of book.genres) {
      genreFrequency.set(genre, (genreFrequency.get(genre) ?? 0) + 1);
    }
    if (book.series) {
      seriesFrequency.set(
        book.series,
        (seriesFrequency.get(book.series) ?? 0) + 1,
      );
    }
  }

  const rawCounts = new Map<
    number,
    { author: number; genre: number; series: number }
  >();
  let totalAuthor = 0;
  let totalGenre = 0;
  let totalSeries = 0;

  for (const book of books) {
    let authorConns = 0;
    for (const author of book.authors) {
      authorConns += authorFrequency.get(author) ?? 0;
    }
    let genreConns = 0;
    for (const genre of book.genres) {
      genreConns += genreFrequency.get(genre) ?? 0;
    }
    let seriesConns = 0;
    if (book.series) {
      seriesConns += seriesFrequency.get(book.series) ?? 0;
    }
    rawCounts.set(book.id, {
      author: authorConns,
      genre: genreConns,
      series: seriesConns,
    });
    totalAuthor += authorConns;
    totalGenre += genreConns;
    totalSeries += seriesConns;
  }

  const n = books.length;
  const meanAuthor = n > 0 ? totalAuthor / n : 0;
  const meanGenre = n > 0 ? totalGenre / n : 0;
  const meanSeries = n > 0 ? totalSeries / n : 0;

  const connectionRatios = new Map<number, ConnectionRatios>();
  for (const [id, counts] of rawCounts) {
    connectionRatios.set(id, {
      author: meanAuthor > 0 ? counts.author / meanAuthor : 1,
      genre: meanGenre > 0 ? counts.genre / meanGenre : 1,
      series: meanSeries > 0 ? counts.series / meanSeries : 1,
    });
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
  connectionRatios: Map<number, ConnectionRatios>,
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
        connectionRatios.get(book.id) ?? DEFAULT_CONNECTION_RATIOS,
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
          connectionRatios: connectionRatios.get(displayBook.id) ?? DEFAULT_CONNECTION_RATIOS,
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
