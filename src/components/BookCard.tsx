import type { ReactNode } from "react";

export function formatScore(value: number) {
  return `${Math.round(Math.max(0, Math.min(100, (value / 5) * 100)))}%`;
}

export type BookCardProps = {
  rank: number;
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
  /** Star rating row (my-rating) — only shown when provided */
  stars?: ReactNode;
  /** Action buttons (edit / remove) — only shown when provided */
  actions?: ReactNode;
};

export function BookCard({
  rank,
  title,
  authors,
  score,
  className,
  animationDelay,
  rankClass = "",
  scoreOverride,
  stars,
  actions,
}: BookCardProps) {
  return (
    <article
      className={`ranking-row${className ? ` ${className}` : ""}`}
      style={animationDelay ? { animationDelay } : undefined}
    >
      <div className="ranking-body">
        <div className="ranking-topline">
          <div className={`rank-badge${rankClass ? ` ${rankClass}` : ""}`}>
            #{rank}
          </div>
          <div className="ranking-info">
            <h3>{title}</h3>
            <p className="ranking-author">
              {authors.join(", ") || "Unknown author"}
            </p>
            {stars}
          </div>
          <strong className="score-value">
            {scoreOverride ?? formatScore(score)}
          </strong>
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
