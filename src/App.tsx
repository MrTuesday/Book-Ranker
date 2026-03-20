import {
  memo,
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  createBookRecord,
  deleteAuthorExperience,
  deleteBookRecord,
  deleteGenreInterest,
  fetchBooks,
  fetchLibraryState,
  type Book,
  type GenreInterestMap,
  type AuthorExperienceMap,
  updateBookRecord,
  writeGenreInterest,
  writeAuthorExperience,
  renameGenreInBooks,
  renameGenreInterest,
  renameAuthorInBooks,
} from "./lib/books-api";
import {
  archiveReadinessFromScores,
  buildTagSmoothingFactorMap,
  capArchiveScore,
  GLOBAL_MEAN,
  learnSignalWeights,
  SMOOTHING_FACTOR,
  bayesianScore,
  averageTagPreference,
  realizeArchiveScore,
  scoreBook,
} from "./lib/scoring";
import {
  requestPathRecommendation,
  type PathRecommendationResponse,
} from "./lib/recommend-api";
import { BookCard } from "./components/BookCard";

type BookDraft = {
  title: string;
  readCount: number;
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
  progress: string;
  myRating: number | null;
  lastReadYear: string;
  markAsRead: boolean;
};

type RankedBook = Book & {
  score: number;
  rank: number;
  archiveLabel?: string;
};

type SuggestionField = "author" | "genre";
type DraftTagDrag = {
  field: SuggestionField;
  tag: string;
};
type DraftTextField =
  | "title"
  | "starRating"
  | "ratingCount"
  | "authorInput"
  | "authorExperience"
  | "genreInput"
  | "genreInterest"
  | "progress";

const MAX_SUGGESTIONS = 6;
const MIN_YEAR_OPTION = 1900;

