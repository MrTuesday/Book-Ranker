export type Book = {
  id: number;
  title: string;
  author: string;
  starRating: number;
  ratingCount: number;
};

export type BookPayload = Omit<Book, "id">;

type BooksResponse = {
  books: Book[];
};

const API_PATH = "/.netlify/functions/books";

async function parseResponse(response: Response) {
  if (response.ok) {
    return (await response.json()) as BooksResponse;
  }

  let message = "Request failed";

  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) {
      message = body.error;
    }
  } catch {
    // Fall back to a generic message when the response body is empty.
  }

  throw new Error(message);
}

export async function fetchBooks() {
  const response = await fetch(API_PATH, {
    headers: {
      Accept: "application/json",
    },
  });

  const body = await parseResponse(response);
  return body.books;
}

export async function createBookRecord(payload: BookPayload) {
  const response = await fetch(API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await parseResponse(response);
  return body.books;
}

export async function updateBookRecord(id: number, payload: BookPayload) {
  const response = await fetch(API_PATH, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ id, ...payload }),
  });

  const body = await parseResponse(response);
  return body.books;
}

export async function deleteBookRecord(id: number) {
  const response = await fetch(`${API_PATH}?id=${id}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
    },
  });

  const body = await parseResponse(response);
  return body.books;
}
