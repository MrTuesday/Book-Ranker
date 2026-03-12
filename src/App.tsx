import { useMemo, useState } from "react";

type EditableBook = {
  id: number;
  title: string;
  author: string;
  rating: string;
  ratingsCount: string;
};

type RankedBook = EditableBook & {
  rank: number;
  numericRating: number;
  numericRatingsCount: number;
  score: number;
};

const initialBooks: EditableBook[] = [
  { id: 1, title: "True Age", author: "Morgan Levine", rating: "3.70", ratingsCount: "125" },
  { id: 2, title: "Super Agers", author: "Eric Topol", rating: "3.48", ratingsCount: "1564" },
  { id: 3, title: "Ageless", author: "Andrew Steele", rating: "3.83", ratingsCount: "1470" },
  { id: 4, title: "Why We Die", author: "Venki Ramakrishnan", rating: "4.04", ratingsCount: "2512" }
];

function round(value: number, digits = 3) {
  return value.toFixed(digits);
}

function computeWeightedScore(rating: number, ratingsCount: number, baseline: number, priorWeight: number) {
  return (ratingsCount / (ratingsCount + priorWeight)) * rating + (priorWeight / (ratingsCount + priorWeight)) * baseline;
}

function createEmptyBook() {
  return {
    id: Date.now(),
    title: "",
    author: "",
    rating: "",
    ratingsCount: ""
  };
}

export default function App() {
  const [baseline, setBaseline] = useState("3.90");
  const [priorWeight, setPriorWeight] = useState("500");
  const [books, setBooks] = useState<EditableBook[]>(initialBooks);
  const [copyLabel, setCopyLabel] = useState("Copy rankings");

  const rankedBooks = useMemo<RankedBook[]>(() => {
    const numericBaseline = Number(baseline);
    const numericPriorWeight = Number(priorWeight);

    if (!Number.isFinite(numericBaseline) || !Number.isFinite(numericPriorWeight) || numericPriorWeight <= 0) {
      return [];
    }

    return books
      .map((book) => {
        const numericRating = Number(book.rating);
        const numericRatingsCount = Number(book.ratingsCount);

        if (!book.title.trim() || !Number.isFinite(numericRating) || !Number.isFinite(numericRatingsCount) || numericRatingsCount < 0) {
          return null;
        }

        const score = computeWeightedScore(numericRating, numericRatingsCount, numericBaseline, numericPriorWeight);

        return {
          ...book,
          numericRating,
          numericRatingsCount,
          score,
          rank: 0
        };
      })
      .filter((book): book is RankedBook => book !== null)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (right.numericRating !== left.numericRating) {
          return right.numericRating - left.numericRating;
        }

        return right.numericRatingsCount - left.numericRatingsCount;
      })
      .map((book, index) => ({ ...book, rank: index + 1 }));
  }, [baseline, books, priorWeight]);

  function updateBook(id: number, field: keyof Omit<EditableBook, "id">, value: string) {
    setBooks((current) => current.map((book) => (book.id === id ? { ...book, [field]: value } : book)));
  }

  function addBook() {
    setBooks((current) => [...current, createEmptyBook()]);
  }

  function removeBook(id: number) {
    setBooks((current) => current.filter((book) => book.id !== id));
  }

  function clearAll() {
    setBooks([createEmptyBook()]);
  }

  async function copyRankedTable() {
    const lines = [
      "Rank\tTitle\tAuthor\tGoodreads Rating\tRatings Count\tWeighted Score",
      ...rankedBooks.map((book) =>
        [
          book.rank,
          book.title,
          book.author || "Unknown author",
          round(book.numericRating, 2),
          book.numericRatingsCount,
          round(book.score)
        ].join("\t")
      )
    ];

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy rankings"), 1500);
    } catch (error) {
      console.error("Clipboard copy failed", error);
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy rankings"), 1500);
    }
  }

  return (
    <div className="page-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <main className="app-frame">
        <section className="hero">
          <div>
            <p className="eyebrow">Bayesian Goodreads ranking</p>
            <h1>Book Ranker</h1>
            <p className="hero-copy">
              Compare Goodreads titles with a weighted score so a tiny sample does not outrank a stronger, broader signal.
            </p>
          </div>
          <div className="formula-card">
            <span>Formula</span>
            <strong>score = (v / (v + m)) * R + (m / (v + m)) * C</strong>
          </div>
        </section>

        <section className="workspace">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Inputs</p>
                <h2>Books and priors</h2>
              </div>
              <button className="button button-secondary" type="button" onClick={addBook}>
                Add book
              </button>
            </div>

            <div className="controls-grid">
              <label className="field">
                <span>Baseline mean (C)</span>
                <input type="number" step="0.01" value={baseline} onChange={(event) => setBaseline(event.target.value)} />
                <small>Use a market-wide average such as 3.90.</small>
              </label>

              <label className="field">
                <span>Prior weight (m)</span>
                <input
                  type="number"
                  step="1"
                  value={priorWeight}
                  onChange={(event) => setPriorWeight(event.target.value)}
                />
                <small>Higher values punish low-count books more aggressively.</small>
              </label>

              <div className="action-row">
                <button className="button" type="button" onClick={copyRankedTable}>
                  {copyLabel}
                </button>
                <button className="button button-ghost" type="button" onClick={clearAll}>
                  Clear
                </button>
              </div>
            </div>

            <div className="book-list">
              {books.map((book, index) => (
                <article className="book-card" key={book.id}>
                  <label className="field">
                    <span>Title</span>
                    <input
                      type="text"
                      value={book.title}
                      placeholder={`Book ${index + 1}`}
                      onChange={(event) => updateBook(book.id, "title", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Author</span>
                    <input
                      type="text"
                      value={book.author}
                      placeholder="Author"
                      onChange={(event) => updateBook(book.id, "author", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Rating</span>
                    <input
                      type="number"
                      step="0.01"
                      value={book.rating}
                      placeholder="3.95"
                      onChange={(event) => updateBook(book.id, "rating", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Ratings count</span>
                    <input
                      type="number"
                      step="1"
                      value={book.ratingsCount}
                      placeholder="2500"
                      onChange={(event) => updateBook(book.id, "ratingsCount", event.target.value)}
                    />
                  </label>

                  <button className="icon-button" type="button" onClick={() => removeBook(book.id)} aria-label={`Remove ${book.title || `book ${index + 1}`}`}>
                    Remove
                  </button>
                </article>
              ))}
            </div>
          </div>

          <aside className="panel ranking-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Output</p>
                <h2>Rankings</h2>
              </div>
            </div>

            {rankedBooks.length === 0 ? (
              <div className="empty-state">Add at least one complete book entry with a title, rating, and ratings count.</div>
            ) : (
              <div className="ranking-list">
                {rankedBooks.map((book) => (
                  <article className="ranking-card" key={book.id}>
                    <div className="ranking-topline">
                      <div>
                        <p className="rank-tag">Rank {book.rank}</p>
                        <h3>{book.title}</h3>
                        <p className="author-line">{book.author || "Unknown author"}</p>
                      </div>
                      <div className="score-block">
                        <span>Weighted score</span>
                        <strong>{round(book.score)}</strong>
                      </div>
                    </div>

                    <div className="metric-grid">
                      <div className="metric">
                        <span>Goodreads rating</span>
                        <strong>{round(book.numericRating, 2)}</strong>
                      </div>
                      <div className="metric">
                        <span>Ratings count</span>
                        <strong>{book.numericRatingsCount.toLocaleString()}</strong>
                      </div>
                      <div className="metric">
                        <span>Adjustment</span>
                        <strong>{round(book.score - book.numericRating)}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}
