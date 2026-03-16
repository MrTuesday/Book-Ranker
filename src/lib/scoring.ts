export const GLOBAL_MEAN = 3.8;
export const SMOOTHING_FACTOR = 500;

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

/**
 * Score a book by blending the predictive score (from public ratings and
 * user preference signals) with the personal rating weighted by reading
 * progress.
 *
 * - Read portion (progress %) → myRating (personal experience)
 * - Unread portion (1 − progress %) → predictive score
 * - No myRating → pure predictive score
 * - myRating without progress → assume fully read (100%)
 */
export function scoreBook(
  bayesian: number,
  authorPref: number,
  genrePrefs: number[],
  myRating?: number,
  progress?: number,
) {
  const predictive = compositeScore(bayesian, authorPref, ...genrePrefs);

  if (myRating == null) {
    return predictive;
  }

  const t = (progress ?? 100) / 100;
  return t * myRating + (1 - t) * predictive;
}
