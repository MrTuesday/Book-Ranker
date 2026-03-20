import type { Book } from "./books-api";

export const GLOBAL_MEAN = 3.8;
export const SMOOTHING_FACTOR = 500;
export const MIN_SMOOTHING_FACTOR = 100;
export const BAYESIAN_SIGNAL_WEIGHT = 0.5;
export const AUTHOR_SIGNAL_WEIGHT = 0.25;
export const GENRE_SIGNAL_WEIGHT = 0.25;
export const REREAD_DECAY = 0.65;
export const ARCHIVE_SCORE_FLOOR = 0.2;
export const ARCHIVE_COOLDOWN_YEARS = 10;
export const ARCHIVE_NOT_YET_MAX = 1.75;
export const ARCHIVE_SOON_MAX = 2.75;
export const ARCHIVE_READY_MAX = 3.5;
export const ARCHIVE_DUE_MAX = 4.25;
export const ARCHIVE_AVOID_MAX =
  ARCHIVE_DUE_MAX * ARCHIVE_SCORE_FLOOR - 0.01;

export function bayesianScore(R: number, v: number, C: number, m: number) {
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(
      tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    ),
  );
}

function average(values: number[]) {
  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clampSmoothingFactor(value: number) {
  return Math.max(MIN_SMOOTHING_FACTOR, value);
}

/**
 * Derive a smoothing factor for each saved book from the books that share at
 * least one genre/topic tag. Archived books remain in the pool so niche
 * clusters can establish their own local baseline while the Bayesian mean
 * stays anchored to the global default.
 */
export function buildTagSmoothingFactorMap(
  books: Pick<Book, "id" | "genres" | "ratingCount">[],
  fallback = SMOOTHING_FACTOR,
) {
  const tagIndex = new Map<string, Pick<Book, "id" | "ratingCount">[]>();
  const normalizedBooks = books.map((book) => {
    const tags = normalizeTags(book.genres);

    for (const tag of tags) {
      const matches = tagIndex.get(tag);

      if (matches) {
        matches.push(book);
      } else {
        tagIndex.set(tag, [book]);
      }
    }

    return {
      id: book.id,
      tags,
    };
  });

  const globalSmoothingAverage = average(
    books.flatMap((book) =>
      book.ratingCount != null && book.ratingCount >= 0 ? [book.ratingCount] : [],
    ),
  );
  const defaultSmoothingFactor = clampSmoothingFactor(
    globalSmoothingAverage ?? fallback,
  );

  return new Map(
    normalizedBooks.map(({ id, tags }) => {
      if (tags.length === 0) {
        return [id, defaultSmoothingFactor] as const;
      }

      const matchedBookIds = new Set<number>();
      const matchedCounts: number[] = [];

      for (const tag of tags) {
        for (const book of tagIndex.get(tag) ?? []) {
          if (matchedBookIds.has(book.id)) {
            continue;
          }

          matchedBookIds.add(book.id);

          if (book.ratingCount != null && book.ratingCount >= 0) {
            matchedCounts.push(book.ratingCount);
          }
        }
      }

      return [
        id,
        clampSmoothingFactor(average(matchedCounts) ?? defaultSmoothingFactor),
      ] as const;
    }),
  );
}

export function compositeScore(bayesian: number, ...inputs: number[]) {
  const values = [bayesian, ...inputs];
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function predictiveScore(
  bayesian: number,
  authorPref: number,
  genrePref: number,
) {
  const weightedTotal =
    bayesian * BAYESIAN_SIGNAL_WEIGHT +
    authorPref * AUTHOR_SIGNAL_WEIGHT +
    genrePref * GENRE_SIGNAL_WEIGHT;
  const totalWeight =
    BAYESIAN_SIGNAL_WEIGHT + AUTHOR_SIGNAL_WEIGHT + GENRE_SIGNAL_WEIGHT;

  return weightedTotal / totalWeight;
}

export function averageTagPreference(
  tags: string[],
  scores: Record<string, number>,
) {
  if (tags.length === 0) {
    return 3;
  }

  return (
    tags.reduce((total, tag) => total + (scores[tag] ?? 3), 0) / tags.length
  );
}

export function tagPreferences(
  tags: string[],
  scores: Record<string, number>,
) {
  if (tags.length === 0) {
    return [3];
  }

  return tags.map((tag) => scores[tag] ?? 3);
}

function decayedReadWeight(readCount: number, decay = REREAD_DECAY) {
  if (readCount <= 0) {
    return 0;
  }

  if (decay <= 0) {
    return 1;
  }

  if (decay === 1) {
    return readCount;
  }

  return (1 - decay ** readCount) / (1 - decay);
}

export function resolveLastReadYear(
  lastReadYear?: number,
  archivedAtYear?: number,
  referenceDate = new Date(),
) {
  return lastReadYear ?? archivedAtYear ?? referenceDate.getFullYear();
}

export function archiveRealizationFactor(
  lastReadYear?: number,
  archivedAtYear?: number,
  referenceDate = new Date(),
) {
  const currentYear = referenceDate.getFullYear();
  const effectiveYear = resolveLastReadYear(
    lastReadYear,
    archivedAtYear,
    referenceDate,
  );
  const yearsElapsed = Math.max(0, currentYear - effectiveYear);
  const realizedShare = Math.min(yearsElapsed / ARCHIVE_COOLDOWN_YEARS, 1);

  return ARCHIVE_SCORE_FLOOR + (1 - ARCHIVE_SCORE_FLOOR) * realizedShare;
}

export function realizeArchiveScore(
  score: number,
  lastReadYear?: number,
  archivedAtYear?: number,
  referenceDate = new Date(),
) {
  return (
    score *
    archiveRealizationFactor(lastReadYear, archivedAtYear, referenceDate)
  );
}

export function capArchiveScore(realizedScore: number, fullScore: number) {
  if (fullScore < ARCHIVE_DUE_MAX) {
    return Math.min(realizedScore, ARCHIVE_AVOID_MAX);
  }

  return realizedScore;
}

export function archiveReadinessFromScores(
  realizedScore: number,
  fullScore: number,
) {
  if (fullScore < ARCHIVE_DUE_MAX) {
    return { label: "Avoid", tone: "avoid" as const };
  }

  const normalizedScore = Math.max(0, Math.min(5, realizedScore));

  if (normalizedScore < ARCHIVE_NOT_YET_MAX) {
    return { label: "Not yet", tone: "not-yet" as const };
  }

  if (normalizedScore < ARCHIVE_SOON_MAX) {
    return { label: "Soon", tone: "soon" as const };
  }

  if (normalizedScore < ARCHIVE_READY_MAX) {
    return { label: "Ready", tone: "ready" as const };
  }

  if (normalizedScore < ARCHIVE_DUE_MAX) {
    return { label: "Due", tone: "due" as const };
  }

  return { label: "Overdue", tone: "overdue" as const };
}

/**
 * Score a book by blending the predictive score (from public ratings and
 * user preference signals) with the personal rating weighted first by current
 * reading progress, then further by prior full reads.
 *
 * Base score:
 * - 1 portion → predictive score
 * - progress % portion → myRating (current experience)
 * - current progress tilts the base toward myRating without removing
 *   predictive scoring entirely
 *
 * Final score:
 * - 0 prior reads → base score
 * - R prior reads → a decayed reread weight (1 + decay + decay² ...)
 * - decayed reread weight → myRating (personal experience)
 * - 1 portion → base score
 * - No myRating → pure predictive score
 */
export function scoreBook(
  bayesian: number,
  authorPref: number,
  genrePref: number,
  myRating?: number,
  progress?: number,
  readCount = 0,
) {
  const predictive = predictiveScore(bayesian, authorPref, genrePref);

  if (myRating == null) {
    return predictive;
  }

  const progressWeight = Math.max(0, Math.min(100, progress ?? 0)) / 100;
  const baseScore = (predictive + progressWeight * myRating) / (1 + progressWeight);

  if (readCount <= 0) {
    return baseScore;
  }

  const rereadWeight = decayedReadWeight(readCount);
  return (rereadWeight * myRating + baseScore) / (rereadWeight + 1);
}
