import { randomUUID } from "node:crypto";

import {
  activateProfileState,
  createEmptyProfile,
  getProfileSummaries,
  markStateUpdated,
  normalizeGenreTag,
  normalizeImportedState,
  parseBookPayload,
  replaceTag,
  syncActiveProfileState,
} from "./library-model.js";
import { upsertCatalogBooks } from "./catalog-memory.js";

function serializeLibraryState(state) {
  return {
    books: state.books,
    catalogBooks: state.catalogBooks,
    genreInterests: state.genreInterests,
    authorExperiences: state.authorExperiences,
    seriesExperiences: state.seriesExperiences ?? {},
    profiles: getProfileSummaries(state),
    activeProfileId: state.activeProfileId,
    meta: state.meta,
  };
}

export async function getLibraryState(store) {
  return serializeLibraryState(await store.read());
}

export async function createProfile(store, payload) {
  const nextName = String(payload?.name ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!nextName) {
    throw new Error("Profile name is required.");
  }

  const state = await store.read();
  const nameTaken = state.profiles.some(
    (profile) => profile.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
  );

  if (nameTaken) {
    throw new Error("A profile with that name already exists.");
  }

  const nextProfile = createEmptyProfile(randomUUID(), nextName);
  const nextState = activateProfileState(
    {
      ...state,
      profiles: [...state.profiles, nextProfile],
    },
    nextProfile.id,
  );
  const writtenState = await store.write(nextState);
  return serializeLibraryState(writtenState);
}

export async function updateProfile(store, profileId, payload) {
  const nextProfileId = String(profileId ?? "").trim();
  const nextName = String(payload?.name ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!nextProfileId) {
    throw new Error("Profile id is required.");
  }

  if (!nextName) {
    throw new Error("Profile name is required.");
  }

  const state = await store.read();
  const profile = state.profiles.find((entry) => entry.id === nextProfileId);

  if (!profile) {
    throw new Error("Profile not found.");
  }

  const nameTaken = state.profiles.some(
    (entry) =>
      entry.id !== nextProfileId &&
      entry.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
  );

  if (nameTaken) {
    throw new Error("A profile with that name already exists.");
  }

  const nextState = {
    ...state,
    profiles: state.profiles.map((entry) =>
      entry.id === nextProfileId ? { ...entry, name: nextName } : entry,
    ),
  };
  const writtenState = await store.write(nextState);
  return serializeLibraryState(writtenState);
}

export async function setActiveProfile(store, profileId) {
  const nextProfileId = String(profileId ?? "").trim();

  if (!nextProfileId) {
    throw new Error("Profile id is required.");
  }

  const state = await store.read();
  const writtenState = await store.write(activateProfileState(state, nextProfileId));
  return serializeLibraryState(writtenState);
}

export async function deleteProfile(store, profileId) {
  const nextProfileId = String(profileId ?? "").trim();

  if (!nextProfileId) {
    throw new Error("Profile id is required.");
  }

  const state = await store.read();

  if (state.profiles.length <= 1) {
    throw new Error("You need at least one profile.");
  }

  const profileIndex = state.profiles.findIndex(
    (entry) => entry.id === nextProfileId,
  );

  if (profileIndex === -1) {
    throw new Error("Profile not found.");
  }

  const nextProfiles = state.profiles.filter((entry) => entry.id !== nextProfileId);
  const fallbackProfile =
    nextProfiles[profileIndex] ?? nextProfiles[Math.max(0, profileIndex - 1)];
  const nextActiveProfileId =
    state.activeProfileId === nextProfileId
      ? fallbackProfile.id
      : state.activeProfileId;

  const nextState =
    state.activeProfileId === nextProfileId
      ? activateProfileState(
          {
            ...state,
            profiles: nextProfiles,
          },
          nextActiveProfileId,
        )
      : {
          ...state,
          profiles: nextProfiles,
        };

  const writtenState = await store.write(nextState);
  return serializeLibraryState(writtenState);
}

export async function importLibraryState(store, payload) {
  const imported = normalizeImportedState(payload);
  const state = await store.read();

  return serializeLibraryState(
    await store.write(
      syncActiveProfileState(
        markStateUpdated(
          {
            ...state,
            books: imported.books.map((book) => ({
              ...book,
              authors: [...book.authors],
              genres: [...book.genres],
              moods: [...book.moods],
            })),
            catalogBooks: imported.catalogBooks,
            genreInterests: { ...imported.genreInterests },
            authorExperiences: { ...imported.authorExperiences },
            seriesExperiences: { ...(imported.seriesExperiences ?? {}) },
          },
          { migratedLocalState: true },
        ),
      ),
    ),
  );
}

