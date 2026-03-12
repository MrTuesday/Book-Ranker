import { getStore } from "@netlify/blobs";

const store = getStore({ name: "book-ranker", consistency: "strong" });
const DATA_KEY = "books-v1";
const seededBooks = [
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

function json(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function error(message, status = 400) {
  return json({ error: message }, { status });
}

function normalizeBook(value) {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const author = typeof value?.author === "string" ? value.author.trim() : "";
  const starRating = Number(value?.starRating);
  const ratingCount = Number(value?.ratingCount);
  const id = Number(value?.id);

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

function parsePayload(value) {
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

async function readBooks() {
  const saved = await store.get(DATA_KEY, { type: "json" });

  if (Array.isArray(saved)) {
    return saved.map(normalizeBook).filter(Boolean);
  }

  await store.setJSON(DATA_KEY, seededBooks);
  return seededBooks;
}

async function writeBooks(books) {
  await store.setJSON(DATA_KEY, books);
  return books;
}

export default async (request) => {
  if (request.method === "GET") {
    const books = await readBooks();
    return json({ books });
  }

  if (request.method === "POST") {
    try {
      const payload = parsePayload(await request.json());
      const books = await readBooks();
      const nextBooks = [
        ...books,
        {
          id: Date.now() + Math.floor(Math.random() * 100000),
          ...payload,
        },
      ];

      return json({ books: await writeBooks(nextBooks) }, { status: 201 });
    } catch (issue) {
      return error(issue instanceof Error ? issue.message : "Could not save book.");
    }
  }

  if (request.method === "PUT") {
    try {
      const body = await request.json();
      const id = Number(body?.id);

      if (!Number.isFinite(id)) {
        return error("Book id is required.");
      }

      const payload = parsePayload(body);
      const books = await readBooks();
      const hasMatch = books.some((book) => book.id === id);

      if (!hasMatch) {
        return error("Book not found.", 404);
      }

      const nextBooks = books.map((book) =>
        book.id === id ? { ...book, ...payload } : book,
      );

      return json({ books: await writeBooks(nextBooks) });
    } catch (issue) {
      return error(issue instanceof Error ? issue.message : "Could not update book.");
    }
  }

  if (request.method === "DELETE") {
    const id = Number(new URL(request.url).searchParams.get("id"));

    if (!Number.isFinite(id)) {
      return error("Book id is required.");
    }

    const books = await readBooks();
    const nextBooks = books.filter((book) => book.id !== id);

    if (nextBooks.length === books.length) {
      return error("Book not found.", 404);
    }

    return json({ books: await writeBooks(nextBooks) });
  }

  return error("Method not allowed.", 405);
};
