import { upsertCatalogBooks } from "./catalog-memory.js";

export const DEFAULT_PROFILE_ID = "profile-default";
export const DEFAULT_PROFILE_NAME = "My Profile";

const seededBooks = [
  {
    id: 1,
    title: "The Power Broker",
    authors: ["Robert A. Caro"],
    genres: ["Biography", "History", "Politics"],
    starRating: 4.5,
    ratingCount: 102000,
    myRating: 5,
    progress: 65,
  },
  {
    id: 2,
    title: "The Emperor of All Maladies",
    authors: ["Siddhartha Mukherjee"],
    genres: ["Science", "History", "Medicine"],
    starRating: 4.3,
    ratingCount: 198000,
    myRating: 5,
    progress: 40,
  },
  {
    id: 3,
    title: "Sapiens",
    authors: ["Yuval Noah Harari"],
    genres: ["History", "Anthropology", "Science"],
    starRating: 4.4,
    ratingCount: 812000,
    myRating: 4,
    progress: 100,
  },
  {
    id: 4,
    title: "The Selfish Gene",
    authors: ["Richard Dawkins"],
    genres: ["Science", "Biology", "Evolution"],
    starRating: 4.1,
    ratingCount: 146000,
    progress: 30,
  },
  {
    id: 5,
    title: "The Man Who Mistook His Wife for a Hat",
    authors: ["Oliver Sacks"],
    genres: ["Science", "Psychology", "Neuroscience"],
    starRating: 4.1,
    ratingCount: 163000,
    myRating: 4,
    progress: 55,
  },
  {
    id: 6,
    title: "Thinking, Fast and Slow",
    authors: ["Daniel Kahneman"],
    genres: ["Psychology", "Economics", "Science"],
    starRating: 4.2,
    ratingCount: 694000,
    myRating: 4,
    progress: 80,
  },
  {
    id: 7,
    title: "The Devil in the White City",
    authors: ["Erik Larson"],
    genres: ["History", "True Crime", "Architecture"],
    starRating: 4.1,
    ratingCount: 518000,
    progress: 20,
  },
  {
    id: 8,
    title: "Silent Spring",
    authors: ["Rachel Carson"],
    genres: ["Science", "Environment", "Classic"],
    starRating: 4.1,
    ratingCount: 112000,
    myRating: 5,
    progress: 100,
    read: true,
    readCount: 1,
    lastReadYear: 2023,
    archivedAtYear: 2023,
  },
  {
    id: 9,
    title: "The Guns of August",
    authors: ["Barbara Tuchman"],
    genres: ["History", "Military", "World War I"],
    starRating: 4.2,
    ratingCount: 89000,
    myRating: 4,
    progress: 100,
    read: true,
    readCount: 2,
    lastReadYear: 2022,
    archivedAtYear: 2022,
  },
  {
    id: 10,
    title: "Cosmos",
    authors: ["Carl Sagan"],
    genres: ["Science", "Astronomy", "Philosophy"],
    starRating: 4.4,
    ratingCount: 319000,
    myRating: 5,
    progress: 100,
    read: true,
    readCount: 2,
    lastReadYear: 2024,
    archivedAtYear: 2024,
  },
  {
    id: 11,
    title: "Team of Rivals",
    authors: ["Doris Kearns Goodwin"],
    genres: ["Biography", "History", "Politics"],
    starRating: 4.3,
    ratingCount: 228000,
    myRating: 5,
    progress: 100,
    read: true,
    readCount: 1,
    lastReadYear: 2021,
    archivedAtYear: 2021,
  },
  {
    id: 12,
    title: "The Black Swan",
    authors: ["Nassim Nicholas Taleb"],
    genres: ["Philosophy", "Economics", "Probability"],
    starRating: 3.9,
    ratingCount: 282000,
    myRating: 4,
    progress: 100,
    read: true,
    readCount: 1,
    lastReadYear: 2020,
    archivedAtYear: 2020,
  },
];

function cloneBooks(books) {
  return books.map((book) => ({
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
    moods: [...(Array.isArray(book.moods) ? book.moods : [])],
  }));
}

function cloneLibraryData(libraryData) {
  return {
    books: cloneBooks(libraryData.books),
    catalogBooks: upsertCatalogBooks([], libraryData.books),
    genreInterests: { ...libraryData.genreInterests },
    authorExperiences: { ...libraryData.authorExperiences },
    seriesExperiences: { ...libraryData.seriesExperiences },
    meta: { ...libraryData.meta },
  };
}

export function createSeedLibraryData() {
  const now = new Date().toISOString();
  const books = cloneBooks(seededBooks);

  return {
    books,
    catalogBooks: upsertCatalogBooks([], books),
    genreInterests: {},
    authorExperiences: {},
    seriesExperiences: {},
    meta: {
      seeded: true,
      migratedLocalState: false,
      updatedAt: now,
    },
  };
}

export function createSeedState() {
  const createdAt = new Date().toISOString();
  const defaultLibraryData = createSeedLibraryData();

  return {
    ...cloneLibraryData(defaultLibraryData),
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        createdAt,
        ...cloneLibraryData(defaultLibraryData),
      },
    ],
    activeProfileId: DEFAULT_PROFILE_ID,
  };
}
