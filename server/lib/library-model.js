import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  createSeedState,
} from "./seed-state.js";
import {
  cloneCatalogBooks,
  normalizeCatalogBook,
  upsertCatalogBooks,
} from "./catalog-memory.js";

function cloneBooks(books) {
  return books.map((book) => ({
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
    moods: [...book.moods],
  }));
}

function cloneLibrarySnapshot(state) {
  return {
    books: cloneBooks(state.books),
    catalogBooks: cloneCatalogBooks(state.catalogBooks ?? []),
    genreInterests: { ...state.genreInterests },
    authorExperiences: { ...state.authorExperiences },
    seriesExperiences: { ...(state.seriesExperiences ?? {}) },
    meta: { ...state.meta },
  };
}

function cloneProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    ...cloneLibrarySnapshot(profile),
  };
}

export function cloneState(state) {
  return {
    ...cloneLibrarySnapshot(state),
    profiles: (state.profiles ?? []).map(cloneProfile),
    activeProfileId: state.activeProfileId,
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

function createEmptySnapshotMeta(updatedAt = new Date().toISOString()) {
  return {
    seeded: false,
    migratedLocalState: false,
    updatedAt,
  };
}

export function createEmptyProfile(
  id = DEFAULT_PROFILE_ID,
  name = DEFAULT_PROFILE_NAME,
  options = {},
) {
  const createdAt =
    normalizeTimestamp(options.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizeTimestamp(options.updatedAt) ?? createdAt;

  return {
    id,
    name,
    createdAt,
    books: [],
    catalogBooks: [],
    genreInterests: {},
    authorExperiences: {},
    seriesExperiences: {},
    meta: createEmptySnapshotMeta(updatedAt),
  };
}

function normalizeLibrarySnapshot(value, fallback) {
  const hasBookList = Array.isArray(value?.books);
  const rawBooks = hasBookList ? value.books : fallback.books;
  const books = rawBooks.map(normalizeBook).filter((book) => book !== null);
  const hasCatalogBooks = Array.isArray(value?.catalogBooks);
  const rawCatalogBooks = hasCatalogBooks ? value.catalogBooks : fallback.catalogBooks;
  const catalogBooks = upsertCatalogBooks(
    rawCatalogBooks
      .map(normalizeCatalogBook)
      .filter((book) => book !== null),
    books,
  );
  const hasMeta = Boolean(value?.meta && typeof value.meta === "object");

  return {
    books: hasBookList ? books : cloneBooks(fallback.books),
    catalogBooks:
      hasCatalogBooks || hasBookList
        ? catalogBooks
        : cloneCatalogBooks(fallback.catalogBooks),
    genreInterests:
      value?.genreInterests != null
        ? normalizeScoreMap(value.genreInterests, normalizeGenreTag)
        : { ...fallback.genreInterests },
    authorExperiences:
      value?.authorExperiences != null
        ? normalizeScoreMap(value.authorExperiences)
        : { ...fallback.authorExperiences },
    seriesExperiences:
      value?.seriesExperiences != null
        ? normalizeScoreMap(value.seriesExperiences)
        : { ...(fallback.seriesExperiences ?? {}) },
    meta: {
      seeded: hasMeta ? value.meta?.seeded === true : fallback.meta?.seeded === true,
      migratedLocalState: hasMeta
        ? value.meta?.migratedLocalState === true
        : fallback.meta?.migratedLocalState === true,
      updatedAt:
        normalizeTimestamp(value?.meta?.updatedAt) ??
        fallback.meta?.updatedAt ??
        new Date().toISOString(),
    },
  };
}

function normalizeProfile(value, fallback) {
  const normalizedId =
    typeof value?.id === "string" && value.id.trim()
      ? value.id.trim()
      : fallback.id;
  const normalizedName =
    typeof value?.name === "string" && value.name.trim()
      ? value.name.trim().replace(/\s+/g, " ")
      : fallback.name;

  return {
    id: normalizedId,
    name: normalizedName,
    createdAt: normalizeTimestamp(value?.createdAt) ?? fallback.createdAt,
    ...normalizeLibrarySnapshot(value, fallback),
  };
}

function buildStateFromActiveProfile(profiles, activeProfileId) {
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];

  if (!activeProfile) {
    const seedState = createSeedState();
    return cloneState(seedState);
  }

  return {
    ...cloneLibrarySnapshot(activeProfile),
    profiles: profiles.map(cloneProfile),
    activeProfileId: activeProfile.id,
  };
}

export function syncActiveProfileState(state) {
  const snapshot = cloneLibrarySnapshot(state);
  const existingProfiles = Array.isArray(state.profiles) ? state.profiles : [];
  const activeProfileIndex = existingProfiles.findIndex(
    (profile) => profile.id === state.activeProfileId,
  );
  const fallbackProfile = createEmptyProfile(state.activeProfileId);
  const baseProfile =
    activeProfileIndex === -1
      ? fallbackProfile
      : normalizeProfile(existingProfiles[activeProfileIndex], fallbackProfile);
  const nextProfile = {
    id: baseProfile.id,
    name: baseProfile.name,
    createdAt: baseProfile.createdAt,
    ...snapshot,
  };
  const nextProfiles =
    activeProfileIndex === -1
      ? [...existingProfiles.map(cloneProfile), nextProfile]
      : existingProfiles.map((profile, index) =>
          index === activeProfileIndex ? nextProfile : cloneProfile(profile),
        );

  return {
    ...snapshot,
    profiles: nextProfiles,
    activeProfileId: nextProfile.id,
  };
}

export function activateProfileState(state, profileId) {
  if (!Array.isArray(state.profiles) || state.profiles.length === 0) {
    throw new Error("No profiles found.");
  }

  const profile = state.profiles.find((entry) => entry.id === profileId);

  if (!profile) {
    throw new Error("Profile not found.");
  }

  return {
    ...cloneLibrarySnapshot(profile),
    profiles: state.profiles.map(cloneProfile),
    activeProfileId: profile.id,
  };
}

export function getProfileSummaries(state) {
  return (state.profiles ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
  }));
}

