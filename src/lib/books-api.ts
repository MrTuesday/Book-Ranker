export type Book = {
  id: number;
  title: string;
  authors: string[];
  genres: string[];
  starRating?: number;
  ratingCount?: number;
  myRating?: number;
};

type LegacyBook = Partial<Book> & {
  author?: unknown;
  genre?: unknown;
  authors?: unknown;
  genres?: unknown;
};

export type BookPayload = Omit<Book, "id">;

const STORAGE_KEY = "book-ranker.books.v1";
const GENRE_INTEREST_KEY = "book-ranker.genre-interests.v1";
const AUTHOR_EXP_KEY = "book-ranker.author-experiences.v1";
const seededBooks: Book[] = [];

function cloneBooks(books: Book[]) {
  return books.map((book) => ({
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
  }));
}

function getStorage() {
  if (typeof window === "undefined") {
    throw new Error("Browser storage is unavailable.");
  }

  try {
    return window.localStorage;
  } catch {
    throw new Error("This browser does not allow local storage.");
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
  };
}

function parsePayload(
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

  const authors = normalizeTagList(value?.authors ?? value?.author);
  const genres = normalizeTagList(value?.genres ?? value?.genre);

  return {
    title,
    authors,
    genres,
    ...(starRating != null ? { starRating } : {}),
    ...(ratingCount != null ? { ratingCount } : {}),
    ...(myRating != null ? { myRating } : {}),
  };
}

function seedBooks(storage: Storage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(seededBooks));
  return cloneBooks(seededBooks);
}

function readBooks() {
  const storage = getStorage();
  const raw = storage.getItem(STORAGE_KEY);

  if (!raw) {
    return seedBooks(storage);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      const books = parsed
        .map(normalizeBook)
        .filter((book): book is Book => book !== null);

      if (books.length === parsed.length) {
        return books;
      }
    }
  } catch {
    // Reset corrupt data back to the seeded library.
  }

  return seedBooks(storage);
}

function writeBooks(books: Book[]) {
  const storage = getStorage();
  const nextBooks = cloneBooks(books);
  storage.setItem(STORAGE_KEY, JSON.stringify(nextBooks));
  return nextBooks;
}

function replaceTag(tags: string[], oldValue: string, newValue: string) {
  const oldTag = oldValue.trim();
  const nextTag = newValue.trim();

  if (!oldTag) {
    return [...tags];
  }

  const replaced = tags.flatMap((tag) => {
    if (tag !== oldTag) {
      return [tag];
    }

    return nextTag ? [nextTag] : [];
  });

  return normalizeTagList(replaced);
}

export async function fetchBooks() {
  return readBooks();
}

export async function createBookRecord(payload: BookPayload) {
  const nextBook = parsePayload(payload);
  const books = readBooks();
  const nextId = books.reduce((maxId, book) => Math.max(maxId, book.id), 0) + 1;

  return writeBooks([
    ...books,
    {
      id: nextId,
      ...nextBook,
    },
  ]);
}

export async function updateBookRecord(id: number, payload: BookPayload) {
  if (!Number.isFinite(id)) {
    throw new Error("Book id is required.");
  }

  const nextBook = parsePayload(payload);
  const books = readBooks();
  const hasMatch = books.some((book) => book.id === id);

  if (!hasMatch) {
    throw new Error("Book not found.");
  }

  return writeBooks(
    books.map((book) => (book.id === id ? { ...book, ...nextBook } : book)),
  );
}

export type GenreInterestMap = Record<string, number>;

export function readGenreInterests(): GenreInterestMap {
  try {
    const storage = getStorage();
    const raw = storage.getItem(GENRE_INTEREST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: GenreInterestMap = {};
      for (const [key, val] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof key === "string" && key.trim() && Number.isFinite(Number(val))) {
          result[key.trim()] = Math.max(0, Math.min(5, Number(val)));
        }
      }
      return result;
    }
  } catch {
    // ignore
  }
  return {};
}

export function writeGenreInterest(genre: string, interest: number) {
  const storage = getStorage();
  const map = readGenreInterests();
  map[genre.trim()] = Math.max(0, Math.min(5, interest));
  storage.setItem(GENRE_INTEREST_KEY, JSON.stringify(map));
  return { ...map };
}

export function deleteGenreInterest(genre: string) {
  const storage = getStorage();
  const map = readGenreInterests();
  delete map[genre.trim()];
  storage.setItem(GENRE_INTEREST_KEY, JSON.stringify(map));
  return { ...map };
}

export function renameGenreInterest(oldGenre: string, newGenre: string) {
  const storage = getStorage();
  const map = readGenreInterests();
  const old = oldGenre.trim();
  const next = newGenre.trim();
  if (old in map) {
    if (next) {
      map[next] = map[old];
    }
    delete map[old];
    storage.setItem(GENRE_INTEREST_KEY, JSON.stringify(map));
  }
  return { ...map };
}

export async function renameGenreInBooks(oldGenre: string, newGenre: string) {
  const books = readBooks();
  const updated = books.map((book) => ({
    ...book,
    genres: replaceTag(book.genres, oldGenre, newGenre),
  }));
  return writeBooks(updated);
}

export type AuthorExperienceMap = Record<string, number>;

export function readAuthorExperiences(): AuthorExperienceMap {
  try {
    const storage = getStorage();
    const raw = storage.getItem(AUTHOR_EXP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: AuthorExperienceMap = {};
      for (const [key, val] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof key === "string" && key.trim() && Number.isFinite(Number(val))) {
          result[key.trim()] = Math.max(0, Math.min(5, Number(val)));
        }
      }
      return result;
    }
  } catch {
    // ignore
  }
  return {};
}

export function writeAuthorExperience(author: string, experience: number) {
  const storage = getStorage();
  const map = readAuthorExperiences();
  map[author.trim()] = Math.max(0, Math.min(5, experience));
  storage.setItem(AUTHOR_EXP_KEY, JSON.stringify(map));
  return { ...map };
}

export function deleteAuthorExperience(author: string) {
  const storage = getStorage();
  const map = readAuthorExperiences();
  delete map[author.trim()];
  storage.setItem(AUTHOR_EXP_KEY, JSON.stringify(map));
  return { ...map };
}

export function renameAuthorExperience(oldAuthor: string, newAuthor: string) {
  const storage = getStorage();
  const map = readAuthorExperiences();
  const old = oldAuthor.trim();
  const next = newAuthor.trim();
  if (old in map) {
    if (next) {
      map[next] = map[old];
    }
    delete map[old];
    storage.setItem(AUTHOR_EXP_KEY, JSON.stringify(map));
  }
  return { ...map };
}

export async function renameAuthorInBooks(oldAuthor: string, newAuthor: string) {
  const books = readBooks();
  const updated = books.map((book) => ({
    ...book,
    authors: replaceTag(book.authors, oldAuthor, newAuthor),
  }));
  return writeBooks(updated);
}

export async function deleteBookRecord(id: number) {
  if (!Number.isFinite(id)) {
    throw new Error("Book id is required.");
  }

  const books = readBooks();
  const nextBooks = books.filter((book) => book.id !== id);

  if (nextBooks.length === books.length) {
    throw new Error("Book not found.");
  }

  return writeBooks(nextBooks);
}
