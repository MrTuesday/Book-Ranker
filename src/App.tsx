import {
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
  authorExperience: string;
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
    authorExperience: "",
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

function averageTagPreference(tags: string[], scores: Record<string, number>) {
  if (tags.length === 0) {
    return 3;
  }

  return (
    tags.reduce((total, tag) => total + (scores[tag] ?? 3), 0) / tags.length
  );
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

function formatTagSummary(tags: string[], fallback: string) {
  return tags.length > 0 ? tags.join(", ") : fallback;
}

function bayesianScore(R: number, v: number, C: number, m: number) {
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

function compositeScore(
  bayesian: number,
  authorExperience?: number,
  genreInterest?: number,
) {
  const values = [bayesian];
  if (authorExperience != null) values.push(authorExperience);
  if (genreInterest != null) values.push(genreInterest);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatScore(value: number, places = 2) {
  return value.toFixed(places);
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

  const dataMin = Math.min(...scores);
  const dataMax = Math.max(...scores);
  const lo = Math.max(0, Math.floor(dataMin * 10) / 10);
  const hi = Math.min(5, Math.ceil(dataMax * 10) / 10);
  const range = hi - lo || 1;

  const w = 280;
  const h = 56;
  const r = 4;
  const trackY = 20;
  const pad = 20;
  const trackW = w - pad * 2;

  const toX = (v: number) => pad + ((v - lo) / range) * trackW;

  const positions = scores.map(toX).sort((a, b) => a - b);

  return (
    <svg
      className="distribution-chart"
      viewBox={`0 0 ${w} ${h}`}
      aria-label="Score distribution"
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
        {lo.toFixed(1)}
      </text>
      <text
        x={w - pad}
        y={h - 2}
        fill="var(--muted)"
        fontSize="10"
        textAnchor="middle"
      >
        {hi.toFixed(1)}
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
        const genreInterest = averageTagPreference(book.genres, genreInterests);
        const authorExp = averageTagPreference(book.authors, authorExperiences);
        const R = book.starRating ?? GLOBAL_MEAN;
        const v = book.ratingCount ?? 0;
        const bScore = bayesianScore(R, v, GLOBAL_MEAN, SMOOTHING_FACTOR);
        return {
          ...book,
          score: compositeScore(bScore, authorExp, genreInterest),
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
    const query = draft.authorInput.trim().toLocaleLowerCase();

    if (!query) {
      return [];
    }

    return knownAuthors
      .filter(
        (author) =>
          !draft.authors.includes(author) &&
          author.toLocaleLowerCase().includes(query),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [draft.authorInput, draft.authors, knownAuthors]);

  const genreSuggestions = useMemo(() => {
    const query = draft.genreInput.trim().toLocaleLowerCase();

    if (!query) {
      return [];
    }

    return knownGenres
      .filter(
        (genre) =>
          !draft.genres.includes(genre) &&
          genre.toLocaleLowerCase().includes(query),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [draft.genreInput, draft.genres, knownGenres]);

  const resetDraft = useCallback(() => {
    setDraft(createDraft());
    setEditingBookId(null);
    setActiveSuggestionField(null);
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
      if (field === "genreInput") {
        const match = value.trim();
        next.genreInterest =
          match && genreInterests[match] != null
            ? String(genreInterests[match])
            : "";
      }

      if (field === "authorInput") {
        const match = value.trim();
        next.authorExperience =
          match && authorExperiences[match] != null
            ? String(authorExperiences[match])
            : "";
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
    addDraftTag(field, value);
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

    return "3";
  }

  function addDraftTag(field: SuggestionField, explicitValue?: string) {
    setDraft((current) => {
      const isAuthor = field === "author";
      const inputKey = isAuthor ? "authorInput" : "genreInput";
      const ratingKey = isAuthor ? "authorExperience" : "genreInterest";
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

  function startEditing(book: Book) {
    setEditingBookId(book.id);
    setScrollToForm(true);
    setDraft({
      title: book.title,
      starRating: book.starRating != null ? String(book.starRating) : "",
      ratingCount: book.ratingCount != null ? String(book.ratingCount) : "",
      authorInput: "",
      genreInterest: "",
      authorExperience: "",
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
                <span className="summary-label">Avg. score</span>
                <strong className="summary-number">
                  {averageScore === null ? "—" : formatScore(averageScore)}
                </strong>
              </article>

              <article className="summary-tile summary-tile-wide">
                <span className="summary-label">Distribution</span>
                <ScoreDistribution scores={rankedBooks.map((b) => b.score)} />
              </article>
            </div>

            <article className="summary-tile summary-tile-leader">
              <span className="summary-label">Top pick</span>
              {leader ? (
                <div className="leader-detail">
                  <div>
                    <strong className="summary-number">{leader.title}</strong>
                    <p className="leader-author">
                      {formatTagSummary(leader.authors, "Author unknown")}
                    </p>
                  </div>
                  <span className="leader-score">
                    {formatScore(leader.score)}
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
            <span>Authors + my experience</span>
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
                  className="btn btn-secondary btn-tag-add"
                  onClick={() => addDraftTag("author")}
                  disabled={!draft.authorInput.trim()}
                >
                  Add
                </button>
              </div>
              {draft.authors.length > 0 ? (
                <div className="draft-tag-list">
                  {draft.authors.map((author) => (
                    <span key={author} className="genre-tag">
                      {author}
                      <span className="genre-tag-interest">
                        {getDraftTagScore("author", author)}
                      </span>
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() => removeDraftTag("author", author)}
                        aria-label={`Remove author ${author} from this book`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="field entry-genre">
            <span>Genres / topics + my current interest</span>
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
                  className="btn btn-secondary btn-tag-add"
                  onClick={() => addDraftTag("genre")}
                  disabled={!draft.genreInput.trim()}
                >
                  Add
                </button>
              </div>
              {draft.genres.length > 0 ? (
                <div className="draft-tag-list">
                  {draft.genres.map((genre) => (
                    <span key={genre} className="genre-tag">
                      {genre}
                      <span className="genre-tag-interest">
                        {getDraftTagScore("genre", genre)}
                      </span>
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() => removeDraftTag("genre", genre)}
                        aria-label={`Remove genre ${genre} from this book`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <label className="field entry-rating">
            <span>Avg. star rating</span>
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
                            book.authors.map((author) => (
                              <span
                                key={`author-${book.id}-${author}`}
                                className="genre-tag"
                              >
                                {author}
                                {authorExperiences[author] != null ? (
                                  <span className="genre-tag-interest">
                                    {authorExperiences[author]}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className="tag-remove"
                                  onClick={() =>
                                    void clearTag(book.id, "author", author)
                                  }
                                  aria-label={`Remove author ${author}`}
                                >
                                  x
                                </button>
                              </span>
                            ))
                          ) : (
                            <span className="genre-tag">Author unknown</span>
                          )}
                          {book.genres.map((genre) => (
                            <span
                              key={`genre-${book.id}-${genre}`}
                              className="genre-tag"
                            >
                              {genre}
                              {genreInterests[genre] != null ? (
                                <span className="genre-tag-interest">
                                  {genreInterests[genre]}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="tag-remove"
                                onClick={() =>
                                  void clearTag(book.id, "genre", genre)
                                }
                                aria-label={`Remove genre ${genre}`}
                              >
                                x
                              </button>
                            </span>
                          ))}
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
                        {formatScore(book.score)}
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