export function normalizeLibraryState(value) {
  const seedState = createSeedState();
  const defaultProfile = cloneProfile(seedState.profiles[0]);
  const rawProfiles =
    Array.isArray(value?.profiles) && value.profiles.length > 0
      ? value.profiles
      : [
          {
            id: DEFAULT_PROFILE_ID,
            name: DEFAULT_PROFILE_NAME,
            createdAt:
              normalizeTimestamp(value?.meta?.updatedAt) ??
              defaultProfile.createdAt,
            ...value,
          },
        ];
  const profiles = rawProfiles
    .map((profile, index) =>
      normalizeProfile(
        profile,
        index === 0
          ? defaultProfile
          : createEmptyProfile(
              typeof profile?.id === "string" && profile.id.trim()
                ? profile.id.trim()
                : `profile-${index + 1}`,
              typeof profile?.name === "string" && profile.name.trim()
                ? profile.name.trim().replace(/\s+/g, " ")
                : `Profile ${index + 1}`,
              { createdAt: profile?.createdAt },
            ),
      ),
    )
    .filter(
      (profile, index, allProfiles) =>
        allProfiles.findIndex((entry) => entry.id === profile.id) === index,
    );

  const requestedActiveProfileId =
    typeof value?.activeProfileId === "string" && value.activeProfileId.trim()
      ? value.activeProfileId.trim()
      : profiles[0]?.id;

  return buildStateFromActiveProfile(profiles, requestedActiveProfileId);
}

export function normalizeImportedState(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Library import payload is required.");
  }

  const rawBooks = Array.isArray(value.books) ? value.books : [];
  const books = rawBooks.map(normalizeBook).filter((book) => book !== null);
  const rawCatalogBooks = Array.isArray(value.catalogBooks) ? value.catalogBooks : [];

  if (books.length === 0) {
    throw new Error("Library import payload must include at least one book.");
  }

  return {
    books,
    catalogBooks: upsertCatalogBooks(rawCatalogBooks, books),
    genreInterests: normalizeScoreMap(value.genreInterests, normalizeGenreTag),
    authorExperiences: normalizeScoreMap(value.authorExperiences),
    seriesExperiences: normalizeScoreMap(value.seriesExperiences),
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
