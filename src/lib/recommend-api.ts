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
  provider: string;
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

const DEFAULT_RECOMMENDATION_LIMIT = 20;
const ACADEMIC_SIGNAL_PATTERNS = [
  /\bancient history\b/i,
  /\bbiography\b/i,
  /\bcivilization\b/i,
  /\bcriticism\b/i,
  /\bgovernment\b/i,
  /\bhistory\b/i,
  /\bliterary criticism\b/i,
  /\bphilosophy\b/i,
  /\bpolitical science\b/i,
  /\breference\b/i,
  /\breligion\b/i,
  /\brepublic\b/i,
  /\bsocial conditions\b/i,
  /\bsources\b/i,
  /\btextbooks?\b/i,
];
const FICTION_SIGNAL_PATTERNS = [
  /\bchildren'?s fiction\b/i,
  /\bfantasy\b/i,
  /\bfiction\b/i,
  /\bgraphic novels?\b/i,
  /\bjuvenile\b/i,
  /\bromance\b/i,
  /\bthrillers?\b/i,
];

function normalizeForMatch(value: string) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function recommendationIdentityKey(candidate: {
  title: string;
  authors: string[];
}) {
  return `${normalizeForMatch(candidate.title)}::${uniqueStrings(
    candidate.authors.map((author) => normalizeForMatch(author)),
  ).join("|")}`;
}

function average(values: number[], fallback = 3) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function averageOrNull(values: number[]) {
  return values.length > 0 ? average(values) : null;
}

function hasSelectedTag(selectedTags: string[], expectedTag: string) {
  const normalizedExpected = normalizeForMatch(expectedTag);

  return selectedTags.some((tag) => normalizeForMatch(tag) === normalizedExpected);
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

function academicFitScore(candidateLabels: string[], selectedTags: string[]) {
  if (!hasSelectedTag(selectedTags, "Academic")) {
    return null;
  }

  const hasAcademicSignal = candidateLabels.some((label) =>
    ACADEMIC_SIGNAL_PATTERNS.some((pattern) => pattern.test(label)),
  );
  const hasFictionSignal = candidateLabels.some((label) =>
    FICTION_SIGNAL_PATTERNS.some((pattern) => pattern.test(label)),
  );

  if (hasAcademicSignal && !hasFictionSignal) {
    return 5;
  }

  if (hasAcademicSignal) {
    return 4;
  }

  if (hasFictionSignal) {
    return 1.5;
  }

  return 3;
}

function scoreCandidate(
  candidate: Omit<RecommendedBook, "score" | "tagOverlap">,
  selectedTags: string[],
  genreInterests: GenreInterestMap,
  authorExperiences: AuthorExperienceMap,
  seriesExperiences: SeriesExperienceMap,
) {
  const candidateLabels = uniqueStrings([
    ...candidate.topics,
    ...candidate.tags,
    ...candidate.genres,
  ]);
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
  const academicScore = academicFitScore(candidateLabels, selectedTags);
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
    ...(academicScore != null ? [academicScore] : []),
    ...genreMatches,
  ];
  const score = average(scoreInputs);

  return {
    ...candidate,
    score,
    tagOverlap: matchedSelectedTags.length,
  };
}

function mergeRecommendedBook(
  current: RecommendedBook,
  incoming: RecommendedBook,
): RecommendedBook {
  const nextProvider =
    current.provider === incoming.provider
      ? current.provider
      : current.provider.includes("openlibrary") ||
          incoming.provider.includes("openlibrary")
        ? "openlibrary+book-ranker"
        : current.provider;

  return {
    ...current,
    provider: nextProvider,
    authors:
      current.authors.length > 0
        ? uniqueStrings(current.authors)
        : uniqueStrings(incoming.authors),
    genres: uniqueStrings([...current.genres, ...incoming.genres]),
    tags: uniqueStrings([...current.tags, ...incoming.tags]),
    topics: uniqueStrings([...current.topics, ...incoming.topics]),
    averageRating: current.averageRating ?? incoming.averageRating,
    ratingsCount: current.ratingsCount ?? incoming.ratingsCount,
    description: current.description ?? incoming.description,
    infoLink: current.infoLink ?? incoming.infoLink,
    thumbnail: current.thumbnail ?? incoming.thumbnail,
    score: Math.max(current.score, incoming.score),
    tagOverlap: Math.max(current.tagOverlap, incoming.tagOverlap),
  };
}

