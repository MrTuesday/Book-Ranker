import { type FormEvent, useEffect, useMemo, useState } from "react";
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

  function resetDraft() {
    setDraft(createDraft());
    setEditingBookId(null);
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
          <h1>Rank books with less noise.</h1>
          <p className="hero-text">
            Compare books with a score that looks at each book's rating and how
            many people rated it, so a handful of glowing reviews doesn't crowd
            out proven favorites.
          </p>
        </div>
      </section>

      <section className="panel control-panel">
        <div className="section-heading section-heading-wide">
          <div>
            <p className="section-label">Inputs</p>
            <h2>{isEditing ? "Edit book" : "Add a book"}</h2>
          </div>

          <div className="summary-strip">
            <article className="summary-tile">
              <span className="summary-label">Books</span>
              <strong>{rankedCount}</strong>
            </article>

            <article className="summary-tile">
              <span className="summary-label">Average</span>
              <strong>
                {averageScore === null ? "--" : formatScore(averageScore)}
              </strong>
            </article>

            <article className="summary-tile summary-tile-wide">
              <span className="summary-label">Leader</span>
              <strong>
                {leader
                  ? leader.title
                  : isLoading
                    ? "Loading..."
                    : "No books yet"}
              </strong>
            </article>
          </div>
        </div>

        {isLoading || errorMessage ? (
          <div className="panel-status-row">
            {isLoading ? (
              <p className="panel-status">Loading books from this browser...</p>
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
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </label>

          <label className="field entry-author">
            <span>Author</span>
            <input
              type="text"
              value={draft.author}
              onChange={(event) => updateDraft("author", event.target.value)}
            />
          </label>

          <label className="field entry-rating">
            <span>Star rating</span>
            <input
              type="number"
              step="0.01"
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
            <div className="empty-state">Loading books...</div>
          ) : rankedBooks.length === 0 ? (
            <div className="empty-state">
              Add a valid title, rating, and vote count to generate rankings.
            </div>
          ) : (
            rankedBooks.map((book) => {
              const scoreFill = clampPercentage((book.score / 5) * 100);
              const isDeleting = pendingDeleteId === book.id;

              return (
                <article
                  key={book.id}
                  className={`ranking-row${editingBookId === book.id ? " is-editing" : ""}`}
                >
                  <div className="rank-badge">#{book.rank}</div>

                  <div className="ranking-body">
                    <div className="ranking-topline">
                      <div>
                        <h3>{book.title}</h3>
                        <p className="book-byline">
                          {book.author || "Author unknown"}
                        </p>
                      </div>

                      <div className="ranking-actions">
                        <div className="score-block score-block-inline">
                          <span className="score-label">Bayesian score</span>
                          <strong className="score-value">
                            {formatScore(book.score)}
                          </strong>
                        </div>

                        <div className="action-group">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => startEditing(book)}
                            disabled={isSaving || isDeleting}
                          >
                            {editingBookId === book.id ? "Editing" : "Edit"}
                          </button>

                          <button
                            type="button"
                            className="btn btn-tertiary"
                            onClick={() => void removeBook(book.id)}
                            disabled={isSaving || isDeleting}
                          >
                            {isDeleting ? "Removing..." : "Remove"}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="meta-row">
                      <span>{formatScore(book.starRating)} average rating</span>
                      <span>{formatCount(book.ratingCount)} ratings</span>
                    </div>

                    <div className="score-meter" aria-hidden="true">
                      <span style={{ width: `${scoreFill}%` }} />
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
