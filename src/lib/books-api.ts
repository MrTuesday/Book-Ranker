export type Book = {
  id: number;
  title: string;
  author: string;
  starRating?: number;
  ratingCount?: number;
  genre?: string;
};

export type BookPayload = Omit<Book, "id">;

const STORAGE_KEY = "book-ranker.books.v1";
const GENRE_INTEREST_KEY = "book-ranker.genre-interests.v1";
const AUTHOR_EXP_KEY = "book-ranker.author-experiences.v1";
const seededBooks: Book[] = [];

function cloneBooks(books: Book[]) {
  return books.map((book) => ({ ...book }));
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

function normalizeBook(value: unknown): Book | null {
  const title =
    typeof (value as Book | null)?.title === "string"
      ? (value as Book).title.trim()
      : "";
  const author =
    typeof (value as Book | null)?.author === "string"
      ? (value as Book).author.trim()
      : "";
  const rawStarRating = (value as Book | null)?.starRating;
  const starRating =
    rawStarRating != null && Number.isFinite(Number(rawStarRating))
      ? Number(rawStarRating)
      : undefined;
  const rawRatingCount = (value as Book | null)?.ratingCount;
  const ratingCount =
    rawRatingCount != null && Number.isFinite(Number(rawRatingCount))
      ? Number(rawRatingCount)
      : undefined;
  const id = Number((value as Book | null)?.id);

  const rawGenre = (value as Book | null)?.genre;
  const genre = typeof rawGenre === "string" ? rawGenre.trim() : undefined;

  if (
    !title ||
    !Number.isFinite(id) ||
    (starRating != null && (starRating < 0 || starRating > 5)) ||
    (ratingCount != null && ratingCount < 0)
  ) {
    return null;
  }

  return {
    id,
    title,
    author,
    ...(starRating != null ? { starRating } : {}),
    ...(ratingCount != null ? { ratingCount } : {}),
    ...(genre ? { genre } : {}),
  };
}

function parsePayload(value: BookPayload) {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const author = typeof value?.author === "string" ? value.author.trim() : "";

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

  const rawGenre = (value as BookPayload & { genre?: string })?.genre;
  const genre = typeof rawGenre === "string" ? rawGenre.trim() : undefined;

  return {
    title,
    author,
    ...(starRating != null ? { starRating } : {}),
    ...(ratingCount != null ? { ratingCount } : {}),
    ...(genre ? { genre } : {}),
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
