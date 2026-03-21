import { createSeedState } from "./seed-state.js";

function cloneBooks(books) {
  return books.map((book) => ({
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
    moods: [...book.moods],
  }));
}

export function cloneState(state) {
  return {
    books: cloneBooks(state.books),
    genreInterests: { ...state.genreInterests },
    authorExperiences: { ...state.authorExperiences },
    meta: { ...state.meta },
  };
}

function normalizeTitledTag(value) {
  const trimmed = String(value ?? "").trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/(^|[\s/-])(\p{L})/gu, (_match, boundary, letter) => {
    return `${boundary}${letter.toLocaleUpperCase()}`;
  });
}

export function normalizeGenreTag(value) {
  return normalizeTitledTag(value);
}

export function normalizeMoodTag(value) {
  return normalizeTitledTag(value);
}

function normalizeTagList(value, normalizeValue = (tag) => tag.trim()) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const trimmed = normalizeValue(rawValue);

    if (trimmed) {
      seen.add(trimmed);
    }
  }

  return Array.from(seen);
}

function normalizeSeriesName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeSeriesNumber(value) {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Number(parsed.toString());
}

function normalizeYear(value) {
  const currentYear = new Date().getFullYear();
  const parsed =
    value != null && Number.isFinite(Number(value))
      ? Math.floor(Number(value))
      : undefined;

  if (parsed == null || parsed < 1000 || parsed > currentYear) {
    return undefined;
  }

  return parsed;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function normalizeReadCount(read, progress, readCount, lastReadYear) {
  if (lastReadYear != null) {
    return Math.max(1, readCount ?? 0);
  }

  if (!read) {
    return readCount;
  }

  if (readCount != null && readCount > 0) {
    return readCount;
  }

  if (progress != null && progress < 100) {
    return 0;
  }

  return 1;
}

export function normalizeBook(value) {
  const book = value ?? null;
  const title = typeof book?.title === "string" ? book.title.trim() : "";
  const series = normalizeSeriesName(book?.series);
  const seriesNumber = normalizeSeriesNumber(book?.seriesNumber);
  const rawStarRating = book?.starRating;
  const starRating =
    rawStarRating != null && Number.isFinite(Number(rawStarRating))
      ? Number(rawStarRating)
      : undefined;
  const rawRatingCount = book?.ratingCount;
  const ratingCount =
    rawRatingCount != null && Number.isFinite(Number(rawRatingCount))
      ? Number(rawRatingCount)
      : undefined;
  const id = Number(book?.id);
  const rawMyRating = book?.myRating;
  const myRating =
    rawMyRating != null && Number.isFinite(Number(rawMyRating))
      ? Number(rawMyRating)
      : undefined;
  const rawProgress = book?.progress;
  const progress =
    rawProgress != null && Number.isFinite(Number(rawProgress))
      ? Math.max(0, Math.min(100, Number(rawProgress)))
      : undefined;
  const read = book?.read === true ? true : undefined;
  const rawReadCount = book?.readCount;
  const parsedReadCount =
    rawReadCount != null && Number.isFinite(Number(rawReadCount))
      ? Math.max(0, Math.floor(Number(rawReadCount)))
      : undefined;
  const lastReadYear = normalizeYear(book?.lastReadYear);
  const readCount = normalizeReadCount(
    read,
    progress,
    parsedReadCount,
    lastReadYear,
  );
  const archivedAtYear = normalizeYear(book?.archivedAtYear);
  const catalogInfoLink =
    typeof book?.catalogInfoLink === "string" ? book.catalogInfoLink.trim() : "";
  const statsUpdatedAt = normalizeTimestamp(book?.statsUpdatedAt);
  const authors = normalizeTagList(book?.authors ?? book?.author);
  const genres = normalizeTagList(book?.genres ?? book?.genre, normalizeGenreTag);
  const moods = normalizeTagList(book?.moods ?? book?.mood, normalizeMoodTag);

  if (
    !title ||
    !Number.isFinite(id) ||
    (starRating != null && (starRating < 0 || starRating > 5)) ||
    (ratingCount != null && ratingCount < 0) ||
    (myRating != null && (myRating < 1 || myRating > 5))
  ) {
    return null;
  }

  return {
    id,
    title,
    ...(series ? { series } : {}),
    ...(seriesNumber != null ? { seriesNumber } : {}),
    authors,
    genres,
    moods,
    ...(starRating != null ? { starRating } : {}),
    ...(ratingCount != null ? { ratingCount } : {}),
    ...(myRating != null ? { myRating } : {}),
    ...(progress != null ? { progress } : {}),
    ...(read != null ? { read } : {}),
    ...(readCount != null ? { readCount } : {}),
    ...(lastReadYear != null ? { lastReadYear } : {}),
    ...(archivedAtYear != null ? { archivedAtYear } : {}),
    ...(catalogInfoLink ? { catalogInfoLink } : {}),
    ...(statsUpdatedAt ? { statsUpdatedAt } : {}),
  };
}

export function parseBookPayload(value) {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const series = normalizeSeriesName(value?.series);
  const seriesNumber = normalizeSeriesNumber(value?.seriesNumber);

  if (!title) {
    throw new Error("Title is required.");
  }

  const rawStarRating = value?.starRating;
  const starRating =
    rawStarRating != null && Number.isFinite(Number(rawStarRating))
      ? Number(rawStarRating)
      : undefined;
  const rawRatingCount = value?.ratingCount;
  const ratingCount =
    rawRatingCount != null && Number.isFinite(Number(rawRatingCount))
      ? Number(rawRatingCount)
      : undefined;

  if (starRating != null && (starRating < 0 || starRating > 5)) {
    throw new Error("Star rating must be a number between 0 and 5.");
  }

  if (ratingCount != null && ratingCount < 0) {
    throw new Error("Ratings must be a non-negative number.");
  }

  const rawMyRating = value?.myRating;
  const myRating =
    rawMyRating != null && Number.isFinite(Number(rawMyRating))
      ? Number(rawMyRating)
      : undefined;

  if (myRating != null && (myRating < 1 || myRating > 5)) {
    throw new Error("Personal rating must be between 1 and 5.");
  }

  const rawProgress = value?.progress;
  const progress =
    rawProgress != null && Number.isFinite(Number(rawProgress))
      ? Math.max(0, Math.min(100, Number(rawProgress)))
      : undefined;

  const read = value?.read === true ? true : undefined;
  const rawReadCount = value?.readCount;
  const parsedReadCount =
    rawReadCount != null && Number.isFinite(Number(rawReadCount))
      ? Math.max(0, Math.floor(Number(rawReadCount)))
      : undefined;
  const lastReadYear = normalizeYear(value?.lastReadYear);
  const readCount = normalizeReadCount(
    read,
    progress,
    parsedReadCount,
    lastReadYear,
  );
  const archivedAtYear = normalizeYear(value?.archivedAtYear);
  const catalogInfoLink =
    typeof value?.catalogInfoLink === "string" ? value.catalogInfoLink.trim() : "";
  const statsUpdatedAt = normalizeTimestamp(value?.statsUpdatedAt);

  const authors = normalizeTagList(value?.authors ?? value?.author);
  const genres = normalizeTagList(value?.genres ?? value?.genre, normalizeGenreTag);
  const moods = normalizeTagList(value?.moods ?? value?.mood, normalizeMoodTag);

  return {
    title,
    ...(series ? { series } : {}),
    ...(seriesNumber != null ? { seriesNumber } : {}),
    authors,
    genres,
    moods,
    ...(starRating != null ? { starRating } : {}),
    ...(ratingCount != null ? { ratingCount } : {}),
    ...(myRating != null ? { myRating } : {}),
    ...(progress != null ? { progress } : {}),
    ...(read != null ? { read } : {}),
    ...(readCount != null ? { readCount } : {}),
    ...(lastReadYear != null ? { lastReadYear } : {}),
    ...(catalogInfoLink ? { catalogInfoLink } : {}),
    ...(statsUpdatedAt ? { statsUpdatedAt } : {}),
    ...(read
      ? {
          archivedAtYear:
            lastReadYear ?? archivedAtYear ?? new Date().getFullYear(),
        }
      : archivedAtYear != null
        ? { archivedAtYear }
        : {}),
  };
}

function normalizeScoreMap(value, normalizeKey = (key) => key.trim()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);

    if (!normalizedKey || !Number.isFinite(Number(rawValue))) {
      continue;
    }

    result[normalizedKey] = Math.max(0, Math.min(5, Number(rawValue)));
  }

  return result;
}

