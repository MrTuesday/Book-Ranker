import type { Book } from "./books-api";

export const GLOBAL_MEAN = 3.8;
export const MAX_SMOOTHING_FACTOR = 1000;
export const SMOOTHING_FACTOR = 0;
export const BAYESIAN_SIGNAL_WEIGHT = 1 / 4;
export const AUTHOR_SIGNAL_WEIGHT = 1 / 4;
export const GENRE_SIGNAL_WEIGHT = 1 / 4;
export const SERIES_SIGNAL_WEIGHT = 1 / 4;
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
  const smoothingFactor = Math.max(0, m);
  const denominator = v + smoothingFactor;

  if (denominator <= 0) {
    return C;
  }

  return (v / denominator) * R + (smoothingFactor / denominator) * C;
}

function clampSmoothingFactor(value: number) {
  return Math.max(0, Math.min(MAX_SMOOTHING_FACTOR, value));
}

/**
 * Use the book's niche-est scored genre as the Bayesian smoothing factor.
 */
export function buildTagSmoothingFactorMap(
  books: Pick<Book, "id" | "genres" | "ratingCount">[],
  genreInterests: Record<string, number>,
  fallback = SMOOTHING_FACTOR,
) {
  const clampedFallback = clampSmoothingFactor(fallback);
  const genreStats = new Map<string, { totalRatings: number; count: number }>();

  for (const book of books) {
    const ratingCount = book.ratingCount;

    if (ratingCount == null || !Number.isFinite(ratingCount)) {
      continue;
    }

    for (const genre of new Set(book.genres)) {
      if (genreInterests[genre] == null) {
        continue;
      }

      const current = genreStats.get(genre) ?? { totalRatings: 0, count: 0 };
      current.totalRatings += ratingCount;
      current.count += 1;
      genreStats.set(genre, current);
    }
  }

  const genreAverages = new Map<string, number>();

  for (const [genre, stats] of genreStats) {
    if (stats.count > 0) {
      genreAverages.set(genre, stats.totalRatings / stats.count);
    }
  }

  return new Map(
    books.map((book) => {
      const nicheGenreAverages = Array.from(new Set(book.genres))
        .filter((genre) => genreInterests[genre] != null)
        .map((genre) => genreAverages.get(genre))
        .filter((value): value is number => value != null && Number.isFinite(value));
      const smoothingFactor =
        nicheGenreAverages.length > 0
          ? Math.min(...nicheGenreAverages)
          : clampedFallback;

      return [book.id, clampSmoothingFactor(smoothingFactor)] as const;
    }),
  );
}

export function compositeScore(bayesian: number, ...inputs: number[]) {
  const values = [bayesian, ...inputs];
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type SignalWeights = {
  bayesian: number;
  author: number;
  genre: number;
  series: number;
};

export type PredictiveWeightSample = {
  bayesian: number;
  author: number | null;
  genre: number | null;
  series: number | null;
  genreWeightScale: number;
  target: number;
};

const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  bayesian: BAYESIAN_SIGNAL_WEIGHT,
  author: AUTHOR_SIGNAL_WEIGHT,
  genre: GENRE_SIGNAL_WEIGHT,
  series: SERIES_SIGNAL_WEIGHT,
};

const MIN_ADAPTIVE_WEIGHT_SAMPLES = 3;
const WEIGHT_SEARCH_STEP = 0.05;
const ADAPTIVE_WEIGHT_PRIOR_SAMPLES = 12;

function blendSignalWeights(
  defaults: SignalWeights,
  learned: SignalWeights,
  blend: number,
) {
  return {
    bayesian:
      defaults.bayesian + (learned.bayesian - defaults.bayesian) * blend,
    author: defaults.author + (learned.author - defaults.author) * blend,
    genre: defaults.genre + (learned.genre - defaults.genre) * blend,
    series: defaults.series + (learned.series - defaults.series) * blend,
  };
}

function weightDistance(left: SignalWeights, right: SignalWeights) {
  return (
    (left.bayesian - right.bayesian) ** 2 +
    (left.author - right.author) ** 2 +
    (left.genre - right.genre) ** 2 +
    (left.series - right.series) ** 2
  );
}

