const GLOBAL_MEAN = 3.8;
const SMOOTHING_FACTOR = 500;

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseBody(req) {
  if (!req.body) {
    return null;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  return null;
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

function average(values, fallback = 3) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function compositeScore(bayesian, ...inputs) {
  const values = [bayesian, ...inputs];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildGoogleQueries(selectedTags) {
  const subjectQueries = selectedTags.map(
    (tag) => `subject:${tag.includes(" ") ? `"${tag}"` : tag}`,
  );

  return uniqueStrings([
    subjectQueries.join(" "),
    selectedTags.join(" "),
    ...subjectQueries,
    ...selectedTags,
  ]).slice(0, 6);
}

async function fetchGoogleVolumes(query) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("printType", "books");
  url.searchParams.set("orderBy", "relevance");
  url.searchParams.set("maxResults", "20");
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    url.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Google Books request failed (${response.status}).`);
  }

  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}

function parseGoogleVolume(item) {
  const info = item?.volumeInfo ?? {};
  const sale = item?.saleInfo ?? {};
  const access = item?.accessInfo ?? {};

  if (typeof info.title !== "string" || !info.title.trim()) {
    return null;
  }

  const title = info.title.trim();
  const authors = Array.isArray(info.authors)
    ? info.authors.filter(
        (author) => typeof author === "string" && author.trim(),
      )
    : [];
  const genres = Array.isArray(info.categories)
    ? info.categories.filter(
        (genre) => typeof genre === "string" && genre.trim(),
      )
    : [];
  const averageRating = Number.isFinite(Number(info.averageRating))
    ? Number(info.averageRating)
    : undefined;
  const ratingsCount = Number.isFinite(Number(info.ratingsCount))
    ? Number(info.ratingsCount)
    : undefined;
  const thumbnail =
    typeof info.imageLinks?.thumbnail === "string"
      ? info.imageLinks.thumbnail
      : typeof info.imageLinks?.smallThumbnail === "string"
        ? info.imageLinks.smallThumbnail
        : undefined;
  const infoLink =
    typeof info.infoLink === "string"
      ? info.infoLink
      : typeof sale.buyLink === "string"
        ? sale.buyLink
        : typeof access.webReaderLink === "string"
          ? access.webReaderLink
          : undefined;

  return {
    id:
      typeof item.id === "string"
        ? item.id
        : normalizeText(`${title}:${authors[0] ?? ""}`),
    title,
    authors,
    genres,
    averageRating,
    ratingsCount,
    description:
      typeof info.description === "string"
        ? info.description.trim()
        : undefined,
    infoLink,
    thumbnail,
  };
}

function expandGenreLabels(values) {
  const normalized = [];

  for (const value of values) {
    const raw = normalizeText(value);

    if (!raw) {
      continue;
    }

    normalized.push(raw);

    for (const segment of value.split("/")) {
      const trimmed = normalizeText(segment);

      if (trimmed) {
        normalized.push(trimmed);
      }
    }
  }

  return uniqueStrings(normalized);
}

function matchesNormalizedLabel(candidateLabels, rawLabel) {
  const normalizedLabel = normalizeText(rawLabel);

  if (!normalizedLabel) {
    return false;
  }

  return candidateLabels.some(
    (candidate) =>
      candidate === normalizedLabel ||
      candidate.includes(normalizedLabel) ||
      normalizedLabel.includes(candidate),
  );
}

function rankCandidates(candidates, selectedTags, profile) {
  const genreEntries = Object.entries(profile.genreInterests ?? {});
  const authorEntries = Object.entries(profile.authorExperiences ?? {});

  const ranked = candidates
    .map((candidate) => {
      const normalizedGenres = expandGenreLabels(candidate.genres);
      const normalizedAuthors = candidate.authors.map(normalizeText);
      const matchedSelectedTags = selectedTags.filter((tag) =>
        matchesNormalizedLabel(normalizedGenres, tag),
      );
      const matchedProfileGenres = genreEntries
        .map(([tag]) => tag)
        .filter((tag) => matchesNormalizedLabel(normalizedGenres, tag));
      const matchedAuthors = authorEntries
        .map(([author]) => author)
        .filter((author) => matchesNormalizedLabel(normalizedAuthors, author));
      const bayesian = bayesianScore(
        clamp(candidate.averageRating ?? GLOBAL_MEAN, 0, 5),
        Math.max(0, candidate.ratingsCount ?? 0),
      );
      const authorScore = average(
        matchedAuthors.map((author) => profile.authorExperiences[author] ?? 3),
      );
      const genreMatches = matchedProfileGenres.map(
        (tag) => profile.genreInterests[tag] ?? 3,
      );
      const pathCoverage =
        selectedTags.length > 0
          ? (matchedSelectedTags.length / selectedTags.length) * 5
          : 3;
      const pathInterest = average(
        matchedSelectedTags.map((tag) => profile.genreInterests[tag] ?? 4),
        matchedSelectedTags.length > 0 ? 4 : 0,
      );
      const score = compositeScore(
        bayesian,
        authorScore,
        pathCoverage,
        pathInterest,
        ...(genreMatches.length > 0 ? genreMatches : [3]),
      );

      return {
        ...candidate,
        score,
        matchedSelectedTags,
        matchedProfileGenres,
        matchedAuthors,
        breakdown: {
          bayesian,
          author: authorScore,
          pathCoverage,
          pathInterest,
          genreMatches,
        },
      };
    })
    .filter((candidate) => candidate.matchedSelectedTags.length > 0)
    .sort((left, right) => {
      const leftMatchCount = left.matchedSelectedTags.length;
      const rightMatchCount = right.matchedSelectedTags.length;

      return (
        rightMatchCount - leftMatchCount ||
        right.score - left.score ||
        (right.ratingsCount ?? 0) - (left.ratingsCount ?? 0) ||
        left.title.localeCompare(right.title)
      );
    });

  if (ranked.length === 0) {
    return [];
  }

  const topMatchCount = ranked[0].matchedSelectedTags.length;

  return ranked
    .filter(
      (candidate) => candidate.matchedSelectedTags.length >= topMatchCount - 1,
    )
    .slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { message: "Method not allowed." });
  }

  const body = parseBody(req);
  const selectedTags = Array.isArray(body?.selectedTags)
    ? body.selectedTags
        .filter((tag) => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const profile = body?.profile;

  if (selectedTags.length < 2) {
    return sendJson(res, 400, {
      message:
        "Choose at least two interests before asking for a recommendation.",
    });
  }

  if (!profile || typeof profile !== "object") {
    return sendJson(res, 400, { message: "Profile payload is required." });
  }

  try {
    const queries = buildGoogleQueries(selectedTags);
    const settledResults = await Promise.allSettled(
      queries.map((query) => fetchGoogleVolumes(query)),
    );
    const results = settledResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (results.length === 0) {
      return sendJson(res, 502, {
        message: "Book search is unavailable right now. Try again shortly.",
      });
    }

    const dedupedCandidates = new Map();

    for (const items of results) {
      for (const item of items) {
        const candidate = parseGoogleVolume(item);

        if (!candidate) {
          continue;
        }

        const dedupeKey = normalizeText(
          `${candidate.title}:${candidate.authors[0] ?? ""}`,
        );
        const existing = dedupedCandidates.get(dedupeKey);

        if (
          !existing ||
          (candidate.ratingsCount ?? 0) > (existing.ratingsCount ?? 0)
        ) {
          dedupedCandidates.set(dedupeKey, candidate);
        }
      }
    }

    const rankedCandidates = rankCandidates(
      Array.from(dedupedCandidates.values()),
      selectedTags,
      {
        genreInterests:
          profile.genreInterests && typeof profile.genreInterests === "object"
            ? profile.genreInterests
            : {},
        authorExperiences:
          profile.authorExperiences &&
          typeof profile.authorExperiences === "object"
            ? profile.authorExperiences
            : {},
      },
    );

    return sendJson(res, 200, {
      provider: "google-books",
      queries,
      bestMatch: rankedCandidates[0] ?? null,
      candidates: rankedCandidates,
    });
  } catch (error) {
    return sendJson(res, 502, {
      message:
        error instanceof Error && error.message
          ? error.message
          : "Recommendation lookup failed.",
    });
  }
}