export async function createBookRecord(store, payload) {
  const nextBook = parseBookPayload(payload);
  const state = await store.read();
  const nextId = state.books.reduce((maxId, book) => Math.max(maxId, book.id), 0) + 1;

  const nextState = syncActiveProfileState(
    markStateUpdated({
      ...state,
      catalogBooks: upsertCatalogBooks(state.catalogBooks ?? [], [nextBook]),
      books: [
        ...state.books,
        {
          id: nextId,
          ...nextBook,
        },
      ],
    }),
  );
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

  const nextState = syncActiveProfileState(
    markStateUpdated({
      ...state,
      catalogBooks: upsertCatalogBooks(state.catalogBooks ?? [], [nextBook]),
      books: state.books.map((book) =>
        book.id === id ? { id: book.id, ...nextBook } : book,
      ),
    }),
  );
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
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        catalogBooks: [...(state.catalogBooks ?? [])],
        books: nextBooks,
      }),
    ),
  );
  return writtenState.books;
}

export async function writeGenreInterest(store, genre, interest) {
  const nextGenre = normalizeGenreTag(genre);
  const nextInterest = Number(interest);

  if (!nextGenre) {
    throw new Error("Genre is required.");
  }

  if (!Number.isFinite(nextInterest)) {
    throw new Error("Genre interest must be a number.");
  }

  const state = await store.read();
  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        genreInterests: {
          ...state.genreInterests,
          [nextGenre]: Math.max(0, Math.min(5, nextInterest)),
        },
      }),
    ),
  );
  return writtenState.genreInterests;
}

export async function deleteGenreInterest(store, genre) {
  const nextGenre = normalizeGenreTag(genre);
  const state = await store.read();
  const nextMap = { ...state.genreInterests };
  delete nextMap[nextGenre];

  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        genreInterests: nextMap,
      }),
    ),
  );
  return writtenState.genreInterests;
}

export async function renameGenreInterest(store, oldGenre, newGenre) {
  const oldValue = normalizeGenreTag(oldGenre);
  const nextValue = normalizeGenreTag(newGenre);
  const state = await store.read();
  const nextMap = { ...state.genreInterests };

  if (oldValue in nextMap) {
    if (nextValue) {
      nextMap[nextValue] = nextMap[oldValue];
    }
    delete nextMap[oldValue];
  }

  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        genreInterests: nextMap,
      }),
    ),
  );
  return writtenState.genreInterests;
}

export async function renameGenreInBooks(store, oldGenre, newGenre) {
  const oldValue = normalizeGenreTag(oldGenre);
  const nextValue = normalizeGenreTag(newGenre);
  const state = await store.read();
  const nextBooks = state.books.map((book) => ({
    ...book,
    genres: replaceTag(book.genres, oldValue, nextValue, normalizeGenreTag),
    genreAdded: replaceTag(book.genreAdded ?? [], oldValue, nextValue, normalizeGenreTag),
    genreRemoved: replaceTag(book.genreRemoved ?? [], oldValue, nextValue, normalizeGenreTag),
  }));
  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        catalogBooks: upsertCatalogBooks(state.catalogBooks ?? [], nextBooks),
        books: nextBooks,
      }),
    ),
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
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        authorExperiences: {
          ...state.authorExperiences,
          [nextAuthor]: Math.max(0, Math.min(5, nextExperience)),
        },
      }),
    ),
  );
  return writtenState.authorExperiences;
}

export async function deleteAuthorExperience(store, author) {
  const nextAuthor = String(author ?? "").trim();
  const state = await store.read();
  const nextMap = { ...state.authorExperiences };
  delete nextMap[nextAuthor];

  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        authorExperiences: nextMap,
      }),
    ),
  );
  return writtenState.authorExperiences;
}

export async function writeSeriesExperience(store, series, experience) {
  const nextSeries = String(series ?? "").trim();
  const nextExperience = Number(experience);

  if (!nextSeries) {
    throw new Error("Series is required.");
  }

  if (!Number.isFinite(nextExperience)) {
    throw new Error("Series experience must be a number.");
  }

  const state = await store.read();
  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        seriesExperiences: {
          ...(state.seriesExperiences ?? {}),
          [nextSeries]: Math.max(0, Math.min(5, nextExperience)),
        },
      }),
    ),
  );
  return writtenState.seriesExperiences;
}

export async function deleteSeriesExperience(store, series) {
  const nextSeries = String(series ?? "").trim();
  const state = await store.read();
  const nextMap = { ...(state.seriesExperiences ?? {}) };
  delete nextMap[nextSeries];

  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        seriesExperiences: nextMap,
      }),
    ),
  );
  return writtenState.seriesExperiences;
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
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        authorExperiences: nextMap,
      }),
    ),
  );
  return writtenState.authorExperiences;
}

export async function renameAuthorInBooks(store, oldAuthor, newAuthor) {
  const state = await store.read();
  const nextBooks = state.books.map((book) => ({
    ...book,
    authors: replaceTag(book.authors, oldAuthor, newAuthor),
  }));
  const writtenState = await store.write(
    syncActiveProfileState(
      markStateUpdated({
        ...state,
        catalogBooks: upsertCatalogBooks(state.catalogBooks ?? [], nextBooks),
        books: nextBooks,
      }),
    ),
  );
  return writtenState.books;
}