export function learnSignalWeights(
  samples: PredictiveWeightSample[],
  defaults = DEFAULT_SIGNAL_WEIGHTS,
) {
  if (samples.length < MIN_ADAPTIVE_WEIGHT_SAMPLES) {
    return defaults;
  }

  let bestWeights = defaults;
  let bestLoss = Number.POSITIVE_INFINITY;
  let bestDistance = 0;
  const steps = Math.round(1 / WEIGHT_SEARCH_STEP);

  for (let bayesianStep = 0; bayesianStep <= steps; bayesianStep += 1) {
    const bayesian = bayesianStep * WEIGHT_SEARCH_STEP;

    for (
      let authorStep = 0;
      authorStep <= steps - bayesianStep;
      authorStep += 1
    ) {
      const author = authorStep * WEIGHT_SEARCH_STEP;
      for (
        let genreStep = 0;
        genreStep <= steps - bayesianStep - authorStep;
        genreStep += 1
      ) {
        const genre = genreStep * WEIGHT_SEARCH_STEP;
        const series = 1 - bayesian - author - genre;

        if (series < 0) {
          continue;
        }

        const candidate = { bayesian, author, genre, series };
        const loss =
          samples.reduce((total, sample) => {
            const prediction = predictiveScore(
              sample.bayesian,
              sample.author,
              sample.genre,
              sample.series,
              candidate,
              sample.genreWeightScale,
            );
            const error = prediction - sample.target;

            return total + error ** 2;
          }, 0) / samples.length;
        const distance = weightDistance(candidate, defaults);

        if (
          loss < bestLoss ||
          (Math.abs(loss - bestLoss) < 1e-9 && distance < bestDistance)
        ) {
          bestWeights = candidate;
          bestLoss = loss;
          bestDistance = distance;
        }
      }
    }
  }

  const learnedWeight = samples.length / (samples.length + ADAPTIVE_WEIGHT_PRIOR_SAMPLES);

  return blendSignalWeights(defaults, bestWeights, learnedWeight);
}

export function predictiveScore(
  bayesian: number,
  authorPref: number | null,
  genrePref: number | null,
  seriesPref: number | null,
  weights = DEFAULT_SIGNAL_WEIGHTS,
  genreWeightScale = 1,
) {
  let weightedTotal = bayesian * weights.bayesian;
  let totalWeight = weights.bayesian;

  if (authorPref != null) {
    weightedTotal += authorPref * weights.author;
    totalWeight += weights.author;
  }

  if (genrePref != null) {
    const effectiveGenreWeight = weights.genre * Math.max(1, genreWeightScale);

    weightedTotal += genrePref * effectiveGenreWeight;
    totalWeight += effectiveGenreWeight;
  }

  if (seriesPref != null) {
    weightedTotal += seriesPref * weights.series;
    totalWeight += weights.series;
  }

  if (totalWeight <= 0) {
    return bayesian;
  }

  return weightedTotal / totalWeight;
}

type AverageTagPreferenceOptions = {
  excludeMissing?: boolean;
  fallback?: number | null;
};

export function averageTagPreference(
  tags: string[],
  scores: Record<string, number>,
  options: AverageTagPreferenceOptions = {},
) {
  const excludeMissing = options.excludeMissing ?? false;
  const fallback =
    options.fallback !== undefined ? options.fallback : excludeMissing ? null : 3;

  if (tags.length === 0) {
    return fallback;
  }

  let total = 0;
  let count = 0;

  for (const tag of tags) {
    if (scores[tag] != null) {
      total += scores[tag];
      count += 1;
      continue;
    }

    if (!excludeMissing && fallback != null) {
      total += fallback;
      count += 1;
    }
  }

  if (count === 0) {
    return fallback;
  }

  return total / count;
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
  authorPref: number | null,
  genrePref: number | null,
  seriesPref: number | null,
  genreWeightScale: number,
  myRating?: number,
  progress?: number,
  readCount = 0,
  signalWeights = DEFAULT_SIGNAL_WEIGHTS,
) {
  const predictive = predictiveScore(
    bayesian,
    authorPref,
    genrePref,
    seriesPref,
    signalWeights,
    genreWeightScale,
  );

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