function mergeRecommendedBooks(
  primary: RecommendedBook[],
  secondary: RecommendedBook[],
  limit = DEFAULT_RECOMMENDATION_LIMIT,
) {
  const byIdentity = new Map<string, RecommendedBook>();
  const ordered: RecommendedBook[] = [];

  function upsert(candidate: RecommendedBook) {
    const identityKey = recommendationIdentityKey(candidate);
    const current = byIdentity.get(identityKey);

    if (!current) {
      byIdentity.set(identityKey, candidate);
      ordered.push(candidate);
      return;
    }

    const merged = mergeRecommendedBook(current, candidate);
    byIdentity.set(identityKey, merged);
    const index = ordered.findIndex(
      (entry) => recommendationIdentityKey(entry) === identityKey,
    );

    if (index !== -1) {
      ordered[index] = merged;
    }
  }

  for (const candidate of primary) {
    upsert(candidate);
  }

  for (const candidate of secondary) {
    upsert(candidate);
  }

  return ordered.slice(0, Math.max(1, limit));
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
          provider: "book-ranker",
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

export async function fetchPathRecommendations(
  payload: PathRecommendationRequest,
  signal?: AbortSignal,
): Promise<PathRecommendationResponse> {
  const localResponse = requestPathRecommendation(payload);
  const response = await fetch("/api/recommendations/path", {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      selectedTags: payload.selectedTags,
      limit: DEFAULT_RECOMMENDATION_LIMIT,
    }),
  });
  const isJson =
    response.headers.get("content-type")?.includes("application/json") ?? false;

  if (!isJson) {
    if (localResponse.candidates.length > 0) {
      return localResponse;
    }

    throw new Error("Recommendation lookup is unavailable.");
  }

  const payloadBody = (await response.json()) as {
    message?: string;
    results?: Array<{
      id: string;
      title: string;
      series?: string;
      seriesNumber?: number;
      authors?: string[];
      genres?: string[];
      tags?: string[];
      topics?: string[];
      averageRating?: number;
      ratingsCount?: number;
      description?: string;
      infoLink?: string;
      thumbnail?: string;
    }>;
  };

  if (!response.ok) {
    if (localResponse.candidates.length > 0) {
      return localResponse;
    }

    throw new Error(payloadBody.message || "Recommendation lookup failed.");
  }

  const remoteCandidates = Array.isArray(payloadBody.results)
    ? payloadBody.results
        .map((candidate) =>
          scoreCandidate(
            {
              id: candidate.id,
              provider: "openlibrary",
              title: candidate.title,
              ...(candidate.series ? { series: candidate.series } : {}),
              ...(candidate.seriesNumber != null
                ? { seriesNumber: candidate.seriesNumber }
                : {}),
              authors: Array.isArray(candidate.authors) ? candidate.authors : [],
              genres: Array.isArray(candidate.genres) ? candidate.genres : [],
              tags: Array.isArray(candidate.tags) ? candidate.tags : [],
              topics: Array.isArray(candidate.topics) ? candidate.topics : [],
              ...(candidate.averageRating != null
                ? { averageRating: candidate.averageRating }
                : {}),
              ...(candidate.ratingsCount != null
                ? { ratingsCount: candidate.ratingsCount }
                : {}),
              ...(candidate.description ? { description: candidate.description } : {}),
              ...(candidate.infoLink ? { infoLink: candidate.infoLink } : {}),
              ...(candidate.thumbnail ? { thumbnail: candidate.thumbnail } : {}),
            },
            localResponse.queries,
            payload.profile.genreInterests,
            payload.profile.authorExperiences,
            payload.profile.seriesExperiences,
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
        .slice(0, DEFAULT_RECOMMENDATION_LIMIT)
    : [];

  const candidates = mergeRecommendedBooks(
    remoteCandidates,
    localResponse.candidates,
    DEFAULT_RECOMMENDATION_LIMIT,
  );
  const provider =
    remoteCandidates.length > 0
      ? localResponse.candidates.length > 0
        ? "openlibrary+book-ranker"
        : "openlibrary"
      : localResponse.provider;

  return {
    provider,
    queries: [...localResponse.queries],
    bestMatch: candidates[0] ?? null,
    candidates,
  };
}
