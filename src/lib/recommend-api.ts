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
  tags: string[];
  moods: string[];
  topics: string[];
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
  provider: "hardcover";
};

export async function requestPathRecommendation(
  payload: PathRecommendationRequest,
): Promise<PathRecommendationResponse> {
  let response: Response;

  try {
    response = await fetch("/api/recommendations/path", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Recommendations are unavailable until the backend is deployed.");
  }

  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Recommendations are unavailable until the backend is deployed.");
  }

  const body = (await response.json()) as { message?: string };

  if (!response.ok) {
    throw new Error(body.message || "Recommendation lookup failed.");
  }

  return body as PathRecommendationResponse;
}
