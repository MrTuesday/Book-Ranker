const GLOBAL_MEAN = 3.8;
const SMOOTHING_FACTOR = 500;
const RECOMMENDATION_SEARCH_FIELDS = "genres,tags,description";
const RECOMMENDATION_SEARCH_WEIGHTS = "10,6,1";
const RECOMMENDATION_SEARCH_SORT =
  "_text_match:desc,users_count:desc,ratings_count:desc";
const RECOMMENDATION_RESULTS_PER_QUERY = 8;

function normalizeForMatch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function average(values, fallback = 3) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bayesianScore(rating, ratingCount) {
  return (
    (ratingCount / (ratingCount + SMOOTHING_FACTOR)) * rating +
    (SMOOTHING_FACTOR / (ratingCount + SMOOTHING_FACTOR)) * GLOBAL_MEAN
  );
}

function labelMatches(candidateLabels, rawLabel) {
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

function bookAlreadyExists(candidate, existingBooks) {
  const candidateTitle = normalizeForMatch(candidate.title);
  const candidateAuthors = new Set(candidate.authors.map(normalizeForMatch));

  return existingBooks.some((book) => {
    if (normalizeForMatch(book.title) !== candidateTitle) {
      return false;
    }

    if (candidateAuthors.size === 0 && book.authors.length === 0) {
      return true;
    }

    return book.authors.some((author) => candidateAuthors.has(normalizeForMatch(author)));
  });
}

function titleMatchesSelectedTag(title, selectedTags) {
  const normalizedTitle = normalizeForMatch(title);

  if (!normalizedTitle) {
    return false;
  }

  return selectedTags.some((tag) => normalizeForMatch(tag) === normalizedTitle);
}

function buildSearchQueries(selectedTags) {
  const tags = selectedTags.map((tag) => tag.trim()).filter(Boolean);
  return uniqueStrings([tags.join(" "), ...tags.slice(0, 2)]);
}

function scoreCandidate(candidate, selectedTags, genreInterests, authorExperiences) {
  const candidateLabels = uniqueStrings([
    ...candidate.topics,
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
    clamp(candidate.averageRating ?? GLOBAL_MEAN, 0, 5),
    Math.max(0, candidate.ratingsCount ?? 0),
  );
  const authorScore = average(
    matchedAuthors.map(
      (author) =>
        authorExperiences[
          Object.keys(authorExperiences).find(
            (knownAuthor) => normalizeForMatch(knownAuthor) === normalizeForMatch(author),
          ) ?? author
        ] ?? 3,
    ),
  );
  const genreMatches = matchedProfileGenres.map((tag) => genreInterests[tag] ?? 3);
  const pathCoverage =
    selectedTags.length > 0
      ? (matchedSelectedTags.length / selectedTags.length) * 5
      : 3;
  const pathInterest = average(
    matchedSelectedTags.map((tag) => genreInterests[tag] ?? 4),
    matchedSelectedTags.length > 0 ? 4 : 0,
  );
  const score = average([
    bayesian,
    authorScore,
    pathCoverage,
    pathInterest,
    ...(genreMatches.length > 0 ? genreMatches : [3]),
  ]);

  return {
    id: candidate.id,
    title: candidate.title,
    authors: candidate.authors,
    genres: candidate.genres,
    tags: candidate.tags,
    topics: candidate.topics,
    averageRating: candidate.averageRating,
    ratingsCount: candidate.ratingsCount,
    description: candidate.description,
    thumbnail: candidate.coverUrl,
    score,
    tagOverlap: matchedSelectedTags.length,
  };
}

export async function fetchPathRecommendations(client, payload) {
  const selectedTags = Array.isArray(payload?.selectedTags)
    ? payload.selectedTags
        .filter((tag) => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const profile =
    payload?.profile && typeof payload.profile === "object" ? payload.profile : {};
  const books = Array.isArray(profile.books) ? profile.books : [];
  const genreInterests =
    profile.genreInterests && typeof profile.genreInterests === "object"
      ? profile.genreInterests
      : {};
  const authorExperiences =
    profile.authorExperiences && typeof profile.authorExperiences === "object"
      ? profile.authorExperiences
      : {};

  if (selectedTags.length < 1) {
    throw new Error(
      "Choose at least one interest before asking for a recommendation.",
    );
  }

  const queries = buildSearchQueries(selectedTags);
  const searchResults = await Promise.all(
    queries.map((query) =>
      client.searchBooks(query, {
        perPage: RECOMMENDATION_RESULTS_PER_QUERY,
        fields: RECOMMENDATION_SEARCH_FIELDS,
        weights: RECOMMENDATION_SEARCH_WEIGHTS,
        sort: RECOMMENDATION_SEARCH_SORT,
        enrich: false,
      }),
    ),
  );
  const deduped = new Map();

  for (const results of searchResults) {
    for (const result of results) {
      const dedupeKey = `${normalizeForMatch(result.title)}::${normalizeForMatch(result.authors[0] ?? "")}`;
      const existing = deduped.get(dedupeKey);

      if (!existing || (result.ratingsCount ?? 0) > (existing.ratingsCount ?? 0)) {
        deduped.set(dedupeKey, result);
      }
    }
  }

  const detailedCandidates =
    typeof client.enrichBooks === "function"
      ? await client.enrichBooks(Array.from(deduped.values()))
      : Array.from(deduped.values());

  const rankedCandidates = detailedCandidates
    .filter((candidate) => !bookAlreadyExists(candidate, books))
    .filter((candidate) => !titleMatchesSelectedTag(candidate.title, selectedTags))
    .map((candidate) =>
      scoreCandidate(candidate, selectedTags, genreInterests, authorExperiences),
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
    .slice(0, 10);

  return {
    provider: client.provider ?? "unknown",
    queries,
    bestMatch: rankedCandidates[0] ?? null,
    candidates: rankedCandidates,
  };
}
