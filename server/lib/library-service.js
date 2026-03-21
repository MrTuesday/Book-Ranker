import {
  markStateUpdated,
  normalizeImportedState,
  parseBookPayload,
  replaceTag,
} from "./library-model.js";

export async function getLibraryState(store) {
  return store.read();
}

export async function importLibraryState(store, payload) {
  const imported = normalizeImportedState(payload);

  return store.write({
    books: imported.books.map((book) => ({
      ...book,
      authors: [...book.authors],
      genres: [...book.genres],
      moods: [...book.moods],
    })),
    genreInterests: { ...imported.genreInterests },
    authorExperiences: { ...imported.authorExperiences },
    meta: {
      seeded: false,
      migratedLocalState: true,
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function createBookRecord(store, payload) {
  const nextBook = parseBookPayload(payload);
  const state = await store.read();
  const nextId = state.books.reduce((maxId, book) => Math.max(maxId, book.id), 0) + 1;

  const nextState = markStateUpdated({
    ...state,
    books: [
      ...state.books,
      {
        id: nextId,
        ...nextBook,
      },
    ],
  });
  const writtenState = await store.write(nextState);
  return writtenState.books;
}

export async function updateBookRecord(store, id, payload) {
  if (!Number.isFinite(id)) {
    throw new Error("Book id is required.");
  }

  const nextBook = parseBookPayload(payload);
  const state = await store.read();
  const hasMatch = state.books.some((book) => book.id === id);

  if (!hasMatch) {
    throw new Error("Book not found.");
  }

  const nextState = markStateUpdated({
    ...state,
    books: state.books.map((book) =>
      book.id === id ? { id: book.id, ...nextBook } : book,
    ),
  });
  const writtenState = await store.write(nextState);
  return writtenState.books;
}

export async function deleteBookRecord(store, id) {
  if (!Number.isFinite(id)) {
    throw new Error("Book id is required.");
  }

  const state = await store.read();
  const nextBooks = state.books.filter((book) => book.id !== id);

  if (nextBooks.length === state.books.length) {
    throw new Error("Book not found.");
  }

  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      books: nextBooks,
    }),
  );
  return writtenState.books;
}

export async function writeGenreInterest(store, genre, interest) {
  const nextGenre = String(genre ?? "").trim();
  const nextInterest = Number(interest);

  if (!nextGenre) {
    throw new Error("Genre is required.");
  }

  if (!Number.isFinite(nextInterest)) {
    throw new Error("Genre interest must be a number.");
  }

  const state = await store.read();
  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      genreInterests: {
        ...state.genreInterests,
        [nextGenre]: Math.max(0, Math.min(5, nextInterest)),
      },
    }),
  );
  return writtenState.genreInterests;
}

export async function deleteGenreInterest(store, genre) {
  const nextGenre = String(genre ?? "").trim();
  const state = await store.read();
  const nextMap = { ...state.genreInterests };
  delete nextMap[nextGenre];

  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      genreInterests: nextMap,
    }),
  );
  return writtenState.genreInterests;
}

export async function renameGenreInterest(store, oldGenre, newGenre) {
  const oldValue = String(oldGenre ?? "").trim();
  const nextValue = String(newGenre ?? "").trim();
  const state = await store.read();
  const nextMap = { ...state.genreInterests };

  if (oldValue in nextMap) {
    if (nextValue) {
      nextMap[nextValue] = nextMap[oldValue];
    }
    delete nextMap[oldValue];
  }

  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      genreInterests: nextMap,
    }),
  );
  return writtenState.genreInterests;
}

export async function renameGenreInBooks(store, oldGenre, newGenre) {
  const state = await store.read();
  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      books: state.books.map((book) => ({
        ...book,
        genres: replaceTag(book.genres, oldGenre, newGenre),
      })),
    }),
  );
  return writtenState.books;
}

export async function writeAuthorExperience(store, author, experience) {
  const nextAuthor = String(author ?? "").trim();
  const nextExperience = Number(experience);

  if (!nextAuthor) {
    throw new Error("Author is required.");
  }

  if (!Number.isFinite(nextExperience)) {
    throw new Error("Author experience must be a number.");
  }

  const state = await store.read();
  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      authorExperiences: {
        ...state.authorExperiences,
        [nextAuthor]: Math.max(0, Math.min(5, nextExperience)),
      },
    }),
  );
  return writtenState.authorExperiences;
}

export async function deleteAuthorExperience(store, author) {
  const nextAuthor = String(author ?? "").trim();
  const state = await store.read();
  const nextMap = { ...state.authorExperiences };
  delete nextMap[nextAuthor];

  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      authorExperiences: nextMap,
    }),
  );
  return writtenState.authorExperiences;
}

export async function renameAuthorExperience(store, oldAuthor, newAuthor) {
  const oldValue = String(oldAuthor ?? "").trim();
  const nextValue = String(newAuthor ?? "").trim();
  const state = await store.read();
  const nextMap = { ...state.authorExperiences };

  if (oldValue in nextMap) {
    if (nextValue) {
      nextMap[nextValue] = nextMap[oldValue];
    }
    delete nextMap[oldValue];
  }

  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      authorExperiences: nextMap,
    }),
  );
  return writtenState.authorExperiences;
}

export async function renameAuthorInBooks(store, oldAuthor, newAuthor) {
  const state = await store.read();
  const writtenState = await store.write(
    markStateUpdated({
      ...state,
      books: state.books.map((book) => ({
        ...book,
        authors: replaceTag(book.authors, oldAuthor, newAuthor),
      })),
    }),
  );
  return writtenState.books;
}
