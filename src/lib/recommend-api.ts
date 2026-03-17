import type { AuthorExperienceMap, Book, GenreInterestMap } from "./books-api";
import { searchBooks, type BookSearchResult } from "./book-search";
import {
  GLOBAL_MEAN,
  bayesianScore,
} from "./scoring";

export type PathRecommendationRequest = {
  selectedTags: string[];
  profile: {
    books: Book[];
    genreInterests: GenreInterestMap;
    authorExperiences: AuthorExperienceMap;
  };
};

export type RecommendedBook = {
  id: string;
  title: string;
  authors: string[];
  genres: string[];
  averageRating?: number;
  ratingsCount?: number;
  description?: string;
  infoLink?: string;
  thumbnail?: string;
  score: number;
  tagOverlap: number;
};

export type PathRecommendationResponse = {
  bestMatch: RecommendedBook | null;
  candidates: RecommendedBook[];
  queries: string[];
  provider: "open-library";
};

function normalizeForMatch(s: string) {
  return s.toLocaleLowerCase().trim();
}

function bookAlreadyExists(
  candidate: BookSearchResult,
  existingBooks: Book[],
) {
  const candidateTitle = normalizeForMatch(candidate.title);
  const candidateAuthors = new Set(
    candidate.authors.map(normalizeForMatch),
  );

  return existingBooks.some((book) => {
    if (normalizeForMatch(book.title) !== candidateTitle) return false;
    if (candidateAuthors.size === 0 && book.authors.length === 0) return true;
    return book.authors.some((a) => candidateAuthors.has(normalizeForMatch(a)));
  });
}

/**
 * Count how many of the user's selected tags appear in the candidate's subjects.
 * Uses fuzzy substring matching since Open Library subjects are verbose
 * (e.g. "Science fiction" vs "Science Fiction" or "Dystopian fiction" vs "Dystopian").
 */
function countTagOverlap(
  candidateGenres: string[],
  selectedTags: string[],
): number {
  const candidateLower = candidateGenres.map(normalizeForMatch);
  let matches = 0;
  for (const tag of selectedTags) {
    const tagLower = normalizeForMatch(tag);
    const hit = candidateLower.some(
      (g) => g.includes(tagLower) || tagLower.includes(g),
    );
    if (hit) matches++;
  }
  return matches;
}

function scoreCandidate(
  candidate: BookSearchResult,
  selectedTags: string[],
  genreInterests: GenreInterestMap,
  authorExperiences: AuthorExperienceMap,
): RecommendedBook {
  // Use lower smoothing factor for Open Library's smaller rating counts
  const R = candidate.starRating ?? GLOBAL_MEAN;
  const v = candidate.ratingCount ?? 0;
  const bScore = bayesianScore(R, v, GLOBAL_MEAN, 50);

  // Author familiarity bonus
  const authorScores = candidate.authors.map(
    (a) => authorExperiences[a] ?? 3,
  );
  const authorPref =
    authorScores.length > 0
      ? authorScores.reduce((sum, s) => sum + s, 0) / authorScores.length
      : 3;

  // Genre interest match — average interest of candidate's genres the user cares about
  const genreScores = candidate.genres
    .map((g) => {
      // Try exact match first, then fuzzy
      if (genreInterests[g] != null) return genreInterests[g];
      const gLower = normalizeForMatch(g);
      for (const [key, val] of Object.entries(genreInterests)) {
        if (normalizeForMatch(key) === gLower) return val;
      }
      return null;
    })
    .filter((v): v is number => v != null);
  const genrePref =
    genreScores.length > 0
      ? genreScores.reduce((sum, s) => sum + s, 0) / genreScores.length
      : 3;

  // Tag overlap: how many selected tags does this book match?
  const tagOverlap = countTagOverlap(candidate.genres, selectedTags);
  const overlapRatio =
    selectedTags.length > 0 ? tagOverlap / selectedTags.length : 0;

  // Final score: weighted combination
  // - Bayesian rating quality: 30%
  // - Genre interest alignment: 25%
  // - Tag overlap with selection: 35% (this is the key signal)
  // - Author familiarity: 10%
  const score =
    bScore * 0.3 +
    genrePref * 0.25 +
    overlapRatio * 5 * 0.35 + // scale to 0-5 range
    authorPref * 0.1;

  return {
    id: `${candidate.title}::${candidate.authors.join(",")}`,
    title: candidate.title,
    authors: candidate.authors,
    genres: candidate.genres,
    averageRating: candidate.starRating,
    ratingsCount: candidate.ratingCount,
    description: candidate.description,
    infoLink: candidate.infoUrl,
    thumbnail: candidate.thumbnail,
    score,
    tagOverlap,
  };
}

export async function requestPathRecommendation(
  payload: PathRecommendationRequest,
): Promise<PathRecommendationResponse> {
  const { selectedTags, profile } = payload;

  const results = await searchBooks(selectedTags);

  const candidates = results
    .filter((r) => !bookAlreadyExists(r, profile.books))
    .map((r) =>
      scoreCandidate(
        r,
        selectedTags,
        profile.genreInterests,
        profile.authorExperiences,
      ),
    )
    .sort((a, b) => b.score - a.score);

  return {
    bestMatch: candidates[0] ?? null,
    candidates,
    queries: selectedTags,
    provider: "open-library",
  };
}