function createDraft(): BookDraft {
  return {
    title: "",
    readCount: 0,
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
    progress: "",
    myRating: null,
    lastReadYear: "",
    markAsRead: false,
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





function messageFromError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong while saving your library.";
}

function shortenLabel(value: string, maxLength = 18) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function hashTag(value: string) {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function normalizedGenreSignature(book: Book) {
  return uniqueTags(book.genres).sort((left, right) => left.localeCompare(right));
}

function sameGraphBooks(left: Book[], right: Book[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightById = new Map(right.map((book) => [book.id, book] as const));

  for (const leftBook of left) {
    const rightBook = rightById.get(leftBook.id);

    if (!rightBook) {
      return false;
    }

    const leftGenres = normalizedGenreSignature(leftBook);
    const rightGenres = normalizedGenreSignature(rightBook);

    if (!sameStringList(leftGenres, rightGenres)) {
      return false;
    }
  }

  return true;
}

function sameInterestMap(
  left: GenreInterestMap,
  right: GenreInterestMap,
) {
  const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));

  if (!sameStringList(leftKeys, rightKeys)) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

function matchesSelectedGenres(
  genres: string[],
  selectedGenres: string[],
) {
  if (selectedGenres.length === 0) {
    return true;
  }

  const genreSet = new Set(uniqueTags(genres));
  return selectedGenres.every((genre) => genreSet.has(genre));
}

function ProgressBar({
  value,
  onChange,
}: {
  value: number;
  onChange: (pct: number) => void;
}) {
  return (
    <div
      className="reading-progress"
      role="slider"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      tabIndex={0}
      onClick={(e) => {
        const track = e.currentTarget.querySelector(".reading-progress-track");
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const raw = Math.max(
          0,
          Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
        );
        const pct =
          raw >= 95 ? 100 : raw <= 5 ? 0 : Math.round(raw / 10) * 10;
        onChange(pct);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(Math.min(100, value + 10));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
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
      {value > 0 && (
        <span className="reading-progress-label">{value}%</span>
      )}
    </div>
  );
}

function RatingButtons({
  value,
  onChange,
  className,
}: {
  value: number | null;
  onChange: (level: number | null) => void;
  className?: string;
}) {
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

function ReadCountStepper({
  value,
  onIncrement,
  onDecrement,
  disabled = false,
}: {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
}) {
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
        aria-label={value === 1 ? "Read 1 time" : `Read ${value} times`}
        title={value === 1 ? "Read 1 time" : `Read ${value} times`}
      >
        {value}
      </span>
      <button
        type="button"
        className="icon-btn read-count-stepper-btn"
        onClick={onIncrement}
        disabled={disabled}
        aria-label={
          value === 1 ? "Increase read count from 1" : `Increase read count from ${value}`
        }
        title="Increase read count"
      >
        +
      </button>
    </div>
  );
}

function BookActionIcon() {
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

function ArchiveShelfIcon({ className }: { className?: string }) {
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

type InterestMapProps = {
  books: Book[];
  interests: GenreInterestMap;
  compact?: boolean;
  selectedPath?: string[];
  onSelectTag?: (tag: string) => void;
  editMode?: boolean;
  onEditingNodeChange?: (node: { tag: string; screenX: number; screenY: number } | null) => void;
};

function InterestMapView({
  books,
  interests,
  compact = false,
  selectedPath = [],
  onSelectTag,
  editMode = false,
  onEditingNodeChange,
}: InterestMapProps) {
  const data = useMemo(() => {
    const tagCounts = new Map<string, number>();
    const pairCounts = new Map<string, number>();

    for (const book of books) {
      const tags = uniqueTags(book.genres);

      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }

      for (let index = 0; index < tags.length; index += 1) {
        for (
          let pairIndex = index + 1;
          pairIndex < tags.length;
          pairIndex += 1
        ) {
          const [left, right] = [tags[index], tags[pairIndex]].sort((a, b) =>
            a.localeCompare(b),
          );
          const key = `${left}\u0000${right}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }

    // Default genre nodes shown when user has no books yet
    const defaultGenres = [
      "Science Fiction", "Fantasy", "Literary Fiction", "Mystery",
      "Historical Fiction", "Romance", "Thriller", "Horror",
      "Non-Fiction", "Philosophy", "Biography", "Self-Help",
    ];

    if (tagCounts.size === 0) {
      for (const genre of defaultGenres) {
        tagCounts.set(genre, 0);
      }
    }

    // Include genres from interest map that aren't on any book yet
    for (const genre of Object.keys(interests)) {
      if (!tagCounts.has(genre)) {
        tagCounts.set(genre, 0);
      }
    }

    const nodes = Array.from(tagCounts.entries())
      .sort(
        ([leftTag, leftCount], [rightTag, rightCount]) =>
          rightCount - leftCount ||
          (interests[rightTag] ?? 3) - (interests[leftTag] ?? 3) ||
          leftTag.localeCompare(rightTag),
      )
      .map(([tag, count]) => ({
        tag,
        count,
        interest: interests[tag] ?? 3,
      }));

    const selectedTags = new Set(nodes.map((node) => node.tag));
    const links = Array.from(pairCounts.entries())
      .map(([key, count]) => {
        const [source, target] = key.split("\u0000");
        return { source, target, count };
      })
      .filter(
        ({ source, target }) =>
          selectedTags.has(source) && selectedTags.has(target),
      )
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.source.localeCompare(right.source) ||
          left.target.localeCompare(right.target),
      );

    return { nodes, links };
  }, [books, interests]);

  const initialLayout = useMemo(() => {
    if (data.nodes.length === 0) {
      return null;
    }

    const degreeMap = new Map<string, number>();

    for (const node of data.nodes) {
      degreeMap.set(node.tag, 0);
    }

    for (const link of data.links) {
      degreeMap.set(
        link.source,
        (degreeMap.get(link.source) ?? 0) + link.count,
      );
      degreeMap.set(
        link.target,
        (degreeMap.get(link.target) ?? 0) + link.count,
      );
    }

    const connectedNodes = [...data.nodes]
      .filter((node) => (degreeMap.get(node.tag) ?? 0) > 0)
      .sort(
        (left, right) =>
          (degreeMap.get(right.tag) ?? 0) - (degreeMap.get(left.tag) ?? 0) ||
          right.count - left.count ||
          right.interest - left.interest ||
          left.tag.localeCompare(right.tag),
      );
    const isolatedNodes = [...data.nodes]
      .filter((node) => (degreeMap.get(node.tag) ?? 0) === 0)
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.interest - left.interest ||
          left.tag.localeCompare(right.tag),
      );
    const rankedNodes = [...connectedNodes, ...isolatedNodes];
    const ringCapacities = [5, 8, 10, 12, 14];
    const ringSizes: number[] = [];
    let remainingNodes = Math.max(0, rankedNodes.length - 1);
    let ringIndex = 0;

    while (remainingNodes > 0) {
      const capacity =
        ringCapacities[ringIndex] ??
        ringCapacities[ringCapacities.length - 1] +
          (ringIndex - ringCapacities.length + 1) * 2;
      const nextRingSize = Math.min(capacity, remainingNodes);
      ringSizes.push(nextRingSize);
      remainingNodes -= nextRingSize;
      ringIndex += 1;
    }

    const width = 1200;
    const height = Math.max(750, 600 + ringSizes.length * 40);
    const padding = 80;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxNodeCount = Math.max(...data.nodes.map((node) => node.count), 1);
    const maxLinkCount = Math.max(...data.links.map((link) => link.count), 1);

    const positionedNodes = rankedNodes.map((node, index) => {
      const seed = hashTag(node.tag);
      const radius = 6 + (node.count / maxNodeCount) * 6;
      let x = centerX;
      let y = centerY;

      if (index > 0) {
        let ringNumber = 0;
        let slotIndex = index - 1;

        while (slotIndex >= (ringSizes[ringNumber] ?? 0)) {
          slotIndex -= ringSizes[ringNumber] ?? 0;
          ringNumber += 1;
        }

        const ringTotal = Math.max(ringSizes[ringNumber] ?? 1, 1);
        const ringRadius = 200 + ringNumber * 100 + ((seed >> 10) % 16);
        const angleOffset = ((seed >> 5) % 21) / 21;
        const angle =
          -Math.PI / 2 +
          ((slotIndex + angleOffset * 0.22) / ringTotal) * Math.PI * 2;

        x = centerX + Math.cos(angle) * ringRadius;
        y = centerY + Math.sin(angle) * ringRadius * 0.55;
      }

      return {
        ...node,
        degree: degreeMap.get(node.tag) ?? 0,
        x,
        y,
        vx: 0,
        vy: 0,
        radius,
      };
    });

    if (positionedNodes.length > 1) {
      const nodeIndex = new Map(
        positionedNodes.map((node, index) => [node.tag, index] as const),
      );

      for (let iteration = 0; iteration < 220; iteration += 1) {
        const forceX = new Array(positionedNodes.length).fill(0);
        const forceY = new Array(positionedNodes.length).fill(0);
        const cooling = 1 - iteration / 220;

        for (
          let leftIndex = 0;
          leftIndex < positionedNodes.length;
          leftIndex += 1
        ) {
          for (
            let rightIndex = leftIndex + 1;
            rightIndex < positionedNodes.length;
            rightIndex += 1
          ) {
            const left = positionedNodes[leftIndex];
            const right = positionedNodes[rightIndex];
            let dx = right.x - left.x;
            let dy = right.y - left.y;
            let distance = Math.hypot(dx, dy);

            if (distance < 0.001) {
              dx = 0.01;
              dy = 0;
              distance = 0.01;
            }

            const minDistance = left.radius + right.radius + 60;
            const directionX = dx / distance;
            const directionY = dy / distance;
            const baseRepulsion = 30000 / (distance * distance);
            const overlapRepulsion =
              distance < minDistance ? (minDistance - distance) * 0.28 : 0;
            const push = baseRepulsion + overlapRepulsion;

            forceX[leftIndex] -= directionX * push;
            forceY[leftIndex] -= directionY * push;
            forceX[rightIndex] += directionX * push;
            forceY[rightIndex] += directionY * push;
          }
        }

        for (const link of data.links) {
          const sourceIndex = nodeIndex.get(link.source) ?? -1;
          const targetIndex = nodeIndex.get(link.target) ?? -1;

          if (sourceIndex === -1 || targetIndex === -1) {
            continue;
          }

          const source = positionedNodes[sourceIndex];
          const target = positionedNodes[targetIndex];
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const directionX = dx / distance;
          const directionY = dy / distance;
          const desiredDistance =
            280 -
            (link.count / maxLinkCount) * 50 -
            (source.radius + target.radius);
          const spring = (distance - desiredDistance) * 0.014;
          const pull = spring * (0.8 + link.count / maxLinkCount);

          forceX[sourceIndex] += directionX * pull;
          forceY[sourceIndex] += directionY * pull;
          forceX[targetIndex] -= directionX * pull;
          forceY[targetIndex] -= directionY * pull;
        }

        for (let index = 0; index < positionedNodes.length; index += 1) {
          const node = positionedNodes[index];
          const centerPull = node.degree > 0 ? 0.0034 : 0.0016;
          const edgeBias =
            node.degree > 0
              ? 0
              : ((hashTag(`${node.tag}:edge`) % 3) - 1) * 0.015;

          node.vx =
            (node.vx +
              forceX[index] +
              (centerX - node.x) * centerPull +
              edgeBias) *
            (0.8 - cooling * -0.03);
          node.vy =
            (node.vy +
              forceY[index] +
              (centerY - node.y) * centerPull +
              edgeBias * 0.6) *
            (0.8 - cooling * -0.03);
          node.x += node.vx;
          node.y += node.vy;

          const xPad = padding + node.radius + 80;
          const yPad = padding + node.radius + 40;
          node.x = Math.max(xPad, Math.min(width - xPad, node.x));
          node.y = Math.max(yPad, Math.min(height - yPad, node.y));
        }
      }
    } else {
      positionedNodes[0].x = centerX;
      positionedNodes[0].y = centerY;
    }

    const minX = Math.min(
      ...positionedNodes.map((node) => node.x - node.radius),
    );
    const maxX = Math.max(
      ...positionedNodes.map((node) => node.x + node.radius),
    );
    const minY = Math.min(
      ...positionedNodes.map((node) => node.y - node.radius),
    );
    const maxY = Math.max(
      ...positionedNodes.map((node) => node.y + node.radius),
    );
    const offsetX = centerX - (minX + maxX) / 2;
    const offsetY = centerY - (minY + maxY) / 2;

    for (const node of positionedNodes) {
      const xPad = padding + node.radius + 80;
      const yPad = padding + node.radius + 40;
      node.x = Math.max(xPad, Math.min(width - xPad, node.x + offsetX));
      node.y = Math.max(yPad, Math.min(height - yPad, node.y + offsetY));
    }

    for (const node of positionedNodes) {
      node.vx = 0;
      node.vy = 0;
    }

    const nodeIndexMap = new Map(
      positionedNodes.map((node, index) => [node.tag, index] as const),
    );

    return {
      width,
      height,
      padding,
      maxLinkCount,
      nodes: positionedNodes,
      nodeIndex: nodeIndexMap,
    };
  }, [data]);

  // Simulation state
  const simRef = useRef<
    Array<{
      tag: string;
      count: number;
      interest: number;
      degree: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
    }>
  >([]);
  const dragRef = useRef<{
    nodeIndex: number;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);
  const wasDraggedRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setTick] = useState(0);
  const setEditingNode = onEditingNodeChange ?? (() => {});

  // Close popover when leaving edit mode
  useEffect(() => {
    if (!editMode) {
      setEditingNode(null);
    }
  }, [editMode]);

  // Initialize simulation from layout
  useEffect(() => {
    if (!initialLayout) {
      simRef.current = [];
      return;
    }
    simRef.current = initialLayout.nodes.map((n) => ({ ...n }));
    setTick((t) => t + 1);
  }, [initialLayout]);

  // Animation loop (non-compact only)
  useEffect(() => {
    if (compact || !initialLayout || simRef.current.length === 0) {
      return;
    }

    const { width, height, padding, maxLinkCount, nodeIndex } = initialLayout;
    const centerX = width / 2;
    const centerY = height / 2;
    const links = data.links;
    let running = true;
    let time = 0;

    function step() {
      if (!running) {
        return;
      }

      const nodes = simRef.current;

      if (nodes.length === 0) {
        requestAnimationFrame(step);
        return;
      }

      time += 1;

      // Gentle sway — slow drift like tree branches
      for (let i = 0; i < nodes.length; i += 1) {
        const hash = hashTag(nodes[i].tag);
        const px =
          Math.sin(time * 0.003 + (hash & 0xff) * 0.04) * 0.008;
        const py =
          Math.cos(time * 0.004 + ((hash >> 8) & 0xff) * 0.04) * 0.006;
        nodes[i].vx += px;
        nodes[i].vy += py;

        // Very light centering — just prevents runaway drift
        const cp = 0.0004;
        nodes[i].vx += (centerX - nodes[i].x) * cp;
        nodes[i].vy += (centerY - nodes[i].y) * cp;
      }

      // Repulsion
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          let dx = nodes[j].x - nodes[i].x;
          let dy = nodes[j].y - nodes[i].y;
          let dist = Math.hypot(dx, dy);

          if (dist < 0.001) {
            dx = 0.01;
            dy = 0;
            dist = 0.01;
          }

          const minDist = nodes[i].radius + nodes[j].radius + 60;
          const ux = dx / dist;
          const uy = dy / dist;
          const repulsion = 1000 / (dist * dist);
          const overlap =
            dist < minDist ? (minDist - dist) * 0.06 : 0;
          const push = repulsion + overlap;

          nodes[i].vx -= ux * push;
          nodes[i].vy -= uy * push;
          nodes[j].vx += ux * push;
          nodes[j].vy += uy * push;
        }
      }

      // Spring attraction
      for (const link of links) {
        const si = nodeIndex.get(link.source) ?? -1;
        const ti = nodeIndex.get(link.target) ?? -1;

        if (si === -1 || ti === -1) {
          continue;
        }

        const dx = nodes[ti].x - nodes[si].x;
        const dy = nodes[ti].y - nodes[si].y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / dist;
        const uy = dy / dist;
        const desired =
          280 -
          (link.count / maxLinkCount) * 50 -
          (nodes[si].radius + nodes[ti].radius);
        const spring = (dist - desired) * 0.002;
        const pull = spring * (0.8 + link.count / maxLinkCount);

        nodes[si].vx += ux * pull;
        nodes[si].vy += uy * pull;
        nodes[ti].vx -= ux * pull;
        nodes[ti].vy -= uy * pull;
      }

      // Update positions — damping for smooth motion
      for (let i = 0; i < nodes.length; i += 1) {
        if (dragRef.current?.nodeIndex === i) {
          nodes[i].vx = 0;
          nodes[i].vy = 0;
          continue;
        }

        nodes[i].vx *= 0.92;
        nodes[i].vy *= 0.92;
        nodes[i].x += nodes[i].vx;
        nodes[i].y += nodes[i].vy;
        const xPad = padding + nodes[i].radius + 80; // extra for labels
        const yPad = padding + nodes[i].radius + 40; // extra for slice crop
        nodes[i].x = Math.max(xPad, Math.min(width - xPad, nodes[i].x));
        nodes[i].y = Math.max(yPad, Math.min(height - yPad, nodes[i].y));
      }

      setTick((t) => t + 1);
      requestAnimationFrame(step);
    }

    const frameId = requestAnimationFrame(step);
    return () => {
      running = false;
      cancelAnimationFrame(frameId);
    };
  }, [compact, initialLayout, data]);

  // Drag handlers
  function handleNodePointerDown(
    event: React.PointerEvent<SVGGElement>,
    nodeIdx: number,
  ) {
    if (compact || !svgRef.current) {
      return;
    }

    // Don't use setPointerCapture — it retargets pointerup/click to the
    // SVG element instead of the original node <g>, which prevents the
    // React onClick handler from firing on nodes.
    dragRef.current = {
      nodeIndex: nodeIdx,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };

    // Use document-level listeners so drag tracking works even when
    // the pointer leaves the SVG.
    function onDocMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || !svgRef.current) return;

      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;

      if (!drag.moved && Math.hypot(dx, dy) < 4) return;

      drag.moved = true;
      const ctm = svgRef.current.getScreenCTM();
      if (!ctm) return;

      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
        ctm.inverse(),
      );
      const node = simRef.current[drag.nodeIndex];
      if (node) {
        node.x = pt.x;
        node.y = pt.y;
        node.vx = 0;
        node.vy = 0;
      }
    }

    function onDocUp() {
      if (dragRef.current) {
        wasDraggedRef.current = dragRef.current.moved;
        dragRef.current = null;
      }
      document.removeEventListener("pointermove", onDocMove);
      document.removeEventListener("pointerup", onDocUp);
    }

    document.addEventListener("pointermove", onDocMove);
    document.addEventListener("pointerup", onDocUp);
  }

  function handleSvgClick(event: React.MouseEvent) {
    if (wasDraggedRef.current) {
      event.stopPropagation();
      wasDraggedRef.current = false;
    }
    if (editMode) {
      setEditingNode(null);
    }
  }

  if (!initialLayout) {
    return (
      <p className={`interest-map-empty${compact ? " is-compact" : ""}`}>
        Add genre and topic tags to see how your interests connect.
      </p>
    );
  }

  // Use animated positions when available, fall back to initial layout
  const currentNodes =
    !compact && simRef.current.length > 0
      ? simRef.current
      : initialLayout.nodes;
  const nodeMap = new Map(
    currentNodes.map((node) => [node.tag, node] as const),
  );

  // Compute labels from current positions
  const centerX = initialLayout.width / 2;
  const centerY = initialLayout.height / 2;
  const renderNodes = currentNodes.map((node, index) => {
    const dx = node.x - centerX;
    const dy = node.y - centerY;
    let labelX = node.x;
    let labelY = node.y + 4;
    let labelAnchor: "middle" | "start" | "end" = "middle";

    if (Math.abs(dx) > Math.abs(dy) + 18) {
      if (dx < 0) {
        labelX = node.x - node.radius - 10;
        labelAnchor = "end";
      } else {
        labelX = node.x + node.radius + 10;
        labelAnchor = "start";
      }
    } else {
      labelY = node.y + (dy < 0 ? -(node.radius + 10) : node.radius + 14);
    }

    return { ...node, index, labelX, labelY, labelAnchor };
  });

  const hasLinks = data.links.length > 0;
  const interestLabel =
    data.nodes.length === 1 ? "1 interest" : `${data.nodes.length} interests`;
  const connectionLabel =
    data.links.length === 1 ? "1 link" : `${data.links.length} links`;
  const selectedPathSet = new Set(selectedPath);
  const highlightedLinks = data.links.filter(
    (link) => selectedPathSet.has(link.source) && selectedPathSet.has(link.target),
  );
  const isSelectable = !compact && typeof onSelectTag === "function";

  function handleNodeKeyDown(
    event: ReactKeyboardEvent<SVGGElement>,
    tag: string,
  ) {
    if (!onSelectTag) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectTag(tag);
    }
  }

  function handleNodeClick(event: React.MouseEvent, tag: string) {
    event.stopPropagation();

    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }

    if (editMode) {
      // Convert SVG coordinates to screen coordinates for popover positioning
      const svg = svgRef.current;
      if (!svg) return;
      const node = simRef.current.find((n) => n.tag === tag);
      if (!node) return;
      const point = svg.createSVGPoint();
      point.x = node.x;
      point.y = node.y;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const screenPoint = point.matrixTransform(ctm);
      setEditingNode({
        tag,
        screenX: screenPoint.x,
        screenY: screenPoint.y,
      });
      return;
    }

    onSelectTag?.(tag);
  }

  return (
    <div className={`interest-map${compact ? " is-compact" : ""}`}>
      {!compact ? (
        <div className="interest-map-meta">
          <span>{interestLabel}</span>
          <span>{hasLinks ? connectionLabel : "No links yet"}</span>
        </div>
      ) : null}
      <div className="interest-map-plot">
        <svg
          ref={svgRef}
          className={`interest-map-chart${dragRef.current ? " is-dragging" : ""}`}
          preserveAspectRatio="xMidYMid slice"
          viewBox={`0 0 ${initialLayout.width} ${initialLayout.height}`}
          aria-label="Interest graph showing how genre and topic tags connect across your books"
          onClick={!compact ? handleSvgClick : undefined}
        >
          {data.links.map((link) => {
            const source = nodeMap.get(link.source);
            const target = nodeMap.get(link.target);

            if (!source || !target) {
              return null;
            }

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const unitX = dx / distance;
            const unitY = dy / distance;
            const startX = source.x + unitX * (source.radius + 1);
            const startY = source.y + unitY * (source.radius + 1);
            const endX = target.x - unitX * (target.radius + 1);
            const endY = target.y - unitY * (target.radius + 1);

            return (
              <g key={`${link.source}-${link.target}`}>
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  stroke="rgba(180, 83, 9, 0.22)"
                  strokeOpacity={
                    0.2 + (link.count / initialLayout.maxLinkCount) * 0.2
                  }
                  strokeWidth={
                    0.8 + (link.count / initialLayout.maxLinkCount) * 1.1
                  }
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {highlightedLinks.map((link) => {
            const source = nodeMap.get(link.source);
            const target = nodeMap.get(link.target);

            if (!source || !target) {
              return null;
            }

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const unitX = dx / distance;
            const unitY = dy / distance;
            const startX = source.x + unitX * (source.radius + 1);
            const startY = source.y + unitY * (source.radius + 1);
            const endX = target.x - unitX * (target.radius + 1);
            const endY = target.y - unitY * (target.radius + 1);

            return (
              <line
                key={`highlight:${link.source}:${link.target}`}
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke="rgba(180, 83, 9, 0.74)"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            );
          })}
          {/* Selection web: connect all selected path nodes */}
          {selectedPath.length >= 2 &&
            selectedPath.flatMap((a, i) =>
              selectedPath.slice(i + 1).map((b) => {
                const source = nodeMap.get(a);
                const target = nodeMap.get(b);
                if (!source || !target) return null;

                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const distance = Math.max(1, Math.hypot(dx, dy));
                const unitX = dx / distance;
                const unitY = dy / distance;
                const startX = source.x + unitX * (source.radius + 1);
                const startY = source.y + unitY * (source.radius + 1);
                const endX = target.x - unitX * (target.radius + 1);
                const endY = target.y - unitY * (target.radius + 1);

                return (
                  <line
                    key={`selection-web:${a}:${b}`}
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke="rgba(180, 83, 9, 0.6)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                );
              }),
            )}
          {renderNodes.map((node) => (
            <g
              key={node.tag}
              className={`interest-map-node${isSelectable ? " is-selectable" : ""}${selectedPathSet.has(node.tag) ? " is-selected" : ""}`}
              onClick={
                onSelectTag
                  ? (event: React.MouseEvent) => handleNodeClick(event, node.tag)
                  : undefined
              }
              onPointerDown={
                !compact
                  ? (event) => handleNodePointerDown(event, node.index)
                  : undefined
              }
              onKeyDown={
                onSelectTag
                  ? (event) => handleNodeKeyDown(event, node.tag)
                  : undefined
              }
            >
              <title>{`${node.tag}: ${node.count} book${node.count === 1 ? "" : "s"}, interest ${node.interest}/5`}</title>
              {selectedPathSet.has(node.tag) ? (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius + 5}
                  fill="rgba(180, 83, 9, 0.12)"
                  stroke="rgba(180, 83, 9, 0.7)"
                  strokeWidth="2"
                />
              ) : null}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill={selectedPathSet.has(node.tag) ? "rgba(180, 83, 9, 0.85)" : "rgba(180, 83, 9, 0.55)"}
                stroke="rgba(180, 83, 9, 0.3)"
                strokeWidth="1"
              />
              {node.count > 0 ? (
                <text
                  className="interest-map-score"
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.max(9, node.radius * 0.7)}
                  fill="white"
                  fontWeight="600"
                  pointerEvents="none"
                >
                  {node.interest}
                </text>
              ) : null}
              {!compact ? (
                <text
                  className="interest-map-label"
                  x={node.labelX}
                  y={node.labelY}
                  textAnchor={node.labelAnchor}
                >
                  {editMode ? `\u270E ${shortenLabel(node.tag)}` : shortenLabel(node.tag)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
      {!compact ? (
        <p className="interest-map-note">
          {hasLinks
            ? "Lines connect interests that appear together on the same book. Drag nodes to rearrange."
            : "Your current books do not connect any two interests yet."}
        </p>
      ) : null}
    </div>
  );
}

const InterestMap = memo(
  InterestMapView,
  (previousProps, nextProps) =>
    previousProps.compact === nextProps.compact &&
    previousProps.editMode === nextProps.editMode &&
    sameStringList(previousProps.selectedPath ?? [], nextProps.selectedPath ?? []) &&
    sameGraphBooks(previousProps.books, nextProps.books) &&
    sameInterestMap(previousProps.interests, nextProps.interests),
);

export default function App() {
  const currentYear = new Date().getFullYear();
  const [books, setBooks] = useState<Book[]>([]);
  const [draft, setDraft] = useState<BookDraft>(createDraft());
  const [editingBookId, setEditingBookId] = useState<number | null>(null);
  const [scrollToForm, setScrollToForm] = useState(false);
  const [highlightedBookId, setHighlightedBookId] = useState<number | null>(null);
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
  const [selectedInterestPath, setSelectedInterestPath] = useState<string[]>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [genreInterests, setGenreInterests] = useState<GenreInterestMap>({});
  const [authorExperiences, setAuthorExperiences] =
    useState<AuthorExperienceMap>({});
  const [recommendations, setRecommendations] =
    useState<PathRecommendationResponse | null>(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [listSize, setListSize] = useState(5);
  const [showArchive, setShowArchive] = useState(false);
  const [addedRecIds] = useState<Set<string>>(new Set());
  const [graphEditMode, setGraphEditMode] = useState(false);
  const [graphAddGenreInput, setGraphAddGenreInput] = useState("");
  const [graphAddGenreRating, setGraphAddGenreRating] = useState<number | null>(null);
  const [graphEditingNode, setGraphEditingNode] = useState<{ tag: string; screenX: number; screenY: number } | null>(null);
  const leftColumnRef = useRef<HTMLElement | null>(null);
  const entryFormRef = useRef<HTMLFormElement | null>(null);
  const pendingBookRectsRef = useRef<Map<number, DOMRect> | null>(null);
  const pendingBookRevealIdRef = useRef<number | null>(null);
  const highlightClearTimeoutRef = useRef<number | null>(null);

  const captureVisibleBookRects = useCallback(() => {
    const rects = new Map<number, DOMRect>();
    const cards = leftColumnRef.current?.querySelectorAll<HTMLElement>(
      ".ranking-row[data-book-id]",
    );

    cards?.forEach((card) => {
      const id = Number(card.dataset.bookId);

      if (Number.isFinite(id)) {
        rects.set(id, card.getBoundingClientRect());
      }
    });

    return rects;
  }, []);

  const applyBooksUpdate = useCallback(
    (nextBooks: Book[]) => {
      pendingBookRectsRef.current = captureVisibleBookRects();
      setBooks(nextBooks);
    },
    [captureVisibleBookRects],
  );

  const queueBookReveal = useCallback((bookId: number | null) => {
    if (bookId == null || !Number.isFinite(bookId)) {
      return;
    }

    pendingBookRevealIdRef.current = bookId;
    setHighlightedBookId(bookId);

    if (highlightClearTimeoutRef.current != null) {
      window.clearTimeout(highlightClearTimeoutRef.current);
    }

    highlightClearTimeoutRef.current = window.setTimeout(() => {
      setHighlightedBookId((current) => (current === bookId ? null : current));
      highlightClearTimeoutRef.current = null;
    }, 2400);
  }, []);

  useLayoutEffect(() => {
    const previousRects = pendingBookRectsRef.current;

    if (!previousRects || previousRects.size === 0) {
      pendingBookRectsRef.current = null;
      return;
    }

    pendingBookRectsRef.current = null;

    const cards = leftColumnRef.current?.querySelectorAll<HTMLElement>(
      ".ranking-row[data-book-id]",
    );

    if (!cards || cards.length === 0) {
      return;
    }

    const animatedCards: HTMLElement[] = [];

    cards.forEach((card) => {
      const id = Number(card.dataset.bookId);
      const previousRect = previousRects.get(id);

      if (!previousRect) {
        return;
      }

      const nextRect = card.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        return;
      }

      card.style.transition = "none";
      card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      card.style.willChange = "transform";
      animatedCards.push(card);
    });

    if (animatedCards.length === 0) {
      return;
    }

    void document.body.offsetHeight;

    const cleanup = () => {
      animatedCards.forEach((card) => {
        card.style.removeProperty("transition");
        card.style.removeProperty("transform");
        card.style.removeProperty("will-change");
      });
    };

    const frameId = window.requestAnimationFrame(() => {
      animatedCards.forEach((card) => {
        card.style.transition =
          "transform 720ms cubic-bezier(0.22, 1, 0.36, 1)";
        card.style.transform = "translate(0, 0)";
      });
    });

    const timeoutId = window.setTimeout(cleanup, 800);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      cleanup();
    };
  }, [books, showArchive]);

  useEffect(() => {
    const bookId = pendingBookRevealIdRef.current;

    if (bookId == null) {
      return;
    }

    const card = leftColumnRef.current?.querySelector<HTMLElement>(
      `.ranking-row[data-book-id="${bookId}"]`,
    );

    pendingBookRevealIdRef.current = null;

    if (!card) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      card.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [books, showArchive, selectedInterestPath]);

  useEffect(() => {
    return () => {
      if (highlightClearTimeoutRef.current != null) {
        window.clearTimeout(highlightClearTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadSavedBooks() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const savedLibrary = await fetchLibraryState();
        if (isActive) {
          setBooks(savedLibrary.books);
          setGenreInterests(savedLibrary.genreInterests);
          setAuthorExperiences(savedLibrary.authorExperiences);
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

  const toggleInterestPathTag = useCallback((tag: string) => {
    setSelectedInterestPath((current) => {
      const existingIndex = current.indexOf(tag);

      if (existingIndex === -1) {
        return [...current, tag];
      }

      return current.filter((currentTag) => currentTag !== tag);
    });
  }, []);

  const smoothingFactors = useMemo(
    () => buildTagSmoothingFactorMap(books),
    [books],
  );

  const signalWeights = useMemo(
    () =>
      learnSignalWeights(
        books.flatMap((book) => {
          if (book.myRating == null) {
            return [];
          }

          const authorPref = averageTagPreference(book.authors, authorExperiences);
          const genrePref = averageTagPreference(book.genres, genreInterests);
          const R = book.starRating ?? GLOBAL_MEAN;
          const v = book.ratingCount ?? 0;
          const bScore = bayesianScore(
            R,
            v,
            GLOBAL_MEAN,
            smoothingFactors.get(book.id) ?? SMOOTHING_FACTOR,
          );

          return [
            {
              bayesian: bScore,
              author: authorPref,
              genre: genrePref,
              target: book.myRating,
            },
          ];
        }),
      ),
    [books, authorExperiences, genreInterests, smoothingFactors],
  );

  const rankedBooks = useMemo<RankedBook[]>(() => {
    return books
      .filter((book) => !book.read)
      .map((book) => {
        const authorPref = averageTagPreference(book.authors, authorExperiences);
        const genrePref = averageTagPreference(book.genres, genreInterests);
        const R = book.starRating ?? GLOBAL_MEAN;
        const v = book.ratingCount ?? 0;
        const bScore = bayesianScore(
          R,
          v,
          GLOBAL_MEAN,
          smoothingFactors.get(book.id) ?? SMOOTHING_FACTOR,
        );
        return {
          ...book,
          score: scoreBook(
            bScore,
            authorPref,
            genrePref,
            book.myRating,
            book.progress,
            book.readCount ?? 0,
            signalWeights,
          ),
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
  }, [books, genreInterests, authorExperiences, smoothingFactors, signalWeights]);

  const readBooks = useMemo<RankedBook[]>(() => {
    return books
      .filter((book) => book.read)
      .map((book) => {
        const authorPref = averageTagPreference(book.authors, authorExperiences);
        const genrePref = averageTagPreference(book.genres, genreInterests);
        const R = book.starRating ?? GLOBAL_MEAN;
        const v = book.ratingCount ?? 0;
        const bScore = bayesianScore(
          R,
          v,
          GLOBAL_MEAN,
          smoothingFactors.get(book.id) ?? SMOOTHING_FACTOR,
        );
        const fullScore = scoreBook(
          bScore,
          authorPref,
          genrePref,
          book.myRating,
          book.progress,
          book.readCount ?? 0,
          signalWeights,
        );
        const realizedScore = realizeArchiveScore(
          fullScore,
          book.lastReadYear,
          book.archivedAtYear,
        );
        const score = capArchiveScore(realizedScore, fullScore);
        const archiveReadiness = archiveReadinessFromScores(score, fullScore);
        return {
          ...book,
          score,
          archiveLabel: archiveReadiness.label,
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
  }, [books, genreInterests, authorExperiences, smoothingFactors, signalWeights]);

  const visibleRankedBooks = useMemo(
    () =>
      rankedBooks.filter((book) =>
        matchesSelectedGenres(book.genres, selectedInterestPath),
      ),
    [rankedBooks, selectedInterestPath],
  );

  const visibleReadBooks = useMemo(
    () =>
      readBooks.filter((book) =>
        matchesSelectedGenres(book.genres, selectedInterestPath),
      ),
    [readBooks, selectedInterestPath],
  );

  const hasSelectedNodeFilter = selectedInterestPath.length > 0;

  const isEditing = editingBookId !== null;
  const currentYearLabel = String(currentYear);
  const yearOptions = useMemo(() => {
    const totalYears = currentYear - MIN_YEAR_OPTION + 1;
    return Array.from({ length: totalYears }, (_, index) => currentYear - index);
  }, [currentYear]);

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
  const parsedDraftLastReadYear = draft.lastReadYear.trim()
    ? Number(draft.lastReadYear)
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

  function effectiveLastReadYear(book: Book) {
    return book.lastReadYear ?? book.archivedAtYear;
  }

  function setDraftReadCount(nextReadCount: number) {
    setDraft((prev) => {
      const readCount = Math.max(0, Math.floor(nextReadCount));
      return {
        ...prev,
        readCount,
        lastReadYear:
          readCount > 0 ? prev.lastReadYear.trim() || currentYearLabel : "",
      };
    });
  }

  function setDraftLastReadYear(nextLastReadYear: string) {
    const lastReadYear = nextLastReadYear.trim();
    setDraft((prev) => ({
      ...prev,
      lastReadYear,
      readCount: lastReadYear ? Math.max(1, prev.readCount) : 0,
    }));
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

  function startEditingDraftTag(field: SuggestionField, tag: string) {
    setDraft((current) => {
      const isAuthor = field === "author";
      const inputKey = isAuthor ? "authorInput" : "genreInput";
      const ratingKey = isAuthor ? "authorExperience" : "genreInterest";
      const manualKey = isAuthor
        ? "authorExperienceIsManual"
        : "genreInterestIsManual";
      const scoreMap = isAuthor ? current.authorScores : current.genreScores;
      const globalScores = isAuthor ? authorExperiences : genreInterests;
      const scoreValue =
        scoreMap[tag]?.trim() ||
        (globalScores[tag] != null ? String(globalScores[tag]) : "");

      return {
        ...current,
        [inputKey]: tag,
        [ratingKey]: scoreValue,
        [manualKey]: false,
      };
    });
    setActiveSuggestionField(field);
    setActiveTagActionMenu(null);
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

      if (!rawTag) {
        return current;
      }

      const globalScores = isAuthor ? authorExperiences : genreInterests;
      const ratingValue =
        current[ratingKey].trim() ||
        (globalScores[rawTag] != null ? String(globalScores[rawTag]) : "");

      if (current[tagsKey].includes(rawTag)) {
        if (!ratingValue || current[scoresKey][rawTag] === ratingValue) {
          return {
            ...current,
            [inputKey]: "",
            [ratingKey]: "",
            [manualKey]: false,
          };
        }

        return {
          ...current,
          [scoresKey]: {
            ...current[scoresKey],
            [rawTag]: ratingValue,
          },
          [inputKey]: "",
          [ratingKey]: "",
          [manualKey]: false,
        };
      }

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

  function startEditing(book: Book) {
    const lastReadYear = effectiveLastReadYear(book);
    setEditingBookId(book.id);
    setScrollToForm(true);
    setActiveTagActionMenu(null);
    setDraft({
      title: book.title,
      readCount: book.readCount ?? 0,
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
      progress: book.progress != null ? String(book.progress) : "",
      myRating: book.myRating ?? null,
      lastReadYear:
        lastReadYear != null
          ? String(lastReadYear)
          : (book.readCount ?? 0) > 0
            ? currentYearLabel
            : "",
      markAsRead: book.read ?? false,
    });
    setErrorMessage(null);
  }

  function toggleEditing(book: Book) {
    if (editingBookId === book.id) {
      entryFormRef.current?.requestSubmit();
      return;
    }

    startEditing(book);
  }

  function toggleCardEditing(book: Book) {
    if (editingBookId === book.id) {
      resetDraft();
      return;
    }

    startEditing(book);
  }

  async function submitBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const parsedProgress = draft.progress.trim()
        ? Number(draft.progress)
        : undefined;
      const payload = {
        title: draft.title.trim(),
        authors: draft.authors,
        starRating: parsedDraftRating,
        ratingCount: parsedDraftCount,
        genres: draft.genres,
        progress: parsedProgress,
        myRating: draft.myRating ?? undefined,
        readCount: draft.readCount,
        ...(draft.markAsRead ? { read: true as const } : {}),
        ...(parsedDraftLastReadYear != null
          ? { lastReadYear: parsedDraftLastReadYear }
          : {}),
      };

      let nextInterests = genreInterests;
      for (const genre of draft.genres) {
        const rawInterest = draft.genreScores[genre]?.trim();
        if (rawInterest && Number.isFinite(Number(rawInterest))) {
          nextInterests = await writeGenreInterest(genre, Number(rawInterest));
        }
      }
      setGenreInterests(nextInterests);

      let nextExps = authorExperiences;
      for (const author of draft.authors) {
        const rawExperience = draft.authorScores[author]?.trim();
        if (rawExperience && Number.isFinite(Number(rawExperience))) {
          nextExps = await writeAuthorExperience(author, Number(rawExperience));
        }
      }
      setAuthorExperiences(nextExps);

      const nextBooks = isEditing
        ? await updateBookRecord(editingBookId, payload)
        : await createBookRecord(payload);
      const createdBookId = isEditing
        ? null
        : nextBooks.find((book) => !books.some((existing) => existing.id === book.id))
            ?.id ?? null;

      queueBookReveal(createdBookId);
      applyBooksUpdate(nextBooks);
      resetDraft();
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setIsSaving(false);
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
        const nextExps = await deleteAuthorExperience(tag);

        applyBooksUpdate(nextBooks);
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
        const nextInterests = await deleteGenreInterest(tag);

        applyBooksUpdate(nextBooks);
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
      applyBooksUpdate(nextBooks);

      if (editingBookId === id) {
        resetDraft();
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setPendingDeleteId(null);
    }
  }

  async function addGraphGenreInterest() {
    const nextGenre = graphAddGenreInput.trim();

    if (!nextGenre) {
      return;
    }

    setErrorMessage(null);

    try {
      const nextInterests = await writeGenreInterest(
        nextGenre,
        graphAddGenreRating ?? 3,
      );
      setGenreInterests(nextInterests);
      setGraphAddGenreInput("");
      setGraphAddGenreRating(null);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function renameGraphGenre(oldName: string, newName: string) {
    setErrorMessage(null);

    try {
      const nextBooks = await renameGenreInBooks(oldName, newName);
      const nextInterests = await renameGenreInterest(oldName, newName);

      applyBooksUpdate(nextBooks);
      setGenreInterests(nextInterests);
      setGraphEditingNode((current) =>
        current && current.tag === oldName ? { ...current, tag: newName } : current,
      );
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function updateGraphGenreInterest(tag: string, level: number | null) {
    setErrorMessage(null);

    try {
      const nextInterests = await writeGenreInterest(tag, level ?? 3);
      setGenreInterests(nextInterests);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function clearDisplayedList() {
    setErrorMessage(null);
    const targets = showArchive ? visibleReadBooks : visibleRankedBooks;
    try {
      for (const book of targets) {
        await deleteBookRecord(book.id);
      }
      const nextBooks = await fetchBooks();
      applyBooksUpdate(nextBooks);
      if (editingBookId != null && targets.some((b) => b.id === editingBookId)) {
        resetDraft();
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function toggleBookRead(id: number, read: boolean) {
    setErrorMessage(null);
    try {
      const book = books.find((b) => b.id === id);
      if (!book) return;
      const nextBooks = await updateBookRecord(id, {
        ...book,
        read,
        ...(read
          ? {
              archivedAtYear: undefined,
              lastReadYear: currentYear,
            }
          : {}),
      });
      applyBooksUpdate(nextBooks);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  async function setReadCount(bookId: number, value: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;

    try {
      const nextValue = Math.max(0, Math.floor(value));
      const nextLastReadYear =
        nextValue > 0
          ? effectiveLastReadYear(book) ?? currentYear
          : undefined;
      const updated = await updateBookRecord(bookId, {
        ...book,
        readCount: nextValue,
        archivedAtYear: undefined,
        lastReadYear: nextLastReadYear,
      });
      applyBooksUpdate(updated);
    } catch {
      // silently ignore
    }
  }

  async function incrementReadCount(bookId: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;

    await setReadCount(bookId, (book.readCount ?? 0) + 1);
  }

  async function decrementReadCount(bookId: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;

    await setReadCount(bookId, (book.readCount ?? 0) - 1);
  }

  // Auto-build reading list when 2+ nodes are selected
  useEffect(() => {
    if (selectedInterestPath.length < 1) {
      setRecommendations(null);
      setRecError(null);
      setIsLoadingRecs(false);
      return;
    }

    let cancelled = false;
    const debounce = setTimeout(async () => {
      setIsLoadingRecs(true);
      setRecError(null);

      try {
        const result = await requestPathRecommendation({
          selectedTags: selectedInterestPath,
          profile: {
            books,
            genreInterests,
            authorExperiences,
          },
        });
        if (!cancelled) setRecommendations(result);
      } catch (error) {
        if (!cancelled) {
          setRecError(
            error instanceof Error ? error.message : "Failed to get recommendations.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingRecs(false);
      }
    }, 400); // debounce to avoid hammering API on rapid clicks

    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [selectedInterestPath, books, genreInterests, authorExperiences]);





  async function updateMyRating(bookId: number, rating: number) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    const newRating = book.myRating === rating ? undefined : rating;
    try {
      const updated = await updateBookRecord(bookId, {
        ...book,
        myRating: newRating,
      });
      applyBooksUpdate(updated);
    } catch {
      // silently ignore
    }
  }

  async function updateProgress(bookId: number, value: number | undefined) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    try {
      const updated = await updateBookRecord(bookId, {
        ...book,
        progress: value,
      });
      applyBooksUpdate(updated);
    } catch {
      // silently ignore
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
      <div className="app-layout">
        {/* ── Left column: reading list ── */}
        <aside ref={leftColumnRef} className="left-column">
        {!showArchive ? (
        <section className="board">
          <header className="list-header">
            <h2>Reading list</h2>
          </header>
          <div className="ranking-list">
            {isLoading ? (
              <div className="empty-state">Loading your rankings...</div>
            ) : rankedBooks.length === 0 ? (
              <div className="empty-state">
                No books yet. Add your first book to get started.
              </div>
            ) : visibleRankedBooks.length === 0 ? (
              <div className="empty-state">
                No books in your reading list match the selected nodes.
              </div>
            ) : (
              visibleRankedBooks.map((book, index) => {
                const isDeleting = pendingDeleteId === book.id;
                const isEditingBook = editingBookId === book.id;
                const editActionDisabled =
                  isSaving || isDeleting || (isEditingBook && !canSubmit);
                const rankClass =
                  book.rank === 1
                    ? "rank-gold"
                    : book.rank === 2
                      ? "rank-silver"
                      : book.rank === 3
                        ? "rank-bronze"
                        : "";

                return (
                  <BookCard
                    key={book.id}
                    itemId={book.id}
                    rank={book.rank}
                    title={book.title}
                    authors={book.authors}
                    score={book.score}
                    rankClass={rankClass}
                    className={[
                      isEditingBook ? "is-editing" : "",
                      book.rank === 1 ? "is-leader" : "",
                      highlightedBookId === book.id ? "is-recently-added" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    animationDelay={`${index * 60}ms`}
                    isActive={isEditingBook}
                    onToggle={() => toggleCardEditing(book)}
                    progressBar={
                      <ProgressBar
                        value={book.progress ?? 0}
                        onChange={(pct) =>
                          void updateProgress(book.id, pct === 0 ? undefined : pct)
                        }
                      />
                    }
                    subMeta={
                      <ReadCountStepper
                        value={book.readCount ?? 0}
                        onIncrement={() => void incrementReadCount(book.id)}
                        onDecrement={() => void decrementReadCount(book.id)}
                        disabled={isSaving || isDeleting}
                      />
                    }
                    stars={
                      <span className="my-rating-stars">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            className={`my-rating-star${book.myRating != null && star <= book.myRating ? " is-filled" : ""}`}
                            onClick={() => void updateMyRating(book.id, star)}
                            aria-label={`Rate ${star} out of 5`}
                          >
                            {book.myRating != null && star <= book.myRating ? "\u2605" : "\u2606"}
                          </button>
                        ))}
                      </span>
                    }
                    actions={
                      <>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          onClick={() => void removeBook(book.id)}
                          disabled={isSaving || isDeleting}
                          aria-label="Remove"
                          title="Remove"
                        >
                          {"\u2715"}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => toggleEditing(book)}
                          disabled={editActionDisabled}
                          aria-label={isEditingBook ? "Save changes" : "Edit"}
                          title={isEditingBook ? "Save changes" : "Edit"}
                        >
                          {isEditingBook ? "\u2713" : "\u270E"}
                        </button>
                        <button
                          type="button"
                          className="icon-btn book-state-btn is-open-default"
                          onClick={() => void toggleBookRead(book.id, true)}
                          disabled={isSaving || isDeleting}
                          aria-label="Mark as read"
                          title="Mark as read"
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
        ) : (
            <section className="board archive-list">
              <header className="list-header">
                <h2>Books to revisit</h2>
              </header>
              <div className="ranking-list">
                {readBooks.length === 0 ? (
                  <div className="empty-state">No read books yet.</div>
                ) : visibleReadBooks.length === 0 ? (
                  <div className="empty-state">
                    No rereads match the selected nodes.
                  </div>
                ) : (
                  visibleReadBooks.map((book) => {
                    const isDeleting = pendingDeleteId === book.id;
                    const isEditingBook = editingBookId === book.id;
                    const editActionDisabled =
                      isSaving || isDeleting || (isEditingBook && !canSubmit);
                    const rankClass =
                      book.rank === 1
                        ? "rank-gold"
                        : book.rank === 2
                          ? "rank-silver"
                          : book.rank === 3
                            ? "rank-bronze"
                            : "";

                    return (
                      <BookCard
                        key={book.id}
                        itemId={book.id}
                        rank={book.rank}
                        title={book.title}
                        authors={book.authors}
                        score={book.score}
                        scoreOverride={book.archiveLabel ?? "Not yet"}
                        rankClass={rankClass}
                        className={[
                          "is-read",
                          isEditingBook ? "is-editing" : "",
                          highlightedBookId === book.id ? "is-recently-added" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        isActive={isEditingBook}
                        onToggle={() => toggleCardEditing(book)}
                        progressBar={
                          <ProgressBar
                            value={book.progress ?? 0}
                            onChange={(pct) =>
                              void updateProgress(book.id, pct === 0 ? undefined : pct)
                            }
                          />
                        }
                        subMeta={
                          <ReadCountStepper
                            value={book.readCount ?? 0}
                            onIncrement={() => void incrementReadCount(book.id)}
                            onDecrement={() => void decrementReadCount(book.id)}
                            disabled={isSaving || isDeleting}
                          />
                        }
                        stars={
                          <span className="my-rating-stars">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                className={`my-rating-star${book.myRating != null && star <= book.myRating ? " is-filled" : ""}`}
                                onClick={() => void updateMyRating(book.id, star)}
                                aria-label={`Rate ${star} out of 5`}
                              >
                                {book.myRating != null && star <= book.myRating ? "\u2605" : "\u2606"}
                              </button>
                            ))}
                          </span>
                        }
                        actions={
                          <>
                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              onClick={() => void removeBook(book.id)}
                              disabled={isSaving || isDeleting}
                              aria-label="Remove"
                              title="Remove"
                            >
                              {"\u2715"}
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => toggleEditing(book)}
                              disabled={editActionDisabled}
                              aria-label={isEditingBook ? "Save changes" : "Edit"}
                              title={isEditingBook ? "Save changes" : "Edit"}
                            >
                              {isEditingBook ? "\u2713" : "\u270E"}
                            </button>
                            <button
                              type="button"
                              className="icon-btn book-state-btn is-closed-default"
                              onClick={() => void toggleBookRead(book.id, false)}
                              disabled={isSaving || isDeleting}
                              aria-label="Reread this book"
                              title="Reread this book"
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
          )}
          <div className="column-footer">
            <div className="profile-info">
              <div className="profile-avatar">DL</div>
              <div className="profile-text">
                <span className="profile-name">Dan L.</span>
                <span className="profile-plan">Free plan</span>
              </div>
            </div>
            <div className="footer-actions">
            <button
              type="button"
              className="archive-toggle icon-btn-danger"
              onClick={() => {
                const count = showArchive ? visibleReadBooks.length : visibleRankedBooks.length;
                const scope = hasSelectedNodeFilter ? "displayed " : "";
                if (count > 0 && window.confirm(`Delete all ${count} ${scope}${showArchive ? "archived" : "ranked"} books?`)) {
                  void clearDisplayedList();
                }
              }}
              title={
                hasSelectedNodeFilter
                  ? showArchive
                    ? "Delete all displayed archived books"
                    : "Delete all displayed ranked books"
                  : showArchive
                    ? "Delete all archived books"
                    : "Delete all ranked books"
              }
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M5 2V1h6v1h4v2H1V2h4zm1 4h1v7H6V6zm3 0h1v7H9V6zM2 5h12l-1 10H3L2 5z"/></svg>
            </button>
            <button
              type="button"
              className="archive-toggle"
              onClick={() => setShowArchive((prev) => !prev)}
              title={showArchive ? "Back to list" : "Archive"}
            >
              {showArchive
                ? <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M10 2L4 8l6 6V2z"/></svg>
                : <ArchiveShelfIcon className="archive-icon" />}
            </button>
            </div>
          </div>
        </aside>

        {/* ── Center column: interest map graph ── */}
        <section className={`center-column${graphEditMode ? " is-editing" : ""}`}>
          <div className="graph-edit-toolbar">
            <button
              type="button"
              className={`graph-edit-btn${graphEditMode ? " is-active" : ""}`}
              onClick={() => setGraphEditMode((prev) => !prev)}
              aria-label={graphEditMode ? "Exit edit mode" : "Edit graph"}
              title={graphEditMode ? "Exit edit mode" : "Edit interests"}
            >
              {graphEditMode ? "\u2715" : "\u270E"}
            </button>
            {!graphEditMode ? (
              <span className="graph-edit-hint">
                Select nodes to generate a list
              </span>
            ) : null}
            {graphEditMode ? (
              <div className="tag-entry-group graph-tag-entry">
                <div className="tag-entry-row">
                  <input
                    type="text"
                    placeholder="Add genre or topic..."
                    value={graphAddGenreInput}
                    onChange={(e) => setGraphAddGenreInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && graphAddGenreInput.trim()) {
                        void addGraphGenreInterest();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="graph-add-btn"
                    disabled={!graphAddGenreInput.trim()}
                    onClick={() => {
                      if (graphAddGenreInput.trim()) {
                        void addGraphGenreInterest();
                      }
                    }}
                    aria-label="Add genre"
                  >
                    +
                  </button>
                </div>
                <RatingButtons
                  value={graphAddGenreRating}
                  onChange={setGraphAddGenreRating}
                />
              </div>
            ) : null}
          </div>
          <InterestMap
            books={books}
            interests={genreInterests}
            selectedPath={selectedInterestPath}
            onSelectTag={toggleInterestPathTag}
            editMode={graphEditMode}
            onEditingNodeChange={setGraphEditingNode}
          />
        </section>
          {graphEditMode && graphEditingNode ? createPortal(
            <div
              className="node-edit-popover"
              style={{ left: graphEditingNode.screenX, top: graphEditingNode.screenY }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                className="node-edit-label"
                defaultValue={graphEditingNode.tag}
                onBlur={(e) => {
                  const newName = e.currentTarget.value.trim();
                  const oldName = graphEditingNode.tag;
                  if (newName && newName !== oldName) {
                    void renameGraphGenre(oldName, newName);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <RatingButtons
                value={genreInterests[graphEditingNode.tag] ?? null}
                onChange={(level) => {
                  void updateGraphGenreInterest(graphEditingNode.tag, level);
                }}
              />
              <button
                type="button"
                className="node-edit-delete"
                onClick={() => {
                  void removeGlobalTag("genre", graphEditingNode.tag);
                  setGraphEditingNode(null);
                }}
              >
                Remove
              </button>
            </div>,
            document.body,
          ) : null}

        {/* ── Right column: reading list builder + add book ── */}
        <aside className="right-column">
          {isLoadingRecs ? (
            <div
              className="right-column-loader"
              aria-label="Building reading list"
              title="Building reading list"
            >
              <span className="right-column-loader-spinner" aria-hidden="true" />
            </div>
          ) : null}
          {recError ? (
            <p className="panel-error">{recError}</p>
          ) : null}
          {recommendations && recommendations.candidates.length > 0 ? (
            <>
              <div className="right-column-head">
                <select
                  className="list-size-select"
                  value={listSize}
                  onChange={(e) => setListSize(Number(e.target.value))}
                >
                  {[3, 5, 10, 15, 20].map((n) => (
                    <option key={n} value={n}>
                      Top {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="right-column-list">
                {recommendations.candidates.slice(0, listSize).map((rec, i) => (
                  <BookCard
                    key={rec.id}
                    rank={i + 1}
                    title={rec.title}
                    authors={rec.authors}
                    score={rec.score}
                    className={addedRecIds.has(rec.id) ? "is-added" : undefined}
                    scoreOverride={addedRecIds.has(rec.id) ? "✓" : undefined}
                  />
                ))}
              </div>
            </>
          ) : recommendations && recommendations.candidates.length === 0 ? (
            <div className="right-column-status">
              <p>No new books found for these genres.</p>
            </div>
          ) : null}
          <section className="panel control-panel">

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

          <form ref={entryFormRef} className="entry-form" onSubmit={submitBook}>
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
                <div className="tag-entry-group">
                  <div className="tag-entry-row">
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
                            const isDeletingTag =
                              pendingTagDelete === deleteKey;

                            return (
                              <div key={author} className="suggestion-option">
                                <button
                                  type="button"
                                  className="suggestion-pick"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
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
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
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
                    <button
                      type="button"
                      className="graph-add-btn"
                      onClick={() => addDraftTag("author")}
                      disabled={!draft.authorInput.trim()}
                      aria-label="Add author tag"
                    >
                      +
                    </button>
                  </div>
                  <RatingButtons
                    value={
                      draft.authorExperience
                        ? Number(draft.authorExperience)
                        : null
                    }
                    onChange={(level) =>
                      updateDraft("authorExperience", level ? String(level) : "")
                    }
                  />
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
                      const isDragging =
                        draftTagDrag?.field === "author" &&
                        draftTagDrag.tag === author;
                      const isDropTarget =
                        draftTagDropTarget?.field === "author" &&
                        draftTagDropTarget.tag === author;

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
                          onClick={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                ".tag-action-shell",
                              )
                            ) {
                              return;
                            }

                            startEditingDraftTag("author", author);
                          }}
                          aria-grabbed={isDragging}
                          title={`Click to edit ${author}, or drag to reorder`}
                        >
                          <span className="genre-tag-name">{author}</span>
                          {score ? (
                            <span className="genre-tag-interest">{score}</span>
                          ) : null}
                          <button
                            type="button"
                            className="tag-remove"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeDraftTag("author", author);
                            }}
                            aria-label={`Remove author ${author}`}
                            title={`Remove ${author}`}
                          >
                            x
                          </button>
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
                <div className="tag-entry-group">
                  <div className="tag-entry-row">
                    <div
                      className="suggestion-field"
                      onFocus={() => setActiveSuggestionField("genre")}
                      onBlur={(event) =>
                        handleSuggestionFieldBlur(event, "genre")
                      }
                    >
                      <input
                        type="text"
                        placeholder="Fictive Memoir"
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
                            const isDeletingTag =
                              pendingTagDelete === deleteKey;

                            return (
                              <div key={genre} className="suggestion-option">
                                <button
                                  type="button"
                                  className="suggestion-pick"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() =>
                                    selectSuggestedValue("genre", genre)
                                  }
                                >
                                  <span className="suggestion-copy">
                                    {genre}
                                  </span>
                                  {genreInterests[genre] != null ? (
                                    <span className="genre-tag-interest">
                                      {genreInterests[genre]}
                                    </span>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  className="tag-remove suggestion-remove"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
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
                    <button
                      type="button"
                      className="graph-add-btn"
                      onClick={() => addDraftTag("genre")}
                      disabled={!draft.genreInput.trim()}
                      aria-label="Add genre tag"
                    >
                      +
                    </button>
                  </div>
                  <RatingButtons
                    value={
                      draft.genreInterest
                        ? Number(draft.genreInterest)
                        : null
                    }
                    onChange={(level) =>
                      updateDraft("genreInterest", level ? String(level) : "")
                    }
                  />
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
                      const isDragging =
                        draftTagDrag?.field === "genre" &&
                        draftTagDrag.tag === genre;
                      const isDropTarget =
                        draftTagDropTarget?.field === "genre" &&
                        draftTagDropTarget.tag === genre;

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
                          onClick={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                ".tag-action-shell",
                              )
                            ) {
                              return;
                            }

                            startEditingDraftTag("genre", genre);
                          }}
                          aria-grabbed={isDragging}
                          title={`Click to edit ${genre}, or drag to reorder`}
                        >
                          <span className="genre-tag-name">{genre}</span>
                          {score ? (
                            <span className="genre-tag-interest">{score}</span>
                          ) : null}
                          <button
                            type="button"
                            className="tag-remove"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeDraftTag("genre", genre);
                            }}
                            aria-label={`Remove genre ${genre}`}
                            title={`Remove ${genre}`}
                          >
                            x
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="field entry-progress">
              <span>Reading progress</span>
              <ProgressBar
                value={Number(draft.progress) || 0}
                onChange={(pct) =>
                  updateDraft("progress", pct === 0 ? "" : String(pct))
                }
              />
            </div>

            <div className="field entry-read-count">
              <span>Times read before</span>
              <ReadCountStepper
                value={draft.readCount}
                onIncrement={() => setDraftReadCount(draft.readCount + 1)}
                onDecrement={() => setDraftReadCount(draft.readCount - 1)}
              />
            </div>

            <label className="field entry-last-read-year">
              <span>Year last read</span>
              <select
                value={draft.lastReadYear}
                onChange={(event) => setDraftLastReadYear(event.target.value)}
              >
                <option value="">-</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <div className="field entry-my-rating">
              <span>My rating</span>
              <span className="my-rating-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`my-rating-star${draft.myRating != null && star <= draft.myRating ? " is-filled" : ""}`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        myRating: prev.myRating === star ? null : star,
                      }))
                    }
                    aria-label={`Rate ${star} out of 5`}
                  >
                    {draft.myRating != null && star <= draft.myRating ? "\u2605" : "\u2606"}
                  </button>
                ))}
              </span>
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
                type="button"
                className="btn btn-tertiary"
                disabled={!canSubmit || isSaving}
                onClick={() => {
                  setDraft((prev) => ({ ...prev, markAsRead: true }));
                  setTimeout(() => {
                    const form = document.querySelector(".entry-form") as HTMLFormElement | null;
                    if (form) form.requestSubmit();
                  }, 0);
                }}
                aria-label="Add to archive as read"
                title="Add to archive as read"
              >
                <ArchiveShelfIcon className="archive-icon" />
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canSubmit}
              >
                {isSaving ? "Saving..." : isEditing ? "Save" : "Add"}
              </button>
            </div>
          </form>
        </section>
        </aside>
      </div>
    </main>
  );
}
