export type Book = {
  id: number;
  title: string;
  author: string;
  starRating: number;
  ratingCount: number;
};

export type BookPayload = Omit<Book, "id">;

const STORAGE_KEY = "book-ranker.books.v1";
const seededBooks: Book[] = [
  {
    id: 1,
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    starRating: 4.12,
    ratingCount: 142300,
  },
  {
    id: 2,
    title: "Never Let Me Go",
    author: "Kazuo Ishiguro",
    starRating: 3.85,
    ratingCount: 592000,
  },
  {
    id: 3,
    title: "Piranesi",
    author: "Susanna Clarke",
    starRating: 4.23,
    ratingCount: 292500,
  },
];

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
  const starRating = Number((value as Book | null)?.starRating);
  const ratingCount = Number((value as Book | null)?.ratingCount);
  const id = Number((value as Book | null)?.id);

  if (
    !title ||
    !Number.isFinite(id) ||
    !Number.isFinite(starRating) ||
    !Number.isFinite(ratingCount) ||
    starRating < 0 ||
    starRating > 5 ||
    ratingCount < 0
  ) {
    return null;
  }

  return {
    id,
    title,
    author,
    starRating,
    ratingCount,
  };
}

function parsePayload(value: BookPayload) {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const author = typeof value?.author === "string" ? value.author.trim() : "";
  const starRating = Number(value?.starRating);
  const ratingCount = Number(value?.ratingCount);

  if (!title) {
    throw new Error("Title is required.");
  }

  if (!Number.isFinite(starRating) || starRating < 0 || starRating > 5) {
    throw new Error("Star rating must be a number between 0 and 5.");
  }

  if (!Number.isFinite(ratingCount) || ratingCount < 0) {
    throw new Error("Ratings must be a non-negative number.");
  }

  return {
    title,
    author,
    starRating,
    ratingCount,
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
