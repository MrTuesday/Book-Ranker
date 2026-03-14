import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createBookRecord,
  deleteBookRecord,
  fetchBooks,
  type Book,
  type GenreInterestMap,
  type AuthorExperienceMap,
  readGenreInterests,
  readAuthorExperiences,
  updateBookRecord,
  writeGenreInterest,
  writeAuthorExperience,
} from "./lib/books-api";

type BookDraft = {
  title: string;
  author: string;
  starRating: string;
  ratingCount: string;
  genre: string;
  genreInterest: string;
  authorExperience: string;
};

type RankedBook = Book & {
  score: number;
  rank: number;
};

const GLOBAL_MEAN = 3.8;
const SMOOTHING_FACTOR = 500;


function createDraft(): BookDraft {
  return {
    title: "",
    author: "",
    starRating: "",
    ratingCount: "",
    genre: "",
    genreInterest: "",
    authorExperience: "",
  };
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
      <line x1={pad} y1={trackY} x2={w - pad} y2={trackY} stroke="var(--line)" strokeWidth="1" />
      <line x1={pad} y1={trackY - 4} x2={pad} y2={trackY + 4} stroke="var(--line-strong)" strokeWidth="1" />
      <line x1={w - pad} y1={trackY - 4} x2={w - pad} y2={trackY + 4} stroke="var(--line-strong)" strokeWidth="1" />
      <text x={pad} y={h - 2} fill="var(--muted)" fontSize="10" textAnchor="middle">
        {lo.toFixed(1)}
      </text>
      <text x={w - pad} y={h - 2} fill="var(--muted)" fontSize="10" textAnchor="middle">
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [genreInterests, setGenreInterests] = useState<GenreInterestMap>({});
  const [authorExperiences, setAuthorExperiences] = useState<AuthorExperienceMap>({});

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
        const genreInterest =
          book.genre && genreInterests[book.genre] != null
            ? genreInterests[book.genre]
            : 3;
        const authorExp =
          book.author && authorExperiences[book.author] != null
            ? authorExperiences[book.author]
            : 3;
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
      if (book.genre) set.add(book.genre);
    }
    for (const genre of Object.keys(genreInterests)) {
      set.add(genre);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books, genreInterests]);

  const knownAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const book of books) {
      if (book.author) set.add(book.author);
    }
    for (const author of Object.keys(authorExperiences)) {
      set.add(author);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books, authorExperiences]);

  const resetDraft = useCallback(() => {
    setDraft(createDraft());
    setEditingBookId(null);
  }, []);

  useEffect(() => {
    if (scrollToForm) {
      document.querySelector(".control-panel")?.scrollIntoView({ behavior: "smooth" });
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

  const parsedDraftRating = draft.starRating.trim() ? Number(draft.starRating) : undefined;
  const parsedDraftCount = draft.ratingCount.trim() ? Number(draft.ratingCount) : undefined;
  const canSubmit =
    !isLoading &&
    !isSaving &&
    draft.title.trim().length > 0 &&
    (parsedDraftRating == null || (Number.isFinite(parsedDraftRating) && parsedDraftRating >= 0 && parsedDraftRating <= 5)) &&
    (parsedDraftCount == null || (Number.isFinite(parsedDraftCount) && parsedDraftCount >= 0));

  function updateDraft(field: keyof BookDraft, value: string) {
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
      // Auto-fill genre interest when genre changes
      if (field === "genre" && value.trim() && genreInterests[value.trim()] != null) {
        next.genreInterest = String(genreInterests[value.trim()]);
      }
      // Auto-fill author experience when author changes
      if (field === "author" && value.trim() && authorExperiences[value.trim()] != null) {
        next.authorExperience = String(authorExperiences[value.trim()]);
      }
      return next;
    });
  }

  function startEditing(book: Book) {
    setEditingBookId(book.id);
    setScrollToForm(true);
    setDraft({
      title: book.title,
      author: book.author,
      starRating: book.starRating != null ? String(book.starRating) : "",
      ratingCount: book.ratingCount != null ? String(book.ratingCount) : "",
      genre: book.genre ?? "",
      genreInterest:
        book.genre && genreInterests[book.genre] != null
          ? String(genreInterests[book.genre])
          : "",
      authorExperience:
        book.author && authorExperiences[book.author] != null
          ? String(authorExperiences[book.author])
          : "",
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
      const genre = draft.genre.trim() || undefined;

      const payload = {
        title: draft.title.trim(),
        author: draft.author.trim(),
        starRating: parsedDraftRating,
        ratingCount: parsedDraftCount,
        genre,
      };

      // Save genre interest globally if genre and interest are both provided
      if (genre && draft.genreInterest.trim()) {
        const parsedInterest = Number(draft.genreInterest);
        if (Number.isFinite(parsedInterest)) {
          const nextInterests = writeGenreInterest(genre, parsedInterest);
          setGenreInterests(nextInterests);
        }
      }

      // Save author experience globally if author and experience are both provided
      const authorName = draft.author.trim();
      if (authorName && draft.authorExperience.trim()) {
        const parsedExp = Number(draft.authorExperience);
        if (Number.isFinite(parsedExp)) {
          const nextExps = writeAuthorExperience(authorName, parsedExp);
          setAuthorExperiences(nextExps);
        }
      }

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

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <h1>
            Rank your reading list, based on what actually{" "}
            <span className="hero-title-accent">matters to you.</span>
          </h1>
          <p className="hero-text">
            Bayesian modelling blends your experience with the author and current interest in the genre / topic with each book's average rating and popularity into a single estimate of how likely you really are to enjoy it.
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
                    <p className="leader-author">{leader.author || "Author unknown"}</p>
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
            <span>Author + my experience</span>
            <div className="inline-composite">
              <input
                type="text"
                list="author-options"
                placeholder="Kazuo Ishiguro"
                value={draft.author}
                onChange={(event) => updateDraft("author", event.target.value)}
              />
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
            <datalist id="author-options">
              {knownAuthors.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>

          <div className="field entry-genre">
            <span>Genre / topic + my current interest</span>
            <div className="inline-composite">
              <input
                type="text"
                list="genre-options"
                placeholder="Historical Fiction"
                value={draft.genre}
                onChange={(event) => updateDraft("genre", event.target.value)}
              />
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
            <datalist id="genre-options">
              {knownGenres.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
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
                          <span className="genre-tag">
                            {book.author || "Author unknown"}
                            {book.author && authorExperiences[book.author] != null ? (
                              <span className="genre-tag-interest">{authorExperiences[book.author]}</span>
                            ) : null}
                          </span>
                          {book.genre ? (
                            <span className="genre-tag">
                              {book.genre}
                              {genreInterests[book.genre] != null ? (
                                <span className="genre-tag-interest">{genreInterests[book.genre]}</span>
                              ) : null}
                            </span>
                          ) : null}
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
