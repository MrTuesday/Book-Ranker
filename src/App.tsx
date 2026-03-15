import {
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createBookRecord,
  deleteAuthorExperience,
  deleteBookRecord,
  deleteGenreInterest,
  fetchBooks,
  type Book,
  type GenreInterestMap,
  type AuthorExperienceMap,
  readGenreInterests,
  readAuthorExperiences,
  updateBookRecord,
  writeGenreInterest,
  writeAuthorExperience,
  renameGenreInBooks,
  renameAuthorInBooks,
} from "./lib/books-api";

type BookDraft = {
  title: string;
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
};

type RankedBook = Book & {
  score: number;
  rank: number;
};

type SuggestionField = "author" | "genre";
type DraftTagDrag = {
  field: SuggestionField;
  tag: string;
};
type BookTagDrag = {
  bookId: number;
  field: SuggestionField;
  tag: string;
};
type TagActionScope = "draft" | "book";
type DraftTextField =
  | "title"
  | "starRating"
  | "ratingCount"
  | "authorInput"
  | "authorExperience"
  | "genreInput"
  | "genreInterest";

const GLOBAL_MEAN = 3.8;
const SMOOTHING_FACTOR = 500;
const MAX_SUGGESTIONS = 6;

function createDraft(): BookDraft {
  return {
    title: "",
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
  };
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

function averageTagPreference(tags: string[], scores: Record<string, number>) {
  if (tags.length === 0) {
    return 3;
  }

  return (
    tags.reduce((total, tag) => total + (scores[tag] ?? 3), 0) / tags.length
  );
}

function tagPreferences(tags: string[], scores: Record<string, number>) {
  if (tags.length === 0) {
    return [3];
  }

  return tags.map((tag) => scores[tag] ?? 3);
}

function buildDraftScores(tags: string[], scores: Record<string, number>) {
  return Object.fromEntries(
    tags.flatMap((tag) =>
      scores[tag] != null ? [[tag, String(scores[tag])]] : [],
    ),
  );
}

function removeTagFromScores(scores: Record<string, string>, tag: string) {
  const nextScores = { ...scores };
  delete nextScores[tag];
  return nextScores;
}

function tagActionMenuId(
  scope: TagActionScope,
  field: SuggestionField,
  tag: string,
  bookId?: number,
) {
  return scope === "draft"
    ? `draft:${field}:${tag}`
    : `book:${bookId}:${field}:${tag}`;
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

function formatTagSummary(tags: string[], fallback: string) {
  return tags.length > 0 ? tags.join(", ") : fallback;
}

function bayesianScore(R: number, v: number, C: number, m: number) {
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

function compositeScore(bayesian: number, ...inputs: number[]) {
  const values = [bayesian, ...inputs];
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatScore(value: number, places = 2) {
  return value.toFixed(places);
}

function formatMainResult(value: number) {
  return `${Math.round(Math.max(0, Math.min(100, (value / 5) * 100)))}%`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(Number(value.toPrecision(2)));
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function messageFromError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong while saving your books in this browser.";
}

function ScoreDistribution({ scores }: { scores: number[] }) {
  if (scores.length === 0) return null;

  const percentages = scores.map((score) => clampPercentage((score / 5) * 100));
  const dataMin = Math.min(...percentages);
  const dataMax = Math.max(...percentages);
  const lo = Math.max(0, Math.floor(dataMin));
  const hi = Math.min(100, Math.ceil(dataMax));
  const range = hi - lo || 1;

  const w = 280;
  const h = 56;
  const r = 4;
  const trackY = 20;
  const pad = 20;
  const trackW = w - pad * 2;

  const toX = (v: number) => pad + ((v - lo) / range) * trackW;

  const positions = percentages.map(toX).sort((a, b) => a - b);

  return (
    <svg
      className="distribution-chart"
      viewBox={`0 0 ${w} ${h}`}
      aria-label="Likelihood distribution"
    >
      <line
        x1={pad}
        y1={trackY}
        x2={w - pad}
        y2={trackY}
        stroke="var(--line)"
        strokeWidth="1"
      />
      <line
        x1={pad}
        y1={trackY - 4}
        x2={pad}
        y2={trackY + 4}
        stroke="var(--line-strong)"
        strokeWidth="1"
      />
      <line
        x1={w - pad}
        y1={trackY - 4}
        x2={w - pad}
        y2={trackY + 4}
        stroke="var(--line-strong)"
        strokeWidth="1"
      />
      <text
        x={pad}
        y={h - 2}
        fill="var(--muted)"
        fontSize="10"
        textAnchor="middle"
      >
        {`${lo}%`}
      </text>
      <text
        x={w - pad}
        y={h - 2}
        fill="var(--muted)"
        fontSize="10"
        textAnchor="middle"
      >
        {`${hi}%`}
      </text>
      {positions.map((x, i) => (
        <circle
          key={i}
          cx={x}
          cy={trackY}
          r={r}
          fill="var(--accent)"
          opacity={0.7}
        />
      ))}
    </svg>
  );
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [draft, setDraft] = useState<BookDraft>(createDraft());
  const [editingBookId, setEditingBookId] = useState<number | null>(null);
  const [scrollToForm, setScrollToForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pendingTagDelete, setPendingTagDelete] = useState<string | null>(null);
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
  const [bookTagDrag, setBookTagDrag] = useState<BookTagDrag | null>(null);
  const [bookTagDropTarget, setBookTagDropTarget] = useState<{
    bookId: number;
    field: SuggestionField;
    tag: string | null;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [genreInterests, setGenreInterests] = useState<GenreInterestMap>({});
  const [authorExperiences, setAuthorExperiences] =
    useState<AuthorExperienceMap>({});

  useEffect(() => {
    let isActive = true;

    async function loadSavedBooks() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const savedBooks = await fetchBooks();
        const savedGenreInterests = readGenreInterests();
        const savedAuthorExperiences = readAuthorExperiences();

        if (isActive) {
          setBooks(savedBooks);
          setGenreInterests(savedGenreInterests);
          setAuthorExperiences(savedAuthorExperiences);
        }
      } catch (error) {
        if (isActive) {
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
  }, []);

  const rankedBooks = useMemo<RankedBook[]>(() => {
    return books
      .map((book) => {
        const preferences = [
          averageTagPreference(book.authors, authorExperiences),
          ...tagPreferences(book.genres, genreInterests),
        ];
        const R = book.starRating ?? GLOBAL_MEAN;
        const v = book.ratingCount ?? 0;
        const bScore = bayesianScore(R, v, GLOBAL_MEAN, SMOOTHING_FACTOR);
        return {
          ...book,
          score: compositeScore(bScore, ...preferences),
          rank: 0,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if ((b.starRating ?? 0) !== (a.starRating ?? 0)) {
          return (b.starRating ?? 0) - (a.starRating ?? 0);
        }
        return (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
      })
      .map((book, index) => ({ ...book, rank: index + 1 }));
  }, [books, genreInterests, authorExperiences]);

  const rankedCount = rankedBooks.length;
  const leader = rankedBooks[0];
  const averageScore =
    rankedCount > 0
      ? rankedBooks.reduce((total, book) => total + book.score, 0) / rankedCount
      : null;
  const isEditing = editingBookId !== null;

  const knownGenres = useMemo(() => {
    const set = new Set<string>();
    for (const book of books) {
      for (const genre of book.genres) {
        set.add(genre);
      }
    }
    for (const genre of Object.keys(genreInterests)) {
      set.add(genre);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books, genreInterests]);

  const knownAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const book of books) {
      for (const author of book.authors) {
        set.add(author);
      }
    }
    for (const author of Object.keys(authorExperiences)) {
      set.add(author);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books, authorExperiences]);

  const authorSuggestions = useMemo(() => {
    return matchingSuggestions(draft.authorInput, draft.authors, knownAuthors);
  }, [draft.authorInput, draft.authors, knownAuthors]);

  const genreSuggestions = useMemo(() => {
    return matchingSuggestions(draft.genreInput, draft.genres, knownGenres);
  }, [draft.genreInput, draft.genres, knownGenres]);

  const resetDraft = useCallback(() => {
    setDraft(createDraft());
    setEditingBookId(null);
    setActiveSuggestionField(null);
    setActiveTagActionMenu(null);
    setDraftTagDrag(null);
    setDraftTagDropTarget(null);
    setBookTagDrag(null);
    setBookTagDropTarget(null);
  }, []);

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

  const parsedDraftRating = draft.starRating.trim()
    ? Number(draft.starRating)
    : undefined;
  const parsedDraftCount = draft.ratingCount.trim()
    ? Number(draft.ratingCount)
    : undefined;
  const canSubmit =
    !isLoading &&
    !isSaving &&
    draft.title.trim().length > 0 &&
    (parsedDraftRating == null ||
      (Number.isFinite(parsedDraftRating) &&
        parsedDraftRating >= 0 &&
        parsedDraftRating <= 5)) &&
    (parsedDraftCount == null ||
      (Number.isFinite(parsedDraftCount) && parsedDraftCount >= 0));

  function updateDraft(field: DraftTextField, value: string) {
    setDraft((current) => {
      let clamped = value;
      const num = Number(value);

      if (value.trim() && Number.isFinite(num)) {
        if (field === "ratingCount" && num < 0) {
          clamped = "0";
        }
        if (field === "ratingCount" && num > 0) {
          clamped = String(Number(num.toPrecision(2)));
        }
        if (
          (field === "starRating" ||
            field === "genreInterest" ||
            field === "authorExperience") &&
          num < 0
        ) {
          clamped = "0";
        }
        if (
          (field === "starRating" ||
            field === "genreInterest" ||
            field === "authorExperience") &&
          num > 5
        ) {
          clamped = "5";
        }
        if (
          (field === "genreInterest" || field === "authorExperience") &&
          !Number.isInteger(num)
        ) {
          clamped = String(Math.round(num));
        }
      }

      const next = { ...current, [field]: clamped };
      if (field === "authorExperience") {
        next.authorExperienceIsManual = true;
        return next;
      }

      if (field === "genreInterest") {
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
          nextMatch != null && genreInterests[nextMatch] != null
            ? String(genreInterests[nextMatch])
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
          nextMatch != null && authorExperiences[nextMatch] != null
            ? String(authorExperiences[nextMatch])
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

  function handleSuggestionFieldBlur(
    event: ReactFocusEvent<HTMLDivElement>,
    field: SuggestionField,
  ) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setActiveSuggestionField((current) => (current === field ? null : current));
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
    const draftScore = scoreMap[tag]?.trim();

    if (draftScore) {
      return draftScore;
    }

    if (globalScores[tag] != null) {
      return String(globalScores[tag]);
    }

    return "";
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
      const rawTag = (explicitValue ?? current[inputKey]).trim();

      if (!rawTag || current[tagsKey].includes(rawTag)) {
        return current;
      }

      const globalScores = isAuthor ? authorExperiences : genreInterests;
      const ratingValue =
        current[ratingKey].trim() ||
        (globalScores[rawTag] != null ? String(globalScores[rawTag]) : "");
      const nextTags = uniqueTags([...current[tagsKey], rawTag]);

      return {
        ...current,
        [tagsKey]: nextTags,
        [scoresKey]: ratingValue
          ? {
              ...current[scoresKey],
              [rawTag]: ratingValue,
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
          authorScores: removeTagFromScores(current.authorScores, tag),
        };
      }

      return {
        ...current,
        genres: current.genres.filter((genre) => genre !== tag),
        genreScores: removeTagFromScores(current.genreScores, tag),
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

  async function reorderBookTags(
    bookId: number,
    field: SuggestionField,
    draggedTag: string,
    targetTag: string | null,
  ) {
    const book = books.find((candidate) => candidate.id === bookId);

    if (!book) {
      return;
    }

    const currentTags = field === "author" ? book.authors : book.genres;
    const nextTags =
      targetTag == null
        ? moveTagToEnd(currentTags, draggedTag)
        : reorderTags(currentTags, draggedTag, targetTag);

    if (nextTags === currentTags) {
      return;
    }

    setErrorMessage(null);

    try {
      const payload = {
        title: book.title,
        authors: field === "author" ? nextTags : book.authors,
        starRating: book.starRating,
        ratingCount: book.ratingCount,
        genres: field === "genre" ? nextTags : book.genres,
      };
      const nextBooks = await updateBookRecord(bookId, payload);
      setBooks(nextBooks);

      if (editingBookId === bookId) {
        const tagsKey = field === "author" ? "authors" : "genres";
        setDraft((current) => ({
          ...current,
          [tagsKey]: nextTags,
        }));
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  function handleBookTagDragStart(
    event: ReactDragEvent<HTMLSpanElement>,
    bookId: number,
    field: SuggestionField,
    tag: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${bookId}:${field}:${tag}`);
    setActiveTagActionMenu(null);
    setBookTagDrag({ bookId, field, tag });
    setBookTagDropTarget(null);
  }

  function handleBookTagGroupDragOver(
    event: ReactDragEvent<HTMLDivElement>,
    bookId: number,
    field: SuggestionField,
  ) {
    if (
      !bookTagDrag ||
      bookTagDrag.bookId !== bookId ||
      bookTagDrag.field !== field
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setBookTagDropTarget((current) =>
      current?.bookId === bookId &&
      current.field === field &&
      current.tag === null
        ? current
        : { bookId, field, tag: null },
    );
  }

  function handleBookTagDragOver(
    event: ReactDragEvent<HTMLSpanElement>,
    bookId: number,
    field: SuggestionField,
    tag: string,
  ) {
    if (
      !bookTagDrag ||
      bookTagDrag.bookId !== bookId ||
      bookTagDrag.field !== field
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (bookTagDrag.tag === tag) {
      setBookTagDropTarget(null);
      return;
    }

    setBookTagDropTarget((current) =>
      current?.bookId === bookId &&
      current.field === field &&
      current.tag === tag
        ? current
        : { bookId, field, tag },
    );
  }

  async function handleBookTagDrop(
    event: ReactDragEvent<HTMLElement>,
    bookId: number,
    field: SuggestionField,
    targetTag: string | null = null,
  ) {
    if (
      !bookTagDrag ||
      bookTagDrag.bookId !== bookId ||
      bookTagDrag.field !== field
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const draggedTag = bookTagDrag.tag;
    setBookTagDrag(null);
    setBookTagDropTarget(null);
    await reorderBookTags(bookId, field, draggedTag, targetTag);
  }

  function handleBookTagDragEnd() {
    setBookTagDrag(null);
    setBookTagDropTarget(null);
  }

  function startEditing(book: Book) {
    setEditingBookId(book.id);
    setScrollToForm(true);
    setActiveTagActionMenu(null);
    setBookTagDrag(null);
    setBookTagDropTarget(null);
    setDraft({
      title: book.title,
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
    });
    setErrorMessage(null);
  }

  async function submitBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        title: draft.title.trim(),
        authors: draft.authors,
        starRating: parsedDraftRating,
        ratingCount: parsedDraftCount,
        genres: draft.genres,
      };

      let nextInterests = genreInterests;
      for (const genre of draft.genres) {
        const rawInterest = draft.genreScores[genre]?.trim();
        if (rawInterest && Number.isFinite(Number(rawInterest))) {
          nextInterests = writeGenreInterest(genre, Number(rawInterest));
        }
      }
      setGenreInterests(nextInterests);

      let nextExps = authorExperiences;
      for (const author of draft.authors) {
        const rawExperience = draft.authorScores[author]?.trim();
        if (rawExperience && Number.isFinite(Number(rawExperience))) {
          nextExps = writeAuthorExperience(author, Number(rawExperience));
        }
      }
      setAuthorExperiences(nextExps);

      const nextBooks = isEditing
        ? await updateBookRecord(editingBookId, payload)
        : await createBookRecord(payload);

      setBooks(nextBooks);
      resetDraft();
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function clearTag(bookId: number, field: SuggestionField, tag: string) {
    try {
      const book = books.find((b) => b.id === bookId);
      if (!book) return;
      const payload = {
        title: book.title,
        authors:
          field === "author"
            ? book.authors.filter((author) => author !== tag)
            : book.authors,
        starRating: book.starRating,
        ratingCount: book.ratingCount,
        genres:
          field === "genre"
            ? book.genres.filter((genre) => genre !== tag)
            : book.genres,
      };
      const nextBooks = await updateBookRecord(bookId, payload);
      setBooks(nextBooks);

      if (editingBookId === bookId) {
        removeDraftTag(field, tag);
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
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
        const nextExps = deleteAuthorExperience(tag);

        setBooks(nextBooks);
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
        const nextInterests = deleteGenreInterest(tag);

        setBooks(nextBooks);
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

  async function removeBook(id: number) {
    setPendingDeleteId(id);
    setErrorMessage(null);

    try {
      const nextBooks = await deleteBookRecord(id);
      setBooks(nextBooks);

      if (editingBookId === id) {
        resetDraft();
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setPendingDeleteId(null);
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

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <h1>
            Sort your reading list by what actually{" "}
            <span className="hero-title-accent">matters to you.</span>
          </h1>
          <p className="hero-text">
            Statistical modelling is applied to the inputs you provide to
            estimate how likely you are to enjoy each book.
          </p>
        </div>

        <aside className="hero-overview" aria-label="List overview">
          <p className="section-label">Your library</p>

          <div className="hero-summary">
            <div className="summary-stats">
              <article className="summary-tile">
                <span className="summary-label">Ranked</span>
                <strong className="summary-number">{rankedCount}</strong>
              </article>

              <article className="summary-tile">
                <span className="summary-label">Average</span>
                <strong className="summary-number">
                  {averageScore === null ? "—" : formatMainResult(averageScore)}
                </strong>
              </article>

              <article className="summary-tile summary-tile-wide">
                <span className="summary-label">Distribution</span>
                <ScoreDistribution scores={rankedBooks.map((b) => b.score)} />
              </article>
            </div>

            <article className="summary-tile summary-tile-leader">
              {leader ? (
                <div className="leader-detail">
                  <div>
                    <strong className="summary-number">{leader.title}</strong>
                    <p className="leader-author">
                      {formatTagSummary(leader.authors, "Author unknown")}
                    </p>
                  </div>
                  <span className="leader-score">
                    {formatMainResult(leader.score)}
                  </span>
                </div>
              ) : (
                <strong className="summary-number">
                  {isLoading ? "Loading..." : "Waiting for entries"}
                </strong>
              )}
            </article>
          </div>
        </aside>
      </section>

      <section className="panel control-panel">
        <div className="section-heading">
          <div>
            <h2>{isEditing ? "Edit book" : "Add a book"}</h2>
          </div>
        </div>

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

        <form className="entry-form" onSubmit={submitBook}>
          <label className="field entry-title">
            <span>Title</span>
            <input
              type="text"
              placeholder="The Remains of the Day"
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </label>

          <div className="field entry-author">
            <span>Author(s) + my experience with them</span>
            <div className="tag-editor">
              <div className="tag-entry-row">
                <div className="inline-composite">
                  <div
                    className="suggestion-field"
                    onFocus={() => setActiveSuggestionField("author")}
                    onBlur={(event) =>
                      handleSuggestionFieldBlur(event, "author")
                    }
                  >
                    <input
                      type="text"
                      placeholder="Kazuo Ishiguro"
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
                          const isDeletingTag = pendingTagDelete === deleteKey;

                          return (
                            <div key={author} className="suggestion-option">
                              <button
                                type="button"
                                className="suggestion-pick"
                                onMouseDown={(event) => event.preventDefault()}
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
                                onMouseDown={(event) => event.preventDefault()}
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
                  <input
                    className="inline-rating"
                    type="number"
                    step="1"
                    min="0"
                    max="5"
                    placeholder="-"
                    title="Experience with author (0–5)"
                    value={draft.authorExperience}
                    onChange={(event) =>
                      updateDraft("authorExperience", event.target.value)
                    }
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-tag-add"
                  onClick={() => addDraftTag("author")}
                  disabled={!draft.authorInput.trim()}
                  aria-label="Add author tag"
                >
                  +
                </button>
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
                    const deleteKey = `author:${author}`;
                    const actionMenuId = tagActionMenuId(
                      "draft",
                      "author",
                      author,
                    );
                    const isDragging =
                      draftTagDrag?.field === "author" &&
                      draftTagDrag.tag === author;
                    const isDropTarget =
                      draftTagDropTarget?.field === "author" &&
                      draftTagDropTarget.tag === author;
                    const isDeletingTag = pendingTagDelete === deleteKey;
                    const isActionMenuOpen =
                      activeTagActionMenu === actionMenuId;

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
                        aria-grabbed={isDragging}
                        title={`Drag to reorder ${author}`}
                      >
                        {author}
                        {score ? (
                          <span className="genre-tag-interest">{score}</span>
                        ) : null}
                        <span className="tag-action-shell">
                          <button
                            type="button"
                            className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveTagActionMenu((current) =>
                                current === actionMenuId ? null : actionMenuId,
                              );
                            }}
                            aria-label={`Open delete options for author ${author}`}
                            title={`Open delete options for author ${author}`}
                            disabled={isDeletingTag}
                          >
                            x
                          </button>
                          {isActionMenuOpen ? (
                            <span className="tag-action-menu">
                              <button
                                type="button"
                                className="tag-action-option"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveTagActionMenu(null);
                                  removeDraftTag("author", author);
                                }}
                                aria-label={`Remove author ${author} from this book`}
                                title={`Remove author ${author} from this book`}
                                disabled={isDeletingTag}
                              >
                                This book
                              </button>
                              <button
                                type="button"
                                className="tag-action-option tag-action-option-danger"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveTagActionMenu(null);
                                  void removeGlobalTag("author", author);
                                }}
                                aria-label={`Delete author tag ${author} everywhere`}
                                title={`Delete author tag ${author} everywhere`}
                                disabled={isDeletingTag}
                              >
                                {isDeletingTag ? "Deleting..." : "Everywhere"}
                              </button>
                            </span>
                          ) : null}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="field entry-genre">
            <span>Genre(s) / topic(s) + my current interest in them</span>
            <div className="tag-editor">
              <div className="tag-entry-row">
                <div className="inline-composite">
                  <div
                    className="suggestion-field"
                    onFocus={() => setActiveSuggestionField("genre")}
                    onBlur={(event) =>
                      handleSuggestionFieldBlur(event, "genre")
                    }
                  >
                    <input
                      type="text"
                      placeholder="Historical Fiction"
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
                          const isDeletingTag = pendingTagDelete === deleteKey;

                          return (
                            <div key={genre} className="suggestion-option">
                              <button
                                type="button"
                                className="suggestion-pick"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() =>
                                  selectSuggestedValue("genre", genre)
                                }
                              >
                                <span className="suggestion-copy">{genre}</span>
                                {genreInterests[genre] != null ? (
                                  <span className="genre-tag-interest">
                                    {genreInterests[genre]}
                                  </span>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                className="tag-remove suggestion-remove"
                                onMouseDown={(event) => event.preventDefault()}
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
                  <input
                    className="inline-rating"
                    type="number"
                    step="1"
                    min="0"
                    max="5"
                    placeholder="-"
                    title="Genre / topic interest (0–5)"
                    value={draft.genreInterest}
                    onChange={(event) =>
                      updateDraft("genreInterest", event.target.value)
                    }
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-tag-add"
                  onClick={() => addDraftTag("genre")}
                  disabled={!draft.genreInput.trim()}
                  aria-label="Add genre tag"
                >
                  +
                </button>
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
                    const deleteKey = `genre:${genre}`;
                    const actionMenuId = tagActionMenuId(
                      "draft",
                      "genre",
                      genre,
                    );
                    const isDragging =
                      draftTagDrag?.field === "genre" &&
                      draftTagDrag.tag === genre;
                    const isDropTarget =
                      draftTagDropTarget?.field === "genre" &&
                      draftTagDropTarget.tag === genre;
                    const isDeletingTag = pendingTagDelete === deleteKey;
                    const isActionMenuOpen =
                      activeTagActionMenu === actionMenuId;

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
                        aria-grabbed={isDragging}
                        title={`Drag to reorder ${genre}`}
                      >
                        {genre}
                        {score ? (
                          <span className="genre-tag-interest">{score}</span>
                        ) : null}
                        <span className="tag-action-shell">
                          <button
                            type="button"
                            className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveTagActionMenu((current) =>
                                current === actionMenuId ? null : actionMenuId,
                              );
                            }}
                            aria-label={`Open delete options for genre ${genre}`}
                            title={`Open delete options for genre ${genre}`}
                            disabled={isDeletingTag}
                          >
                            x
                          </button>
                          {isActionMenuOpen ? (
                            <span className="tag-action-menu">
                              <button
                                type="button"
                                className="tag-action-option"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveTagActionMenu(null);
                                  removeDraftTag("genre", genre);
                                }}
                                aria-label={`Remove genre ${genre} from this book`}
                                title={`Remove genre ${genre} from this book`}
                                disabled={isDeletingTag}
                              >
                                This book
                              </button>
                              <button
                                type="button"
                                className="tag-action-option tag-action-option-danger"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveTagActionMenu(null);
                                  void removeGlobalTag("genre", genre);
                                }}
                                aria-label={`Delete genre tag ${genre} everywhere`}
                                title={`Delete genre tag ${genre} everywhere`}
                                disabled={isDeletingTag}
                              >
                                {isDeletingTag ? "Deleting..." : "Everywhere"}
                              </button>
                            </span>
                          ) : null}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <label className="field entry-rating">
            <span>Average rating</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="5"
              placeholder="4.14"
              value={draft.starRating}
              onChange={(event) =>
                updateDraft("starRating", event.target.value)
              }
            />
          </label>

          <label className="field entry-count">
            <span>Number of ratings</span>
            <input
              type="number"
              step="1"
              min="0"
              placeholder="370000"
              value={draft.ratingCount}
              onChange={(event) =>
                updateDraft("ratingCount", event.target.value)
              }
            />
          </label>

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
              type="submit"
              className="btn btn-primary"
              disabled={!canSubmit}
            >
              {isSaving ? "Saving..." : isEditing ? "Update" : "Add book"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel board">
        <div className="board-toolbar">
          <h2>My list</h2>
        </div>
        <div className="ranking-list">
          {isLoading ? (
            <div className="empty-state">Loading your rankings...</div>
          ) : rankedBooks.length === 0 ? (
            <div className="empty-state">
              No books yet. Add a title above to see your first ranking.
            </div>
          ) : (
            rankedBooks.map((book, index) => {
              const scoreFill = clampPercentage((book.score / 5) * 100);
              const isDeleting = pendingDeleteId === book.id;
              const rankClass =
                book.rank === 1
                  ? "rank-gold"
                  : book.rank === 2
                    ? "rank-silver"
                    : book.rank === 3
                      ? "rank-bronze"
                      : "";

              return (
                <article
                  key={book.id}
                  className={`ranking-row${editingBookId === book.id ? " is-editing" : ""}${book.rank === 1 ? " is-leader" : ""}`}
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <div className={`rank-badge ${rankClass}`}>#{book.rank}</div>

                  <div className="ranking-body">
                    <div className="ranking-topline">
                      <div className="ranking-info">
                        <h3>{book.title}</h3>
                        <div className="book-tags">
                          {book.authors.length > 0 ? (
                            <div
                              className={[
                                "book-tag-group",
                                bookTagDrag?.bookId === book.id &&
                                bookTagDrag.field === "author"
                                  ? "is-drag-active"
                                  : "",
                                bookTagDropTarget?.bookId === book.id &&
                                bookTagDropTarget.field === "author" &&
                                bookTagDropTarget.tag === null
                                  ? "is-drop-target-end"
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onDragOver={(event) =>
                                handleBookTagGroupDragOver(
                                  event,
                                  book.id,
                                  "author",
                                )
                              }
                              onDrop={(event) =>
                                void handleBookTagDrop(event, book.id, "author")
                              }
                            >
                              {book.authors.map((author) => {
                                const deleteKey = `author:${author}`;
                                const actionMenuId = tagActionMenuId(
                                  "book",
                                  "author",
                                  author,
                                  book.id,
                                );
                                const isDeletingTag =
                                  pendingTagDelete === deleteKey;
                                const isActionMenuOpen =
                                  activeTagActionMenu === actionMenuId;
                                const isDragging =
                                  bookTagDrag?.bookId === book.id &&
                                  bookTagDrag.field === "author" &&
                                  bookTagDrag.tag === author;
                                const isDropTarget =
                                  bookTagDropTarget?.bookId === book.id &&
                                  bookTagDropTarget.field === "author" &&
                                  bookTagDropTarget.tag === author;

                                return (
                                  <span
                                    key={`author-${book.id}-${author}`}
                                    className={[
                                      "genre-tag",
                                      "book-tag-chip",
                                      isDragging ? "is-dragging" : "",
                                      isDropTarget ? "is-drag-target" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    draggable
                                    onDragStart={(event) =>
                                      handleBookTagDragStart(
                                        event,
                                        book.id,
                                        "author",
                                        author,
                                      )
                                    }
                                    onDragOver={(event) =>
                                      handleBookTagDragOver(
                                        event,
                                        book.id,
                                        "author",
                                        author,
                                      )
                                    }
                                    onDrop={(event) =>
                                      void handleBookTagDrop(
                                        event,
                                        book.id,
                                        "author",
                                        author,
                                      )
                                    }
                                    onDragEnd={handleBookTagDragEnd}
                                    aria-grabbed={isDragging}
                                    title={`Drag to reorder ${author}`}
                                  >
                                    {author}
                                    {authorExperiences[author] != null ? (
                                      <span className="genre-tag-interest">
                                        {authorExperiences[author]}
                                      </span>
                                    ) : null}
                                    <span className="tag-action-shell">
                                      <button
                                        type="button"
                                        className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                                        onClick={() =>
                                          setActiveTagActionMenu((current) =>
                                            current === actionMenuId
                                              ? null
                                              : actionMenuId,
                                          )
                                        }
                                        aria-label={`Open delete options for author ${author}`}
                                        title={`Open delete options for author ${author}`}
                                        disabled={isDeletingTag}
                                      >
                                        x
                                      </button>
                                      {isActionMenuOpen ? (
                                        <span className="tag-action-menu">
                                          <button
                                            type="button"
                                            className="tag-action-option"
                                            onClick={() => {
                                              setActiveTagActionMenu(null);
                                              void clearTag(
                                                book.id,
                                                "author",
                                                author,
                                              );
                                            }}
                                            aria-label={`Remove author ${author} from this book`}
                                            title={`Remove author ${author} from this book`}
                                            disabled={isDeletingTag}
                                          >
                                            This book
                                          </button>
                                          <button
                                            type="button"
                                            className="tag-action-option tag-action-option-danger"
                                            onClick={() => {
                                              setActiveTagActionMenu(null);
                                              void removeGlobalTag(
                                                "author",
                                                author,
                                              );
                                            }}
                                            aria-label={`Delete author tag ${author} everywhere`}
                                            title={`Delete author tag ${author} everywhere`}
                                            disabled={isDeletingTag}
                                          >
                                            {isDeletingTag
                                              ? "Deleting..."
                                              : "Everywhere"}
                                          </button>
                                        </span>
                                      ) : null}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="genre-tag">Author unknown</span>
                          )}
                          <div
                            className={[
                              "book-tag-group",
                              bookTagDrag?.bookId === book.id &&
                              bookTagDrag.field === "genre"
                                ? "is-drag-active"
                                : "",
                              bookTagDropTarget?.bookId === book.id &&
                              bookTagDropTarget.field === "genre" &&
                              bookTagDropTarget.tag === null
                                ? "is-drop-target-end"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onDragOver={(event) =>
                              handleBookTagGroupDragOver(
                                event,
                                book.id,
                                "genre",
                              )
                            }
                            onDrop={(event) =>
                              void handleBookTagDrop(event, book.id, "genre")
                            }
                          >
                            {book.genres.map((genre) => {
                              const deleteKey = `genre:${genre}`;
                              const actionMenuId = tagActionMenuId(
                                "book",
                                "genre",
                                genre,
                                book.id,
                              );
                              const isDeletingTag =
                                pendingTagDelete === deleteKey;
                              const isActionMenuOpen =
                                activeTagActionMenu === actionMenuId;
                              const isDragging =
                                bookTagDrag?.bookId === book.id &&
                                bookTagDrag.field === "genre" &&
                                bookTagDrag.tag === genre;
                              const isDropTarget =
                                bookTagDropTarget?.bookId === book.id &&
                                bookTagDropTarget.field === "genre" &&
                                bookTagDropTarget.tag === genre;

                              return (
                                <span
                                  key={`genre-${book.id}-${genre}`}
                                  className={[
                                    "genre-tag",
                                    "book-tag-chip",
                                    isDragging ? "is-dragging" : "",
                                    isDropTarget ? "is-drag-target" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  draggable
                                  onDragStart={(event) =>
                                    handleBookTagDragStart(
                                      event,
                                      book.id,
                                      "genre",
                                      genre,
                                    )
                                  }
                                  onDragOver={(event) =>
                                    handleBookTagDragOver(
                                      event,
                                      book.id,
                                      "genre",
                                      genre,
                                    )
                                  }
                                  onDrop={(event) =>
                                    void handleBookTagDrop(
                                      event,
                                      book.id,
                                      "genre",
                                      genre,
                                    )
                                  }
                                  onDragEnd={handleBookTagDragEnd}
                                  aria-grabbed={isDragging}
                                  title={`Drag to reorder ${genre}`}
                                >
                                  {genre}
                                  {genreInterests[genre] != null ? (
                                    <span className="genre-tag-interest">
                                      {genreInterests[genre]}
                                    </span>
                                  ) : null}
                                  <span className="tag-action-shell">
                                    <button
                                      type="button"
                                      className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                                      onClick={() =>
                                        setActiveTagActionMenu((current) =>
                                          current === actionMenuId
                                            ? null
                                            : actionMenuId,
                                        )
                                      }
                                      aria-label={`Open delete options for genre ${genre}`}
                                      title={`Open delete options for genre ${genre}`}
                                      disabled={isDeletingTag}
                                    >
                                      x
                                    </button>
                                    {isActionMenuOpen ? (
                                      <span className="tag-action-menu">
                                        <button
                                          type="button"
                                          className="tag-action-option"
                                          onClick={() => {
                                            setActiveTagActionMenu(null);
                                            void clearTag(
                                              book.id,
                                              "genre",
                                              genre,
                                            );
                                          }}
                                          aria-label={`Remove genre ${genre} from this book`}
                                          title={`Remove genre ${genre} from this book`}
                                          disabled={isDeletingTag}
                                        >
                                          This book
                                        </button>
                                        <button
                                          type="button"
                                          className="tag-action-option tag-action-option-danger"
                                          onClick={() => {
                                            setActiveTagActionMenu(null);
                                            void removeGlobalTag(
                                              "genre",
                                              genre,
                                            );
                                          }}
                                          aria-label={`Delete genre tag ${genre} everywhere`}
                                          title={`Delete genre tag ${genre} everywhere`}
                                          disabled={isDeletingTag}
                                        >
                                          {isDeletingTag
                                            ? "Deleting..."
                                            : "Everywhere"}
                                        </button>
                                      </span>
                                    ) : null}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div className="meta-row">
                          {book.starRating != null ? (
                            <span>{formatScore(book.starRating)} avg</span>
                          ) : null}
                          {book.ratingCount != null ? (
                            <span>{formatCount(book.ratingCount)} ratings</span>
                          ) : null}
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => startEditing(book)}
                              disabled={isSaving || isDeleting}
                            >
                              {editingBookId === book.id ? "Editing" : "Edit"}
                            </button>
                            <span className="action-dot">·</span>
                            <button
                              type="button"
                              className="link-btn link-btn-danger"
                              onClick={() => void removeBook(book.id)}
                              disabled={isSaving || isDeleting}
                            >
                              {isDeleting ? "Removing..." : "Remove"}
                            </button>
                          </div>
                        </div>
                      </div>

                      <strong className="score-value">
                        {formatMainResult(book.score)}
                      </strong>
                    </div>

                    <div className="score-meter" aria-hidden="true">
                      <span
                        className="score-meter-fill"
                        style={
                          {
                            "--fill-width": `${scoreFill}%`,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
