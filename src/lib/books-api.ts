import {
  cloneCatalogBooks,
  normalizeCatalogBook,
  type CatalogBook,
  upsertCatalogBooks,
} from "./catalog-memory";
import { applySiteRatingStats } from "./site-books";
import { isSupabaseConfigured, requireSupabase } from "./supabase";

export type Book = {
  id: number;
  title: string;
  series?: string;
  seriesNumber?: number;
  authors: string[];
  genres: string[];
  moods: string[];
  starRating?: number;
  ratingCount?: number;
  catalogInfoLink?: string;
  statsUpdatedAt?: string;
  myRating?: number;
  progress?: number;
  read?: boolean;
  readCount?: number;
  lastReadYear?: number;
  archivedAtYear?: number;
  genreAdded?: string[];
  genreRemoved?: string[];
};

export type BookPayload = Omit<Book, "id" | "moods"> & {
  moods?: string[];
};
export type GenreInterestMap = Record<string, number>;
export type AuthorExperienceMap = Record<string, number>;
export type SeriesExperienceMap = Record<string, number>;
export type ProfileSummary = {
  id: string;
  name: string;
  createdAt: string;
};

export type LibraryState = {
  books: Book[];
  catalogBooks: CatalogBook[];
  genreInterests: GenreInterestMap;
  authorExperiences: AuthorExperienceMap;
  seriesExperiences: SeriesExperienceMap;
  profiles: ProfileSummary[];
  activeProfileId: string;
  meta: {
    seeded: boolean;
    migratedLocalState: boolean;
    updatedAt: string;
  };
};

type LegacyBook = Partial<Book> & {
  author?: unknown;
  genre?: unknown;
  mood?: unknown;
  authors?: unknown;
  genres?: unknown;
  moods?: unknown;
};

function normalizeSeriesName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeProfileName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeSeriesNumber(value: unknown) {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Number(parsed.toString());
}

const STORAGE_KEY = "book-ranker.books.v1";
const CATALOG_STORAGE_KEY = "book-ranker.catalog-books.v1";
const GENRE_INTEREST_KEY = "book-ranker.genre-interests.v1";
const AUTHOR_EXP_KEY = "book-ranker.author-experiences.v1";
const SERIES_EXP_KEY = "book-ranker.series-experiences.v1";
const PROFILES_STORAGE_KEY = "book-ranker.profiles.v1";
const ACTIVE_PROFILE_STORAGE_KEY = "book-ranker.active-profile-id.v1";
const BACKEND_MIGRATION_KEY = "book-ranker.backend-migrated.v1";
const DEFAULT_PROFILE_ID = "profile-default";
const DEFAULT_PROFILE_NAME = "My Profile";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StoredProfile = ProfileSummary & {
  books: Book[];
  catalogBooks: CatalogBook[];
  genreInterests: GenreInterestMap;
  authorExperiences: AuthorExperienceMap;
  seriesExperiences: SeriesExperienceMap;
  meta: LibraryState["meta"];
};

type StoredLibraryState = {
  profiles: StoredProfile[];
  activeProfileId: string;
};

type RemoteProfileRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  books: unknown;
  catalog_books: unknown;
  genre_interests: unknown;
  author_experiences: unknown;
  series_experiences: unknown;
};

type RemoteLibraryMeta = {
  migratedLocalState: boolean;
  updatedAt: string;
};

type RemoteLibraryContext = {
  userId: string;
  state: StoredLibraryState;
  meta: RemoteLibraryMeta;
};

type LegacyLibraryData = Omit<
  LibraryState,
  "meta" | "profiles" | "activeProfileId"
>;

