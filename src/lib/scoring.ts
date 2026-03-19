export const GLOBAL_MEAN = 3.8;
export const SMOOTHING_FACTOR = 500;
export const REREAD_DECAY = 0.65;
export const ARCHIVE_SCORE_FLOOR = 0.2;
export const ARCHIVE_COOLDOWN_YEARS = 10;

export function bayesianScore(R: number, v: number, C: number, m: number) {
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

export function compositeScore(bayesian: number, ...inputs: number[]) {
  const values = [bayesian, ...inputs];
  return values.reduce((a, b) => a + b, 0) / values.length;
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

export function archiveReadinessFromScore(score: number) {
  const normalizedScore = Math.max(0, Math.min(5, score));

  if (normalizedScore < 1.75) {
    return { label: "Not yet", tone: "not-yet" as const };
  }

  if (normalizedScore < 2.75) {
    return { label: "Soon", tone: "soon" as const };
  }

  if (normalizedScore < 3.5) {
    return { label: "Ready", tone: "ready" as const };
  }

  if (normalizedScore < 4.25) {
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
  const predictive = compositeScore(bayesian, authorPref, genrePref);

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
