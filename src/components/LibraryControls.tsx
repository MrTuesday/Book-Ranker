export const MAX_READ_COUNT = 5;

type ProgressBarProps = {
  value: number;
  onChange: (pct: number) => void;
};

export function ProgressBar({ value, onChange }: ProgressBarProps) {
  return (
    <div
      className="reading-progress"
      role="slider"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      tabIndex={0}
      onClick={(event) => {
        const track = event.currentTarget.querySelector(".reading-progress-track");

        if (!track) {
          return;
        }

        const rect = track.getBoundingClientRect();
        const raw = Math.max(
          0,
          Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
        );
        const pct =
          raw >= 95 ? 100 : raw <= 5 ? 0 : Math.round(raw / 10) * 10;

        onChange(pct);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onChange(Math.min(100, value + 10));
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(Math.max(0, value - 10));
        }
      }}
    >
      <div className="reading-progress-track">
        <div
          className="reading-progress-fill"
          style={{ width: `${value}%` }}
        />
      </div>
      {value > 0 ? (
        <span className="reading-progress-label">{value}%</span>
      ) : null}
    </div>
  );
}

type RatingButtonsProps = {
  value: number | null;
  onChange: (level: number | null) => void;
  className?: string;
};

export function RatingButtons({
  value,
  onChange,
  className,
}: RatingButtonsProps) {
  return (
    <div className={`rating-buttons${className ? ` ${className}` : ""}`}>
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          key={level}
          type="button"
          className={`rating-btn${level === value ? " is-active" : ""}`}
          onClick={() => onChange(level === value ? null : level)}
        >
          {level}
        </button>
      ))}
    </div>
  );
}

type ReadCountStepperProps = {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
};

export function ReadCountStepper({
  value,
  onIncrement,
  onDecrement,
  disabled = false,
}: ReadCountStepperProps) {
  const isAtMax = value >= MAX_READ_COUNT;
  const displayValue = isAtMax ? `${MAX_READ_COUNT} ≤` : String(value);
  const countLabel =
    isAtMax
      ? `Read ${MAX_READ_COUNT} or more times`
      : value === 1
        ? "Read 1 time"
        : `Read ${value} times`;

  return (
    <div className="read-count-stepper" role="group" aria-label="Read count">
      <button
        type="button"
        className="icon-btn read-count-stepper-btn"
        onClick={onDecrement}
        disabled={disabled || value === 0}
        aria-label={
          value === 0 ? "Read count is already 0" : `Decrease read count from ${value}`
        }
        title="Decrease read count"
      >
        -
      </button>
      <span
        className={`read-count-value${value > 0 ? " has-reads" : ""}`}
        aria-label={countLabel}
        title={countLabel}
      >
        {displayValue}
      </span>
      <button
        type="button"
        className="icon-btn read-count-stepper-btn"
        onClick={onIncrement}
        disabled={disabled || isAtMax}
        aria-label={
          isAtMax
            ? `Read count is already ${MAX_READ_COUNT} or more`
            : value === 1
              ? "Increase read count from 1"
              : `Increase read count from ${value}`
        }
        title="Increase read count"
      >
        +
      </button>
    </div>
  );
}

type StarRatingProps = {
  value: number | null | undefined;
  onChange: (level: number) => void;
};

export function StarRating({ value, onChange }: StarRatingProps) {
  return (
    <span className="my-rating-stars">
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          key={level}
          type="button"
          className={`my-rating-star${value != null && level <= value ? " is-filled" : ""}`}
          onClick={() => onChange(level)}
          aria-label={`Rate ${level} out of 5`}
        >
          {value != null && level <= value ? "\u2605" : "\u2606"}
        </button>
      ))}
    </span>
  );
}

export function BookActionIcon() {
  return (
    <svg
      className="book-state-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <g className="book-icon-open">
        <path
          d="M8 4.35C6.65 3.55 5 3.15 3.3 3.15v8.3c1.7 0 3.35.4 4.7 1.2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 4.35C9.35 3.55 11 3.15 12.7 3.15v8.3c-1.7 0-3.35.4-4.7 1.2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 4.35v8.3"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M4.35 5.55h2.1M4.35 7h2.1M9.55 5.55h2.1M9.55 7h2.1"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.34"
        />
      </g>
      <g className="book-icon-closed">
        <path
          d="M4.1 3.2h6.15a1.35 1.35 0 0 1 1.35 1.35v8.15H5.45A1.35 1.35 0 0 0 4.1 14.05z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4.1 3.2v10.85"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M5.55 5.15h4.35M5.55 6.7h4.35M5.55 8.25h3.55"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.34"
        />
      </g>
    </svg>
  );
}

export function ArchiveShelfIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2 2.3h1.9v9H2zM5.2 1.4h1.9v9.9H5.2zM8.4 3.1h1.9v8.2H8.4zM11.6 2.6h1.9v8.7h-1.9zM1.4 13.1h13.2v1.5H1.4z" />
    </svg>
  );
}
