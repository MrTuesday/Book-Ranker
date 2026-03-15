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
 * Score a book from its Bayesian rating and user preference signals.
 * myRating is NOT included here — it's used to calibrate the model
 * (e.g. adjusting genre interest weights) rather than as a direct input.
 */
export function scoreBook(
  bayesian: number,
  authorPref: number,
  genrePrefs: number[],
) {
  return compositeScore(bayesian, authorPref, ...genrePrefs);
}

/**
 * Build calibrated genre interests by blending stated interests with
 * actual personal ratings. This lets myRating influence all scores
 * indirectly by adjusting the genre interest map.
 */
export function calibrateGenreInterests(
  baseInterests: Record<string, number>,
  books: Array<{ genres: string[]; myRating?: number }>,
): Record<string, number> {
  // Collect myRatings per genre
  const genreRatings: Record<string, number[]> = {};
  for (const book of books) {
    if (book.myRating == null) continue;
    for (const genre of book.genres) {
      if (!genreRatings[genre]) genreRatings[genre] = [];
      genreRatings[genre].push(book.myRating);
    }
  }

  // Blend: 60% stated interest + 40% average myRating for that genre
  const calibrated = { ...baseInterests };
  for (const [genre, ratings] of Object.entries(genreRatings)) {
    const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const stated = baseInterests[genre] ?? 3;
    calibrated[genre] = stated * 0.6 + avgRating * 0.4;
  }

  return calibrated;
}
