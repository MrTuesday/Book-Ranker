import { BookCard } from "./BookCard";
import {
  BookActionIcon,
  ProgressBar,
  StarRating,
} from "./LibraryControls";
import type { RankedBook } from "../lib/ranking";
import type { AuthorCredentialMap } from "../lib/books-api";

type BookListSectionProps = {
  title: string;
  totalCount: number;
  books: RankedBook[];
  authorCredentials?: AuthorCredentialMap;
  isLoading?: boolean;
  emptyMessage: string;
  emptyFilteredMessage: string;
  readMode?: boolean;
  pendingDeleteId: number | null;
  editingBookId: number | null;
  highlightedBookId: number | null;
  isSaving: boolean;
  canSubmit: boolean;
  onToggleCardEditing: (book: RankedBook) => void;
  onToggleEditing: (book: RankedBook) => void;
  onProgressChange: (bookId: number, progress: number | undefined) => void;
  onRatingChange: (bookId: number, level: number) => void;
  onRemove: (bookId: number) => void;
  onToggleRead: (bookId: number, read: boolean) => void;
};

function buildRankClass(rank: number) {
  if (rank === 2) {
    return "rank-silver";
  }

  if (rank === 3) {
    return "rank-bronze";
  }

  return "";
}

export function BookListSection({
  title,
  totalCount,
  books,
  authorCredentials,
  isLoading = false,
  emptyMessage,
  emptyFilteredMessage,
  readMode = false,
  pendingDeleteId,
  editingBookId,
  highlightedBookId,
  isSaving,
  canSubmit,
  onToggleCardEditing,
  onToggleEditing,
  onProgressChange,
  onRatingChange,
  onRemove,
  onToggleRead,
}: BookListSectionProps) {
  return (
    <section className={`board${readMode ? " archive-list" : ""}`}>
      <header className="list-header">
        <h2>{title}</h2>
      </header>
      <div className="ranking-list">
        {isLoading ? (
          <div className="empty-state">Loading your rankings...</div>
        ) : totalCount === 0 ? (
          <div className="empty-state">{emptyMessage}</div>
        ) : books.length === 0 ? (
          <div className="empty-state">{emptyFilteredMessage}</div>
        ) : (
          books.map((book) => {
            const isDeleting = pendingDeleteId === book.id;
            const isEditingBook = editingBookId === book.id;
            const editActionDisabled =
              isSaving || isDeleting || (isEditingBook && !canSubmit);

            return (
              <BookCard
                key={book.id}
                itemId={book.id}
                rank={book.rank}
                title={book.title}
                series={book.series}
                seriesNumber={book.seriesNumber}
                authors={book.authors}
                authorCredentials={authorCredentials}
                score={book.score}
                scoreOverride={readMode ? book.archiveLabel ?? "Not yet" : undefined}
                rankClass={buildRankClass(book.rank)}
                className={[
                  readMode ? "is-read" : "",
                  isEditingBook ? "is-editing" : "",
                  highlightedBookId === book.id ? "is-recently-added" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                isActive={isEditingBook}
                onToggle={() => onToggleCardEditing(book)}
                progressBar={
                  <ProgressBar
                    value={book.progress ?? 0}
                    onChange={(pct) =>
                      onProgressChange(book.id, pct === 0 ? undefined : pct)
                    }
                  />
                }
                stars={
                  <StarRating
                    value={book.myRating}
                    onChange={(level) => onRatingChange(book.id, level)}
                  />
                }
                actions={
                  <>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      onClick={() => onRemove(book.id)}
                      disabled={isSaving || isDeleting}
                      aria-label="Remove"
                      title="Remove"
                    >
                      {"\u2715"}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onToggleEditing(book)}
                      disabled={editActionDisabled}
                      aria-label={isEditingBook ? "Save changes" : "Edit"}
                      title={isEditingBook ? "Save changes" : "Edit"}
                    >
                      {isEditingBook ? "\u2713" : "\u270E"}
                    </button>
                    <button
                      type="button"
                      className={`icon-btn book-state-btn ${readMode ? "is-closed-default" : "is-open-default"}`}
                      onClick={() => onToggleRead(book.id, !readMode)}
                      disabled={isSaving || isDeleting}
                      aria-label={readMode ? "Reread this book" : "Mark as read"}
                      title={readMode ? "Reread this book" : "Mark as read"}
                    >
                      <BookActionIcon />
                    </button>
                  </>
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}
