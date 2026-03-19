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
const seededBooks: Book[] = [
  {
    id: 1,
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    genres: ["Science Fiction", "Political", "Classic"],
    starRating: 4.1,
    ratingCount: 358000,
    progress: 70,
  },
  {
    id: 2,
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    genres: ["Fantasy", "Mystery", "Literary"],
    starRating: 4.2,
    ratingCount: 312000,
    myRating: 5,
    progress: 40,
  },
  {
    id: 3,
    title: "The Fifth Season",
    authors: ["N. K. Jemisin"],
    genres: ["Fantasy", "Science Fiction", "Apocalyptic"],
    starRating: 4.3,
    ratingCount: 289000,
    myRating: 4,
    progress: 20,
  },
  {
    id: 4,
    title: "A Visit from the Goon Squad",
    authors: ["Jennifer Egan"],
    genres: ["Literary", "Experimental", "Contemporary"],
    starRating: 3.9,
    ratingCount: 146000,
    progress: 10,
  },
  {
    id: 5,
    title: "The Name of the Rose",
    authors: ["Umberto Eco"],
    genres: ["Historical", "Mystery", "Classic"],
    starRating: 4,
    ratingCount: 163000,
    myRating: 4,
    progress: 55,
  },
  {
    id: 6,
    title: "Sea of Tranquility",
    authors: ["Emily St. John Mandel"],
    genres: ["Science Fiction", "Literary", "Time Travel"],
    starRating: 4.1,
    ratingCount: 228000,
    progress: 30,
  },
  {
    id: 7,
    title: "Tomorrow, and Tomorrow, and Tomorrow",
    authors: ["Gabrielle Zevin"],
    genres: ["Contemporary", "Literary", "Friendship"],
    starRating: 4.2,
    ratingCount: 694000,
    myRating: 5,
    progress: 80,
  },
  {
    id: 8,
    title: "Kindred",
    authors: ["Octavia E. Butler"],
    genres: ["Science Fiction", "Historical", "Classic"],
    starRating: 4.3,
    ratingCount: 423000,
    myRating: 5,
    progress: 100,
    read: true,
    readCount: 1,
    lastReadYear: 2023,
    archivedAtYear: 2023,
  },
  {
    id: 9,
    title: "Station Eleven",
    authors: ["Emily St. John Mandel"],
    genres: ["Apocalyptic", "Literary", "Science Fiction"],
    starRating: 4.1,
    ratingCount: 518000,
    myRating: 4,
    progress: 100,
    read: true,
    readCount: 2,
    lastReadYear: 2022,
    archivedAtYear: 2022,
  },
  {
    id: 10,
    title: "The Goldfinch",
    authors: ["Donna Tartt"],
    genres: ["Literary", "Coming-of-Age", "Drama"],
    starRating: 3.9,
    ratingCount: 819000,
    myRating: 3,
    progress: 100,
    read: true,
    readCount: 1,
    lastReadYear: 2021,
    archivedAtYear: 2021,
  },
  {
    id: 11,
    title: "Never Let Me Go",
    authors: ["Kazuo Ishiguro"],
    genres: ["Literary", "Science Fiction", "Dystopian"],
    starRating: 3.8,
    ratingCount: 621000,
    myRating: 5,
    progress: 100,
    read: true,
    readCount: 2,
    lastReadYear: 2024,
    archivedAtYear: 2024,
  },
  {
    id: 12,
    title: "The City & the City",
    authors: ["China Mieville"],
    genres: ["Mystery", "Fantasy", "Political"],
    starRating: 3.9,
    ratingCount: 82000,
    myRating: 4,
    progress: 100,
    read: true,
    readCount: 1,
    lastReadYear: 2020,
    archivedAtYear: 2020,
  },
];

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

function normalizeReadCount(
  read: boolean | undefined,
  progress: number | undefined,
  readCount: number | undefined,
) {
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
  const readCount = normalizeReadCount(read, progress, parsedReadCount);
  const lastReadYear = normalizeYear(
    (book as Record<string, unknown>)?.lastReadYear,
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
  const readCount = normalizeReadCount(read, progress, parsedReadCount);
  const lastReadYear = normalizeYear(
    (value as Record<string, unknown>)?.lastReadYear,
  );
  const archivedAtYear = normalizeYear(
    (value as Record<string, unknown>)?.archivedAtYear,
  );

  const authors = normalizeTagList(value?.authors ?? value?.author);
  const genres = normalizeTagList(value?.genres ?? value?.genre);

  return {
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
    ...(read
      ? { archivedAtYear: archivedAtYear ?? new Date().getFullYear() }
      : archivedAtYear != null
        ? { archivedAtYear }
        : {}),
  };
}

function seedBooks(storage: Storage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(seededBooks));
  return cloneBooks(seededBooks);
}

function withArchiveYearDefaults(books: Book[]) {
  const currentYear = new Date().getFullYear();
  let hasChanges = false;

  const nextBooks = books.map((book) => {
    if (!book.read || book.archivedAtYear != null) {
      return book;
    }

    hasChanges = true;
    return {
      ...book,
      archivedAtYear: book.lastReadYear ?? currentYear,
    };
  });

  return hasChanges ? cloneBooks(nextBooks) : books;
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
      if (parsed.length === 0) {
        return seedBooks(storage);
      }

      const books = parsed
        .map(normalizeBook)
        .filter((book): book is Book => book !== null);

      if (books.length === parsed.length) {
        const hydratedBooks = withArchiveYearDefaults(books);

        if (hydratedBooks !== books) {
          storage.setItem(STORAGE_KEY, JSON.stringify(hydratedBooks));
        }

        return hydratedBooks;
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
    books.map((book) => (book.id === id ? { id: book.id, ...nextBook } : book)),
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
