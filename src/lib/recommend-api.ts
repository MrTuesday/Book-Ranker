import type {
  AuthorExperienceMap,
  Book,
  GenreInterestMap,
  SeriesExperienceMap,
} from "./books-api";
import { GLOBAL_MEAN, bayesianScore } from "./scoring";
import { buildSiteCatalogResults } from "./catalog-api";

export type PathRecommendationRequest = {
  selectedTags: string[];
  profile: {
    books: Book[];
    genreInterests: GenreInterestMap;
    authorExperiences: AuthorExperienceMap;
    seriesExperiences: SeriesExperienceMap;
  };
};

export type RecommendedBook = {
  id: string;
  title: string;
  series?: string;
  seriesNumber?: number;
  authors: string[];
  genres: string[];
  tags: string[];
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
  provider: string;
};

function normalizeForMatch(value: string) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function average(values: number[], fallback = 3) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function averageOrNull(values: number[]) {
  return values.length > 0 ? average(values) : null;
}

function labelMatches(candidateLabels: string[], rawLabel: string) {
  const normalizedLabel = normalizeForMatch(rawLabel);

  if (!normalizedLabel) {
    return false;
  }

  return candidateLabels.some((candidate) => {
    const normalizedCandidate = normalizeForMatch(candidate);
    return (
      normalizedCandidate === normalizedLabel ||
      normalizedCandidate.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedCandidate)
    );
  });
}

function scoreCandidate(
  candidate: Omit<RecommendedBook, "score" | "tagOverlap">,
  selectedTags: string[],
  genreInterests: GenreInterestMap,
  authorExperiences: AuthorExperienceMap,
  seriesExperiences: SeriesExperienceMap,
) {
  const candidateLabels = uniqueStrings([...candidate.topics, ...candidate.genres]);
  const matchedSelectedTags = selectedTags.filter((tag) =>
    labelMatches(candidateLabels, tag),
  );
  const matchedProfileGenres = Object.keys(genreInterests).filter((tag) =>
    labelMatches(candidateLabels, tag),
  );
  const matchedAuthors = candidate.authors.filter((author) =>
    Object.keys(authorExperiences).some(
      (knownAuthor) => normalizeForMatch(knownAuthor) === normalizeForMatch(author),
    ),
  );

  const bayesian = bayesianScore(
    candidate.averageRating ?? GLOBAL_MEAN,
    candidate.ratingsCount ?? 0,
    GLOBAL_MEAN,
    0,
  );
  const authorScore = averageOrNull(
    matchedAuthors.flatMap((author) => {
      const matchedAuthorKey = Object.keys(authorExperiences).find(
        (knownAuthor) => normalizeForMatch(knownAuthor) === normalizeForMatch(author),
      );
      const score =
        matchedAuthorKey != null ? authorExperiences[matchedAuthorKey] : undefined;
      return score != null ? [score] : [];
    }),
  );
  const seriesScore =
    candidate.series && seriesExperiences[candidate.series] != null
      ? seriesExperiences[candidate.series]
      : null;
  const genreMatches = matchedProfileGenres.flatMap((tag) =>
    genreInterests[tag] != null ? [genreInterests[tag]] : [],
  );
  const pathCoverage =
    selectedTags.length > 0
      ? (matchedSelectedTags.length / selectedTags.length) * 5
      : 3;
  const pathInterest = average(
    matchedSelectedTags.map((tag) => genreInterests[tag] ?? 4),
    matchedSelectedTags.length > 0 ? 4 : 0,
  );
  const scoreInputs = [
    bayesian,
    pathCoverage,
    pathInterest,
    ...(authorScore != null ? [authorScore] : []),
    ...(seriesScore != null ? [seriesScore] : []),
    ...genreMatches,
  ];
  const score = average(scoreInputs);

  return {
    ...candidate,
    score,
    tagOverlap: matchedSelectedTags.length,
  };
}

export function requestPathRecommendation(
  payload: PathRecommendationRequest,
): PathRecommendationResponse {
  const selectedTags = Array.isArray(payload?.selectedTags)
    ? payload.selectedTags
        .filter((tag) => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const profile = payload?.profile;
  const books = Array.isArray(profile?.books) ? profile.books : [];
  const genreInterests =
    profile?.genreInterests && typeof profile.genreInterests === "object"
      ? profile.genreInterests
      : {};
  const authorExperiences =
    profile?.authorExperiences && typeof profile.authorExperiences === "object"
      ? profile.authorExperiences
      : {};
  const seriesExperiences =
    profile?.seriesExperiences && typeof profile.seriesExperiences === "object"
      ? profile.seriesExperiences
      : {};

  if (selectedTags.length < 1) {
    throw new Error(
      "Choose at least one interest before asking for a recommendation.",
    );
  }

  const candidates = buildSiteCatalogResults(books)
    .filter((candidate) => candidate.hasUnreadEntry)
    .map((candidate) =>
      scoreCandidate(
        {
          id: candidate.id,
          title: candidate.title,
          series: candidate.series,
          seriesNumber: candidate.seriesNumber,
          authors: candidate.authors,
          genres: candidate.genres,
          tags: candidate.tags,
          topics: candidate.topics,
          averageRating: candidate.averageRating,
          ratingsCount: candidate.ratingsCount,
        },
        selectedTags,
        genreInterests,
        authorExperiences,
        seriesExperiences,
      ),
    )
    .filter((candidate) => candidate.tagOverlap > 0)
    .sort((left, right) => {
      return (
        right.tagOverlap - left.tagOverlap ||
        right.score - left.score ||
        (right.ratingsCount ?? 0) - (left.ratingsCount ?? 0) ||
        left.title.localeCompare(right.title)
      );
    })
    .slice(0, 20);

  return {
    provider: "book-ranker",
    queries: [...selectedTags],
    bestMatch: candidates[0] ?? null,
    candidates,
  };
}
