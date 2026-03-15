import type { AuthorExperienceMap, Book, GenreInterestMap } from "./books-api";

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

function responseMessageFromError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Recommendation request failed.";
}

export async function requestPathRecommendation(
  payload: PathRecommendationRequest,
) {
  try {
    const response = await fetch("/api/recommend-path", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as
      | { message?: string }
      | PathRecommendationResponse
      | null;

    if (!response.ok) {
      const message =
        data && "message" in data && typeof data.message === "string"
          ? data.message
          : response.status === 404
            ? "Recommendation API unavailable. Run this app through Vercel for the backend route."
            : "Recommendation request failed.";

      throw new Error(message);
    }

    if (!data || !("provider" in data)) {
      throw new Error("Recommendation response was incomplete.");
    }

    return data;
  } catch (error) {
    throw new Error(responseMessageFromError(error));
  }
}
