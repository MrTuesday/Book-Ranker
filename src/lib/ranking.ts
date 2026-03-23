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
    right.scoredTagCount - left.scoredTagCount ||
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
        scoredTagCount: _scoredTagCount,
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
      const fullScore = scoreBook(
        bayesian,
        preferences.author,
        preferences.genre,
        preferences.series,
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
          scoredTagCount: countScoredTagsForBook(
            book,
            authorExperiences,
            genreInterests,
            seriesExperiences,
          ),
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
        scoredTagCount: countScoredTagsForBook(
          book,
          authorExperiences,
          genreInterests,
          seriesExperiences,
        ),
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
    ),
    readBooks: buildRankedCollection(
      books.filter((book) => book.read),
      predictiveBooksById,
      genreInterests,
      authorExperiences,
      seriesExperiences,
      smoothingFactors,
      signalWeights,
      true,
    ),
  };
}