class BackendUnavailableError extends Error {
  constructor(message = "Backend is unavailable.") {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

export class AuthRequiredError extends Error {
  constructor(message = "Sign in required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

const REMOTE_PROFILE_TABLE = "user_profiles";
const REMOTE_SETTINGS_TABLE = "user_settings";

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new BackendUnavailableError();
  }

  const isJsonResponse =
    response.headers.get("content-type")?.includes("application/json") ?? false;

  if (!isJsonResponse) {
    throw new BackendUnavailableError();
  }

  const payload = (await response.json()) as { message?: string };

  if (!response.ok) {
    throw new Error(
      payload?.message || `Request failed with status ${response.status}.`,
    );
  }

  return payload as T;
}

function hasMeaningfulStoredState(state: StoredLibraryState) {
  return state.profiles.some((profile) => {
    return (
      profile.books.length > 0 ||
      profile.catalogBooks.length > 0 ||
      Object.keys(profile.genreInterests).length > 0 ||
      Object.keys(profile.authorExperiences).length > 0 ||
      Object.keys(profile.seriesExperiences).length > 0
    );
  });
}

function withRemoteMeta(
  libraryState: LibraryState,
  meta: RemoteLibraryMeta,
): LibraryState {
  return {
    ...libraryState,
    meta: {
      ...libraryState.meta,
      migratedLocalState: meta.migratedLocalState,
      updatedAt: normalizeTimestamp(meta.updatedAt) ?? libraryState.meta.updatedAt,
    },
  };
}

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function requireStorage() {
  const storage = getStorage();

  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  return storage;
}

function normalizeTitledTag(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "";
  }

  return trimmed.replace(
    /(^|[\s/-])(\p{L})/gu,
    (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toLocaleUpperCase()}`,
  );
}

export function normalizeGenreTag(value: string) {
  return normalizeTitledTag(value);
}

export function normalizeMoodTag(value: string) {
  return normalizeTitledTag(value);
}

function normalizeTagList(
  value: unknown,
  normalizeValue: (value: string) => string = (tag) => tag.trim(),
) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set<string>();

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

export function resolveBookGenres(
  catalogGenres: string[],
  allowedGenres: Set<string>,
  added: string[] = [],
  removed: string[] = [],
): string[] {
  const removedSet = new Set(removed.map(normalizeGenreTag));
  const filtered = catalogGenres
    .map(normalizeGenreTag)
    .filter((g) => g && allowedGenres.has(g) && !removedSet.has(g));
  const extra = added
    .map(normalizeGenreTag)
    .filter((g) => g && !removedSet.has(g));
  return Array.from(new Set([...filtered, ...extra])).filter(Boolean);
}

export function computeGenreOverrides(
  draftGenres: string[],
  catalogGenres: string[],
  allowedGenres: Set<string>,
): { genreAdded: string[]; genreRemoved: string[] } {
  const normalizedDraft = new Set(
    draftGenres.map(normalizeGenreTag).filter(Boolean),
  );
  const catalogFiltered = catalogGenres
    .map(normalizeGenreTag)
    .filter((g) => g && allowedGenres.has(g));
  const catalogFilteredSet = new Set(catalogFiltered);

  const genreAdded = draftGenres
    .map(normalizeGenreTag)
    .filter((g) => g && !catalogFilteredSet.has(g));
  const genreRemoved = catalogFiltered.filter((g) => !normalizedDraft.has(g));

  return {
    genreAdded: Array.from(new Set(genreAdded)),
    genreRemoved: Array.from(new Set(genreRemoved)),
  };
}

function normalizeYear(value: unknown) {
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

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function normalizeReadCount(
  read: boolean | undefined,
  progress: number | undefined,
  readCount: number | undefined,
  lastReadYear: number | undefined,
) {
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

function normalizeBook(value: unknown): Book | null {
  const book = value as LegacyBook | null;
  const title = typeof book?.title === "string" ? book.title.trim() : "";
  const series = normalizeSeriesName((book as Record<string, unknown>)?.series);
  const seriesNumber = normalizeSeriesNumber(
    (book as Record<string, unknown>)?.seriesNumber,
  );
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
  const rawMyRating = (book as Record<string, unknown>)?.myRating;
  const myRating =
    rawMyRating != null && Number.isFinite(Number(rawMyRating))
      ? Number(rawMyRating)
      : undefined;
  const rawProgress = (book as Record<string, unknown>)?.progress;
  const progress =
    rawProgress != null && Number.isFinite(Number(rawProgress))
      ? Math.max(0, Math.min(100, Number(rawProgress)))
      : undefined;
  const rawRead = (book as Record<string, unknown>)?.read;
  const read = rawRead === true ? true : undefined;
  const rawReadCount = (book as Record<string, unknown>)?.readCount;
  const parsedReadCount =
    rawReadCount != null && Number.isFinite(Number(rawReadCount))
      ? Math.max(0, Math.floor(Number(rawReadCount)))
      : undefined;
  const lastReadYear = normalizeYear(
    (book as Record<string, unknown>)?.lastReadYear,
  );
  const readCount = normalizeReadCount(
    read,
    progress,
    parsedReadCount,
    lastReadYear,
  );
  const archivedAtYear = normalizeYear(
    (book as Record<string, unknown>)?.archivedAtYear,
  );
  const catalogInfoLink =
    typeof (book as Record<string, unknown>)?.catalogInfoLink === "string"
      ? String((book as Record<string, unknown>)?.catalogInfoLink).trim()
      : "";
  const statsUpdatedAt = normalizeTimestamp(
    (book as Record<string, unknown>)?.statsUpdatedAt,
  );
  const authors = normalizeTagList(book?.authors ?? book?.author);
  const genres = normalizeTagList(book?.genres ?? book?.genre, normalizeGenreTag);
  const moods = normalizeTagList(book?.moods ?? book?.mood, normalizeMoodTag);
  const genreAdded = normalizeTagList((book as Record<string, unknown>)?.genreAdded, normalizeGenreTag);
  const genreRemoved = normalizeTagList((book as Record<string, unknown>)?.genreRemoved, normalizeGenreTag);

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
    ...(genreAdded.length > 0 ? { genreAdded } : {}),
    ...(genreRemoved.length > 0 ? { genreRemoved } : {}),
  };
}

function normalizeScoreMap(
  value: unknown,
  normalizeKey: (value: string) => string = (key) => key.trim(),
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeKey(key);

    if (!normalizedKey || !Number.isFinite(Number(rawValue))) {
      continue;
    }

    result[normalizedKey] = Math.max(0, Math.min(5, Number(rawValue)));
  }

  return result;
}

function cloneBooks(books: Book[]) {
  return books.map((book) => ({
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
    moods: [...book.moods],
    ...(book.genreAdded ? { genreAdded: [...book.genreAdded] } : {}),
    ...(book.genreRemoved ? { genreRemoved: [...book.genreRemoved] } : {}),
  }));
}

function cloneStoredProfile(profile: StoredProfile): StoredProfile {
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    books: cloneBooks(profile.books),
    catalogBooks: cloneCatalogBooks(profile.catalogBooks),
    genreInterests: { ...profile.genreInterests },
    authorExperiences: { ...profile.authorExperiences },
    seriesExperiences: { ...profile.seriesExperiences },
    meta: { ...profile.meta },
  };
}

function createProfileId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isUuid(value: string | null | undefined) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function createStoredProfile(
  overrides: Partial<StoredProfile> & Pick<StoredProfile, "id" | "name">,
): StoredProfile {
  const updatedAt =
    normalizeTimestamp(overrides.meta?.updatedAt) ??
    normalizeTimestamp(overrides.createdAt) ??
    new Date().toISOString();
  const createdAt = normalizeTimestamp(overrides.createdAt) ?? updatedAt;
  const books = cloneBooks(overrides.books ?? []);

  return {
    id: overrides.id,
    name: overrides.name.trim().replace(/\s+/g, " "),
    createdAt,
    books,
    catalogBooks: upsertCatalogBooks(overrides.catalogBooks ?? [], books),
    genreInterests: { ...(overrides.genreInterests ?? {}) },
    authorExperiences: { ...(overrides.authorExperiences ?? {}) },
    seriesExperiences: { ...(overrides.seriesExperiences ?? {}) },
    meta: {
      seeded: overrides.meta?.seeded === true,
      migratedLocalState: overrides.meta?.migratedLocalState === true,
      updatedAt,
    },
  };
}

function createDefaultStoredProfile(
  overrides: Partial<StoredProfile> = {},
): StoredProfile {
  return createStoredProfile({
    id: overrides.id ?? DEFAULT_PROFILE_ID,
    name: overrides.name ?? DEFAULT_PROFILE_NAME,
    ...overrides,
  });
}

function findActiveStoredProfile(state: StoredLibraryState) {
  return (
    state.profiles.find((profile) => profile.id === state.activeProfileId) ??
    state.profiles[0] ??
    createDefaultStoredProfile()
  );
}

function replaceActiveStoredProfile(
  state: StoredLibraryState,
  nextProfile: StoredProfile,
): StoredLibraryState {
  const profiles = state.profiles.some((profile) => profile.id === nextProfile.id)
    ? state.profiles.map((profile) =>
        profile.id === nextProfile.id ? cloneStoredProfile(nextProfile) : profile,
      )
    : [...state.profiles, cloneStoredProfile(nextProfile)];

  return {
    profiles,
    activeProfileId: nextProfile.id,
  };
}

function toLibraryState(state: StoredLibraryState): LibraryState {
  const activeProfile = findActiveStoredProfile(state);

  return {
    books: cloneBooks(activeProfile.books),
    catalogBooks: cloneCatalogBooks(activeProfile.catalogBooks),
    genreInterests: { ...activeProfile.genreInterests },
    authorExperiences: { ...activeProfile.authorExperiences },
    seriesExperiences: { ...activeProfile.seriesExperiences },
    profiles: state.profiles.map(({ id, name, createdAt }) => ({
      id,
      name,
      createdAt,
    })),
    activeProfileId: activeProfile.id,
    meta: { ...activeProfile.meta },
  };
}

function createStoredLibraryState(
  overrides: Partial<StoredLibraryState> = {},
): StoredLibraryState {
  const profiles =
    overrides.profiles && overrides.profiles.length > 0
      ? overrides.profiles.map(cloneStoredProfile)
      : [createDefaultStoredProfile()];
  const activeProfileId =
    overrides.activeProfileId &&
    profiles.some((profile) => profile.id === overrides.activeProfileId)
      ? overrides.activeProfileId
      : profiles[0].id;

  return {
    profiles,
    activeProfileId,
  };
}

function normalizeStoredLibraryStateForRemote(state: StoredLibraryState) {
  const idMap = new Map<string, string>();
  const nextProfiles = state.profiles.map((profile) => {
    const nextId = isUuid(profile.id) ? profile.id : createProfileId();
    idMap.set(profile.id, nextId);

    if (nextId === profile.id) {
      return cloneStoredProfile(profile);
    }

    return createStoredProfile({
      ...profile,
      id: nextId,
    });
  });
  const nextActiveProfileId =
    idMap.get(state.activeProfileId) ??
    (isUuid(state.activeProfileId) ? state.activeProfileId : nextProfiles[0]?.id);

  return createStoredLibraryState({
    profiles: nextProfiles,
    activeProfileId: nextActiveProfileId,
  });
}

function normalizeRemoteProfileRow(row: RemoteProfileRow): StoredProfile {
  return createStoredProfile({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    books: Array.isArray(row.books)
      ? row.books.map(normalizeBook).filter((book): book is Book => book !== null)
      : [],
    catalogBooks: Array.isArray(row.catalog_books)
      ? row.catalog_books
          .map(normalizeCatalogBook)
          .filter((book): book is CatalogBook => book !== null)
      : [],
    genreInterests: normalizeScoreMap(row.genre_interests, normalizeGenreTag),
    authorExperiences: normalizeScoreMap(row.author_experiences),
    seriesExperiences: normalizeScoreMap(row.series_experiences),
    meta: {
      seeded: false,
      migratedLocalState: false,
      updatedAt: row.updated_at,
    },
  });
}

function createRemoteStoredLibraryStateResult(
  state: StoredLibraryState,
  meta: RemoteLibraryMeta,
) {
  return withNativeRatingStats(withRemoteMeta(toLibraryState(state), meta));
}

async function getRemoteAuthUser() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw error;
  }

  const user = data.session?.user;

  if (!user) {
    throw new AuthRequiredError();
  }

  return user;
}

function createInitialRemoteStoredLibraryState(defaultProfileName?: string) {
  const nextDefaultProfileName =
    normalizeProfileName(defaultProfileName) || DEFAULT_PROFILE_NAME;

  if (!getStorage()) {
    return createStoredLibraryState({
      profiles: [createDefaultStoredProfile({ name: nextDefaultProfileName })],
      activeProfileId: DEFAULT_PROFILE_ID,
    });
  }

  const localState = readStoredLocalLibraryState();

  if (hasMeaningfulStoredState(localState)) {
    return localState;
  }

  return createStoredLibraryState({
    profiles: [createDefaultStoredProfile({ name: nextDefaultProfileName })],
    activeProfileId: DEFAULT_PROFILE_ID,
  });
}

async function persistRemoteStoredLibraryState(
  userId: string,
  state: StoredLibraryState,
  meta: RemoteLibraryMeta,
) {
  const client = requireSupabase();
  const nextState = normalizeStoredLibraryStateForRemote(
    createStoredLibraryState(state),
  );
  const nextProfileIds = nextState.profiles.map((profile) => profile.id);
  const { data: existingProfiles, error: existingProfilesError } = await client
    .from(REMOTE_PROFILE_TABLE)
    .select("id")
    .eq("user_id", userId);

  if (existingProfilesError) {
    throw existingProfilesError;
  }

  const staleProfileIds =
    existingProfiles
      ?.map((profile) => String(profile.id))
      .filter((profileId) => !nextProfileIds.includes(profileId)) ?? [];

  if (staleProfileIds.length > 0) {
    const { error: deleteProfilesError } = await client
      .from(REMOTE_PROFILE_TABLE)
      .delete()
      .eq("user_id", userId)
      .in("id", staleProfileIds);

    if (deleteProfilesError) {
      throw deleteProfilesError;
    }
  }

  const remoteProfiles = nextState.profiles.map((profile) => ({
    id: profile.id,
    user_id: userId,
    name: profile.name,
    created_at: profile.createdAt,
    updated_at: profile.meta.updatedAt,
    books: cloneBooks(profile.books),
    catalog_books: cloneCatalogBooks(profile.catalogBooks),
    genre_interests: { ...profile.genreInterests },
    author_experiences: { ...profile.authorExperiences },
    series_experiences: { ...profile.seriesExperiences },
  }));
  const { error: upsertProfilesError } = await client
    .from(REMOTE_PROFILE_TABLE)
    .upsert(remoteProfiles, { onConflict: "id" });

  if (upsertProfilesError) {
    throw upsertProfilesError;
  }

  const { error: upsertSettingsError } = await client
    .from(REMOTE_SETTINGS_TABLE)
    .upsert(
      {
        user_id: userId,
        active_profile_id: nextState.activeProfileId,
        migrated_local_state: meta.migratedLocalState,
        updated_at: meta.updatedAt,
      },
      { onConflict: "user_id" },
    );

  if (upsertSettingsError) {
    throw upsertSettingsError;
  }

  return nextState;
}

async function initializeRemoteStoredLibraryState(
  userId: string,
  defaultProfileName?: string,
): Promise<RemoteLibraryContext> {
  const state = createInitialRemoteStoredLibraryState(defaultProfileName);
  const meta = {
    migratedLocalState: hasMeaningfulStoredState(state),
    updatedAt: new Date().toISOString(),
  };
  const persistedState = await persistRemoteStoredLibraryState(userId, state, meta);

  return {
    userId,
    state: persistedState,
    meta,
  };
}

async function readRemoteStoredLibraryContext(): Promise<RemoteLibraryContext> {
  const client = requireSupabase();
  const user = await getRemoteAuthUser();
  const userId = user.id;
  const username = normalizeProfileName(user.user_metadata?.username);
  const [profilesResult, settingsResult] = await Promise.all([
    client
      .from(REMOTE_PROFILE_TABLE)
      .select(
        "id, user_id, name, created_at, updated_at, books, catalog_books, genre_interests, author_experiences, series_experiences",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    client
      .from(REMOTE_SETTINGS_TABLE)
      .select("user_id, active_profile_id, migrated_local_state, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (profilesResult.error) {
    throw profilesResult.error;
  }

  if (settingsResult.error) {
    throw settingsResult.error;
  }

  const profileRows = (profilesResult.data ?? []) as RemoteProfileRow[];

  if (profileRows.length === 0) {
    return initializeRemoteStoredLibraryState(userId, username);
  }

  const profiles = profileRows.map(normalizeRemoteProfileRow);
  const activeProfileId =
    settingsResult.data?.active_profile_id &&
    profiles.some((profile) => profile.id === settingsResult.data?.active_profile_id)
      ? settingsResult.data.active_profile_id
      : profiles[0].id;
  const state = createStoredLibraryState({
    profiles,
    activeProfileId,
  });
  const meta = {
    migratedLocalState: settingsResult.data?.migrated_local_state === true,
    updatedAt:
      normalizeTimestamp(settingsResult.data?.updated_at) ??
      findActiveStoredProfile(state).meta.updatedAt,
  };

  if (!settingsResult.data || settingsResult.data.active_profile_id !== activeProfileId) {
    await persistRemoteStoredLibraryState(userId, state, meta);
  }

  return {
    userId,
    state,
    meta,
  };
}

async function mutateRemoteStoredState<T>(
  mutation: (context: RemoteLibraryContext) => {
    nextState: StoredLibraryState;
    buildResult: (meta: RemoteLibraryMeta) => T;
    meta?: Partial<RemoteLibraryMeta>;
  },
) {
  const context = await readRemoteStoredLibraryContext();
  const { nextState, buildResult, meta } = mutation(context);
  const nextMeta = {
    migratedLocalState: meta?.migratedLocalState ?? context.meta.migratedLocalState,
    updatedAt: meta?.updatedAt ?? new Date().toISOString(),
  };

  await persistRemoteStoredLibraryState(context.userId, nextState, nextMeta);
  return buildResult(nextMeta);
}

function parseBookPayload(
  value: BookPayload &
    Partial<{
      author: string;
      genre: string;
    }>,
) {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const series = normalizeSeriesName((value as Record<string, unknown>)?.series);
  const seriesNumber = normalizeSeriesNumber(
    (value as Record<string, unknown>)?.seriesNumber,
  );

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

  const rawProgress = (value as Record<string, unknown>)?.progress;
  const progress =
    rawProgress != null && Number.isFinite(Number(rawProgress))
      ? Math.max(0, Math.min(100, Number(rawProgress)))
      : undefined;

  const rawRead = (value as Record<string, unknown>)?.read;
  const read = rawRead === true ? true : undefined;
  const rawReadCount = (value as Record<string, unknown>)?.readCount;
  const parsedReadCount =
    rawReadCount != null && Number.isFinite(Number(rawReadCount))
      ? Math.max(0, Math.floor(Number(rawReadCount)))
      : undefined;
  const lastReadYear = normalizeYear(
    (value as Record<string, unknown>)?.lastReadYear,
  );
  const readCount = normalizeReadCount(
    read,
    progress,
    parsedReadCount,
    lastReadYear,
  );
  const archivedAtYear = normalizeYear(
    (value as Record<string, unknown>)?.archivedAtYear,
  );
  const catalogInfoLink =
    typeof (value as Record<string, unknown>)?.catalogInfoLink === "string"
      ? String((value as Record<string, unknown>)?.catalogInfoLink).trim()
      : "";
  const statsUpdatedAt = normalizeTimestamp(
    (value as Record<string, unknown>)?.statsUpdatedAt,
  );

  const authors = normalizeTagList(value?.authors ?? value?.author);
  const genres = normalizeTagList(value?.genres ?? value?.genre, normalizeGenreTag);
  const moods = normalizeTagList(
    (value as Partial<{ moods: unknown; mood: unknown }>)?.moods ??
      (value as Partial<{ moods: unknown; mood: unknown }>)?.mood,
    normalizeMoodTag,
  );
  const genreAdded = normalizeTagList((value as Record<string, unknown>)?.genreAdded, normalizeGenreTag);
  const genreRemoved = normalizeTagList((value as Record<string, unknown>)?.genreRemoved, normalizeGenreTag);

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
    ...(genreAdded.length > 0 ? { genreAdded } : {}),
    ...(genreRemoved.length > 0 ? { genreRemoved } : {}),
  };
}

function replaceTag(
  tags: string[],
  oldValue: string,
  newValue: string,
  normalizeValue: (value: string) => string = (tag) => tag.trim(),
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

function readLegacyState(): LegacyLibraryData | null {
  const storage = getStorage();

  if (!storage) {
    return null;
  }

  try {
    const rawBooks = storage.getItem(STORAGE_KEY);
    const rawCatalogBooks = storage.getItem(CATALOG_STORAGE_KEY);
    const rawGenreInterests = storage.getItem(GENRE_INTEREST_KEY);
    const rawAuthorExperiences = storage.getItem(AUTHOR_EXP_KEY);
    const rawSeriesExperiences = storage.getItem(SERIES_EXP_KEY);

    const parsedBooks = rawBooks ? (JSON.parse(rawBooks) as unknown) : [];
    const books = Array.isArray(parsedBooks)
      ? parsedBooks
          .map(normalizeBook)
          .filter((book): book is Book => book !== null)
      : [];
    const parsedCatalogBooks = rawCatalogBooks
      ? (JSON.parse(rawCatalogBooks) as unknown)
      : [];
    const catalogBooks = upsertCatalogBooks(
      Array.isArray(parsedCatalogBooks)
        ? parsedCatalogBooks
            .map(normalizeCatalogBook)
            .filter((book): book is CatalogBook => book !== null)
        : [],
      books,
    );
    const genreInterests = rawGenreInterests
      ? normalizeScoreMap(JSON.parse(rawGenreInterests), normalizeGenreTag)
      : {};
    const authorExperiences = rawAuthorExperiences
      ? normalizeScoreMap(JSON.parse(rawAuthorExperiences))
      : {};
    const seriesExperiences = rawSeriesExperiences
      ? normalizeScoreMap(JSON.parse(rawSeriesExperiences))
      : {};

    if (
      books.length === 0 &&
      catalogBooks.length === 0 &&
      Object.keys(genreInterests).length === 0 &&
      Object.keys(authorExperiences).length === 0 &&
      Object.keys(seriesExperiences).length === 0
    ) {
      return null;
    }

    return {
      books,
      catalogBooks,
      genreInterests,
      authorExperiences,
      seriesExperiences,
    };
  } catch {
    return null;
  }
}

function stableMapEntries(value: Record<string, number>) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function sameLibraryData(
  left: LegacyLibraryData,
  right: Pick<
    LibraryState,
    | "books"
    | "catalogBooks"
    | "genreInterests"
    | "authorExperiences"
    | "seriesExperiences"
  >,
) {
  return (
    JSON.stringify(left.books) === JSON.stringify(right.books) &&
    JSON.stringify(left.catalogBooks) === JSON.stringify(right.catalogBooks) &&
    JSON.stringify(stableMapEntries(left.genreInterests)) ===
      JSON.stringify(stableMapEntries(right.genreInterests)) &&
    JSON.stringify(stableMapEntries(left.authorExperiences)) ===
      JSON.stringify(stableMapEntries(right.authorExperiences)) &&
    JSON.stringify(stableMapEntries(left.seriesExperiences)) ===
      JSON.stringify(stableMapEntries(right.seriesExperiences))
  );
}

function readStoredLocalLibraryState(): StoredLibraryState {
  const storage = getStorage();

  if (!storage) {
    return createStoredLibraryState();
  }

  try {
    const rawProfiles = storage.getItem(PROFILES_STORAGE_KEY);
    const rawActiveProfileId = storage.getItem(ACTIVE_PROFILE_STORAGE_KEY);

    if (rawProfiles) {
      const parsedProfiles = JSON.parse(rawProfiles) as unknown;

      if (Array.isArray(parsedProfiles) && parsedProfiles.length > 0) {
        const profiles = parsedProfiles
          .map((profile, index) => {
            const rawProfile =
              profile && typeof profile === "object"
                ? (profile as Partial<StoredProfile>)
                : null;
            const fallback = createDefaultStoredProfile({
              id:
                typeof rawProfile?.id === "string" && rawProfile.id.trim()
                  ? rawProfile.id.trim()
                  : `profile-${index + 1}`,
              name:
                typeof rawProfile?.name === "string" && rawProfile.name.trim()
                  ? rawProfile.name.trim()
                  : `Profile ${index + 1}`,
              createdAt:
                typeof rawProfile?.createdAt === "string"
                  ? rawProfile.createdAt
                  : undefined,
            });

            return createStoredProfile({
              id:
                typeof rawProfile?.id === "string" && rawProfile.id.trim()
                  ? rawProfile.id.trim()
                  : fallback.id,
              name:
                typeof rawProfile?.name === "string" && rawProfile.name.trim()
                  ? rawProfile.name
                  : fallback.name,
              createdAt: rawProfile?.createdAt ?? fallback.createdAt,
              books: Array.isArray(rawProfile?.books)
                ? rawProfile.books
                    .map(normalizeBook)
                    .filter((book): book is Book => book !== null)
                : fallback.books,
              catalogBooks: Array.isArray(rawProfile?.catalogBooks)
                ? rawProfile.catalogBooks
                    .map(normalizeCatalogBook)
                    .filter((book): book is CatalogBook => book !== null)
                : fallback.catalogBooks,
              genreInterests:
                rawProfile?.genreInterests != null
                  ? normalizeScoreMap(rawProfile.genreInterests, normalizeGenreTag)
                  : fallback.genreInterests,
              authorExperiences:
                rawProfile?.authorExperiences != null
                  ? normalizeScoreMap(rawProfile.authorExperiences)
                  : fallback.authorExperiences,
              seriesExperiences:
                rawProfile?.seriesExperiences != null
                  ? normalizeScoreMap(rawProfile.seriesExperiences)
                  : fallback.seriesExperiences,
              meta: {
                seeded: rawProfile?.meta?.seeded === true,
                migratedLocalState: rawProfile?.meta?.migratedLocalState === true,
                updatedAt:
                  normalizeTimestamp(rawProfile?.meta?.updatedAt) ??
                  fallback.meta.updatedAt,
              },
            });
          })
          .filter(
            (profile, index, allProfiles) =>
              allProfiles.findIndex((entry) => entry.id === profile.id) === index,
          );

        if (profiles.length > 0) {
          return createStoredLibraryState({
            profiles,
            activeProfileId:
              rawActiveProfileId &&
              profiles.some((profile) => profile.id === rawActiveProfileId)
                ? rawActiveProfileId
                : profiles[0].id,
          });
        }
      }
    }
  } catch {
    // Ignore invalid storage and fall back to legacy/local defaults.
  }

  const legacyState = readLegacyState();

  if (!legacyState) {
    return createStoredLibraryState();
  }

  const createdAt = new Date().toISOString();
  return createStoredLibraryState({
    profiles: [
      createDefaultStoredProfile({
        createdAt,
        books: legacyState.books,
        catalogBooks: legacyState.catalogBooks,
        genreInterests: legacyState.genreInterests,
        authorExperiences: legacyState.authorExperiences,
        seriesExperiences: legacyState.seriesExperiences,
      }),
    ],
    activeProfileId: DEFAULT_PROFILE_ID,
  });
}

function writeStoredLocalLibraryState(state: StoredLibraryState) {
  const storage = requireStorage();
  const nextState = createStoredLibraryState(state);
  const activeProfile = findActiveStoredProfile(nextState);

  storage.setItem(
    PROFILES_STORAGE_KEY,
    JSON.stringify(nextState.profiles.map(cloneStoredProfile)),
  );
  storage.setItem(ACTIVE_PROFILE_STORAGE_KEY, nextState.activeProfileId);
  storage.setItem(STORAGE_KEY, JSON.stringify(cloneBooks(activeProfile.books)));
  storage.setItem(
    CATALOG_STORAGE_KEY,
    JSON.stringify(cloneCatalogBooks(activeProfile.catalogBooks)),
  );
  storage.setItem(GENRE_INTEREST_KEY, JSON.stringify(activeProfile.genreInterests));
  storage.setItem(
    AUTHOR_EXP_KEY,
    JSON.stringify(activeProfile.authorExperiences),
  );
  storage.setItem(
    SERIES_EXP_KEY,
    JSON.stringify(activeProfile.seriesExperiences),
  );

  return nextState;
}

function readLocalLibraryState(): LibraryState {
  return toLibraryState(readStoredLocalLibraryState());
}

function writeLocalBooks(books: Book[]) {
  const state = readStoredLocalLibraryState();
  const activeProfile = findActiveStoredProfile(state);
  const nextBooks = cloneBooks(books);
  const nextProfile = createStoredProfile({
    ...activeProfile,
    books: nextBooks,
    catalogBooks: upsertCatalogBooks(activeProfile.catalogBooks, nextBooks),
    meta: {
      ...activeProfile.meta,
      seeded: false,
      updatedAt: new Date().toISOString(),
    },
  });

  writeStoredLocalLibraryState(replaceActiveStoredProfile(state, nextProfile));
  return nextBooks;
}

function writeLocalCatalogBooks(catalogBooks: CatalogBook[]) {
  const state = readStoredLocalLibraryState();
  const activeProfile = findActiveStoredProfile(state);
  const nextCatalogBooks = cloneCatalogBooks(catalogBooks);
  const nextProfile = createStoredProfile({
    ...activeProfile,
    catalogBooks: nextCatalogBooks,
    meta: {
      ...activeProfile.meta,
      seeded: false,
      updatedAt: new Date().toISOString(),
    },
  });

  writeStoredLocalLibraryState(replaceActiveStoredProfile(state, nextProfile));
  return nextCatalogBooks;
}

function readLocalBooks() {
  return cloneBooks(findActiveStoredProfile(readStoredLocalLibraryState()).books);
}

function readLocalCatalogBooks() {
  return cloneCatalogBooks(
    findActiveStoredProfile(readStoredLocalLibraryState()).catalogBooks,
  );
}

function writeLocalMap(storageKey: string, nextMap: Record<string, number>) {
  const state = readStoredLocalLibraryState();
  const activeProfile = findActiveStoredProfile(state);
  const nextProfile = createStoredProfile({
    ...activeProfile,
    ...(storageKey === GENRE_INTEREST_KEY
      ? { genreInterests: { ...nextMap } }
      : storageKey === AUTHOR_EXP_KEY
        ? { authorExperiences: { ...nextMap } }
        : { seriesExperiences: { ...nextMap } }),
    meta: {
      ...activeProfile.meta,
      seeded: false,
      updatedAt: new Date().toISOString(),
    },
  });

  writeStoredLocalLibraryState(replaceActiveStoredProfile(state, nextProfile));
  return { ...nextMap };
}

function readLocalGenreInterests() {
  return {
    ...findActiveStoredProfile(readStoredLocalLibraryState()).genreInterests,
  };
}

function readLocalAuthorExperiences() {
  return {
    ...findActiveStoredProfile(readStoredLocalLibraryState()).authorExperiences,
  };
}

function readLocalSeriesExperiences() {
  return {
    ...findActiveStoredProfile(readStoredLocalLibraryState()).seriesExperiences,
  };
}

async function migrateLegacyStateIfNeeded(libraryState: LibraryState) {
  const storage = getStorage();

  if (!storage) {
    return libraryState;
  }

  if (storage.getItem(BACKEND_MIGRATION_KEY) === "true") {
    return libraryState;
  }

  const legacyState = readLegacyState();

  if (!legacyState) {
    storage.setItem(BACKEND_MIGRATION_KEY, "true");
    return libraryState;
  }

  if (!libraryState.meta.seeded) {
    storage.setItem(BACKEND_MIGRATION_KEY, "true");
    return libraryState;
  }

  if (sameLibraryData(legacyState, libraryState)) {
    storage.setItem(BACKEND_MIGRATION_KEY, "true");
    return libraryState;
  }

  const migratedState = await requestJson<LibraryState>("/api/library/import", {
    method: "POST",
    body: JSON.stringify(legacyState),
  });

  storage.setItem(BACKEND_MIGRATION_KEY, "true");
  return migratedState;
}

function withNativeRatingStats(
  libraryState: LibraryState,
  options: { persistLocal?: boolean } = {},
) {
  const nextBooks = applySiteRatingStats(libraryState.books);

  if (options.persistLocal && getStorage()) {
    writeLocalBooks(nextBooks);
    writeLocalCatalogBooks(libraryState.catalogBooks);
  }

  return {
    ...libraryState,
    books: nextBooks,
  };
}

function sanitizeBookPayload(payload: BookPayload) {
  const {
    starRating: _starRating,
    ratingCount: _ratingCount,
    catalogInfoLink: _catalogInfoLink,
    statsUpdatedAt: _statsUpdatedAt,
    ...rest
  } = payload;

  return rest;
}

export async function fetchLibraryState() {
  if (isSupabaseConfigured) {
    const context = await readRemoteStoredLibraryContext();
    return createRemoteStoredLibraryStateResult(context.state, context.meta);
  }

  try {
    const libraryState = await requestJson<LibraryState>("/api/library");
    return withNativeRatingStats(await migrateLegacyStateIfNeeded(libraryState));
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      return withNativeRatingStats(readLocalLibraryState(), {
        persistLocal: true,
      });
    }

    throw error;
  }
}

export async function createProfile(name: string) {
  const nextName = name.trim().replace(/\s+/g, " ");

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!nextName) {
        throw new Error("Profile name is required.");
      }

      const nameTaken = state.profiles.some(
        (profile) =>
          profile.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      );

      if (nameTaken) {
        throw new Error("A profile with that name already exists.");
      }

      const nextProfile = createStoredProfile({
        id: createProfileId(),
        name: nextName,
      });
      const nextState = createStoredLibraryState({
        profiles: [...state.profiles, nextProfile],
        activeProfileId: nextProfile.id,
      });

      return {
        nextState,
        buildResult: (meta) =>
          createRemoteStoredLibraryStateResult(nextState, {
            ...meta,
            updatedAt: nextProfile.meta.updatedAt,
          }),
        meta: {
          updatedAt: nextProfile.meta.updatedAt,
        },
      };
    });
  }

  try {
    return withNativeRatingStats(
      await requestJson<LibraryState>("/api/profiles", {
        method: "POST",
        body: JSON.stringify({ name: nextName }),
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!nextName) {
      throw new Error("Profile name is required.");
    }

    const state = readStoredLocalLibraryState();
    const nameTaken = state.profiles.some(
      (profile) => profile.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
    );

    if (nameTaken) {
      throw new Error("A profile with that name already exists.");
    }

    const nextProfile = createStoredProfile({
      id: createProfileId(),
      name: nextName,
    });
    const nextState = writeStoredLocalLibraryState({
      profiles: [...state.profiles, nextProfile],
      activeProfileId: nextProfile.id,
    });

    return withNativeRatingStats(toLibraryState(nextState), {
      persistLocal: true,
    });
  }
}

export async function updateProfile(profileId: string, name: string) {
  const nextProfileId = profileId.trim();
  const nextName = name.trim().replace(/\s+/g, " ");

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!nextProfileId) {
        throw new Error("Profile id is required.");
      }

      if (!nextName) {
        throw new Error("Profile name is required.");
      }

      const currentProfile = state.profiles.find(
        (profile) => profile.id === nextProfileId,
      );

      if (!currentProfile) {
        throw new Error("Profile not found.");
      }

      const nameTaken = state.profiles.some(
        (profile) =>
          profile.id !== nextProfileId &&
          profile.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      );

      if (nameTaken) {
        throw new Error("A profile with that name already exists.");
      }

      const updatedAt = new Date().toISOString();
      const nextState = createStoredLibraryState({
        profiles: state.profiles.map((profile) =>
          profile.id === nextProfileId
            ? createStoredProfile({
                ...profile,
                name: nextName,
                meta: {
                  ...profile.meta,
                  updatedAt,
                },
              })
            : profile,
        ),
        activeProfileId: state.activeProfileId,
      });

      return {
        nextState,
        buildResult: (meta) => createRemoteStoredLibraryStateResult(nextState, meta),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return withNativeRatingStats(
      await requestJson<LibraryState>(`/api/profiles/${encodeURIComponent(nextProfileId)}`, {
        method: "PUT",
        body: JSON.stringify({ name: nextName }),
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!nextProfileId) {
      throw new Error("Profile id is required.");
    }

    if (!nextName) {
      throw new Error("Profile name is required.");
    }

    const state = readStoredLocalLibraryState();
    const currentProfile = state.profiles.find(
      (profile) => profile.id === nextProfileId,
    );

    if (!currentProfile) {
      throw new Error("Profile not found.");
    }

    const nameTaken = state.profiles.some(
      (profile) =>
        profile.id !== nextProfileId &&
        profile.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
    );

    if (nameTaken) {
      throw new Error("A profile with that name already exists.");
    }

    const nextState = writeStoredLocalLibraryState({
      profiles: state.profiles.map((profile) =>
        profile.id === nextProfileId
          ? createStoredProfile({
              ...profile,
              name: nextName,
            })
          : profile,
      ),
      activeProfileId: state.activeProfileId,
    });

    return withNativeRatingStats(toLibraryState(nextState), {
      persistLocal: true,
    });
  }
}

export async function setActiveProfile(profileId: string) {
  const nextProfileId = profileId.trim();

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!nextProfileId) {
        throw new Error("Profile id is required.");
      }

      if (!state.profiles.some((profile) => profile.id === nextProfileId)) {
        throw new Error("Profile not found.");
      }

      const nextState = createStoredLibraryState({
        profiles: state.profiles,
        activeProfileId: nextProfileId,
      });

      return {
        nextState,
        buildResult: (meta) => createRemoteStoredLibraryStateResult(nextState, meta),
      };
    });
  }

  try {
    return withNativeRatingStats(
      await requestJson<LibraryState>("/api/profiles/active", {
        method: "PUT",
        body: JSON.stringify({ profileId: nextProfileId }),
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!nextProfileId) {
      throw new Error("Profile id is required.");
    }

    const state = readStoredLocalLibraryState();

    if (!state.profiles.some((profile) => profile.id === nextProfileId)) {
      throw new Error("Profile not found.");
    }

    const nextState = writeStoredLocalLibraryState({
      profiles: state.profiles,
      activeProfileId: nextProfileId,
    });

    return withNativeRatingStats(toLibraryState(nextState), {
      persistLocal: true,
    });
  }
}

export async function deleteProfile(profileId: string) {
  const nextProfileId = profileId.trim();

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!nextProfileId) {
        throw new Error("Profile id is required.");
      }

      if (state.profiles.length <= 1) {
        throw new Error("You need at least one profile.");
      }

      const profileIndex = state.profiles.findIndex(
        (profile) => profile.id === nextProfileId,
      );

      if (profileIndex === -1) {
        throw new Error("Profile not found.");
      }

      const nextProfiles = state.profiles.filter(
        (profile) => profile.id !== nextProfileId,
      );
      const fallbackProfile =
        nextProfiles[profileIndex] ?? nextProfiles[Math.max(0, profileIndex - 1)];
      const nextState = createStoredLibraryState({
        profiles: nextProfiles,
        activeProfileId:
          state.activeProfileId === nextProfileId
            ? fallbackProfile.id
            : state.activeProfileId,
      });

      return {
        nextState,
        buildResult: (meta) => createRemoteStoredLibraryStateResult(nextState, meta),
      };
    });
  }

  try {
    return withNativeRatingStats(
      await requestJson<LibraryState>(`/api/profiles/${encodeURIComponent(nextProfileId)}`, {
        method: "DELETE",
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!nextProfileId) {
      throw new Error("Profile id is required.");
    }

    const state = readStoredLocalLibraryState();

    if (state.profiles.length <= 1) {
      throw new Error("You need at least one profile.");
    }

    const profileIndex = state.profiles.findIndex(
      (profile) => profile.id === nextProfileId,
    );

    if (profileIndex === -1) {
      throw new Error("Profile not found.");
    }

    const nextProfiles = state.profiles.filter(
      (profile) => profile.id !== nextProfileId,
    );
    const fallbackProfile =
      nextProfiles[profileIndex] ?? nextProfiles[Math.max(0, profileIndex - 1)];
    const nextState = writeStoredLocalLibraryState({
      profiles: nextProfiles,
      activeProfileId:
        state.activeProfileId === nextProfileId
          ? fallbackProfile.id
          : state.activeProfileId,
    });

    return withNativeRatingStats(toLibraryState(nextState), {
      persistLocal: true,
    });
  }
}

export async function fetchBooks() {
  const libraryState = await fetchLibraryState();
  return libraryState.books;
}

export async function createBookRecord(payload: BookPayload) {
  const sanitizedPayload = sanitizeBookPayload(payload);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const nextBook = parseBookPayload(sanitizedPayload);
      const activeProfile = findActiveStoredProfile(state);
      const nextId =
        activeProfile.books.reduce((maxId, book) => Math.max(maxId, book.id), 0) + 1;
      const updatedAt = new Date().toISOString();
      const nextBooks = [
        ...activeProfile.books,
        {
          id: nextId,
          ...nextBook,
        },
      ];
      const nextProfile = createStoredProfile({
        ...activeProfile,
        books: nextBooks,
        catalogBooks: upsertCatalogBooks(activeProfile.catalogBooks, [nextBook]),
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => applySiteRatingStats(nextBooks),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return applySiteRatingStats(
      await requestJson<Book[]>("/api/books", {
        method: "POST",
        body: JSON.stringify(sanitizedPayload),
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const nextBook = parseBookPayload(sanitizedPayload);
    const books = readLocalBooks();
    const catalogBooks = readLocalCatalogBooks();
    const nextId = books.reduce((maxId, book) => Math.max(maxId, book.id), 0) + 1;
    const nextCatalogBooks = upsertCatalogBooks(catalogBooks, [nextBook]);
    writeLocalCatalogBooks(nextCatalogBooks);

    return writeLocalBooks(
      applySiteRatingStats([
        ...books,
        {
          id: nextId,
          ...nextBook,
        },
      ]),
    );
  }
}

export async function updateBookRecord(id: number, payload: BookPayload) {
  const sanitizedPayload = sanitizeBookPayload(payload);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!Number.isFinite(id)) {
        throw new Error("Book id is required.");
      }

      const nextBook = parseBookPayload(sanitizedPayload);
      const activeProfile = findActiveStoredProfile(state);
      const hasMatch = activeProfile.books.some((book) => book.id === id);

      if (!hasMatch) {
        throw new Error("Book not found.");
      }

      const updatedAt = new Date().toISOString();
      const nextBooks = activeProfile.books.map((book) =>
        book.id === id ? { id: book.id, ...nextBook } : book,
      );
      const nextProfile = createStoredProfile({
        ...activeProfile,
        books: nextBooks,
        catalogBooks: upsertCatalogBooks(activeProfile.catalogBooks, [nextBook]),
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => applySiteRatingStats(nextBooks),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return applySiteRatingStats(
      await requestJson<Book[]>(`/api/books/${id}`, {
        method: "PUT",
        body: JSON.stringify(sanitizedPayload),
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!Number.isFinite(id)) {
      throw new Error("Book id is required.");
    }

    const nextBook = parseBookPayload(sanitizedPayload);
    const books = readLocalBooks();
    const catalogBooks = readLocalCatalogBooks();
    const hasMatch = books.some((book) => book.id === id);

    if (!hasMatch) {
      throw new Error("Book not found.");
    }

    writeLocalCatalogBooks(upsertCatalogBooks(catalogBooks, [nextBook]));

    return writeLocalBooks(
      applySiteRatingStats(
        books.map((book) => (book.id === id ? { id: book.id, ...nextBook } : book)),
      ),
    );
  }
}

export async function deleteBookRecord(id: number) {
  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!Number.isFinite(id)) {
        throw new Error("Book id is required.");
      }

      const activeProfile = findActiveStoredProfile(state);
      const nextBooks = activeProfile.books.filter((book) => book.id !== id);

      if (nextBooks.length === activeProfile.books.length) {
        throw new Error("Book not found.");
      }

      const updatedAt = new Date().toISOString();
      const nextProfile = createStoredProfile({
        ...activeProfile,
        books: nextBooks,
        catalogBooks: cloneCatalogBooks(activeProfile.catalogBooks),
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => applySiteRatingStats(nextBooks),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return applySiteRatingStats(
      await requestJson<Book[]>(`/api/books/${id}`, {
        method: "DELETE",
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!Number.isFinite(id)) {
      throw new Error("Book id is required.");
    }

    const books = readLocalBooks();
    const nextBooks = books.filter((book) => book.id !== id);

    if (nextBooks.length === books.length) {
      throw new Error("Book not found.");
    }

    writeLocalCatalogBooks(readLocalCatalogBooks());
    return writeLocalBooks(applySiteRatingStats(nextBooks));
  }
}

export async function readGenreInterests() {
  const libraryState = await fetchLibraryState();
  return libraryState.genreInterests;
}

export async function writeGenreInterest(genre: string, interest: number) {
  const nextGenre = normalizeGenreTag(genre);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!nextGenre) {
        throw new Error("Genre is required.");
      }

      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = {
        ...activeProfile.genreInterests,
        [nextGenre]: Math.max(0, Math.min(5, Number(interest))),
      };
      const nextProfile = createStoredProfile({
        ...activeProfile,
        genreInterests: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<GenreInterestMap>(
      `/api/genre-interests/${encodeURIComponent(nextGenre)}`,
      {
        method: "PUT",
        body: JSON.stringify({ interest }),
      },
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!nextGenre) {
      throw new Error("Genre is required.");
    }

    const map = readLocalGenreInterests();
    map[nextGenre] = Math.max(0, Math.min(5, Number(interest)));
    return writeLocalMap(GENRE_INTEREST_KEY, map);
  }
}

export async function deleteGenreInterest(genre: string) {
  const nextGenre = normalizeGenreTag(genre);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = { ...activeProfile.genreInterests };
      delete nextMap[nextGenre];
      const nextProfile = createStoredProfile({
        ...activeProfile,
        genreInterests: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<GenreInterestMap>(
      `/api/genre-interests/${encodeURIComponent(nextGenre)}`,
      {
        method: "DELETE",
      },
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const map = readLocalGenreInterests();
    delete map[nextGenre];
    return writeLocalMap(GENRE_INTEREST_KEY, map);
  }
}

export async function renameGenreInterest(oldGenre: string, newGenre: string) {
  const oldValue = normalizeGenreTag(oldGenre);
  const nextValue = normalizeGenreTag(newGenre);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = { ...activeProfile.genreInterests };

      if (oldValue in nextMap) {
        if (nextValue) {
          nextMap[nextValue] = nextMap[oldValue];
        }
        delete nextMap[oldValue];
      }

      const nextProfile = createStoredProfile({
        ...activeProfile,
        genreInterests: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<GenreInterestMap>("/api/genre-interests/rename", {
      method: "POST",
      body: JSON.stringify({ oldGenre: oldValue, newGenre: nextValue }),
    });
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const map = readLocalGenreInterests();

    if (oldValue in map) {
      if (nextValue) {
        map[nextValue] = map[oldValue];
      }
      delete map[oldValue];
    }

    return writeLocalMap(GENRE_INTEREST_KEY, map);
  }
}

export async function renameGenreInBooks(oldGenre: string, newGenre: string) {
  const oldValue = normalizeGenreTag(oldGenre);
  const nextValue = normalizeGenreTag(newGenre);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextBooks = activeProfile.books.map((book) => ({
        ...book,
        genres: replaceTag(book.genres, oldValue, nextValue, normalizeGenreTag),
        genreAdded: replaceTag(book.genreAdded ?? [], oldValue, nextValue, normalizeGenreTag),
        genreRemoved: replaceTag(book.genreRemoved ?? [], oldValue, nextValue, normalizeGenreTag),
      }));
      const nextProfile = createStoredProfile({
        ...activeProfile,
        books: nextBooks,
        catalogBooks: upsertCatalogBooks(activeProfile.catalogBooks, nextBooks),
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => applySiteRatingStats(nextBooks),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return applySiteRatingStats(
      await requestJson<Book[]>("/api/books/genres/rename", {
        method: "POST",
        body: JSON.stringify({ oldGenre: oldValue, newGenre: nextValue }),
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const books = readLocalBooks();
    const nextBooks = books.map((book) => ({
      ...book,
      genres: replaceTag(book.genres, oldValue, nextValue, normalizeGenreTag),
      genreAdded: replaceTag(book.genreAdded ?? [], oldValue, nextValue, normalizeGenreTag),
      genreRemoved: replaceTag(book.genreRemoved ?? [], oldValue, nextValue, normalizeGenreTag),
    }));
    writeLocalCatalogBooks(upsertCatalogBooks(readLocalCatalogBooks(), nextBooks));
    return writeLocalBooks(applySiteRatingStats(nextBooks));
  }
}

export async function readAuthorExperiences() {
  const libraryState = await fetchLibraryState();
  return libraryState.authorExperiences;
}

export async function readSeriesExperiences() {
  const libraryState = await fetchLibraryState();
  return libraryState.seriesExperiences;
}

export async function writeAuthorExperience(author: string, experience: number) {
  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const nextAuthor = author.trim();

      if (!nextAuthor) {
        throw new Error("Author is required.");
      }

      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = {
        ...activeProfile.authorExperiences,
        [nextAuthor]: Math.max(0, Math.min(5, Number(experience))),
      };
      const nextProfile = createStoredProfile({
        ...activeProfile,
        authorExperiences: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<AuthorExperienceMap>(
      `/api/author-experiences/${encodeURIComponent(author)}`,
      {
        method: "PUT",
        body: JSON.stringify({ experience }),
      },
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const nextAuthor = author.trim();

    if (!nextAuthor) {
      throw new Error("Author is required.");
    }

    const map = readLocalAuthorExperiences();
    map[nextAuthor] = Math.max(0, Math.min(5, Number(experience)));
    return writeLocalMap(AUTHOR_EXP_KEY, map);
  }
}

export async function deleteAuthorExperience(author: string) {
  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = { ...activeProfile.authorExperiences };
      delete nextMap[author.trim()];
      const nextProfile = createStoredProfile({
        ...activeProfile,
        authorExperiences: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<AuthorExperienceMap>(
      `/api/author-experiences/${encodeURIComponent(author)}`,
      {
        method: "DELETE",
      },
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const map = readLocalAuthorExperiences();
    delete map[author.trim()];
    return writeLocalMap(AUTHOR_EXP_KEY, map);
  }
}

export async function writeSeriesExperience(series: string, experience: number) {
  const nextSeries = normalizeSeriesName(series);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      if (!nextSeries) {
        throw new Error("Series is required.");
      }

      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = {
        ...activeProfile.seriesExperiences,
        [nextSeries]: Math.max(0, Math.min(5, Number(experience))),
      };
      const nextProfile = createStoredProfile({
        ...activeProfile,
        seriesExperiences: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<SeriesExperienceMap>(
      `/api/series-experiences/${encodeURIComponent(nextSeries)}`,
      {
        method: "PUT",
        body: JSON.stringify({ experience }),
      },
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!nextSeries) {
      throw new Error("Series is required.");
    }

    const map = readLocalSeriesExperiences();
    map[nextSeries] = Math.max(0, Math.min(5, Number(experience)));
    return writeLocalMap(SERIES_EXP_KEY, map);
  }
}

export async function deleteSeriesExperience(series: string) {
  const nextSeries = normalizeSeriesName(series);

  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = { ...activeProfile.seriesExperiences };
      delete nextMap[nextSeries];
      const nextProfile = createStoredProfile({
        ...activeProfile,
        seriesExperiences: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<SeriesExperienceMap>(
      `/api/series-experiences/${encodeURIComponent(nextSeries)}`,
      {
        method: "DELETE",
      },
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const map = readLocalSeriesExperiences();
    delete map[nextSeries];
    return writeLocalMap(SERIES_EXP_KEY, map);
  }
}

export async function renameAuthorExperience(
  oldAuthor: string,
  newAuthor: string,
) {
  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextMap = { ...activeProfile.authorExperiences };
      const oldValue = oldAuthor.trim();
      const nextValue = newAuthor.trim();

      if (oldValue in nextMap) {
        if (nextValue) {
          nextMap[nextValue] = nextMap[oldValue];
        }
        delete nextMap[oldValue];
      }

      const nextProfile = createStoredProfile({
        ...activeProfile,
        authorExperiences: nextMap,
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => ({ ...nextMap }),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return await requestJson<AuthorExperienceMap>("/api/author-experiences/rename", {
      method: "POST",
      body: JSON.stringify({ oldAuthor, newAuthor }),
    });
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const map = readLocalAuthorExperiences();
    const oldValue = oldAuthor.trim();
    const nextValue = newAuthor.trim();

    if (oldValue in map) {
      if (nextValue) {
        map[nextValue] = map[oldValue];
      }
      delete map[oldValue];
    }

    return writeLocalMap(AUTHOR_EXP_KEY, map);
  }
}

export async function renameAuthorInBooks(oldAuthor: string, newAuthor: string) {
  if (isSupabaseConfigured) {
    return mutateRemoteStoredState(({ state }) => {
      const activeProfile = findActiveStoredProfile(state);
      const updatedAt = new Date().toISOString();
      const nextBooks = activeProfile.books.map((book) => ({
        ...book,
        authors: replaceTag(book.authors, oldAuthor, newAuthor),
      }));
      const nextProfile = createStoredProfile({
        ...activeProfile,
        books: nextBooks,
        catalogBooks: upsertCatalogBooks(activeProfile.catalogBooks, nextBooks),
        meta: {
          ...activeProfile.meta,
          seeded: false,
          updatedAt,
        },
      });
      const nextState = replaceActiveStoredProfile(state, nextProfile);

      return {
        nextState,
        buildResult: () => applySiteRatingStats(nextBooks),
        meta: {
          updatedAt,
        },
      };
    });
  }

  try {
    return applySiteRatingStats(
      await requestJson<Book[]>("/api/books/authors/rename", {
        method: "POST",
        body: JSON.stringify({ oldAuthor, newAuthor }),
      }),
    );
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const books = readLocalBooks();
    const nextBooks = books.map((book) => ({
      ...book,
      authors: replaceTag(book.authors, oldAuthor, newAuthor),
    }));
    writeLocalCatalogBooks(upsertCatalogBooks(readLocalCatalogBooks(), nextBooks));
    return writeLocalBooks(applySiteRatingStats(nextBooks));
  }
}