export function normalizeLibraryState(value) {
  const seedState = createSeedState();

  if (!value || typeof value !== "object") {
    return seedState;
  }

  const hasBookList = Array.isArray(value.books);
  const rawBooks = hasBookList ? value.books : [];
  const books = rawBooks
    .map(normalizeBook)
    .filter((book) => book !== null);

  return {
    books: hasBookList ? books : seedState.books,
    genreInterests: normalizeScoreMap(value.genreInterests, normalizeGenreTag),
    authorExperiences: normalizeScoreMap(value.authorExperiences),
    meta: {
      seeded: value.meta?.seeded === true,
      migratedLocalState: value.meta?.migratedLocalState === true,
      updatedAt:
        typeof value.meta?.updatedAt === "string"
          ? value.meta.updatedAt
          : new Date().toISOString(),
    },
  };
}

export function normalizeImportedState(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Library import payload is required.");
  }

  const rawBooks = Array.isArray(value.books) ? value.books : [];
  const books = rawBooks
    .map(normalizeBook)
    .filter((book) => book !== null);

  if (books.length === 0) {
    throw new Error("Library import payload must include at least one book.");
  }

  return {
    books,
    genreInterests: normalizeScoreMap(value.genreInterests, normalizeGenreTag),
    authorExperiences: normalizeScoreMap(value.authorExperiences),
  };
}

export function replaceTag(
  tags,
  oldValue,
  newValue,
  normalizeValue = (tag) => tag.trim(),
) {
  const oldTag = normalizeValue(oldValue);
  const nextTag = normalizeValue(newValue);

  if (!oldTag) {
    return [...tags];
  }

  const replaced = tags.flatMap((tag) => {
    if (tag !== oldTag) {
      return [tag];
    }

    return nextTag ? [nextTag] : [];
  });

  return normalizeTagList(replaced, normalizeValue);
}

export function markStateUpdated(state, overrides = {}) {
  return {
    ...state,
    meta: {
      ...state.meta,
      seeded: false,
      updatedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}
