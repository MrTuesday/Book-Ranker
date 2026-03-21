export type Book = {
  id: number;
  title: string;
  authors: string[];
  genres: string[];
  moods: string[];
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
  mood?: unknown;
  authors?: unknown;
  genres?: unknown;
  moods?: unknown;
};

const STORAGE_KEY = "book-ranker.books.v1";
const GENRE_INTEREST_KEY = "book-ranker.genre-interests.v1";
const AUTHOR_EXP_KEY = "book-ranker.author-experiences.v1";
const BACKEND_MIGRATION_KEY = "book-ranker.backend-migrated.v1";

class BackendUnavailableError extends Error {
  constructor(message = "Backend is unavailable.") {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

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

  return trimmed
    .toLocaleLowerCase()
    .replace(/(^|[\s/-])\p{L}/gu, (match) => match.toLocaleUpperCase());
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
  }));
}

function localLibraryState(
  overrides: Partial<Omit<LibraryState, "meta">> = {},
): LibraryState {
  return {
    books: cloneBooks(overrides.books ?? []),
    genreInterests: { ...(overrides.genreInterests ?? {}) },
    authorExperiences: { ...(overrides.authorExperiences ?? {}) },
    meta: {
      seeded: false,
      migratedLocalState: false,
      updatedAt: new Date().toISOString(),
    },
  };
}

function parseBookPayload(
  value: BookPayload &
    Partial<{
      author: string;
      genre: string;
    }>,
) {
  const title = typeof value?.title === "string" ? value.title.trim() : "";

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

  const authors = normalizeTagList(value?.authors ?? value?.author);
  const genres = normalizeTagList(value?.genres ?? value?.genre, normalizeGenreTag);
  const moods = normalizeTagList(
    (value as Partial<{ moods: unknown; mood: unknown }>)?.moods ??
      (value as Partial<{ moods: unknown; mood: unknown }>)?.mood,
    normalizeMoodTag,
  );

  return {
    title,
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
      ? normalizeScoreMap(JSON.parse(rawGenreInterests), normalizeGenreTag)
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

function readLocalLibraryState(): LibraryState {
  const legacyState = readLegacyState();

  if (!legacyState) {
    return localLibraryState();
  }

  return localLibraryState(legacyState);
}

function writeLocalBooks(books: Book[]) {
  const storage = requireStorage();
  const nextBooks = cloneBooks(books);
  storage.setItem(STORAGE_KEY, JSON.stringify(nextBooks));
  return nextBooks;
}

function readLocalBooks() {
  return readLocalLibraryState().books;
}

function writeLocalMap(storageKey: string, nextMap: Record<string, number>) {
  const storage = requireStorage();
  storage.setItem(storageKey, JSON.stringify(nextMap));
  return { ...nextMap };
}

function readLocalGenreInterests() {
  return readLocalLibraryState().genreInterests;
}

function readLocalAuthorExperiences() {
  return readLocalLibraryState().authorExperiences;
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
  try {
    const libraryState = await requestJson<LibraryState>("/api/library");
    return migrateLegacyStateIfNeeded(libraryState);
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      return readLocalLibraryState();
    }

    throw error;
  }
}

export async function fetchBooks() {
  const libraryState = await fetchLibraryState();
  return libraryState.books;
}

export async function createBookRecord(payload: BookPayload) {
  try {
    return await requestJson<Book[]>("/api/books", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const nextBook = parseBookPayload(payload);
    const books = readLocalBooks();
    const nextId = books.reduce((maxId, book) => Math.max(maxId, book.id), 0) + 1;

    return writeLocalBooks([
      ...books,
      {
        id: nextId,
        ...nextBook,
      },
    ]);
  }
}

export async function updateBookRecord(id: number, payload: BookPayload) {
  try {
    return await requestJson<Book[]>(`/api/books/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    if (!Number.isFinite(id)) {
      throw new Error("Book id is required.");
    }

    const nextBook = parseBookPayload(payload);
    const books = readLocalBooks();
    const hasMatch = books.some((book) => book.id === id);

    if (!hasMatch) {
      throw new Error("Book not found.");
    }

    return writeLocalBooks(
      books.map((book) => (book.id === id ? { id: book.id, ...nextBook } : book)),
    );
  }
}

export async function deleteBookRecord(id: number) {
  try {
    return await requestJson<Book[]>(`/api/books/${id}`, {
      method: "DELETE",
    });
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

    return writeLocalBooks(nextBooks);
  }
}

export async function readGenreInterests() {
  const libraryState = await fetchLibraryState();
  return libraryState.genreInterests;
}

export async function writeGenreInterest(genre: string, interest: number) {
  const nextGenre = normalizeGenreTag(genre);

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

  try {
    return await requestJson<Book[]>("/api/books/genres/rename", {
      method: "POST",
      body: JSON.stringify({ oldGenre: oldValue, newGenre: nextValue }),
    });
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const books = readLocalBooks();
    return writeLocalBooks(
      books.map((book) => ({
        ...book,
        genres: replaceTag(book.genres, oldValue, nextValue, normalizeGenreTag),
      })),
    );
  }
}

export async function readAuthorExperiences() {
  const libraryState = await fetchLibraryState();
  return libraryState.authorExperiences;
}

export async function writeAuthorExperience(author: string, experience: number) {
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

export async function renameAuthorExperience(
  oldAuthor: string,
  newAuthor: string,
) {
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
  try {
    return await requestJson<Book[]>("/api/books/authors/rename", {
      method: "POST",
      body: JSON.stringify({ oldAuthor, newAuthor }),
    });
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) {
      throw error;
    }

    const books = readLocalBooks();
    return writeLocalBooks(
      books.map((book) => ({
        ...book,
        authors: replaceTag(book.authors, oldAuthor, newAuthor),
      })),
    );
  }
}
