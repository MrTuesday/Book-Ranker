import {
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AuthRequiredError,
  createBookRecord,
  deleteAuthorExperience,
  deleteBookRecord,
  deleteGenreInterest,
  deleteSeriesExperience,
  fetchBooks,
  fetchLibraryState,
  type LibraryState,
  type Book,
  type GenreInterestMap,
  type AuthorExperienceMap,
  type ProfileSummary,
  type SeriesExperienceMap,
  normalizeGenreTag,
  updateProfile,
  updateBookRecord,
  writeGenreInterest,
  writeAuthorExperience,
  writeSeriesExperience,
  renameGenreInBooks,
  renameGenreInterest,
  renameAuthorInBooks,
  resolveBookGenres,
  computeGenreOverrides,
  fetchAuthorCredentials,
  addAuthorCredential,
  removeAuthorCredential,
  type AuthorCredentialMap,
} from "./lib/books-api";
import {
  getAuthSession,
  isSupabaseConfigured,
  requestPasswordReset,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  subscribeToAuthChanges,
  type AuthSession,
  updateSignedInUsername,
} from "./lib/auth";
import {
  fetchPathRecommendations,
  type PathRecommendationResponse,
  type RecommendedBook,
} from "./lib/recommend-api";
import {
  mergeCatalogSearchResults,
  searchCatalog,
  type CatalogSearchResult,
} from "./lib/catalog-api";
import {
  buildCatalogIdentityKey,
  type CatalogBook,
  upsertCatalogBooks,
} from "./lib/catalog-memory";
import { BookCard } from "./components/BookCard";
import {
  ArchiveShelfIcon,
  ProgressBar,
  RatingButtons,
  ReadCountStepper,
  StarRating,
} from "./components/LibraryControls";
import { BookListSection } from "./components/BookListSection";
import { buildBookAnalytics } from "./lib/ranking";
import { searchOpenLibraryCatalog } from "./lib/open-library";

const InterestMap = lazy(() => import("./components/InterestMap"));

type BookDraft = {
  title: string;
  series: string;
  seriesNumber: string;
  seriesExperience: string;
  seriesExperienceIsManual: boolean;
  readCount: number;
  starRating: string;
  ratingCount: string;
  authorInput: string;
  genreInterest: string;
  genreInterestIsManual: boolean;
  authorExperience: string;
  authorExperienceIsManual: boolean;
  authors: string[];
  authorScores: Record<string, string>;
  genreInput: string;
  genres: string[];
  genreScores: Record<string, string>;
  progress: string;
  myRating: number | null;
  lastReadYear: string;
  markAsRead: boolean;
};

type SuggestionField = "author" | "genre";
type DraftTagDrag = {
  field: SuggestionField;
  tag: string;
};
type DraftTextField =
  | "title"
  | "series"
  | "seriesNumber"
  | "seriesExperience"
  | "authorInput"
  | "authorExperience"
  | "genreInput"
  | "genreInterest"
  | "progress";

type AuthView = "sign-in" | "sign-up" | "reset";
type AuthStatus = "checking" | "signed-in" | "signed-out" | "disabled";

const MAX_SUGGESTIONS = 6;
const MAX_AUTOFILL_TOPICS = 8;
const TITLE_SUGGESTION_FETCH_LIMIT = 6;
const MIN_YEAR_OPTION = 1900;

function createDraft(): BookDraft {
  return {
    title: "",
    series: "",
    seriesNumber: "",
    seriesExperience: "",
    seriesExperienceIsManual: false,
    readCount: 0,
    starRating: "",
    ratingCount: "",
    authorInput: "",
    genreInterest: "",
    genreInterestIsManual: false,
    authorExperience: "",
    authorExperienceIsManual: false,
    authors: [],
    authorScores: {},
    genreInput: "",
    genres: [],
    genreScores: {},
    progress: "",
    myRating: null,
    lastReadYear: "",
    markAsRead: false,
  };
}

function recommendationSourceLabel(provider: string) {
  if (provider === "openlibrary+book-ranker") {
    return "Open Library + your library";
  }

  if (provider.includes("openlibrary")) {
    return "Open Library";
  }

  return "Your library";
}

function uniqueTags(values: string[]) {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
}

function matchingSuggestions(
  query: string,
  selectedTags: string[],
  knownTags: string[],
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  return knownTags
    .filter(
      (tag) =>
        !selectedTags.includes(tag) &&
        tag.toLocaleLowerCase().includes(normalizedQuery),
    )
    .slice(0, MAX_SUGGESTIONS);
}

function resolvedSuggestion(
  query: string,
  selectedTags: string[],
  knownTags: string[],
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return null;
  }

  const suggestions = matchingSuggestions(query, selectedTags, knownTags);
  const exactMatch = suggestions.find(
    (tag) => tag.toLocaleLowerCase() === normalizedQuery,
  );

  return exactMatch ?? (suggestions.length === 1 ? suggestions[0] : null);
}

function buildCatalogGenres(
  result: Pick<CatalogSearchResult, "title" | "authors" | "genres" | "tags">,
  knownGenres: string[],
) {
  const knownGenreSet = new Set(knownGenres.map(normalizeGenreTag));

  return uniqueTags(
    [...result.genres, ...result.tags]
      .map(normalizeGenreTag)
      .filter((genre) => knownGenreSet.has(genre)),
  ).slice(0, MAX_AUTOFILL_TOPICS);
}

function currentTranslateY(element: HTMLElement) {
  const transform = window.getComputedStyle(element).transform;

  if (!transform || transform === "none") {
    return 0;
  }

  try {
    return new DOMMatrixReadOnly(transform).m42;
  } catch {
    return 0;
  }
}

type DraftAutofillSource = Pick<
  CatalogSearchResult,
  | "id"
  | "title"
  | "series"
  | "seriesNumber"
  | "authors"
  | "genres"
  | "tags"
  | "averageRating"
  | "ratingsCount"
>;

function formatCatalogRating(value: number) {
  return String(Number(value.toFixed(2)));
}

function formatCatalogRatingCount(value: number) {
  return String(Math.max(0, Math.round(value)));
}

function formatDisplayedDraftCount(value: string) {
  if (!value.trim()) {
    return "";
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return value;
  }

  return Math.round(parsed).toLocaleString();
}

function buildDraftScores(tags: string[], scores: Record<string, number>) {
  return Object.fromEntries(
    tags.flatMap((tag) =>
      scores[tag] != null ? [[tag, String(scores[tag])]] : [],
    ),
  );
}

function hasDraftTagScore(scores: Record<string, string>, tag: string) {
  return Object.prototype.hasOwnProperty.call(scores, tag);
}

function removeTagFromScores(scores: Record<string, string>, tag: string) {
  const nextScores = { ...scores };
  delete nextScores[tag];
  return nextScores;
}


function reorderTags(tags: string[], draggedTag: string, targetTag: string) {
  if (draggedTag === targetTag) {
    return tags;
  }

  const next = [...tags];
  const draggedIndex = next.indexOf(draggedTag);

  if (draggedIndex === -1) {
    return tags;
  }

  next.splice(draggedIndex, 1);

  const targetIndex = next.indexOf(targetTag);

  if (targetIndex === -1) {
    next.push(draggedTag);
    return next;
  }

  next.splice(targetIndex, 0, draggedTag);
  return next;
}

function moveTagToEnd(tags: string[], draggedTag: string) {
  const next = tags.filter((tag) => tag !== draggedTag);

  if (next.length === tags.length) {
    return tags;
  }

  next.push(draggedTag);
  return next;
}

function messageFromError(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return "Sign in required.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong while saving your library.";
}

function profileInitials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length === 0) {
    return "BR";
  }

  return words.map((word) => word[0]?.toLocaleUpperCase() ?? "").join("");
}

function normalizeAccountUsername(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function isPlaceholderProfileName(value: string | null | undefined) {
  const normalized = normalizeAccountUsername(value);
  return !normalized || normalized === "My Profile" || normalized === "Profile";
}

function messageFromCatalogLookupError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "";
  }

  return "Catalog lookup is unavailable right now.";
}

function matchesSelectedGenres(
  genres: string[],
  selectedGenres: string[],
) {
  if (selectedGenres.length === 0) {
    return true;
  }

  const genreSet = new Set(uniqueTags(genres));
  return selectedGenres.every((genre) => genreSet.has(genre));
}

