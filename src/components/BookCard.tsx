import type { ReactNode } from "react";

export function formatScore(value: number) {
  return `${Math.round(Math.max(0, Math.min(100, (value / 5) * 100)))}%`;
}

export type BookCardProps = {
  itemId?: number;
  rank?: number;
  title: string;
  authors: string[];
  score: number;
  /** Extra CSS classes on the root <article> */
  className?: string;
  /** Animation delay for stagger entrance */
  animationDelay?: string;
  /** Rank badge colour variant: "rank-gold" | "rank-silver" | "rank-bronze" | "" */
  rankClass?: string;
  /** Override the score display (e.g. "✓" for already-added recs) */
  scoreOverride?: ReactNode;
  /** Reading progress bar — only shown when provided */
  progressBar?: ReactNode;
  /** Inline control row shown under the author line */
  subMeta?: ReactNode;
  /** Star rating row (my-rating) — only shown when provided */
  stars?: ReactNode;
  /** Action buttons (edit / remove) — only shown when provided */
  actions?: ReactNode;
};

export function BookCard({
  itemId,
  rank,
  title,
  authors,
  score,
  className,
  animationDelay,
  rankClass = "",
  scoreOverride,
  progressBar,
  subMeta,
  stars,
  actions,
}: BookCardProps) {
  const cardStyle = animationDelay ? { animationDelay } : undefined;

  return (
    <article
      className={`ranking-row${className ? ` ${className}` : ""}`}
      data-book-id={itemId}
      style={cardStyle}
    >
      <div className="ranking-body">
        <div className={`ranking-topline${rank != null ? " has-rank" : ""}`}>
          {rank != null ? (
            <div className={`rank-badge${rankClass ? ` ${rankClass}` : ""}`}>
              #{rank}
            </div>
          ) : null}
          <div className="ranking-info">
            <h3>{title}</h3>
            <p className="ranking-author">
              {authors.join(", ") || "Unknown author"}
            </p>
          </div>
          <strong className="score-value">
            {scoreOverride ?? formatScore(score)}
          </strong>
          {progressBar ? (
            <div
              className={`ranking-progress-row${rank != null ? " has-rank" : ""}`}
            >
              {progressBar}
            </div>
          ) : null}
          {stars || subMeta ? (
            <div className={`ranking-detail-row${rank != null ? " has-rank" : ""}`}>
              {stars}
              {subMeta}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="ranking-meta">
            <span className="ranking-actions">{actions}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}
