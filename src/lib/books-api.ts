export type Book = {
  id: number;
  title: string;
  authors: string[];
  genres: string[];
  starRating?: number;
  ratingCount?: number;
  myRating?: number;
  progress?: number;
  read?: boolean;
  readCount?: number;
  lastReadYear?: number;
  archivedAtYear?: number;
};

export type BookPayload = Omit<Book, "id">;
export type GenreInterestMap = Record<string, number>;
export type AuthorExperienceMap = Record<string, number>;

export type LibraryState = {
  books: Book[];
  genreInterests: GenreInterestMap;
  authorExperiences: AuthorExperienceMap;
  meta: {
    seeded: boolean;
    migratedLocalState: boolean;
    updatedAt: string;
  };
};

type LegacyBook = Partial<Book> & {
  author?: unknown;
  genre?: unknown;
  authors?: unknown;
  genres?: unknown;
};

const STORAGE_KEY = "book-ranker.books.v1";
const GENRE_INTEREST_KEY = "book-ranker.genre-interests.v1";
const AUTHOR_EXP_KEY = "book-ranker.author-experiences.v1";
const BACKEND_MIGRATION_KEY = "book-ranker.backend-migrated.v1";

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const payload =
    response.headers.get("content-type")?.includes("application/json")
      ? ((await response.json()) as { message?: string })
      : null;

  if (!response.ok) {
    throw new Error(
      payload?.message || `Request failed with status ${response.status}.`,
    );
  }

  return payload as T;
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

function normalizeTagList(value: unknown) {
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

    const trimmed = rawValue.trim();

    if (trimmed) {
      seen.add(trimmed);
    }
  }

  return Array.from(seen);
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
  const authors = normalizeTagList(book?.authors ?? book?.author);
  const genres = normalizeTagList(book?.genres ?? book?.genre);

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
    authors,
    genres,
    ...(starRating != null ? { starRating } : {}),
    ...(ratingCount != null ? { ratingCount } : {}),
    ...(myRating != null ? { myRating } : {}),
    ...(progress != null ? { progress } : {}),
    ...(read != null ? { read } : {}),
    ...(readCount != null ? { readCount } : {}),
    ...(lastReadYear != null ? { lastReadYear } : {}),
    ...(archivedAtYear != null ? { archivedAtYear } : {}),
  };
}

function normalizeScoreMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim() || !Number.isFinite(Number(rawValue))) {
      continue;
    }

    result[key.trim()] = Math.max(0, Math.min(5, Number(rawValue)));
  }

  return result;
}

function readLegacyState(): Omit<LibraryState, "meta"> | null {
  const storage = getStorage();

  if (!storage) {
    return null;
  }

  try {
    const rawBooks = storage.getItem(STORAGE_KEY);
    const rawGenreInterests = storage.getItem(GENRE_INTEREST_KEY);
    const rawAuthorExperiences = storage.getItem(AUTHOR_EXP_KEY);

    const parsedBooks = rawBooks ? (JSON.parse(rawBooks) as unknown) : [];
    const books = Array.isArray(parsedBooks)
      ? parsedBooks
          .map(normalizeBook)
          .filter((book): book is Book => book !== null)
      : [];
    const genreInterests = rawGenreInterests
      ? normalizeScoreMap(JSON.parse(rawGenreInterests))
      : {};
    const authorExperiences = rawAuthorExperiences
      ? normalizeScoreMap(JSON.parse(rawAuthorExperiences))
      : {};

    if (
      books.length === 0 &&
      Object.keys(genreInterests).length === 0 &&
      Object.keys(authorExperiences).length === 0
    ) {
      return null;
    }

    return {
      books,
      genreInterests,
      authorExperiences,
    };
  } catch {
    return null;
  }
}

function stableMapEntries(value: Record<string, number>) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function sameLibraryData(
  left: Omit<LibraryState, "meta">,
  right: Pick<LibraryState, "books" | "genreInterests" | "authorExperiences">,
) {
  return (
    JSON.stringify(left.books) === JSON.stringify(right.books) &&
    JSON.stringify(stableMapEntries(left.genreInterests)) ===
      JSON.stringify(stableMapEntries(right.genreInterests)) &&
    JSON.stringify(stableMapEntries(left.authorExperiences)) ===
      JSON.stringify(stableMapEntries(right.authorExperiences))
  );
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

export async function fetchLibraryState() {
  const libraryState = await requestJson<LibraryState>("/api/library");
  return migrateLegacyStateIfNeeded(libraryState);
}

export async function fetchBooks() {
  const libraryState = await fetchLibraryState();
  return libraryState.books;
}

export async function createBookRecord(payload: BookPayload) {
  return requestJson<Book[]>("/api/books", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateBookRecord(id: number, payload: BookPayload) {
  return requestJson<Book[]>(`/api/books/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteBookRecord(id: number) {
  return requestJson<Book[]>(`/api/books/${id}`, {
    method: "DELETE",
  });
}

export async function readGenreInterests() {
  const libraryState = await fetchLibraryState();
  return libraryState.genreInterests;
}

export async function writeGenreInterest(genre: string, interest: number) {
  return requestJson<GenreInterestMap>(
    `/api/genre-interests/${encodeURIComponent(genre)}`,
    {
      method: "PUT",
      body: JSON.stringify({ interest }),
    },
  );
}

export async function deleteGenreInterest(genre: string) {
  return requestJson<GenreInterestMap>(
    `/api/genre-interests/${encodeURIComponent(genre)}`,
    {
      method: "DELETE",
    },
  );
}

export async function renameGenreInterest(oldGenre: string, newGenre: string) {
  return requestJson<GenreInterestMap>("/api/genre-interests/rename", {
    method: "POST",
    body: JSON.stringify({ oldGenre, newGenre }),
  });
}

export async function renameGenreInBooks(oldGenre: string, newGenre: string) {
  return requestJson<Book[]>("/api/books/genres/rename", {
    method: "POST",
    body: JSON.stringify({ oldGenre, newGenre }),
  });
}

export async function readAuthorExperiences() {
  const libraryState = await fetchLibraryState();
  return libraryState.authorExperiences;
}

export async function writeAuthorExperience(author: string, experience: number) {
  return requestJson<AuthorExperienceMap>(
    `/api/author-experiences/${encodeURIComponent(author)}`,
    {
      method: "PUT",
      body: JSON.stringify({ experience }),
    },
  );
}

export async function deleteAuthorExperience(author: string) {
  return requestJson<AuthorExperienceMap>(
    `/api/author-experiences/${encodeURIComponent(author)}`,
    {
      method: "DELETE",
    },
  );
}

export async function renameAuthorExperience(
  oldAuthor: string,
  newAuthor: string,
) {
  return requestJson<AuthorExperienceMap>("/api/author-experiences/rename", {
    method: "POST",
    body: JSON.stringify({ oldAuthor, newAuthor }),
  });
}

export async function renameAuthorInBooks(oldAuthor: string, newAuthor: string) {
  return requestJson<Book[]>("/api/books/authors/rename", {
    method: "POST",
    body: JSON.stringify({ oldAuthor, newAuthor }),
  });
}
