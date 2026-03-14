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
  updateBookRecord,
} from "./lib/books-api";

type BookDraft = {
  title: string;
  author: string;
  starRating: string;
  ratingCount: string;
};

type RankedBook = Book & {
  score: number;
  rank: number;
};

const GLOBAL_MEAN = 3.8;
const SMOOTHING_FACTOR = 500;
const FULL_STARS = 5;

function createDraft(): BookDraft {
  return {
    title: "",
    author: "",
    starRating: "",
    ratingCount: "",
  };
}

function bayesianScore(R: number, v: number, C: number, m: number) {
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

function formatScore(value: number, places = 2) {
  return value.toFixed(places);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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
  const min = 0;
  const max = 5;
  const range = max - min;
  const w = 280;
  const h = 48;
  const r = 4;

  const positions = scores
    .map((s) => ((s - min) / range) * (w - r * 2) + r)
    .sort((a, b) => a - b);

  return (
    <svg
      className="distribution-chart"
      viewBox={`0 0 ${w} ${h}`}
      aria-label="Score distribution"
    >
      <line x1={r} y1={h / 2} x2={w - r} y2={h / 2} stroke="var(--line)" strokeWidth="1" />
      {[0, 1, 2, 3, 4, 5].map((tick) => {
        const x = (tick / max) * (w - r * 2) + r;
        return (
          <line
            key={tick}
            x1={x} y1={h / 2 - 4} x2={x} y2={h / 2 + 4}
            stroke="var(--line-strong)"
            strokeWidth="1"
          />
        );
      })}
      {positions.map((x, i) => (
        <circle
          key={i}
          cx={x}
          cy={h / 2}
          r={r}
          fill="var(--accent)"
          opacity={0.7}
        />
      ))}
    </svg>
  );
}

function Stars({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <span className="stars" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: FULL_STARS }, (_, i) => (
        <span key={i} className={i < filled ? "star-filled" : "star-empty"}>
          {i < filled ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [draft, setDraft] = useState<BookDraft>(createDraft());
  const [editingBookId, setEditingBookId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadSavedBooks() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const savedBooks = await fetchBooks();

        if (isActive) {
          setBooks(savedBooks);
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
      .map((book) => ({
        ...book,
        score: bayesianScore(
          book.starRating,
          book.ratingCount,
          GLOBAL_MEAN,
          SMOOTHING_FACTOR,
        ),
        rank: 0,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (b.starRating !== a.starRating) {
          return b.starRating - a.starRating;
        }
        return b.ratingCount - a.ratingCount;
      })
      .map((book, index) => ({ ...book, rank: index + 1 }));
  }, [books]);

  const rankedCount = rankedBooks.length;
  const leader = rankedBooks[0];
  const averageScore =
    rankedCount > 0
      ? rankedBooks.reduce((total, book) => total + book.score, 0) / rankedCount
      : null;
  const isEditing = editingBookId !== null;

  const resetDraft = useCallback(() => {
    setDraft(createDraft());
    setEditingBookId(null);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isEditing) {
        resetDraft();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isEditing, resetDraft]);

  const parsedDraftRating = Number(draft.starRating);
  const parsedDraftCount = Number(draft.ratingCount);
  const canSubmit =
    !isLoading &&
    !isSaving &&
    draft.title.trim().length > 0 &&
    draft.starRating.trim().length > 0 &&
    draft.ratingCount.trim().length > 0 &&
    Number.isFinite(parsedDraftRating) &&
    Number.isFinite(parsedDraftCount) &&
    parsedDraftRating >= 0 &&
    parsedDraftRating <= 5 &&
    parsedDraftCount >= 0;

  function updateDraft(field: keyof BookDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function startEditing(book: Book) {
    setEditingBookId(book.id);
    setDraft({
      title: book.title,
      author: book.author,
      starRating: String(book.starRating),
      ratingCount: String(book.ratingCount),
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
        author: draft.author.trim(),
        starRating: parsedDraftRating,
        ratingCount: parsedDraftCount,
      };

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
          <p className="eyebrow">Bayesian Book Ranker</p>
          <h1>
            Book ratings
            <span className="hero-title-accent">made smarter.</span>
          </h1>
          <p className="hero-text">
            The more people have rated a book, the more weight its stars carry.
            The big numbers on the right tell you the scores a book has really
            earned - not just what it claims.
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
              placeholder="e.g. The Remains of the Day"
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </label>

          <label className="field entry-author">
            <span>Author</span>
            <input
              type="text"
              placeholder="e.g. Kazuo Ishiguro"
              value={draft.author}
              onChange={(event) => updateDraft("author", event.target.value)}
            />
          </label>

          <label className="field entry-rating">
            <span>Star rating</span>
            <input
              type="number"
              step="0.01"
              placeholder="0 – 5"
              value={draft.starRating}
              onChange={(event) =>
                updateDraft("starRating", event.target.value)
              }
            />
          </label>

          <label className="field entry-count">
            <span>Ratings</span>
            <input
              type="number"
              step="1"
              placeholder="e.g. 50000"
              value={draft.ratingCount}
              onChange={(event) =>
                updateDraft("ratingCount", event.target.value)
              }
            />
          </label>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canSubmit}
            >
              {isSaving ? "Saving..." : isEditing ? "Save changes" : "Add book"}
            </button>

            {isEditing ? (
              <button
                type="button"
                className="btn btn-tertiary"
                onClick={resetDraft}
                disabled={isSaving}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel board">
        <div className="ranking-list">
          {isLoading ? (
            <div className="empty-state">Loading your rankings...</div>
          ) : rankedBooks.length === 0 ? (
            <div className="empty-state">
              No books yet. Add a title, star rating, and number of ratings
              above to see your first ranking.
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
                        <p className="book-byline">
                          {book.author || "Author unknown"}
                        </p>
                        <div className="meta-row">
                          <span>
                            <Stars rating={book.starRating} />{" "}
                            {formatScore(book.starRating)} avg
                          </span>
                          <span>{formatCount(book.ratingCount)} ratings</span>
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
