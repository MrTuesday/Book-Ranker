import type { AuthorExperienceMap, Book, GenreInterestMap } from "./books-api";
import { searchGoogleBooks, type GoogleBooksResult } from "./google-books";
import {
  GLOBAL_MEAN,
  SMOOTHING_FACTOR,
  bayesianScore,
  averageTagPreference,
  tagPreferences,
  compositeScore,
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
  matchedSelectedTags: string[];
  matchedProfileGenres: string[];
  matchedAuthors: string[];
  breakdown: {
    bayesian: number;
    author: number;
    pathCoverage: number;
    pathInterest: number;
    genreMatches: number[];
  };
};

export type PathRecommendationResponse = {
  bestMatch: RecommendedBook | null;
  candidates: RecommendedBook[];
  queries: string[];
  provider: "google-books";
};

function normalizeForMatch(s: string) {
  return s.toLocaleLowerCase().trim();
}

function bookAlreadyExists(
  candidate: GoogleBooksResult,
  existingBooks: Book[],
) {
  const candidateTitle = normalizeForMatch(candidate.title);
  const candidateAuthors = new Set(
    candidate.authors.map(normalizeForMatch),
  );

  return existingBooks.some((book) => {
    if (normalizeForMatch(book.title) !== candidateTitle) return false;
    // Title matches — check if at least one author overlaps
    if (candidateAuthors.size === 0 && book.authors.length === 0) return true;
    return book.authors.some((a) => candidateAuthors.has(normalizeForMatch(a)));
  });
}

function scoreCandidate(
  candidate: GoogleBooksResult,
  selectedTags: string[],
  genreInterests: GenreInterestMap,
  authorExperiences: AuthorExperienceMap,
  myRatingsByAuthor: Record<string, number>,
): RecommendedBook {
  const R = candidate.starRating ?? GLOBAL_MEAN;
  const v = candidate.ratingCount ?? 0;
  const bScore = bayesianScore(R, v, GLOBAL_MEAN, SMOOTHING_FACTOR);

  // Author preference — use myRating-based scores if available
  const authorScores = { ...authorExperiences };
  for (const author of candidate.authors) {
    if (myRatingsByAuthor[normalizeForMatch(author)] != null) {
      authorScores[author] = myRatingsByAuthor[normalizeForMatch(author)];
    }
  }
  const authorPref = averageTagPreference(candidate.authors, authorScores);

  // Genre preferences from user interests
  const genrePrefs = tagPreferences(candidate.genres, genreInterests);

  // Path coverage: how many selected tags does this book match?
  const candidateGenresLower = candidate.genres.map(normalizeForMatch);
  const matchedSelected = selectedTags.filter((tag) =>
    candidateGenresLower.some(
      (g) => g.includes(normalizeForMatch(tag)) || normalizeForMatch(tag).includes(g),
    ),
  );
  const pathCoverage = selectedTags.length > 0
    ? matchedSelected.length / selectedTags.length
    : 0;

  // Path interest: average interest score of matched selected tags
  const matchedInterests = matchedSelected.map(
    (tag) => genreInterests[tag] ?? 3,
  );
  const pathInterest = matchedInterests.length > 0
    ? matchedInterests.reduce((a, b) => a + b, 0) / matchedInterests.length
    : 3;

  // Matched profile genres (genres the user has any interest data for)
  const matchedProfileGenres = candidate.genres.filter(
    (g) => genreInterests[g] != null,
  );

  // Matched authors
  const matchedAuthors = candidate.authors.filter(
    (a) => authorExperiences[a] != null || myRatingsByAuthor[normalizeForMatch(a)] != null,
  );

  // Composite: base score + path coverage bonus (scaled to 0-5)
  const pathBonus = pathCoverage * pathInterest;
  const score = compositeScore(bScore, authorPref, ...genrePrefs, pathBonus);

  return {
    id: `${candidate.title}::${candidate.authors.join(",")}`,
    title: candidate.title,
    authors: candidate.authors,
    genres: candidate.genres,
    averageRating: candidate.starRating,
    ratingsCount: candidate.ratingCount,
    description: candidate.description,
    infoLink: candidate.googleBooksUrl,
    thumbnail: candidate.thumbnail,
    score,
    matchedSelectedTags: matchedSelected,
    matchedProfileGenres,
    matchedAuthors,
    breakdown: {
      bayesian: bScore,
      author: authorPref,
      pathCoverage,
      pathInterest,
      genreMatches: genrePrefs,
    },
  };
}

export async function requestPathRecommendation(
  payload: PathRecommendationRequest,
): Promise<PathRecommendationResponse> {
  const { selectedTags, profile } = payload;

  // Build myRating lookup by author (lowercased)
  const myRatingsByAuthor: Record<string, number> = {};
  for (const book of profile.books) {
    if (book.myRating != null) {
      for (const author of book.authors) {
        const key = normalizeForMatch(author);
        const existing = myRatingsByAuthor[key];
        // Average if multiple books by same author
        myRatingsByAuthor[key] = existing != null
          ? (existing + book.myRating) / 2
          : book.myRating;
      }
    }
  }

  const results = await searchGoogleBooks(selectedTags);

  const candidates = results
    .filter((r) => !bookAlreadyExists(r, profile.books))
    .map((r) =>
      scoreCandidate(
        r,
        selectedTags,
        profile.genreInterests,
        profile.authorExperiences,
        myRatingsByAuthor,
      ),
    )
    .sort((a, b) => b.score - a.score);

  return {
    bestMatch: candidates[0] ?? null,
    candidates,
    queries: selectedTags,
    provider: "google-books",
  };
}
