import {
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  genreInterestIsManual: boolean;
  authorExperience: string;
  authorExperienceIsManual: boolean;
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
type DraftTagDrag = {
  field: SuggestionField;
  tag: string;
};
type BookTagDrag = {
  bookId: number;
  field: SuggestionField;
  tag: string;
};
type TagActionScope = "draft" | "book";
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
    genreInterestIsManual: false,
    authorExperience: "",
    authorExperienceIsManual: false,
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

function averageTagPreference(tags: string[], scores: Record<string, number>) {
  if (tags.length === 0) {
    return 3;
  }

  return (
    tags.reduce((total, tag) => total + (scores[tag] ?? 3), 0) / tags.length
  );
}

function tagPreferences(tags: string[], scores: Record<string, number>) {
  if (tags.length === 0) {
    return [3];
  }

  return tags.map((tag) => scores[tag] ?? 3);
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

function tagActionMenuId(
  scope: TagActionScope,
  field: SuggestionField,
  tag: string,
  bookId?: number,
) {
  return scope === "draft"
    ? `draft:${field}:${tag}`
    : `book:${bookId}:${field}:${tag}`;
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

function bayesianScore(R: number, v: number, C: number, m: number) {
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

function compositeScore(bayesian: number, ...inputs: number[]) {
  const values = [bayesian, ...inputs];
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatScore(value: number, places = 2) {
  return value.toFixed(places);
}

function formatMainResult(value: number) {
  return `${Math.round(Math.max(0, Math.min(100, (value / 5) * 100)))}%`;
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

function InterestMap({
  books,
  interests,
  compact = false,
  selectedPath = [],
  onSelectTag,
  expansion = 0,
}: {
  books: Book[];
  interests: GenreInterestMap;
  compact?: boolean;
  selectedPath?: string[];
  onSelectTag?: (tag: string) => void;
  expansion?: number; // 0 = default, 1 = fully expanded
}) {
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
    const padding = 50;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxNodeCount = Math.max(...data.nodes.map((node) => node.count), 1);
    const maxLinkCount = Math.max(...data.links.map((link) => link.count), 1);

    const positionedNodes = rankedNodes.map((node, index) => {
      const seed = hashTag(node.tag);
      const radius = 6 + (node.count / maxNodeCount) * 6;
      const fillOpacity = 0.12 + (node.interest / 5) * 0.26;
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
        const ringRadius = 250 + ringNumber * 120 + ((seed >> 10) % 20);
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
        fillOpacity,
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

          node.x = Math.max(
            padding + node.radius,
            Math.min(width - padding - node.radius, node.x),
          );
          node.y = Math.max(
            padding + node.radius,
            Math.min(height - padding - node.radius, node.y),
          );
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
      node.x = Math.max(
        padding + node.radius,
        Math.min(width - padding - node.radius, node.x + offsetX),
      );
      node.y = Math.max(
        padding + node.radius,
        Math.min(height - padding - node.radius, node.y + offsetY),
      );
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
      fillOpacity: number;
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
        nodes[i].x = Math.max(
          padding + nodes[i].radius,
          Math.min(width - padding - nodes[i].radius, nodes[i].x),
        );
        nodes[i].y = Math.max(
          padding + nodes[i].radius,
          Math.min(height - padding - nodes[i].radius, nodes[i].y),
        );
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

    event.preventDefault();
    svgRef.current.setPointerCapture(event.pointerId);
    dragRef.current = {
      nodeIndex: nodeIdx,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;

    if (!drag || !svgRef.current) {
      return;
    }

    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;

    if (!drag.moved && Math.hypot(dx, dy) < 4) {
      return;
    }

    drag.moved = true;
    const ctm = svgRef.current.getScreenCTM();

    if (!ctm) {
      return;
    }

    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(
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

  function handlePointerUp() {
    if (dragRef.current) {
      wasDraggedRef.current = dragRef.current.moved;
      dragRef.current = null;
    }
  }

  function handleSvgClick(event: React.MouseEvent) {
    if (wasDraggedRef.current) {
      event.stopPropagation();
      wasDraggedRef.current = false;
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
          viewBox={(() => {
            // Subtle zoom as graph is revealed — graph is already full-size
            const zoomFactor = 1 - expansion * 0.15; // 1.0 → 0.85
            const w = initialLayout.width * zoomFactor;
            const h = initialLayout.height * zoomFactor;
            const x = (initialLayout.width - w) / 2;
            const y = (initialLayout.height - h) / 2;
            return `${x} ${y} ${w} ${h}`;
          })()}
          aria-label="Interest graph showing how genre and topic tags connect across your books"
          onClick={!compact ? handleSvgClick : undefined}
          onPointerMove={!compact ? handlePointerMove : undefined}
          onPointerUp={!compact ? handlePointerUp : undefined}
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
                  r={node.radius + 4}
                  fill="rgba(180, 83, 9, 0.08)"
                  stroke="rgba(180, 83, 9, 0.62)"
                  strokeWidth="1.4"
                />
              ) : null}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill={`rgba(180, 83, 9, ${node.fillOpacity})`}
                stroke="rgba(180, 83, 9, 0.24)"
                strokeWidth="1"
              />
              {!compact ? (
                <text
                  className="interest-map-label"
                  x={node.labelX}
                  y={node.labelY}
                  textAnchor={node.labelAnchor}
                >
                  {shortenLabel(node.tag)}
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
  const [activeTagActionMenu, setActiveTagActionMenu] = useState<string | null>(
    null,
  );
  const [draftTagDrag, setDraftTagDrag] = useState<DraftTagDrag | null>(null);
  const [draftTagDropTarget, setDraftTagDropTarget] = useState<{
    field: SuggestionField;
    tag: string | null;
  } | null>(null);
  const [bookTagDrag, setBookTagDrag] = useState<BookTagDrag | null>(null);
  const [bookTagDropTarget, setBookTagDropTarget] = useState<{
    bookId: number;
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

  function toggleInterestPathTag(tag: string) {
    setSelectedInterestPath((current) => {
      const existingIndex = current.indexOf(tag);

      if (existingIndex === -1) {
        return [...current, tag];
      }

      return current.filter((currentTag) => currentTag !== tag);
    });
  }

  const hasInterestMap = useMemo(
    () => books.some((book) => uniqueTags(book.genres).length > 0),
    [books],
  );

  /* ── scroll-driven graph expansion ── */
  const [graphExpansion, setGraphExpansion] = useState(0);
  useEffect(() => {
    if (!hasInterestMap) return;

    // Auto-scroll so only a strip of graph peeks out (iceberg effect)
    const timer = setTimeout(() => {
      window.scrollTo({ top: window.innerHeight * 0.85, behavior: "instant" as ScrollBehavior });
    }, 200);

    function onScroll() {
      const threshold = window.innerHeight * 0.85;
      const scrollY = window.scrollY ?? window.pageYOffset;
      const t = 1 - Math.min(1, scrollY / threshold); // 1 at top, 0 when scrolled down
      setGraphExpansion(t);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [hasInterestMap]);

  const rankedBooks = useMemo<RankedBook[]>(() => {
    return books
      .map((book) => {
        const preferences = [
          averageTagPreference(book.authors, authorExperiences),
          ...tagPreferences(book.genres, genreInterests),
        ];
        const R = book.starRating ?? GLOBAL_MEAN;
        const v = book.ratingCount ?? 0;
        const bScore = bayesianScore(R, v, GLOBAL_MEAN, SMOOTHING_FACTOR);
        return {
          ...book,
          score: compositeScore(bScore, ...preferences),
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
    setBookTagDrag(null);
    setBookTagDropTarget(null);
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

  async function reorderBookTags(
    bookId: number,
    field: SuggestionField,
    draggedTag: string,
    targetTag: string | null,
  ) {
    const book = books.find((candidate) => candidate.id === bookId);

    if (!book) {
      return;
    }

    const currentTags = field === "author" ? book.authors : book.genres;
    const nextTags =
      targetTag == null
        ? moveTagToEnd(currentTags, draggedTag)
        : reorderTags(currentTags, draggedTag, targetTag);

    if (nextTags === currentTags) {
      return;
    }

    setErrorMessage(null);

    try {
      const payload = {
        title: book.title,
        authors: field === "author" ? nextTags : book.authors,
        starRating: book.starRating,
        ratingCount: book.ratingCount,
        genres: field === "genre" ? nextTags : book.genres,
      };
      const nextBooks = await updateBookRecord(bookId, payload);
      setBooks(nextBooks);

      if (editingBookId === bookId) {
        const tagsKey = field === "author" ? "authors" : "genres";
        setDraft((current) => ({
          ...current,
          [tagsKey]: nextTags,
        }));
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  }

  function handleBookTagDragStart(
    event: ReactDragEvent<HTMLSpanElement>,
    bookId: number,
    field: SuggestionField,
    tag: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${bookId}:${field}:${tag}`);
    setActiveTagActionMenu(null);
    setBookTagDrag({ bookId, field, tag });
    setBookTagDropTarget(null);
  }

  function handleBookTagGroupDragOver(
    event: ReactDragEvent<HTMLDivElement>,
    bookId: number,
    field: SuggestionField,
  ) {
    if (
      !bookTagDrag ||
      bookTagDrag.bookId !== bookId ||
      bookTagDrag.field !== field
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setBookTagDropTarget((current) =>
      current?.bookId === bookId &&
      current.field === field &&
      current.tag === null
        ? current
        : { bookId, field, tag: null },
    );
  }

  function handleBookTagDragOver(
    event: ReactDragEvent<HTMLSpanElement>,
    bookId: number,
    field: SuggestionField,
    tag: string,
  ) {
    if (
      !bookTagDrag ||
      bookTagDrag.bookId !== bookId ||
      bookTagDrag.field !== field
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (bookTagDrag.tag === tag) {
      setBookTagDropTarget(null);
      return;
    }

    setBookTagDropTarget((current) =>
      current?.bookId === bookId &&
      current.field === field &&
      current.tag === tag
        ? current
        : { bookId, field, tag },
    );
  }

  async function handleBookTagDrop(
    event: ReactDragEvent<HTMLElement>,
    bookId: number,
    field: SuggestionField,
    targetTag: string | null = null,
  ) {
    if (
      !bookTagDrag ||
      bookTagDrag.bookId !== bookId ||
      bookTagDrag.field !== field
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const draggedTag = bookTagDrag.tag;
    setBookTagDrag(null);
    setBookTagDropTarget(null);
    await reorderBookTags(bookId, field, draggedTag, targetTag);
  }

  function handleBookTagDragEnd() {
    setBookTagDrag(null);
    setBookTagDropTarget(null);
  }

  function startEditing(book: Book) {
    setEditingBookId(book.id);
    setScrollToForm(true);
    setActiveTagActionMenu(null);
    setBookTagDrag(null);
    setBookTagDropTarget(null);
    setDraft({
      title: book.title,
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
          authorExperienceIsManual:
            current.authorInput.trim() === tag
              ? false
              : current.authorExperienceIsManual,
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
    <main
      className={[
        "app-shell",
        hasInterestMap ? "has-graph-stage" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hasInterestMap ? (
        <section className="graph-stage" aria-label="Interest map">
          <div className="graph-stage-frame">
            <InterestMap
              books={books}
              interests={genreInterests}
              selectedPath={selectedInterestPath}
              onSelectTag={toggleInterestPathTag}
              expansion={graphExpansion}
            />
          </div>
        </section>
      ) : (
        <section className="hero hero-empty">
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
        </section>
      )}

      <div className="app-content">
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
              <span>Author(s) + my experience with them</span>
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
                    className="btn btn-tag-add"
                    onClick={() => addDraftTag("author")}
                    disabled={!draft.authorInput.trim()}
                    aria-label="Add author tag"
                  >
                    +
                  </button>
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
                      const deleteKey = `author:${author}`;
                      const actionMenuId = tagActionMenuId(
                        "draft",
                        "author",
                        author,
                      );
                      const isDragging =
                        draftTagDrag?.field === "author" &&
                        draftTagDrag.tag === author;
                      const isDropTarget =
                        draftTagDropTarget?.field === "author" &&
                        draftTagDropTarget.tag === author;
                      const isDeletingTag = pendingTagDelete === deleteKey;
                      const isActionMenuOpen =
                        activeTagActionMenu === actionMenuId;

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
                          {author}
                          {score ? (
                            <span className="genre-tag-interest">{score}</span>
                          ) : null}
                          <span className="tag-action-shell">
                            <button
                              type="button"
                              className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveTagActionMenu((current) =>
                                  current === actionMenuId
                                    ? null
                                    : actionMenuId,
                                );
                              }}
                              aria-label={`Open delete options for author ${author}`}
                              title={`Open delete options for author ${author}`}
                              disabled={isDeletingTag}
                            >
                              x
                            </button>
                            {isActionMenuOpen ? (
                              <span className="tag-action-menu">
                                <button
                                  type="button"
                                  className="tag-action-option"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveTagActionMenu(null);
                                    removeDraftTag("author", author);
                                  }}
                                  aria-label={`Remove author ${author} from this book`}
                                  title={`Remove author ${author} from this book`}
                                  disabled={isDeletingTag}
                                >
                                  This book
                                </button>
                                <button
                                  type="button"
                                  className="tag-action-option tag-action-option-danger"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveTagActionMenu(null);
                                    void removeGlobalTag("author", author);
                                  }}
                                  aria-label={`Delete author tag ${author} everywhere`}
                                  title={`Delete author tag ${author} everywhere`}
                                  disabled={isDeletingTag}
                                >
                                  {isDeletingTag ? "Deleting..." : "Everywhere"}
                                </button>
                              </span>
                            ) : null}
                          </span>
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
                    className="btn btn-tag-add"
                    onClick={() => addDraftTag("genre")}
                    disabled={!draft.genreInput.trim()}
                    aria-label="Add genre tag"
                  >
                    +
                  </button>
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
                      const deleteKey = `genre:${genre}`;
                      const actionMenuId = tagActionMenuId(
                        "draft",
                        "genre",
                        genre,
                      );
                      const isDragging =
                        draftTagDrag?.field === "genre" &&
                        draftTagDrag.tag === genre;
                      const isDropTarget =
                        draftTagDropTarget?.field === "genre" &&
                        draftTagDropTarget.tag === genre;
                      const isDeletingTag = pendingTagDelete === deleteKey;
                      const isActionMenuOpen =
                        activeTagActionMenu === actionMenuId;

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
                          {genre}
                          {score ? (
                            <span className="genre-tag-interest">{score}</span>
                          ) : null}
                          <span className="tag-action-shell">
                            <button
                              type="button"
                              className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveTagActionMenu((current) =>
                                  current === actionMenuId
                                    ? null
                                    : actionMenuId,
                                );
                              }}
                              aria-label={`Open delete options for genre ${genre}`}
                              title={`Open delete options for genre ${genre}`}
                              disabled={isDeletingTag}
                            >
                              x
                            </button>
                            {isActionMenuOpen ? (
                              <span className="tag-action-menu">
                                <button
                                  type="button"
                                  className="tag-action-option"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveTagActionMenu(null);
                                    removeDraftTag("genre", genre);
                                  }}
                                  aria-label={`Remove genre ${genre} from this book`}
                                  title={`Remove genre ${genre} from this book`}
                                  disabled={isDeletingTag}
                                >
                                  This book
                                </button>
                                <button
                                  type="button"
                                  className="tag-action-option tag-action-option-danger"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveTagActionMenu(null);
                                    void removeGlobalTag("genre", genre);
                                  }}
                                  aria-label={`Delete genre tag ${genre} everywhere`}
                                  title={`Delete genre tag ${genre} everywhere`}
                                  disabled={isDeletingTag}
                                >
                                  {isDeletingTag ? "Deleting..." : "Everywhere"}
                                </button>
                              </span>
                            ) : null}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
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
          <div className="board-toolbar">
            <h2>My list</h2>
          </div>
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
                    <div className={`rank-badge ${rankClass}`}>
                      #{book.rank}
                    </div>

                    <div className="ranking-body">
                      <div className="ranking-topline">
                        <div className="ranking-info">
                          <h3>{book.title}</h3>
                          <div className="book-tags">
                            {book.authors.length > 0 ? (
                              <div
                                className={[
                                  "book-tag-group",
                                  bookTagDrag?.bookId === book.id &&
                                  bookTagDrag.field === "author"
                                    ? "is-drag-active"
                                    : "",
                                  bookTagDropTarget?.bookId === book.id &&
                                  bookTagDropTarget.field === "author" &&
                                  bookTagDropTarget.tag === null
                                    ? "is-drop-target-end"
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                onDragOver={(event) =>
                                  handleBookTagGroupDragOver(
                                    event,
                                    book.id,
                                    "author",
                                  )
                                }
                                onDrop={(event) =>
                                  void handleBookTagDrop(
                                    event,
                                    book.id,
                                    "author",
                                  )
                                }
                              >
                                {book.authors.map((author) => {
                                  const deleteKey = `author:${author}`;
                                  const actionMenuId = tagActionMenuId(
                                    "book",
                                    "author",
                                    author,
                                    book.id,
                                  );
                                  const isDeletingTag =
                                    pendingTagDelete === deleteKey;
                                  const isActionMenuOpen =
                                    activeTagActionMenu === actionMenuId;
                                  const isDragging =
                                    bookTagDrag?.bookId === book.id &&
                                    bookTagDrag.field === "author" &&
                                    bookTagDrag.tag === author;
                                  const isDropTarget =
                                    bookTagDropTarget?.bookId === book.id &&
                                    bookTagDropTarget.field === "author" &&
                                    bookTagDropTarget.tag === author;

                                  return (
                                    <span
                                      key={`author-${book.id}-${author}`}
                                      className={[
                                        "genre-tag",
                                        "book-tag-chip",
                                        isDragging ? "is-dragging" : "",
                                        isDropTarget ? "is-drag-target" : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      draggable
                                      onDragStart={(event) =>
                                        handleBookTagDragStart(
                                          event,
                                          book.id,
                                          "author",
                                          author,
                                        )
                                      }
                                      onDragOver={(event) =>
                                        handleBookTagDragOver(
                                          event,
                                          book.id,
                                          "author",
                                          author,
                                        )
                                      }
                                      onDrop={(event) =>
                                        void handleBookTagDrop(
                                          event,
                                          book.id,
                                          "author",
                                          author,
                                        )
                                      }
                                      onDragEnd={handleBookTagDragEnd}
                                      aria-grabbed={isDragging}
                                      title={`Drag to reorder ${author}`}
                                    >
                                      {author}
                                      {authorExperiences[author] != null ? (
                                        <span className="genre-tag-interest">
                                          {authorExperiences[author]}
                                        </span>
                                      ) : null}
                                      <span className="tag-action-shell">
                                        <button
                                          type="button"
                                          className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                                          onClick={() =>
                                            setActiveTagActionMenu((current) =>
                                              current === actionMenuId
                                                ? null
                                                : actionMenuId,
                                            )
                                          }
                                          aria-label={`Open delete options for author ${author}`}
                                          title={`Open delete options for author ${author}`}
                                          disabled={isDeletingTag}
                                        >
                                          x
                                        </button>
                                        {isActionMenuOpen ? (
                                          <span className="tag-action-menu">
                                            <button
                                              type="button"
                                              className="tag-action-option"
                                              onClick={() => {
                                                setActiveTagActionMenu(null);
                                                void clearTag(
                                                  book.id,
                                                  "author",
                                                  author,
                                                );
                                              }}
                                              aria-label={`Remove author ${author} from this book`}
                                              title={`Remove author ${author} from this book`}
                                              disabled={isDeletingTag}
                                            >
                                              This book
                                            </button>
                                            <button
                                              type="button"
                                              className="tag-action-option tag-action-option-danger"
                                              onClick={() => {
                                                setActiveTagActionMenu(null);
                                                void removeGlobalTag(
                                                  "author",
                                                  author,
                                                );
                                              }}
                                              aria-label={`Delete author tag ${author} everywhere`}
                                              title={`Delete author tag ${author} everywhere`}
                                              disabled={isDeletingTag}
                                            >
                                              {isDeletingTag
                                                ? "Deleting..."
                                                : "Everywhere"}
                                            </button>
                                          </span>
                                        ) : null}
                                      </span>
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="genre-tag">Author unknown</span>
                            )}
                            <div
                              className={[
                                "book-tag-group",
                                bookTagDrag?.bookId === book.id &&
                                bookTagDrag.field === "genre"
                                  ? "is-drag-active"
                                  : "",
                                bookTagDropTarget?.bookId === book.id &&
                                bookTagDropTarget.field === "genre" &&
                                bookTagDropTarget.tag === null
                                  ? "is-drop-target-end"
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onDragOver={(event) =>
                                handleBookTagGroupDragOver(
                                  event,
                                  book.id,
                                  "genre",
                                )
                              }
                              onDrop={(event) =>
                                void handleBookTagDrop(event, book.id, "genre")
                              }
                            >
                              {book.genres.map((genre) => {
                                const deleteKey = `genre:${genre}`;
                                const actionMenuId = tagActionMenuId(
                                  "book",
                                  "genre",
                                  genre,
                                  book.id,
                                );
                                const isDeletingTag =
                                  pendingTagDelete === deleteKey;
                                const isActionMenuOpen =
                                  activeTagActionMenu === actionMenuId;
                                const isDragging =
                                  bookTagDrag?.bookId === book.id &&
                                  bookTagDrag.field === "genre" &&
                                  bookTagDrag.tag === genre;
                                const isDropTarget =
                                  bookTagDropTarget?.bookId === book.id &&
                                  bookTagDropTarget.field === "genre" &&
                                  bookTagDropTarget.tag === genre;

                                return (
                                  <span
                                    key={`genre-${book.id}-${genre}`}
                                    className={[
                                      "genre-tag",
                                      "book-tag-chip",
                                      isDragging ? "is-dragging" : "",
                                      isDropTarget ? "is-drag-target" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    draggable
                                    onDragStart={(event) =>
                                      handleBookTagDragStart(
                                        event,
                                        book.id,
                                        "genre",
                                        genre,
                                      )
                                    }
                                    onDragOver={(event) =>
                                      handleBookTagDragOver(
                                        event,
                                        book.id,
                                        "genre",
                                        genre,
                                      )
                                    }
                                    onDrop={(event) =>
                                      void handleBookTagDrop(
                                        event,
                                        book.id,
                                        "genre",
                                        genre,
                                      )
                                    }
                                    onDragEnd={handleBookTagDragEnd}
                                    aria-grabbed={isDragging}
                                    title={`Drag to reorder ${genre}`}
                                  >
                                    {genre}
                                    {genreInterests[genre] != null ? (
                                      <span className="genre-tag-interest">
                                        {genreInterests[genre]}
                                      </span>
                                    ) : null}
                                    <span className="tag-action-shell">
                                      <button
                                        type="button"
                                        className={`tag-remove tag-action-toggle${isActionMenuOpen ? " is-open" : ""}`}
                                        onClick={() =>
                                          setActiveTagActionMenu((current) =>
                                            current === actionMenuId
                                              ? null
                                              : actionMenuId,
                                          )
                                        }
                                        aria-label={`Open delete options for genre ${genre}`}
                                        title={`Open delete options for genre ${genre}`}
                                        disabled={isDeletingTag}
                                      >
                                        x
                                      </button>
                                      {isActionMenuOpen ? (
                                        <span className="tag-action-menu">
                                          <button
                                            type="button"
                                            className="tag-action-option"
                                            onClick={() => {
                                              setActiveTagActionMenu(null);
                                              void clearTag(
                                                book.id,
                                                "genre",
                                                genre,
                                              );
                                            }}
                                            aria-label={`Remove genre ${genre} from this book`}
                                            title={`Remove genre ${genre} from this book`}
                                            disabled={isDeletingTag}
                                          >
                                            This book
                                          </button>
                                          <button
                                            type="button"
                                            className="tag-action-option tag-action-option-danger"
                                            onClick={() => {
                                              setActiveTagActionMenu(null);
                                              void removeGlobalTag(
                                                "genre",
                                                genre,
                                              );
                                            }}
                                            aria-label={`Delete genre tag ${genre} everywhere`}
                                            title={`Delete genre tag ${genre} everywhere`}
                                            disabled={isDeletingTag}
                                          >
                                            {isDeletingTag
                                              ? "Deleting..."
                                              : "Everywhere"}
                                          </button>
                                        </span>
                                      ) : null}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                          <div className="meta-row">
                            {book.starRating != null ? (
                              <span>{formatScore(book.starRating)} avg</span>
                            ) : null}
                            {book.ratingCount != null ? (
                              <span>
                                {formatCount(book.ratingCount)} ratings
                              </span>
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
                          {formatMainResult(book.score)}
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
      </div>
    </main>
  );
}