export default function App() {
  const currentYear = new Date().getFullYear();
  const authEnabled = isSupabaseConfigured;
  const [books, setBooks] = useState<Book[]>([]);
  const [catalogBooks, setCatalogBooks] = useState<CatalogBook[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookDraft>(createDraft());
  const [editingBookId, setEditingBookId] = useState<number | null>(null);
  const [scrollToForm, setScrollToForm] = useState(false);
  const [highlightedBookId, setHighlightedBookId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    authEnabled ? "checking" : "disabled",
  );
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authMode, setAuthMode] = useState<AuthView>("sign-in");
  const [authUsernameInput, setAuthUsernameInput] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  const [isUsernameEditorOpen, setIsUsernameEditorOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pendingTagDelete, setPendingTagDelete] = useState<string | null>(null);
  const [credentialInput, setCredentialInput] = useState("");
  const [credentialAuthor, setCredentialAuthor] = useState<string | null>(null);
  const [titleSuggestions, setTitleSuggestions] = useState<CatalogSearchResult[]>(
    [],
  );
  const [isSearchingCatalog, setIsSearchingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isTitleSuggestionActive, setIsTitleSuggestionActive] = useState(false);
  const [selectedCatalogBookId, setSelectedCatalogBookId] = useState<string | null>(
    null,
  );
  const [activeSuggestionField, setActiveSuggestionField] =
    useState<SuggestionField | null>(null);
  const [activeTagActionMenu, setActiveTagActionMenu] = useState<string | null>(
    null,
  );
  const [draftTagDrag, setDraftTagDrag] = useState<DraftTagDrag | null>(null);
  const [draftTagDropTarget, setDraftTagDropTarget] = useState<{
    field: SuggestionField;
    tag: string | null;
  } | null>(null);
  const [selectedInterestPath, setSelectedInterestPath] = useState<string[]>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [genreInterests, setGenreInterests] = useState<GenreInterestMap>({});
  const [authorExperiences, setAuthorExperiences] =
    useState<AuthorExperienceMap>({});
  const [seriesExperiences, setSeriesExperiences] =
    useState<SeriesExperienceMap>({});
  const [authorCredentials, setAuthorCredentials] =
    useState<AuthorCredentialMap>({});
  const [recommendations, setRecommendations] =
    useState<PathRecommendationResponse | null>(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(
    null,
  );
  const [listSize, setListSize] = useState(5);
  const [showArchive, setShowArchive] = useState(false);
  const [addedRecIds, setAddedRecIds] = useState<Set<string>>(new Set());
  const [graphAddGenreInput, setGraphAddGenreInput] = useState("");
  const [graphAddGenreRating, setGraphAddGenreRating] = useState<number | null>(null);
  const [isGraphGenreSuggestionActive, setIsGraphGenreSuggestionActive] =
    useState(false);
  const [graphEditingNode, setGraphEditingNode] = useState<{ tag: string; screenX: number; screenY: number } | null>(null);
  const leftColumnRef = useRef<HTMLElement | null>(null);
  const rightColumnRef = useRef<HTMLElement | null>(null);
  const entryFormRef = useRef<HTMLFormElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingBookRectsRef = useRef<Map<number, DOMRect> | null>(null);
  const highlightClearTimeoutRef = useRef<number | null>(null);
  const titleSearchRequestRef = useRef(0);
  const selectedCatalogTitleRef = useRef("");
  const [pendingBookRevealId, setPendingBookRevealId] = useState<number | null>(
    null,
  );

  const applyLibraryState = useCallback((libraryState: LibraryState) => {
    setBooks(libraryState.books);
    setCatalogBooks(libraryState.catalogBooks);
    setGenreInterests(libraryState.genreInterests);
    setAuthorExperiences(libraryState.authorExperiences);
    setSeriesExperiences(libraryState.seriesExperiences ?? {});
    setProfiles(libraryState.profiles);
    setActiveProfileId(libraryState.activeProfileId);
  }, []);

  const clearLibraryState = useCallback(() => {
    setBooks([]);
    setCatalogBooks([]);
    setGenreInterests({});
    setAuthorExperiences({});
    setSeriesExperiences({});
    setProfiles([]);
    setActiveProfileId(null);
  }, []);

  const captureVisibleBookRects = useCallback(() => {
    const rects = new Map<number, DOMRect>();
    const cards = leftColumnRef.current?.querySelectorAll<HTMLElement>(
      ".ranking-row[data-book-id]",
    );

    cards?.forEach((card) => {
      const id = Number(card.dataset.bookId);

      if (Number.isFinite(id)) {
        rects.set(id, card.getBoundingClientRect());
      }
    });

    return rects;
  }, []);

  const applyBooksUpdate = useCallback(
    (nextBooks: Book[]) => {
      pendingBookRectsRef.current = captureVisibleBookRects();
      setBooks(nextBooks);
      setCatalogBooks((current) =>
        upsertCatalogBooks(
          current,
          nextBooks.map((book) => ({ ...book, genres: [] })),
        ),
      );
    },
    [captureVisibleBookRects],
  );

  const queueBookReveal = useCallback((bookId: number | null) => {
    if (bookId == null || !Number.isFinite(bookId)) {
      return;
    }

    setPendingBookRevealId(bookId);
    setHighlightedBookId(bookId);

    if (highlightClearTimeoutRef.current != null) {
      window.clearTimeout(highlightClearTimeoutRef.current);
    }

    highlightClearTimeoutRef.current = window.setTimeout(() => {
      setHighlightedBookId((current) => (current === bookId ? null : current));
      highlightClearTimeoutRef.current = null;
    }, 2400);
  }, []);

  const revealSavedBook = useCallback(
    (book: Book | null) => {
      if (!book) {
        return;
      }

      setShowArchive(Boolean(book.read));
      setSelectedInterestPath((current) =>
        matchesSelectedGenres(book.genres, current) ? current : [],
      );
      queueBookReveal(book.id);
    },
    [queueBookReveal],
  );

  useLayoutEffect(() => {
    const previousRects = pendingBookRectsRef.current;
    const revealedBookId = pendingBookRevealId;

    if (!previousRects || previousRects.size === 0) {
      pendingBookRectsRef.current = null;
      return;
    }

    pendingBookRectsRef.current = null;

    const cards = leftColumnRef.current?.querySelectorAll<HTMLElement>(
      ".ranking-row[data-book-id]",
    );

    if (!cards || cards.length === 0) {
      return;
    }

    const animatedCards: HTMLElement[] = [];

    cards.forEach((card) => {
      const id = Number(card.dataset.bookId);

      if (id === revealedBookId) {
        return;
      }

      const previousRect = previousRects.get(id);

      if (!previousRect) {
        return;
      }

      const nextRect = card.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        return;
      }

      card.style.transition = "none";
      card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      card.style.willChange = "transform";
      animatedCards.push(card);
    });

    if (animatedCards.length === 0) {
      return;
    }

    void document.body.offsetHeight;

    const cleanup = () => {
      animatedCards.forEach((card) => {
        card.style.removeProperty("transition");
        card.style.removeProperty("transform");
        card.style.removeProperty("will-change");
      });
    };

    const frameId = window.requestAnimationFrame(() => {
      animatedCards.forEach((card) => {
        card.style.transition =
          "transform 720ms cubic-bezier(0.22, 1, 0.36, 1)";
        card.style.transform = "translate(0, 0)";
      });
    });

    const timeoutId = window.setTimeout(cleanup, 800);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      cleanup();
    };
  }, [books, pendingBookRevealId, showArchive]);

  useEffect(() => {
    const bookId = pendingBookRevealId;

    if (bookId == null) {
      return;
    }

    const card = leftColumnRef.current?.querySelector<HTMLElement>(
      `.ranking-row[data-book-id="${bookId}"]`,
    );

    if (!card) {
      return;
    }

    const container =
      card.closest<HTMLElement>(".board, .archive-list") ?? leftColumnRef.current;

    if (!container) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const translateY = currentTranslateY(card);
      const finalCardTop = cardRect.top - translateY;
      const currentScrollTop = container.scrollTop;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const targetScrollTop = Math.min(
        maxScrollTop,
        Math.max(
          0,
          currentScrollTop +
            (finalCardTop - containerRect.top) -
            (container.clientHeight - cardRect.height) / 2,
        ),
      );

      setPendingBookRevealId((current) => (current === bookId ? null : current));
      container.scrollTo({
        top: targetScrollTop,
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [books, pendingBookRevealId, selectedInterestPath, showArchive]);

  useEffect(() => {
    return () => {
      if (highlightClearTimeoutRef.current != null) {
        window.clearTimeout(highlightClearTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    if (authEnabled && authStatus !== "signed-in") {
      clearLibraryState();
      setIsLoading(authStatus === "checking");
      return () => {
        isActive = false;
      };
    }

    async function loadSavedBooks() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const savedLibrary = await fetchLibraryState();
        if (isActive) {
          applyLibraryState(savedLibrary);
        }
      } catch (error) {
        if (isActive) {
          if (error instanceof AuthRequiredError) {
            setAuthSession(null);
            setAuthStatus("signed-out");
            clearLibraryState();
            return;
          }

          setErrorMessage(messageFromError(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadSavedBooks();

    return () => {
      isActive = false;
    };
  }, [applyLibraryState, authEnabled, authStatus, clearLibraryState]);

  const toggleInterestPathTag = useCallback((tag: string) => {
    setSelectedInterestPath((current) => {
      const existingIndex = current.indexOf(tag);

      if (existingIndex === -1) {
        return [...current, tag];
      }

      return current.filter((currentTag) => currentTag !== tag);
    });
  }, []);

  const resolvedBooks = useMemo(() => {
    const allowedGenres = new Set(
      Object.keys(genreInterests).map(normalizeGenreTag).filter(Boolean),
    );
    const catalogByIdentity = new Map<string, CatalogBook>();
    for (const cb of catalogBooks) {
      catalogByIdentity.set(buildCatalogIdentityKey(cb), cb);
    }

    return books.map((book) => {
      if (!book.genreAdded && !book.genreRemoved) {
        return book;
      }

      const catalogKey = buildCatalogIdentityKey({
        title: book.title,
        authors: book.authors,
      });
      const catalogBook = catalogByIdentity.get(catalogKey);
      const catGenres = catalogBook?.genres ?? [];

      return {
        ...book,
        genres: resolveBookGenres(
          catGenres,
          allowedGenres,
          book.genreAdded,
          book.genreRemoved,
        ),
      };
    });
  }, [books, catalogBooks, genreInterests]);

  const visibleGraphGenres = useMemo(() => {
    return uniqueTags(
      resolvedBooks.flatMap((book) =>
        uniqueTags(book.genres).filter((tag) => genreInterests[tag] != null),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }, [resolvedBooks, genreInterests]);

  useEffect(() => {
    const visibleGraphTags = new Set(visibleGraphGenres);

    setSelectedInterestPath((current) =>
      current.filter((tag) => visibleGraphTags.has(tag)),
    );
  }, [visibleGraphGenres]);

  useEffect(() => {
    setGraphEditingNode((current) =>
      current &&
      selectedInterestPath.length === 1 &&
      selectedInterestPath.includes(current.tag)
        ? current
        : null,
    );
  }, [selectedInterestPath]);

  const { predictiveBooks, rankedBooks, readBooks } = useMemo(
    () =>
      buildBookAnalytics({
        books: resolvedBooks,
        genreInterests,
        authorExperiences,
        seriesExperiences,
      }),
    [resolvedBooks, genreInterests, authorExperiences, seriesExperiences],
  );

  const visibleRankedBooks = useMemo(
    () =>
      rankedBooks.filter((book) =>
        matchesSelectedGenres(book.genres, selectedInterestPath),
      ),
    [rankedBooks, selectedInterestPath],
  );

  const visibleReadBooks = useMemo(
    () =>
      readBooks.filter((book) =>
        matchesSelectedGenres(book.genres, selectedInterestPath),
      ),
    [readBooks, selectedInterestPath],
  );

  const hasSelectedNodeFilter = selectedInterestPath.length > 0;
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );
  const accountEmail = authSession?.user.email?.trim() ?? "";
  const storedAccountUsername = normalizeAccountUsername(
    authSession?.user.user_metadata?.username,
  );
  const displayedProfileName =
    storedAccountUsername ||
    (!isPlaceholderProfileName(activeProfile?.name) ? activeProfile?.name : "") ||
    accountEmail.split("@")[0] ||
    "Profile";
  const needsUsernameSetup =
    authEnabled &&
    authStatus === "signed-in" &&
    authSession != null &&
    !storedAccountUsername &&
    isPlaceholderProfileName(activeProfile?.name);
  const isUsernameModalOpen = needsUsernameSetup || isUsernameEditorOpen;
  const profileControlDisabled =
    isLoading || isSaving || isAuthBusy || isUpdatingUsername;

  const isEditing = editingBookId !== null;
  const currentYearLabel = String(currentYear);
  const yearOptions = useMemo(() => {
    const totalYears = currentYear - MIN_YEAR_OPTION + 1;
    return Array.from({ length: totalYears }, (_, index) => currentYear - index);
  }, [currentYear]);

  const { knownGenres, knownAuthors, knownSeries } = useMemo(() => {
    const nextGenres = new Set<string>();
    const nextAuthors = new Set<string>();
    const nextSeries = new Set<string>();

    for (const book of resolvedBooks) {
      for (const genre of book.genres) {
        nextGenres.add(genre);
      }

      for (const author of book.authors) {
        nextAuthors.add(author);
      }

      if (book.series?.trim()) {
        nextSeries.add(book.series);
      }
    }

    for (const genre of Object.keys(genreInterests)) {
      nextGenres.add(genre);
    }

    for (const author of Object.keys(authorExperiences)) {
      nextAuthors.add(author);
    }

    for (const series of Object.keys(seriesExperiences)) {
      nextSeries.add(series);
    }

    return {
      knownGenres: Array.from(nextGenres).sort((a, b) => a.localeCompare(b)),
      knownAuthors: Array.from(nextAuthors).sort((a, b) => a.localeCompare(b)),
      knownSeries: Array.from(nextSeries).sort((a, b) => a.localeCompare(b)),
    };
  }, [resolvedBooks, genreInterests, authorExperiences, seriesExperiences]);


  const authorSuggestions = useMemo(() => {
    return matchingSuggestions(draft.authorInput, draft.authors, knownAuthors);
  }, [draft.authorInput, draft.authors, knownAuthors]);

  const genreSuggestions = useMemo(() => {
    return matchingSuggestions(draft.genreInput, draft.genres, knownGenres);
  }, [draft.genreInput, draft.genres, knownGenres]);

  const graphGenreSuggestions = useMemo(() => {
    return matchingSuggestions(graphAddGenreInput, [], visibleGraphGenres);
  }, [graphAddGenreInput, visibleGraphGenres]);

  const resetDraft = useCallback(() => {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest(".ranking-row")
    ) {
      activeElement.blur();
    }

    titleSearchRequestRef.current += 1;
    setDraft(createDraft());
    setEditingBookId(null);
    setTitleSuggestions([]);
    setIsSearchingCatalog(false);
    setCatalogError(null);
    setIsTitleSuggestionActive(false);
    setSelectedCatalogBookId(null);
    setSelectedRecommendationId(null);
    selectedCatalogTitleRef.current = "";
    setActiveSuggestionField(null);
    setActiveTagActionMenu(null);
    setDraftTagDrag(null);
    setDraftTagDropTarget(null);
  }, []);

  const resetProfileWorkspace = useCallback(() => {
    resetDraft();
    pendingBookRectsRef.current = null;
    setPendingBookRevealId(null);
    setHighlightedBookId(null);
    setPendingDeleteId(null);
    setPendingTagDelete(null);
    setSelectedInterestPath([]);
    setShowArchive(false);
    setRecommendations(null);
    setRecError(null);
    setIsLoadingRecs(false);
    setAddedRecIds(new Set());
    setGraphEditingNode(null);
  }, [resetDraft]);

  useEffect(() => {
    if (knownAuthors.length === 0) return;

    let isActive = true;

    void fetchAuthorCredentials(knownAuthors).then((creds) => {
      if (isActive) setAuthorCredentials(creds);
    }).catch(() => {
      // Credentials are non-critical — silently ignore failures
    });

    return () => { isActive = false; };
  }, [knownAuthors]);

  useEffect(() => {
    if (!authEnabled) {
      setAuthStatus("disabled");
      return;
    }

    let isActive = true;

    void getAuthSession()
      .then((session) => {
        if (!isActive) {
          return;
        }

        setAuthSession(session);
        setAuthStatus(session ? "signed-in" : "signed-out");
        setAuthEmail(session?.user.email ?? "");
        setAuthUsernameInput(
          normalizeAccountUsername(session?.user.user_metadata?.username) ||
            (session?.user.email?.split("@")[0] ?? ""),
        );
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setAuthSession(null);
        setAuthStatus("signed-out");
        setErrorMessage(messageFromError(error));
      });

    const unsubscribe = subscribeToAuthChanges((session) => {
      if (!isActive) {
        return;
      }

      setAuthSession(session);
      setAuthStatus(session ? "signed-in" : "signed-out");
      setIsAuthBusy(false);
      setIsProfileMenuOpen(false);
      setAuthPassword("");
      setAuthConfirmPassword("");

      if (session) {
        setAuthEmail(session.user.email ?? "");
        setAuthUsernameInput(
          normalizeAccountUsername(session.user.user_metadata?.username) ||
            (session.user.email?.split("@")[0] ?? ""),
        );
        setIsUsernameEditorOpen(false);
        setAuthFeedback(null);
        setErrorMessage(null);
        return;
      }

      setAuthUsernameInput("");
      setIsUsernameEditorOpen(false);
      resetProfileWorkspace();
      clearLibraryState();
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [authEnabled, clearLibraryState, resetProfileWorkspace]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setAuthFeedback(null);

    const nextEmail = authEmail.trim().toLocaleLowerCase();

    if (!nextEmail) {
      setErrorMessage("Email is required.");
      return;
    }

    if (authMode !== "reset" && !authPassword) {
      setErrorMessage("Password is required.");
      return;
    }

    const nextUsername = normalizeAccountUsername(authUsernameInput);

    if (authMode === "sign-up" && !nextUsername) {
      setErrorMessage("Username is required.");
      return;
    }

    if (authMode === "sign-up" && authPassword !== authConfirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsAuthBusy(true);

    try {
      if (authMode === "sign-up") {
        const result = await signUpWithEmail(nextEmail, authPassword, nextUsername);
        setAuthPassword("");
        setAuthConfirmPassword("");

        if (result.needsEmailConfirmation) {
          setAuthFeedback("Check your email to confirm your account.");
          setAuthMode("sign-in");
        }
      } else if (authMode === "reset") {
        await requestPasswordReset(nextEmail);
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthFeedback("Password reset email sent.");
        setAuthMode("sign-in");
      } else {
        await signInWithEmail(nextEmail, authPassword);
        setAuthPassword("");
        setAuthConfirmPassword("");
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleLogout() {
    setIsProfileMenuOpen(false);
    setIsUsernameEditorOpen(false);
    setErrorMessage(null);

    if (!authEnabled) {
      return;
    }

    setIsAuthBusy(true);

    try {
      await signOutUser();
    } catch (error) {
      setErrorMessage(messageFromError(error));
      setIsAuthBusy(false);
    }
  }

  function openUsernameEditor() {
    setIsProfileMenuOpen(false);
    setErrorMessage(null);
    setAuthUsernameInput(storedAccountUsername || displayedProfileName);
    setIsUsernameEditorOpen(true);
  }

  async function handleUsernameSetupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const nextUsername = normalizeAccountUsername(authUsernameInput);

    if (!nextUsername) {
      setErrorMessage("Username is required.");
      return;
    }

    if (!authSession) {
      setErrorMessage("Sign in required.");
      return;
    }

    setIsUpdatingUsername(true);

    try {
      await updateSignedInUsername(nextUsername);

      if (activeProfile) {
        applyLibraryState(await updateProfile(activeProfile.id, nextUsername));
      }

      const nextSession = await getAuthSession();
      setAuthSession(nextSession);
      setAuthUsernameInput(nextUsername);
      setIsUsernameEditorOpen(false);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setIsUpdatingUsername(false);
    }
  }

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        profileMenuRef.current?.contains(target)
      ) {
        return;
      }

      setIsProfileMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (scrollToForm) {
      document
        .querySelector(".control-panel")
        ?.scrollIntoView({ behavior: "instant" });
      setScrollToForm(false);
    }
  }, [scrollToForm]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isEditing) {
        resetDraft();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isEditing, resetDraft]);

  useEffect(() => {
    if (editingBookId == null && selectedRecommendationId == null) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (rightColumnRef.current?.contains(target)) {
        return;
      }

      if (profileMenuRef.current?.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest(".ranking-row")) {
        return;
      }

      resetDraft();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [editingBookId, selectedRecommendationId, resetDraft]);

  useEffect(() => {
    if (!activeTagActionMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Element && target.closest(".tag-action-shell")) {
        return;
      }

      setActiveTagActionMenu(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeTagActionMenu]);

  useEffect(() => {
    if (
      selectedRecommendationId == null ||
      recommendations?.candidates.some(
        (candidate) => candidate.id === selectedRecommendationId,
      )
    ) {
      return;
    }

    setSelectedRecommendationId(null);
  }, [recommendations, selectedRecommendationId]);

  const parsedDraftLastReadYear = draft.lastReadYear.trim()
    ? Number(draft.lastReadYear)
    : undefined;
  const showTitleSuggestions =
    isTitleSuggestionActive && titleSuggestions.length > 0;
  const hasAutomatedDraftStats =
    draft.starRating.trim().length > 0 || draft.ratingCount.trim().length > 0;
  const canSubmit =
    !isLoading && !isSaving && draft.title.trim().length > 0;

  useEffect(() => {
    if (!isTitleSuggestionActive) {
      setIsSearchingCatalog(false);
      setCatalogError(null);
      return;
    }

    const query = draft.title.trim();
    const hasSelectedCatalogMatch =
      selectedCatalogBookId != null &&
      query.length > 0 &&
      query === selectedCatalogTitleRef.current;

    if (!query || query.length < 2 || hasSelectedCatalogMatch) {
      setIsSearchingCatalog(false);
      setCatalogError(null);
      setTitleSuggestions([]);
      return;
    }

    const requestId = titleSearchRequestRef.current + 1;
    titleSearchRequestRef.current = requestId;
    let cancelled = false;
    let controller: AbortController | null = null;

    setIsSearchingCatalog(true);
    setCatalogError(null);

    const debounce = window.setTimeout(async () => {
      const localResponse = searchCatalog(
        books,
        query,
        TITLE_SUGGESTION_FETCH_LIMIT,
        catalogBooks,
      );

      if (cancelled || titleSearchRequestRef.current !== requestId) {
        return;
      }

      controller = new AbortController();

      try {
        const remoteResponse = await searchOpenLibraryCatalog(
          query,
          TITLE_SUGGESTION_FETCH_LIMIT,
          controller.signal,
        );

        if (cancelled || titleSearchRequestRef.current !== requestId) {
          return;
        }

        setTitleSuggestions(
          mergeCatalogSearchResults(
            remoteResponse.results,
            localResponse.results,
            TITLE_SUGGESTION_FETCH_LIMIT,
          ),
        );
        setCatalogError(null);
      } catch (error) {
        if (cancelled || titleSearchRequestRef.current !== requestId) {
          return;
        }

        const message = messageFromCatalogLookupError(error);

        if (localResponse.results.length > 0) {
          setTitleSuggestions(localResponse.results);
          setCatalogError(null);
        } else if (message) {
          setCatalogError(message);
        }
      } finally {
        if (!cancelled && titleSearchRequestRef.current === requestId) {
          setIsSearchingCatalog(false);
        }
      }
    }, 260);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(debounce);
    };
  }, [
    books,
    catalogBooks,
    draft.title,
    isTitleSuggestionActive,
    selectedCatalogBookId,
  ]);

  function updateDraft(field: DraftTextField, value: string) {
    if (field === "title") {
      setSelectedCatalogBookId(null);
      setSelectedRecommendationId(null);
      setCatalogError(null);
      selectedCatalogTitleRef.current = "";
    }

    setDraft((current) => {
      let clamped = value;
      const num = Number(value);

      if (field === "seriesNumber") {
        clamped = value.replace(/[^\d.]/g, "");
        const decimalIndex = clamped.indexOf(".");

        if (decimalIndex !== -1) {
          clamped =
            clamped.slice(0, decimalIndex + 1) +
            clamped
              .slice(decimalIndex + 1)
              .replace(/\./g, "");
        }
      }

      if (value.trim() && Number.isFinite(num)) {
        if (
          (field === "genreInterest" ||
            field === "authorExperience" ||
            field === "seriesExperience") &&
          num < 0
        ) {
          clamped = "0";
        }
        if (
          (field === "genreInterest" ||
            field === "authorExperience" ||
            field === "seriesExperience") &&
          num > 5
        ) {
          clamped = "5";
        }
        if (
          (field === "genreInterest" ||
            field === "authorExperience" ||
            field === "seriesExperience") &&
          !Number.isInteger(num)
        ) {
          clamped = String(Math.round(num));
        }
      }

      const next = { ...current, [field]: clamped };
      if (field === "title") {
        next.starRating = "";
        next.ratingCount = "";
      }
      if (field === "progress") {
        const progressValue = clamped.trim()
          ? Math.max(0, Math.min(100, Number(clamped)))
          : undefined;

        if (
          progressValue != null &&
          Number.isFinite(progressValue) &&
          progressValue >= 100
        ) {
          next.progress = "100";
          next.readCount = Math.max(1, current.readCount);
          next.lastReadYear = current.lastReadYear.trim() || currentYearLabel;
        } else {
          next.readCount = 0;
          next.lastReadYear = "";
        }
      }
      if (field === "series" && !clamped.trim()) {
        next.seriesNumber = "";
      }
      if (field === "seriesExperience") {
        next.seriesExperienceIsManual = true;
        return next;
      }
      if (field === "series") {
        const currentMatch = resolvedSuggestion(current.series, [], knownSeries);
        const nextMatch = resolvedSuggestion(clamped, [], knownSeries);
        const nextScore =
          nextMatch != null && seriesExperiences[nextMatch] != null
            ? String(seriesExperiences[nextMatch])
            : "";

        if (!clamped.trim()) {
          next.seriesNumber = "";
          next.seriesExperience = "";
          next.seriesExperienceIsManual = false;
        } else if (
          nextScore &&
          (!current.seriesExperienceIsManual || currentMatch !== nextMatch)
        ) {
          next.seriesExperience = nextScore;
          next.seriesExperienceIsManual = false;
        } else if (!nextScore && currentMatch !== nextMatch) {
          next.seriesExperience = "";
          next.seriesExperienceIsManual = false;
        }
      }
      if (field === "authorExperience") {
        const matchingAuthor = findMatchingDraftTag(
          "author",
          current.authorInput,
          current.authors,
        );

        if (matchingAuthor) {
          next.authorScores = clamped.trim()
            ? {
                ...current.authorScores,
                [matchingAuthor]: clamped,
              }
            : {
                ...current.authorScores,
                [matchingAuthor]: "",
              };
        }

        next.authorExperienceIsManual = true;
        return next;
      }

      if (field === "genreInterest") {
        const matchingGenre = findMatchingDraftTag(
          "genre",
          current.genreInput,
          current.genres,
        );

        if (matchingGenre) {
          next.genreScores = clamped.trim()
            ? {
                ...current.genreScores,
                [matchingGenre]: clamped,
              }
            : {
                ...current.genreScores,
                [matchingGenre]: "",
              };
        }

        next.genreInterestIsManual = true;
        return next;
      }

      if (field === "genreInput") {
        const currentMatch = resolvedSuggestion(
          current.genreInput,
          current.genres,
          knownGenres,
        );
        const nextMatch = resolvedSuggestion(
          clamped,
          current.genres,
          knownGenres,
        );
        const nextScore =
          nextMatch != null
            ? hasDraftTagScore(current.genreScores, nextMatch)
              ? current.genreScores[nextMatch]?.trim() ?? ""
              : genreInterests[nextMatch] != null
                ? String(genreInterests[nextMatch])
                : ""
            : "";

        if (!clamped.trim()) {
          next.genreInterest = "";
          next.genreInterestIsManual = false;
        } else if (
          nextScore &&
          (!current.genreInterestIsManual || currentMatch !== nextMatch)
        ) {
          next.genreInterest = nextScore;
          next.genreInterestIsManual = false;
        } else if (!nextScore && currentMatch !== nextMatch) {
          next.genreInterest = "";
          next.genreInterestIsManual = false;
        }
      }

      if (field === "authorInput") {
        const currentMatch = resolvedSuggestion(
          current.authorInput,
          current.authors,
          knownAuthors,
        );
        const nextMatch = resolvedSuggestion(
          clamped,
          current.authors,
          knownAuthors,
        );
        const nextScore =
          nextMatch != null
            ? hasDraftTagScore(current.authorScores, nextMatch)
              ? current.authorScores[nextMatch]?.trim() ?? ""
              : authorExperiences[nextMatch] != null
                ? String(authorExperiences[nextMatch])
                : ""
            : "";

        if (!clamped.trim()) {
          next.authorExperience = "";
          next.authorExperienceIsManual = false;
        } else if (
          nextScore &&
          (!current.authorExperienceIsManual || currentMatch !== nextMatch)
        ) {
          next.authorExperience = nextScore;
          next.authorExperienceIsManual = false;
        } else if (!nextScore && currentMatch !== nextMatch) {
          next.authorExperience = "";
          next.authorExperienceIsManual = false;
        }
      }

      return next;
    });
  }

  function effectiveLastReadYear(book: Book) {
    return book.lastReadYear ?? book.archivedAtYear;
  }

  function setDraftReadCount(nextReadCount: number) {
    setDraft((prev) => {
      const readCount = Math.max(0, Math.floor(nextReadCount));
      return {
        ...prev,
        readCount,
        progress:
          readCount > 0
            ? "100"
            : prev.progress.trim() === "100"
              ? ""
              : prev.progress,
        lastReadYear:
          readCount > 0 ? prev.lastReadYear.trim() || currentYearLabel : "",
      };
    });
  }

  function setDraftLastReadYear(nextLastReadYear: string) {
    const lastReadYear = nextLastReadYear.trim();
    setDraft((prev) => ({
      ...prev,
      lastReadYear,
      progress:
        lastReadYear
          ? "100"
          : prev.progress.trim() === "100"
            ? ""
            : prev.progress,
      readCount: lastReadYear ? Math.max(1, prev.readCount) : 0,
    }));
  }

  function handleSuggestionFieldBlur(
    event: ReactFocusEvent<HTMLDivElement>,
    field: SuggestionField,
  ) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setActiveSuggestionField((current) => (current === field ? null : current));
  }

  function handleTitleSuggestionBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsTitleSuggestionActive(false);
  }

  function handleGraphGenreSuggestionBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsGraphGenreSuggestionActive(false);
  }

  function populateDraftFromAutofill(
    result: DraftAutofillSource,
    options?: { resetDraft?: boolean },
  ) {
    const catalogGenres = buildCatalogGenres(
      result,
      knownGenres,
    );
    setDraft((current) => {
      const baseDraft = options?.resetDraft ? createDraft() : current;
      const nextAuthors =
        result.authors.length > 0 ? uniqueTags(result.authors) : baseDraft.authors;
      const nextGenres =
        catalogGenres.length > 0 ? catalogGenres : baseDraft.genres;

      return {
        ...baseDraft,
        title: result.title,
        series: result.series ?? "",
        seriesNumber:
          result.seriesNumber != null
            ? String(result.seriesNumber)
            : "",
        seriesExperience:
          result.series && seriesExperiences[result.series] != null
            ? String(seriesExperiences[result.series])
            : "",
        seriesExperienceIsManual: false,
        authors: nextAuthors,
        authorInput: "",
        authorExperience: "",
        authorExperienceIsManual: false,
        authorScores:
          result.authors.length > 0
            ? buildDraftScores(nextAuthors, authorExperiences)
            : baseDraft.authorScores,
        genres: nextGenres,
        genreInput: "",
        genreInterest: "",
        genreInterestIsManual: false,
        genreScores:
          catalogGenres.length > 0
            ? buildDraftScores(nextGenres, genreInterests)
            : baseDraft.genreScores,
        starRating:
          result.averageRating != null
            ? formatCatalogRating(result.averageRating)
            : "",
        ratingCount:
          result.ratingsCount != null
            ? formatCatalogRatingCount(result.ratingsCount)
            : "",
      };
    });

    setSelectedCatalogBookId(result.id);
    selectedCatalogTitleRef.current = result.title;
    setTitleSuggestions([]);
    setCatalogError(null);
  }

  function scrollControlPanelIntoView() {
    window.requestAnimationFrame(() => {
      entryFormRef.current
        ?.closest(".control-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function selectCatalogSuggestion(result: CatalogSearchResult) {
    setSelectedRecommendationId(null);
    populateDraftFromAutofill(result);
  }

  function selectRecommendedBook(result: RecommendedBook) {
    setIsTitleSuggestionActive(false);
    setEditingBookId(null);
    setErrorMessage(null);
    setActiveSuggestionField(null);
    setActiveTagActionMenu(null);
    setDraftTagDrag(null);
    setDraftTagDropTarget(null);
    setSelectedRecommendationId(result.id);
    populateDraftFromAutofill(result, { resetDraft: true });
    scrollControlPanelIntoView();
  }

  function selectSuggestedValue(field: SuggestionField, value: string) {
    setDraft((current) => {
      const isAuthor = field === "author";
      const inputKey = isAuthor ? "authorInput" : "genreInput";
      const ratingKey = isAuthor ? "authorExperience" : "genreInterest";
      const manualKey = isAuthor
        ? "authorExperienceIsManual"
        : "genreInterestIsManual";
      const globalScores = isAuthor ? authorExperiences : genreInterests;
      const next = { ...current, [inputKey]: value };
      const existingScore = globalScores[value];

      if (existingScore != null) {
        next[ratingKey] = String(existingScore);
        next[manualKey] = false;
      } else if (!current[manualKey]) {
        next[ratingKey] = "";
        next[manualKey] = false;
      }

      return next;
    });
    setActiveSuggestionField(null);
  }

  function getDraftTagScore(field: SuggestionField, tag: string) {
    const scoreMap =
      field === "author" ? draft.authorScores : draft.genreScores;
    const globalScores =
      field === "author" ? authorExperiences : genreInterests;
    const draftScore = scoreMap[tag]?.trim() ?? "";

    if (hasDraftTagScore(scoreMap, tag)) {
      return draftScore;
    }

    if (globalScores[tag] != null) {
      return String(globalScores[tag]);
    }

    return "";
  }

  function findMatchingDraftTag(
    field: SuggestionField,
    query: string,
    selectedTags: string[],
  ) {
    if (field === "author") {
      const normalizedQuery = query.trim().toLocaleLowerCase();

      if (!normalizedQuery) {
        return null;
      }

      return (
        selectedTags.find(
          (tag) => tag.trim().toLocaleLowerCase() === normalizedQuery,
        ) ?? null
      );
    }

    const normalizedQuery = normalizeGenreTag(query);

    if (!normalizedQuery) {
      return null;
    }

    return selectedTags.find((tag) => tag === normalizedQuery) ?? null;
  }

  function startEditingDraftTag(field: SuggestionField, tag: string) {
    setDraft((current) => {
      const isAuthor = field === "author";
      const inputKey = isAuthor ? "authorInput" : "genreInput";
      const ratingKey = isAuthor ? "authorExperience" : "genreInterest";
      const manualKey = isAuthor
        ? "authorExperienceIsManual"
        : "genreInterestIsManual";
      const scoreMap = isAuthor ? current.authorScores : current.genreScores;
      const globalScores = isAuthor ? authorExperiences : genreInterests;
      const scoreValue =
        hasDraftTagScore(scoreMap, tag)
          ? scoreMap[tag]?.trim() ?? ""
          : globalScores[tag] != null
            ? String(globalScores[tag])
            : "";

      return {
        ...current,
        [inputKey]: tag,
        [ratingKey]: scoreValue,
        [manualKey]: false,
      };
    });
    setActiveSuggestionField(field);
    setActiveTagActionMenu(null);
  }

  function addDraftTag(field: SuggestionField, explicitValue?: string) {
    setDraft((current) => {
      const isAuthor = field === "author";
      const inputKey = isAuthor ? "authorInput" : "genreInput";
      const ratingKey = isAuthor ? "authorExperience" : "genreInterest";
      const manualKey = isAuthor
        ? "authorExperienceIsManual"
        : "genreInterestIsManual";
      const tagsKey = isAuthor ? "authors" : "genres";
      const scoresKey = isAuthor ? "authorScores" : "genreScores";
      const rawTag = explicitValue ?? current[inputKey];
      const nextTag = isAuthor ? rawTag.trim() : normalizeGenreTag(rawTag);

      if (!nextTag) {
        return current;
      }

      const globalScores = isAuthor ? authorExperiences : genreInterests;
      const currentRatingValue = current[ratingKey].trim();
      const existingDraftScore = hasDraftTagScore(current[scoresKey], nextTag)
        ? current[scoresKey][nextTag]?.trim() ?? ""
        : undefined;
      const ratingValue =
        currentRatingValue ||
        existingDraftScore ||
        (existingDraftScore === ""
          ? ""
          : globalScores[nextTag] != null
            ? String(globalScores[nextTag])
            : "");

      if (current[tagsKey].includes(nextTag)) {
        if (!ratingValue || current[scoresKey][nextTag] === ratingValue) {
          return {
            ...current,
            [inputKey]: "",
            [ratingKey]: "",
            [manualKey]: false,
          };
        }

        return {
          ...current,
          [scoresKey]: {
            ...current[scoresKey],
            [nextTag]: ratingValue,
          },
          [inputKey]: "",
          [ratingKey]: "",
          [manualKey]: false,
        };
      }

      const nextTags = uniqueTags([...current[tagsKey], nextTag]);

      return {
        ...current,
        [tagsKey]: nextTags,
        [scoresKey]: ratingValue
          ? {
              ...current[scoresKey],
              [nextTag]: ratingValue,
            }
          : current[scoresKey],
        [inputKey]: "",
        [ratingKey]: "",
        [manualKey]: false,
      };
    });
  }

  function reorderDraftTags(
    field: SuggestionField,
    draggedTag: string,
    targetTag: string | null,
  ) {
    setDraft((current) => {
      const tagsKey = field === "author" ? "authors" : "genres";
      const currentTags = current[tagsKey];
      const nextTags =
        targetTag == null
          ? moveTagToEnd(currentTags, draggedTag)
          : reorderTags(currentTags, draggedTag, targetTag);

      if (nextTags === currentTags) {
        return current;
      }

      return {
        ...current,
        [tagsKey]: nextTags,
      };
    });
  }

  function removeDraftTag(field: SuggestionField, tag: string) {
    setDraft((current) => {
      if (field === "author") {
        return {
          ...current,
          authors: current.authors.filter((author) => author !== tag),
        };
      }

      return {
        ...current,
        genres: current.genres.filter((genre) => genre !== tag),
      };
    });
  }

  function handleTagInputKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    field: SuggestionField,
  ) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addDraftTag(field);
    }
  }

  function handleDraftTagDragStart(
    event: ReactDragEvent<HTMLSpanElement>,
    field: SuggestionField,
    tag: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${field}:${tag}`);
    setActiveTagActionMenu(null);
    setDraftTagDrag({ field, tag });
    setDraftTagDropTarget(null);
  }

  function handleDraftTagListDragOver(
    event: ReactDragEvent<HTMLDivElement>,
    field: SuggestionField,
  ) {
    if (!draftTagDrag || draftTagDrag.field !== field) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDraftTagDropTarget((current) =>
      current?.field === field && current.tag === null
        ? current
        : { field, tag: null },
    );
  }

  function handleDraftTagDragOver(
    event: ReactDragEvent<HTMLSpanElement>,
    field: SuggestionField,
    tag: string,
  ) {
    if (!draftTagDrag || draftTagDrag.field !== field) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (draftTagDrag.tag === tag) {
      setDraftTagDropTarget(null);
      return;
    }

    setDraftTagDropTarget((current) =>
      current?.field === field && current.tag === tag
        ? current
        : { field, tag },
    );
  }

  function handleDraftTagDrop(
    event: ReactDragEvent<HTMLElement>,
    field: SuggestionField,
    targetTag: string | null = null,
  ) {
    if (!draftTagDrag || draftTagDrag.field !== field) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    reorderDraftTags(field, draftTagDrag.tag, targetTag);
    setDraftTagDrag(null);
    setDraftTagDropTarget(null);
  }

  function handleDraftTagDragEnd() {
    setDraftTagDrag(null);
    setDraftTagDropTarget(null);
  }

  function startEditing(book: Book) {
    const lastReadYear = effectiveLastReadYear(book);
    titleSearchRequestRef.current += 1;
    setEditingBookId(book.id);
    setScrollToForm(true);
    setTitleSuggestions([]);
    setIsSearchingCatalog(false);
    setCatalogError(null);
    setIsTitleSuggestionActive(false);
    setSelectedCatalogBookId(null);
    setSelectedRecommendationId(null);
    selectedCatalogTitleRef.current = "";
    setActiveTagActionMenu(null);
    setDraft({
      title: book.title,
      series: book.series ?? "",
      seriesNumber:
        book.seriesNumber != null ? String(book.seriesNumber) : "",
      seriesExperience:
        book.series && seriesExperiences[book.series] != null
          ? String(seriesExperiences[book.series])
          : "",
      seriesExperienceIsManual: false,
      readCount: book.readCount ?? 0,
      starRating: book.starRating != null ? String(book.starRating) : "",
      ratingCount: book.ratingCount != null ? String(book.ratingCount) : "",
      authorInput: "",
      genreInterest: "",
      genreInterestIsManual: false,
      authorExperience: "",
      authorExperienceIsManual: false,
      authors: [...book.authors],
      authorScores: buildDraftScores(book.authors, authorExperiences),
      genreInput: "",
      genres: [...book.genres],
      genreScores: buildDraftScores(book.genres, genreInterests),
      progress: book.progress != null ? String(book.progress) : "",
      myRating: book.myRating ?? null,
      lastReadYear:
        lastReadYear != null
          ? String(lastReadYear)
          : (book.readCount ?? 0) > 0
            ? currentYearLabel
            : "",
      markAsRead: book.read ?? false,
    });
    setErrorMessage(null);
  }

  function toggleEditing(book: Book) {
    if (editingBookId === book.id) {
      entryFormRef.current?.requestSubmit();
      return;
    }

    startEditing(book);
  }

  function toggleCardEditing(book: Book) {
    if (editingBookId === book.id) {
      resetDraft();
      return;
    }

    startEditing(book);
  }

  async function submitBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const parsedProgress = draft.progress.trim()
        ? Number(draft.progress)
        : undefined;
      const sourceCatalogBookId = selectedCatalogBookId;
      const draftTitle = draft.title.trim();
      const catalogKey = buildCatalogIdentityKey({
        title: draftTitle,
        authors: draft.authors,
      });
      const catalogBook = catalogBooks.find(
        (cb) => buildCatalogIdentityKey(cb) === catalogKey,
      );
      const allowedGenres = new Set(
        Object.keys(genreInterests).map(normalizeGenreTag).filter(Boolean),
      );
      const { genreAdded, genreRemoved } = computeGenreOverrides(
        draft.genres,
        catalogBook?.genres ?? [],
        allowedGenres,
      );

      const payload = {
        title: draftTitle,
        ...(draft.series.trim() ? { series: draft.series.trim() } : {}),
        ...(draft.series.trim() && draft.seriesNumber.trim()
          ? { seriesNumber: Number(draft.seriesNumber) }
          : {}),
        authors: draft.authors,
        genres: draft.genres,
        genreAdded,
        genreRemoved,
        progress: parsedProgress,
        myRating: draft.myRating ?? undefined,
        readCount: draft.readCount,
        ...(draft.markAsRead ? { read: true as const } : {}),
        ...(parsedDraftLastReadYear != null
          ? { lastReadYear: parsedDraftLastReadYear }
          : {}),
      };

      let nextInterests = genreInterests;
      for (const genre of draft.genres) {
        const rawInterest = draft.genreScores[genre]?.trim() ?? "";
        if (rawInterest && Number.isFinite(Number(rawInterest))) {
          nextInterests = await writeGenreInterest(genre, Number(rawInterest));
        } else if (
          hasDraftTagScore(draft.genreScores, genre) &&
          nextInterests[genre] != null
        ) {
          nextInterests = await deleteGenreInterest(genre);
        }
      }
      setGenreInterests(nextInterests);

      let nextExps = authorExperiences;
      for (const author of draft.authors) {
        const rawExperience = draft.authorScores[author]?.trim() ?? "";
        if (rawExperience && Number.isFinite(Number(rawExperience))) {
          nextExps = await writeAuthorExperience(author, Number(rawExperience));
        } else if (
          hasDraftTagScore(draft.authorScores, author) &&
          nextExps[author] != null
        ) {
          nextExps = await deleteAuthorExperience(author);
        }
      }
      setAuthorExperiences(nextExps);

      let nextSeriesExps = seriesExperiences;
      const nextSeries = draft.series.trim();
      const rawSeriesExperience = draft.seriesExperience.trim();
      if (nextSeries && rawSeriesExperience && Number.isFinite(Number(rawSeriesExperience))) {
        nextSeriesExps = await writeSeriesExperience(
          nextSeries,
          Number(rawSeriesExperience),
        );
      } else if (nextSeries && nextSeriesExps[nextSeries] != null) {
        nextSeriesExps = await deleteSeriesExperience(nextSeries);
      }
      setSeriesExperiences(nextSeriesExps);

      const nextBooks = isEditing
        ? await updateBookRecord(editingBookId, payload)
        : await createBookRecord(payload);
      const savedBook = isEditing
        ? nextBooks.find((book) => book.id === editingBookId) ?? null
        : nextBooks.find((book) => !books.some((existing) => existing.id === book.id)) ??
          null;

      if (!isEditing && sourceCatalogBookId) {
        setAddedRecIds((current) => {
          const next = new Set(current);
          next.add(sourceCatalogBookId);
          return next;
        });
      }

      revealSavedBook(savedBook);
      applyBooksUpdate(nextBooks);
      resetDraft();
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeGlobalTag(field: "author" | "genre", value: string) {
    const tag = value.trim();

    if (!tag) {
      return;
    }

    setPendingTagDelete(`${field}:${tag}`);
    setErrorMessage(null);

    try {
      if (field === "author") {
        const nextBooks = await renameAuthorInBooks(tag, "");
        const nextExps = await deleteAuthorExperience(tag);

        applyBooksUpdate(nextBooks);
        setAuthorExperiences(nextExps);
        setDraft((current) => ({
          ...current,
          authors: current.authors.filter((author) => author !== tag),
          authorScores: removeTagFromScores(current.authorScores, tag),
          authorInput:
            current.authorInput.trim() === tag ? "" : current.authorInput,
          authorExperience:
            current.authorInput.trim() === tag ? "" : current.authorExperience,
          authorExperienceIsManual:
            current.authorInput.trim() === tag
              ? false
              : current.authorExperienceIsManual,
        }));
      } else {
        const nextBooks = await renameGenreInBooks(tag, "");
        const nextInterests = await deleteGenreInterest(tag);

        applyBooksUpdate(nextBooks);
        setGenreInterests(nextInterests);
        setDraft((current) => ({
          ...current,
          genres: current.genres.filter((genre) => genre !== tag),
          genreScores: removeTagFromScores(current.genreScores, tag),
          genreInput:
            current.genreInput.trim() === tag ? "" : current.genreInput,
          genreInterest:
            current.genreInput.trim() === tag ? "" : current.genreInterest,
          genreInterestIsManual:
            current.genreInput.trim() === tag
              ? false
              : current.genreInterestIsManual,
        }));
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setPendingTagDelete(null);
    }
  }

  async function handleAddCredential(author: string, credential: string) {
    try {
      await addAuthorCredential(author, credential);
      setAuthorCredentials((prev) => ({
        ...prev,
        [author]: [...(prev[author] ?? []), credential],
      }));
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function handleRemoveCredential(author: string, credential: string) {
    try {
      await removeAuthorCredential(author, credential);
      setAuthorCredentials((prev) => ({
        ...prev,
        [author]: (prev[author] ?? []).filter((c) => c !== credential),
      }));
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function removeBook(id: number) {
    setPendingDeleteId(id);
    setErrorMessage(null);

    try {
      const nextBooks = await deleteBookRecord(id);
      applyBooksUpdate(nextBooks);

      if (editingBookId === id) {
        resetDraft();
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setPendingDeleteId(null);
    }
  }

  async function addGraphGenreInterest() {
    const nextGenre = normalizeGenreTag(graphAddGenreInput);

    if (!nextGenre) {
      return;
    }

    const rating = graphAddGenreRating ?? 3;
    setErrorMessage(null);

    try {
      const nextInterests = await writeGenreInterest(nextGenre, rating);
      setGenreInterests(nextInterests);
      setGraphAddGenreInput("");
      setGraphAddGenreRating(null);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  function focusGraphGenre(tag: string) {
    setSelectedInterestPath([tag]);
    setGraphAddGenreInput(tag);
    setGraphAddGenreRating(genreInterests[tag] ?? null);
    setIsGraphGenreSuggestionActive(false);
  }

  async function renameGraphGenre(oldName: string, newName: string) {
    setErrorMessage(null);

    try {
      const nextBooks = await renameGenreInBooks(oldName, newName);
      const nextInterests = await renameGenreInterest(oldName, newName);

      applyBooksUpdate(nextBooks);
      setGenreInterests(nextInterests);
      setSelectedInterestPath((current) =>
        uniqueTags(
          current.map((tag) => (tag === oldName ? newName : tag)),
        ),
      );
      setGraphEditingNode((current) =>
        current && current.tag === oldName ? { ...current, tag: newName } : current,
      );
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function updateGraphGenreInterest(tag: string, level: number | null) {
    setErrorMessage(null);

    try {
      const nextInterests =
        level == null
          ? await deleteGenreInterest(tag)
          : await writeGenreInterest(tag, level);
      setGenreInterests(nextInterests);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function clearDisplayedList() {
    setErrorMessage(null);
    const targets = showArchive ? visibleReadBooks : visibleRankedBooks;
    try {
      for (const book of targets) {
        await deleteBookRecord(book.id);
      }
      const nextBooks = await fetchBooks();
      applyBooksUpdate(nextBooks);
      if (editingBookId != null && targets.some((b) => b.id === editingBookId)) {
        resetDraft();
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function toggleBookRead(id: number, read: boolean) {
    setErrorMessage(null);
    try {
      const book = books.find((b) => b.id === id);
      if (!book) return;
      const nextBooks = await updateBookRecord(id, {
        ...book,
        read,
        ...(read
          ? {
              archivedAtYear: undefined,
              lastReadYear: currentYear,
            }
          : {}),
      });
      revealSavedBook(nextBooks.find((nextBook) => nextBook.id === id) ?? null);
      applyBooksUpdate(nextBooks);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function setReadCount(bookId: number, value: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;

    try {
      const nextValue = Math.max(0, Math.floor(value));
      const nextLastReadYear =
        nextValue > 0
          ? effectiveLastReadYear(book) ?? currentYear
          : undefined;
      const {
        archivedAtYear: _archivedAtYear,
        lastReadYear: _lastReadYear,
        progress: _progress,
        ...baseBook
      } = book;
      const updated = await updateBookRecord(bookId, {
        ...baseBook,
        ...(nextValue > 0 ? { progress: 100 } : {}),
        readCount: nextValue,
        ...(nextLastReadYear != null ? { lastReadYear: nextLastReadYear } : {}),
      });
      revealSavedBook(updated.find((nextBook) => nextBook.id === bookId) ?? null);
      applyBooksUpdate(updated);
    } catch {
      // silently ignore
    }
  }

  async function incrementReadCount(bookId: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;

    await setReadCount(bookId, (book.readCount ?? 0) + 1);
  }

  async function decrementReadCount(bookId: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;

    await setReadCount(bookId, (book.readCount ?? 0) - 1);
  }

  // Auto-build reading list when at least one node is selected
  useEffect(() => {
    if (selectedInterestPath.length < 1) {
      setRecommendations(null);
      setRecError(null);
      setIsLoadingRecs(false);
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    const debounce = setTimeout(async () => {
      setIsLoadingRecs(true);
      setRecError(null);
      controller = new AbortController();

      try {
        const result = await fetchPathRecommendations(
          {
          selectedTags: selectedInterestPath,
          profile: {
            books: predictiveBooks,
            genreInterests,
            authorExperiences,
            seriesExperiences,
          },
          },
          controller.signal,
        );
        if (!cancelled) setRecommendations(result);
      } catch (error) {
        if (
          cancelled ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }

        if (!cancelled) {
          setRecError(
            error instanceof Error ? error.message : "Failed to get recommendations.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingRecs(false);
      }
    }, 400); // debounce to avoid hammering API on rapid clicks

    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(debounce);
    };
  }, [
    selectedInterestPath,
    predictiveBooks,
    genreInterests,
    authorExperiences,
    seriesExperiences,
  ]);





  async function updateMyRating(bookId: number, rating: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    const newRating = book.myRating === rating ? undefined : rating;
    try {
      const updated = await updateBookRecord(bookId, {
        ...book,
        myRating: newRating,
      });
      revealSavedBook(updated.find((nextBook) => nextBook.id === bookId) ?? null);
      applyBooksUpdate(updated);
    } catch {
      // silently ignore
    }
  }

  async function updateProgress(bookId: number, value: number | undefined) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    try {
      const nextProgress =
        value != null ? Math.max(0, Math.min(100, value)) : undefined;
      const nextReadCount =
        nextProgress != null && nextProgress >= 100
          ? Math.max(1, book.readCount ?? 0)
          : 0;
      const nextLastReadYear =
        nextProgress != null && nextProgress >= 100
          ? effectiveLastReadYear(book) ?? currentYear
          : undefined;
      const {
        lastReadYear: _lastReadYear,
        readCount: _readCount,
        progress: _progress,
        ...baseBook
      } = book;
      const updated = await updateBookRecord(bookId, {
        ...baseBook,
        ...(nextProgress != null ? { progress: nextProgress } : {}),
        readCount: nextReadCount,
        ...(nextLastReadYear != null ? { lastReadYear: nextLastReadYear } : {}),
      });
      revealSavedBook(updated.find((nextBook) => nextBook.id === bookId) ?? null);
      applyBooksUpdate(updated);
    } catch {
      // silently ignore
    }
  }

  const showAuthorSuggestions =
    activeSuggestionField === "author" &&
    draft.authorInput.trim().length > 0 &&
    authorSuggestions.length > 0;
  const showGenreSuggestions =
    activeSuggestionField === "genre" &&
    draft.genreInput.trim().length > 0 &&
    genreSuggestions.length > 0;
  const showGraphGenreSuggestions =
    isGraphGenreSuggestionActive &&
    graphAddGenreInput.trim().length > 0 &&
    graphGenreSuggestions.length > 0;

  function showAuthView(nextView: AuthView) {
    setAuthMode(nextView);
    setAuthFeedback(null);
    setErrorMessage(null);
    setAuthPassword("");
    setAuthConfirmPassword("");
  }

  if (authEnabled && authStatus !== "signed-in") {
    const authTitle =
      authStatus === "checking"
        ? "Checking your session"
        : authMode === "sign-up"
          ? "Create your account"
          : authMode === "reset"
            ? "Reset your password"
            : "Sign in";
    const authCopy =
      authStatus === "checking"
        ? "Loading your account."
        : authMode === "sign-up"
          ? "Use your email address to create an account for your saved lists."
          : authMode === "reset"
            ? "Enter your email address and we’ll send a reset link."
            : "Sign in with your email address to access your saved lists.";

    return (
      <main className="auth-shell">
        <section className="auth-card" aria-busy={authStatus === "checking" || isAuthBusy}>
          <p className="auth-eyebrow">Book Ranker</p>
          <h1>{authTitle}</h1>
          <p className="auth-copy">{authCopy}</p>
          {authStatus === "checking" ? (
            <p className="auth-status">Loading...</p>
          ) : (
            <>
              <form
                className="auth-form"
                onSubmit={(event) => {
                  void handleAuthSubmit(event);
                }}
              >
                <label className="auth-field">
                  <span>Email</span>
                  <input
                    className="auth-input"
                    type="email"
                    autoComplete="email"
                    value={authEmail}
                    onChange={(event) => {
                      setAuthEmail(event.target.value);
                    }}
                    placeholder="you@example.com"
                    disabled={isAuthBusy}
                  />
                </label>
                {authMode === "sign-up" ? (
                  <label className="auth-field">
                    <span>Username</span>
                    <input
                      className="auth-input"
                      type="text"
                      autoComplete="nickname"
                      value={authUsernameInput}
                      onChange={(event) => {
                        setAuthUsernameInput(event.target.value);
                      }}
                      placeholder="How your name should appear"
                      disabled={isAuthBusy}
                    />
                  </label>
                ) : null}
                {authMode !== "reset" ? (
                  <label className="auth-field">
                    <span>Password</span>
                    <input
                      className="auth-input"
                      type="password"
                      autoComplete={authMode === "sign-up" ? "new-password" : "current-password"}
                      value={authPassword}
                      onChange={(event) => {
                        setAuthPassword(event.target.value);
                      }}
                      placeholder="Password"
                      disabled={isAuthBusy}
                    />
                  </label>
                ) : null}
                {authMode === "sign-up" ? (
                  <label className="auth-field">
                    <span>Confirm password</span>
                    <input
                      className="auth-input"
                      type="password"
                      autoComplete="new-password"
                      value={authConfirmPassword}
                      onChange={(event) => {
                        setAuthConfirmPassword(event.target.value);
                      }}
                      placeholder="Confirm password"
                      disabled={isAuthBusy}
                    />
                  </label>
                ) : null}
                {authFeedback ? <p className="auth-feedback">{authFeedback}</p> : null}
                {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
                <button
                  type="submit"
                  className="auth-submit"
                  disabled={isAuthBusy}
                >
                  {isAuthBusy
                    ? "Working..."
                    : authMode === "sign-up"
                      ? "Create account"
                      : authMode === "reset"
                        ? "Send reset email"
                        : "Sign in"}
                </button>
              </form>
              <div className="auth-actions">
                {authMode === "sign-in" ? (
                  <>
                    <button
                      type="button"
                      className="auth-link"
                      onClick={() => {
                        showAuthView("sign-up");
                      }}
                      disabled={isAuthBusy}
                    >
                      Create an account
                    </button>
                    <button
                      type="button"
                      className="auth-link"
                      onClick={() => {
                        showAuthView("reset");
                      }}
                      disabled={isAuthBusy}
                    >
                      Forgot password?
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => {
                      showAuthView("sign-in");
                    }}
                    disabled={isAuthBusy}
                  >
                    Back to sign in
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="app-layout">
        {/* ── Left column: reading list ── */}
        <aside ref={leftColumnRef} className="left-column">
          {!showArchive ? (
            <BookListSection
              title="Reading list"
              totalCount={rankedBooks.length}
              books={visibleRankedBooks}
              authorCredentials={authorCredentials}
              isLoading={isLoading}
              emptyMessage="No books yet. Add your first book to get started."
              emptyFilteredMessage="No books in your reading list match the selected nodes."
              pendingDeleteId={pendingDeleteId}
              editingBookId={editingBookId}
              highlightedBookId={highlightedBookId}
              isSaving={isSaving}
              canSubmit={canSubmit}
              onToggleCardEditing={toggleCardEditing}
              onToggleEditing={toggleEditing}
              onProgressChange={(bookId, progress) => {
                void updateProgress(bookId, progress);
              }}
              onIncrementReadCount={(bookId) => {
                void incrementReadCount(bookId);
              }}
              onDecrementReadCount={(bookId) => {
                void decrementReadCount(bookId);
              }}
              onRatingChange={(bookId, level) => {
                void updateMyRating(bookId, level);
              }}
              onRemove={(bookId) => {
                void removeBook(bookId);
              }}
              onToggleRead={(bookId, read) => {
                void toggleBookRead(bookId, read);
              }}
            />
          ) : (
            <BookListSection
              title="Books to revisit"
              totalCount={readBooks.length}
              books={visibleReadBooks}
              authorCredentials={authorCredentials}
              emptyMessage="No read books yet."
              emptyFilteredMessage="No rereads match the selected nodes."
              readMode
              pendingDeleteId={pendingDeleteId}
              editingBookId={editingBookId}
              highlightedBookId={highlightedBookId}
              isSaving={isSaving}
              canSubmit={canSubmit}
              onToggleCardEditing={toggleCardEditing}
              onToggleEditing={toggleEditing}
              onProgressChange={(bookId, progress) => {
                void updateProgress(bookId, progress);
              }}
              onIncrementReadCount={(bookId) => {
                void incrementReadCount(bookId);
              }}
              onDecrementReadCount={(bookId) => {
                void decrementReadCount(bookId);
              }}
              onRatingChange={(bookId, level) => {
                void updateMyRating(bookId, level);
              }}
              onRemove={(bookId) => {
                void removeBook(bookId);
              }}
              onToggleRead={(bookId, read) => {
                void toggleBookRead(bookId, read);
              }}
            />
          )}
	          <div className="column-footer">
	            <div ref={profileMenuRef} className="profile-info">
	              <div className="profile-menu-shell">
	                <button
	                  type="button"
	                  className="profile-trigger"
	                  onClick={() => {
	                    setIsProfileMenuOpen((current) => !current);
	                  }}
	                  disabled={profileControlDisabled}
	                  aria-haspopup="menu"
	                  aria-expanded={isProfileMenuOpen}
	                  aria-label="Open profile options"
	                  title="Profile options"
	                >
	                  <div className="profile-avatar">
	                    {profileInitials(displayedProfileName)}
	                  </div>
	                  <div className="profile-text">
	                    <span className="profile-name">{displayedProfileName}</span>
	                  </div>
	                </button>
	                {isProfileMenuOpen ? (
	                  <div className="profile-menu" role="menu" aria-label="Profile options">
	                    <div className="profile-menu-account">
	                      <span className="profile-menu-username">{displayedProfileName}</span>
	                      {accountEmail ? (
	                        <span className="profile-menu-email">{accountEmail}</span>
	                      ) : null}
	                    </div>
	                    <button
	                      type="button"
	                      className="profile-menu-link"
	                      onClick={openUsernameEditor}
	                      disabled={profileControlDisabled}
	                      role="menuitem"
	                    >
	                      Change username
	                    </button>
	                    {authEnabled ? (
	                      <button
	                        type="button"
	                        className="profile-menu-link is-danger"
	                        onClick={() => {
	                          void handleLogout();
	                        }}
	                        disabled={profileControlDisabled}
	                        role="menuitem"
	                      >
	                        Log out
	                      </button>
	                    ) : null}
	                  </div>
	                ) : null}
	              </div>
	            </div>
	            <div className="footer-actions">
            <button
              type="button"
              className="archive-toggle icon-btn-danger"
              onClick={() => {
                const count = showArchive ? visibleReadBooks.length : visibleRankedBooks.length;
                const scope = hasSelectedNodeFilter ? "displayed " : "";
                if (count > 0 && window.confirm(`Delete all ${count} ${scope}${showArchive ? "archived" : "ranked"} books?`)) {
                  void clearDisplayedList();
                }
              }}
              title={
                hasSelectedNodeFilter
                  ? showArchive
                    ? "Delete all displayed archived books"
                    : "Delete all displayed ranked books"
                  : showArchive
                    ? "Delete all archived books"
                    : "Delete all ranked books"
              }
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M5 2V1h6v1h4v2H1V2h4zm1 4h1v7H6V6zm3 0h1v7H9V6zM2 5h12l-1 10H3L2 5z"/></svg>
            </button>
            <button
              type="button"
              className="archive-toggle"
              onClick={() => setShowArchive((prev) => !prev)}
              title={showArchive ? "Back to list" : "Archive"}
            >
              {showArchive
                ? <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M10 2L4 8l6 6V2z"/></svg>
                : <ArchiveShelfIcon className="archive-icon" />}
            </button>
            </div>
          </div>
        </aside>

        {/* ── Center column: interest map graph ── */}
        <section className="center-column">
          <div className="graph-edit-toolbar">
            <div className="tag-entry-group graph-tag-entry">
              <div className="tag-entry-row">
                <div
                  className="suggestion-field"
                  onFocus={() => setIsGraphGenreSuggestionActive(true)}
                  onBlur={handleGraphGenreSuggestionBlur}
                >
                  <input
                    type="text"
                    placeholder="Find what interests you"
                    value={graphAddGenreInput}
                    autoComplete="off"
                    aria-expanded={showGraphGenreSuggestions}
                    aria-controls="graph-genre-suggestions"
                    onChange={(e) => {
                      setGraphAddGenreInput(e.target.value);
                      setIsGraphGenreSuggestionActive(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") {
                        return;
                      }

                      const matchedGenre = resolvedSuggestion(
                        graphAddGenreInput,
                        [],
                        visibleGraphGenres,
                      );

                      if (matchedGenre) {
                        e.preventDefault();
                        focusGraphGenre(matchedGenre);
                        return;
                      }

                      if (graphAddGenreInput.trim()) {
                        void addGraphGenreInterest();
                      }
                    }}
                  />
                  {showGraphGenreSuggestions ? (
                    <div
                      id="graph-genre-suggestions"
                      className="suggestion-popover"
                      aria-label="Suggested graph genres"
                    >
                      {graphGenreSuggestions.map((genre) => (
                        <div key={genre} className="suggestion-option">
                          <button
                            type="button"
                            className="suggestion-pick"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => focusGraphGenre(genre)}
                          >
                            <span className="suggestion-copy">{genre}</span>
                            {genreInterests[genre] != null ? (
                              <span className="genre-tag-interest">
                                {genreInterests[genre]}
                              </span>
                            ) : null}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="graph-add-btn"
                  disabled={!graphAddGenreInput.trim()}
                  onClick={() => {
                    if (graphAddGenreInput.trim()) {
                      void addGraphGenreInterest();
                    }
                  }}
                  aria-label="Add genre"
                >
                  +
                </button>
              </div>
              <RatingButtons
                value={graphAddGenreRating}
                onChange={setGraphAddGenreRating}
              />
            </div>
          </div>
          <Suspense
            fallback={
              <div className="interest-map">
                <p className="interest-map-empty">Loading interest map…</p>
              </div>
            }
          >
            <InterestMap
              books={books}
              interests={genreInterests}
              selectedPath={selectedInterestPath}
              onSelectTag={toggleInterestPathTag}
              onClearSelection={() => setSelectedInterestPath([])}
              onEditingNodeChange={setGraphEditingNode}
            />
          </Suspense>
        </section>
          {graphEditingNode ? createPortal(
            <div
              className="node-edit-popover"
              style={{ left: graphEditingNode.screenX, top: graphEditingNode.screenY }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                className="node-edit-label"
                defaultValue={graphEditingNode.tag}
                onBlur={(e) => {
                  const newName = e.currentTarget.value.trim();
                  const oldName = graphEditingNode.tag;
                  if (newName && newName !== oldName) {
                    void renameGraphGenre(oldName, newName);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <RatingButtons
                value={genreInterests[graphEditingNode.tag] ?? null}
                onChange={(level) => {
                  void updateGraphGenreInterest(graphEditingNode.tag, level);
                }}
              />
              <button
                type="button"
                className="node-edit-delete"
                onClick={() => {
                  void removeGlobalTag("genre", graphEditingNode.tag);
                  setGraphEditingNode(null);
                }}
              >
                Remove
              </button>
            </div>,
            document.body,
          ) : null}

        {/* ── Right column: reading list builder + add book ── */}
        <aside ref={rightColumnRef} className="right-column">
          {isLoadingRecs ? (
            <div
              className="right-column-loader"
              aria-label="Building reading list"
              title="Building reading list"
            >
              <span className="right-column-loader-spinner" aria-hidden="true" />
            </div>
          ) : null}
          {recError ? (
            <p className="panel-error">{recError}</p>
          ) : null}
          {recommendations && recommendations.candidates.length > 0 ? (
            <>
              <div className="right-column-head">
                <select
                  className="list-size-select"
                  value={listSize}
                  onChange={(e) => setListSize(Number(e.target.value))}
                >
                  {[3, 5, 10, 15, 20].map((n) => (
                    <option key={n} value={n}>
                      Top {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="right-column-list">
                {recommendations.candidates.slice(0, listSize).map((rec, i) => (
                  <BookCard
                    key={rec.id}
                    rank={i + 1}
                    title={rec.title}
                    series={rec.series}
                    seriesNumber={rec.seriesNumber}
                    authors={rec.authors}
                    authorCredentials={authorCredentials}
                    score={rec.score}
                    className={[
                      addedRecIds.has(rec.id) ? "is-added" : "",
                      selectedRecommendationId === rec.id ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    scoreOverride={addedRecIds.has(rec.id) ? "✓" : undefined}
                    subMeta={
                      <span
                        className={`recommendation-source${rec.provider.includes("openlibrary") ? " is-openlibrary" : ""}`}
                      >
                        {recommendationSourceLabel(rec.provider)}
                      </span>
                    }
                    onToggle={() => selectRecommendedBook(rec)}
                    isActive={selectedRecommendationId === rec.id}
                  />
                ))}
              </div>
            </>
          ) : recommendations && recommendations.candidates.length === 0 ? (
            <div className="right-column-status">
              <p>No matching books found for these interests.</p>
            </div>
          ) : null}
          <section className="panel control-panel">

          {isLoading || errorMessage ? (
            <div className="panel-status-row">
              {isLoading ? (
                <p className="panel-status">Loading your saved library...</p>
              ) : null}
              {errorMessage ? (
                <p className="panel-error">{errorMessage}</p>
              ) : null}
            </div>
          ) : null}

          <form ref={entryFormRef} className="entry-form" onSubmit={submitBook}>
            <label className="field entry-title">
              <span>Title</span>
              <div className="tag-entry-group">
                <div className="tag-entry-row">
                  <div
                    className="suggestion-field"
                    onFocus={() => setIsTitleSuggestionActive(true)}
                    onBlur={handleTitleSuggestionBlur}
                  >
                    <input
                      type="text"
                      placeholder="The Path to Power"
                      value={draft.title}
                      autoComplete="off"
                      aria-expanded={showTitleSuggestions}
                      aria-controls="title-suggestions"
                      onChange={(event) =>
                        updateDraft("title", event.target.value)
                      }
                    />
                    {showTitleSuggestions ? (
                      <div
                        id="title-suggestions"
                        className="suggestion-popover"
                        aria-label="Suggested books"
                      >
                        {titleSuggestions.map((result) => (
                          <div
                            key={result.id}
                            className="suggestion-option title-suggestion-option"
                          >
                            <button
                              type="button"
                              className="suggestion-pick title-suggestion-pick"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => selectCatalogSuggestion(result)}
                            >
                              <span className="title-suggestion-copy">
                                <span className="suggestion-copy">
                                  {result.title}
                                </span>
                                <span className="title-suggestion-meta">
                                  {result.authors.length > 0
                                    ? result.authors.join(", ")
                                    : "Unknown author"}
                                </span>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {isTitleSuggestionActive && isSearchingCatalog ? (
                  <p className="field-note">Searching…</p>
                ) : null}
                {isTitleSuggestionActive && catalogError ? (
                  <p className="field-note is-error">{catalogError}</p>
                ) : null}
              </div>
            </label>

            <label className="field entry-series">
              <span>Series + my experience with it</span>
              <div className="tag-editor">
                <div className="tag-entry-group">
                  <div className="tag-entry-row">
                    <input
                      type="text"
                      placeholder="The Years of Lyndon Johnson"
                      value={draft.series}
                      onChange={(event) =>
                        updateDraft("series", event.target.value)
                      }
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      className="series-number-input"
                      placeholder="#"
                      aria-label="Series number"
                      value={draft.seriesNumber}
                      disabled={!draft.series.trim()}
                      onChange={(event) =>
                        updateDraft("seriesNumber", event.target.value)
                      }
                    />
                  </div>
                  <RatingButtons
                    value={
                      draft.seriesExperience
                        ? Number(draft.seriesExperience)
                        : null
                    }
                    onChange={(level) =>
                      updateDraft("seriesExperience", level ? String(level) : "")
                    }
                  />
                </div>
              </div>
            </label>

            <div className="field entry-author">
              <span>Author(s) + my experience with them</span>
              <div className="tag-editor">
                <div className="tag-entry-group">
                  <div className="tag-entry-row">
                    <div
                      className="suggestion-field"
                      onFocus={() => setActiveSuggestionField("author")}
                      onBlur={(event) =>
                        handleSuggestionFieldBlur(event, "author")
                      }
                    >
                      <input
                        type="text"
                        placeholder="Robert A. Caro"
                        value={draft.authorInput}
                        autoComplete="off"
                        aria-expanded={showAuthorSuggestions}
                        aria-controls="author-suggestions"
                        onChange={(event) =>
                          updateDraft("authorInput", event.target.value)
                        }
                        onKeyDown={(event) =>
                          handleTagInputKeyDown(event, "author")
                        }
                      />
                      {showAuthorSuggestions ? (
                        <div
                          id="author-suggestions"
                          className="suggestion-popover"
                          aria-label="Suggested authors"
                        >
                          {authorSuggestions.map((author) => {
                            const deleteKey = `author:${author}`;
                            const isDeletingTag =
                              pendingTagDelete === deleteKey;

                            return (
                              <div key={author} className="suggestion-option">
                                <button
                                  type="button"
                                  className="suggestion-pick"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() =>
                                    selectSuggestedValue("author", author)
                                  }
                                >
                                  <span className="suggestion-copy">
                                    {author}
                                  </span>
                                  {authorExperiences[author] != null ? (
                                    <span className="genre-tag-interest">
                                      {authorExperiences[author]}
                                    </span>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  className="tag-remove suggestion-remove"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() =>
                                    void removeGlobalTag("author", author)
                                  }
                                  aria-label={`Remove author tag ${author}`}
                                  title={`Remove author tag ${author}`}
                                  disabled={isDeletingTag}
                                >
                                  {isDeletingTag ? "…" : "x"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="graph-add-btn"
                      onClick={() => addDraftTag("author")}
                      disabled={!draft.authorInput.trim()}
                      aria-label="Add author tag"
                    >
                      +
                    </button>
                  </div>
                  <RatingButtons
                    value={
                      draft.authorExperience
                        ? Number(draft.authorExperience)
                        : null
                    }
                    onChange={(level) =>
                      updateDraft("authorExperience", level ? String(level) : "")
                    }
                  />
                </div>
                {draft.authors.length > 0 ? (
                  <div
                    className={[
                      "draft-tag-list",
                      draftTagDrag?.field === "author" ? "is-drag-active" : "",
                      draftTagDropTarget?.field === "author" &&
                      draftTagDropTarget.tag === null
                        ? "is-drop-target-end"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onDragOver={(event) =>
                      handleDraftTagListDragOver(event, "author")
                    }
                    onDrop={(event) => handleDraftTagDrop(event, "author")}
                  >
                    {draft.authors.map((author) => {
                      const score = getDraftTagScore("author", author);
                      const isDragging =
                        draftTagDrag?.field === "author" &&
                        draftTagDrag.tag === author;
                      const isDropTarget =
                        draftTagDropTarget?.field === "author" &&
                        draftTagDropTarget.tag === author;

                      return (
                        <span
                          key={author}
                          className={[
                            "genre-tag",
                            "draft-tag-chip",
                            isDragging ? "is-dragging" : "",
                            isDropTarget ? "is-drag-target" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          draggable
                          onDragStart={(event) =>
                            handleDraftTagDragStart(event, "author", author)
                          }
                          onDragOver={(event) =>
                            handleDraftTagDragOver(event, "author", author)
                          }
                          onDrop={(event) =>
                            handleDraftTagDrop(event, "author", author)
                          }
                          onDragEnd={handleDraftTagDragEnd}
                          onClick={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                ".tag-action-shell",
                              )
                            ) {
                              return;
                            }

                            startEditingDraftTag("author", author);
                          }}
                          aria-grabbed={isDragging}
                          title={`Click to edit ${author}, or drag to reorder`}
                        >
                          <span className="genre-tag-name">{author}</span>
                          {score ? (
                            <span className="genre-tag-interest">{score}</span>
                          ) : null}
                          <button
                            type="button"
                            className="tag-remove"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeDraftTag("author", author);
                            }}
                            aria-label={`Remove author ${author}`}
                            title={`Remove ${author}`}
                          >
                            x
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            {draft.authors.length > 0 ? (
              <div className="field entry-credentials">
                <span>Author credentials</span>
                {draft.authors.map((author) => {
                  const creds = authorCredentials[author] ?? [];
                  return (
                    <div key={author} className="tag-editor">
                      <span className="credentials-author-label">{author}</span>
                      <div className="tag-entry-group">
                        <div className="tag-entry-row">
                          <input
                            type="text"
                            placeholder="e.g. Oncologist"
                            value={
                              credentialAuthor === author
                                ? credentialInput
                                : ""
                            }
                            onChange={(e) => {
                              setCredentialAuthor(author);
                              setCredentialInput(e.target.value);
                            }}
                            onFocus={() => {
                              if (credentialAuthor !== author) {
                                setCredentialAuthor(author);
                                setCredentialInput("");
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const trimmed = credentialInput.trim();
                                if (trimmed) {
                                  void handleAddCredential(author, trimmed);
                                }
                                setCredentialInput("");
                              } else if (e.key === "Escape") {
                                setCredentialInput("");
                                setCredentialAuthor(null);
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="graph-add-btn"
                            disabled={
                              credentialAuthor !== author ||
                              !credentialInput.trim()
                            }
                            onClick={() => {
                              const trimmed = credentialInput.trim();
                              if (trimmed) {
                                void handleAddCredential(author, trimmed);
                              }
                              setCredentialInput("");
                            }}
                            aria-label={`Add credential for ${author}`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      {creds.length > 0 ? (
                        <div className="draft-tag-list">
                          {creds.map((cred) => (
                            <span key={cred} className="genre-tag draft-tag-chip">
                              <span className="genre-tag-name">{cred}</span>
                              <button
                                type="button"
                                className="tag-remove"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() =>
                                  void handleRemoveCredential(author, cred)
                                }
                                aria-label={`Remove ${cred}`}
                                title={`Remove ${cred}`}
                              >
                                x
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="field entry-genre">
              <span>Genre(s) / topic(s) + my current interest in them</span>
              <div className="tag-editor">
                <div className="tag-entry-group">
                  <div className="tag-entry-row">
                    <div
                      className="suggestion-field"
                      onFocus={() => setActiveSuggestionField("genre")}
                      onBlur={(event) =>
                        handleSuggestionFieldBlur(event, "genre")
                      }
                    >
                      <input
                        type="text"
                        placeholder="Biography"
                        value={draft.genreInput}
                        autoComplete="off"
                        aria-expanded={showGenreSuggestions}
                        aria-controls="genre-suggestions"
                        onChange={(event) =>
                          updateDraft("genreInput", event.target.value)
                        }
                        onKeyDown={(event) =>
                          handleTagInputKeyDown(event, "genre")
                        }
                      />
                      {showGenreSuggestions ? (
                        <div
                          id="genre-suggestions"
                          className="suggestion-popover"
                          aria-label="Suggested genres"
                        >
                          {genreSuggestions.map((genre) => {
                            const deleteKey = `genre:${genre}`;
                            const isDeletingTag =
                              pendingTagDelete === deleteKey;

                            return (
                              <div key={genre} className="suggestion-option">
                                <button
                                  type="button"
                                  className="suggestion-pick"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() =>
                                    selectSuggestedValue("genre", genre)
                                  }
                                >
                                  <span className="suggestion-copy">
                                    {genre}
                                  </span>
                                  {genreInterests[genre] != null ? (
                                    <span className="genre-tag-interest">
                                      {genreInterests[genre]}
                                    </span>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  className="tag-remove suggestion-remove"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() =>
                                    void removeGlobalTag("genre", genre)
                                  }
                                  aria-label={`Remove genre tag ${genre}`}
                                  title={`Remove genre tag ${genre}`}
                                  disabled={isDeletingTag}
                                >
                                  {isDeletingTag ? "…" : "x"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="graph-add-btn"
                      onClick={() => addDraftTag("genre")}
                      disabled={!draft.genreInput.trim()}
                      aria-label="Add genre tag"
                    >
                      +
                    </button>
                  </div>
                  <RatingButtons
                    value={
                      draft.genreInterest
                        ? Number(draft.genreInterest)
                        : null
                    }
                    onChange={(level) =>
                      updateDraft("genreInterest", level ? String(level) : "")
                    }
                  />
                </div>
                {draft.genres.length > 0 ? (
                  <div
                    className={[
                      "draft-tag-list",
                      draftTagDrag?.field === "genre" ? "is-drag-active" : "",
                      draftTagDropTarget?.field === "genre" &&
                      draftTagDropTarget.tag === null
                        ? "is-drop-target-end"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onDragOver={(event) =>
                      handleDraftTagListDragOver(event, "genre")
                    }
                    onDrop={(event) => handleDraftTagDrop(event, "genre")}
                  >
                    {draft.genres.map((genre) => {
                      const score = getDraftTagScore("genre", genre);
                      const isDragging =
                        draftTagDrag?.field === "genre" &&
                        draftTagDrag.tag === genre;
                      const isDropTarget =
                        draftTagDropTarget?.field === "genre" &&
                        draftTagDropTarget.tag === genre;

                      return (
                        <span
                          key={genre}
                          className={[
                            "genre-tag",
                            "draft-tag-chip",
                            isDragging ? "is-dragging" : "",
                            isDropTarget ? "is-drag-target" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          draggable
                          onDragStart={(event) =>
                            handleDraftTagDragStart(event, "genre", genre)
                          }
                          onDragOver={(event) =>
                            handleDraftTagDragOver(event, "genre", genre)
                          }
                          onDrop={(event) =>
                            handleDraftTagDrop(event, "genre", genre)
                          }
                          onDragEnd={handleDraftTagDragEnd}
                          onClick={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                ".tag-action-shell",
                              )
                            ) {
                              return;
                            }

                            startEditingDraftTag("genre", genre);
                          }}
                          aria-grabbed={isDragging}
                          title={`Click to edit ${genre}, or drag to reorder`}
                        >
                          <span className="genre-tag-name">{genre}</span>
                          {score ? (
                            <span className="genre-tag-interest">{score}</span>
                          ) : null}
                          <button
                            type="button"
                            className="tag-remove"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeDraftTag("genre", genre);
                            }}
                            aria-label={`Remove genre ${genre}`}
                            title={`Remove ${genre}`}
                          >
                            x
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>


            <div className="field entry-progress">
              <span>Reading progress</span>
              <ProgressBar
                value={Number(draft.progress) || 0}
                onChange={(pct) =>
                  updateDraft("progress", pct === 0 ? "" : String(pct))
                }
              />
            </div>

            <div className="field entry-read-count">
              <span>Times read before</span>
              <ReadCountStepper
                value={draft.readCount}
                onIncrement={() => setDraftReadCount(draft.readCount + 1)}
                onDecrement={() => setDraftReadCount(draft.readCount - 1)}
              />
            </div>

            <label className="field entry-last-read-year">
              <span>Year last read</span>
              <select
                value={draft.lastReadYear}
                onChange={(event) => setDraftLastReadYear(event.target.value)}
              >
                <option value="">-</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <div className="field entry-my-rating">
              <span>My rating</span>
              <StarRating
                value={draft.myRating}
                onChange={(level) =>
                  setDraft((prev) => ({
                    ...prev,
                    myRating: prev.myRating === level ? null : level,
                  }))
                }
              />
            </div>

            {hasAutomatedDraftStats ? (
              <div className="entry-automated-stats">
                {draft.starRating.trim() ? (
                  <span className="entry-automated-stat">
                    <strong>{draft.starRating}</strong>
                    <span>average rating</span>
                  </span>
                ) : null}
                {draft.ratingCount.trim() ? (
                  <span className="entry-automated-stat">
                    <strong>{formatDisplayedDraftCount(draft.ratingCount)}</strong>
                    <span>ratings</span>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-tertiary"
                onClick={resetDraft}
                disabled={isSaving}
              >
                {isEditing ? "Cancel" : "Clear"}
              </button>
              <button
                type="button"
                className="btn btn-tertiary"
                disabled={!canSubmit || isSaving}
                onClick={() => {
                  setDraft((prev) => ({ ...prev, markAsRead: true }));
                  setTimeout(() => {
                    const form = document.querySelector(".entry-form") as HTMLFormElement | null;
                    if (form) form.requestSubmit();
                  }, 0);
                }}
                aria-label="Add to archive as read"
                title="Add to archive as read"
              >
                <ArchiveShelfIcon className="archive-icon" />
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canSubmit}
              >
                {isSaving ? "Saving..." : isEditing ? "Save" : "Add"}
              </button>
            </div>
          </form>
	        </section>
	        </aside>
	      </div>
	      {isUsernameModalOpen ? (
	        <div className="account-setup-overlay" role="dialog" aria-modal="true">
	          <div className="account-setup-card">
	            <p className="account-setup-eyebrow">Account setup</p>
	            <h2>{needsUsernameSetup ? "Choose a username" : "Change username"}</h2>
	            <p className="account-setup-copy">
	              {needsUsernameSetup
	                ? "This will appear above your email address in the account menu."
	                : "Your username appears above your email address in the account menu."}
	            </p>
	            <form
	              className="account-setup-form"
	              onSubmit={(event) => {
	                void handleUsernameSetupSubmit(event);
	              }}
	            >
	              <label className="auth-field">
	                <span>Username</span>
	                <input
	                  className="auth-input"
	                  type="text"
	                  autoComplete="nickname"
	                  value={authUsernameInput}
	                  onChange={(event) => {
	                    setAuthUsernameInput(event.target.value);
	                  }}
	                  placeholder="How your name should appear"
	                  disabled={isUpdatingUsername}
	                />
	              </label>
	              {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
	              <button
	                type="submit"
	                className="auth-submit"
	                disabled={isUpdatingUsername}
	              >
	                {isUpdatingUsername ? "Saving..." : "Save username"}
	              </button>
	              {!needsUsernameSetup ? (
	                <div className="account-setup-actions">
	                  <button
	                    type="button"
	                    className="auth-link"
	                    onClick={() => {
	                      setIsUsernameEditorOpen(false);
	                      setErrorMessage(null);
	                    }}
	                    disabled={isUpdatingUsername}
	                  >
	                    Cancel
	                  </button>
	                </div>
	              ) : null}
	            </form>
	          </div>
	        </div>
	      ) : null}
	    </main>
	  );
	}
