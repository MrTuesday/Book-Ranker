import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Book, GenreInterestMap, AuthorCredentialMap } from "../lib/books-api";

const MIN_INTEREST_MAP_ZOOM = 0.75;
const MAX_INTEREST_MAP_ZOOM = 2.5;
const INTEREST_MAP_WHEEL_ZOOM_SENSITIVITY = 0.003;
const INTEREST_MAP_PINCH_ZOOM_SENSITIVITY = 1.35;

type InterestMapViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LabelAnchor = "middle" | "start" | "end";
type LabelOrientation = "left" | "right" | "top" | "bottom";
type LabelBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type NodeLayer = "genre" | "credential";

type InterestMapNode = {
  key: string;
  tag: string;
  layer: NodeLayer;
  count: number;
  interest: number;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  radius: number;
  restX: number;
  restY: number;
};

export type SelectedNode = { tag: string; layer: NodeLayer };

export type InterestMapProps = {
  books: Book[];
  interests: GenreInterestMap;
  authorCredentials?: AuthorCredentialMap;
  activeLayers?: Set<NodeLayer>;
  compact?: boolean;
  selectedPath?: SelectedNode[];
  onSelectTag?: (node: SelectedNode) => void;
  onClearSelection?: () => void;
  onEditingNodeChange?: (node: {
    tag: string;
    screenX: number;
    screenY: number;
  } | null) => void;
};

function uniqueTags(values: string[]) {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
}

function hashTag(value: string) {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function shortenLabel(value: string, maxLength = 18) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
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

function normalizedAuthorSignature(book: Book) {
  return uniqueTags(book.authors).sort((left, right) => left.localeCompare(right));
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

    const leftAuthors = normalizedAuthorSignature(leftBook);
    const rightAuthors = normalizedAuthorSignature(rightBook);

    if (!sameStringList(leftAuthors, rightAuthors)) {
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

function sameCredentialMap(
  left: AuthorCredentialMap,
  right: AuthorCredentialMap,
) {
  const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));

  if (!sameStringList(leftKeys, rightKeys)) {
    return false;
  }

  for (const key of leftKeys) {
    const leftVals = [...left[key]].sort((a, b) => a.localeCompare(b));
    const rightVals = [...right[key]].sort((a, b) => a.localeCompare(b));

    if (!sameStringList(leftVals, rightVals)) {
      return false;
    }
  }

  return true;
}

function sameSelectedPath(left: SelectedNode[], right: SelectedNode[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index].tag !== right[index].tag || left[index].layer !== right[index].layer) {
      return false;
    }
  }

  return true;
}

function sameLayers(left: Set<NodeLayer>, right: Set<NodeLayer>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }

  return true;
}

function nodeKey(layer: NodeLayer, tag: string) {
  return `${layer}:${tag}`;
}

const GENRE_COLOR = {
  fill: "rgba(103, 232, 249, 0.46)",
  fillSelected: "rgba(103, 232, 249, 0.94)",
  stroke: "rgba(125, 211, 252, 0.34)",
  haloFill: "rgba(103, 232, 249, 0.12)",
  haloStroke: "rgba(103, 232, 249, 0.62)",
  link: "rgba(103, 232, 249, 0.16)",
  linkHighlight: "rgba(103, 232, 249, 0.72)",
  bubbleFill: "rgba(9, 20, 38, 0.82)",
  bubbleFillSelected: "rgba(12, 33, 60, 0.94)",
  bubbleStroke: "rgba(103, 232, 249, 0.14)",
  bubbleStrokeSelected: "rgba(103, 232, 249, 0.34)",
};

const CREDENTIAL_COLOR = {
  fill: "rgba(134, 239, 172, 0.44)",
  fillSelected: "rgba(134, 239, 172, 0.92)",
  stroke: "rgba(134, 239, 172, 0.34)",
  haloFill: "rgba(134, 239, 172, 0.12)",
  haloStroke: "rgba(134, 239, 172, 0.62)",
  link: "rgba(134, 239, 172, 0.16)",
  linkHighlight: "rgba(134, 239, 172, 0.72)",
  bubbleFill: "rgba(7, 24, 30, 0.82)",
  bubbleFillSelected: "rgba(9, 43, 43, 0.94)",
  bubbleStroke: "rgba(134, 239, 172, 0.14)",
  bubbleStrokeSelected: "rgba(134, 239, 172, 0.34)",
};

function layerColor(layer: NodeLayer) {
  return layer === "credential" ? CREDENTIAL_COLOR : GENRE_COLOR;
}

function zoomInterestMapViewport(
  viewport: InterestMapViewport,
  baseWidth: number,
  baseHeight: number,
  nextZoom: number,
  anchor = {
    x: viewport.x + viewport.width / 2,
    y: viewport.y + viewport.height / 2,
  },
): InterestMapViewport {
  const clampedZoom = Math.max(
    MIN_INTEREST_MAP_ZOOM,
    Math.min(MAX_INTEREST_MAP_ZOOM, nextZoom),
  );
  const nextWidth = baseWidth / clampedZoom;
  const nextHeight = baseHeight / clampedZoom;
  const relativeX =
    viewport.width > 0 ? (anchor.x - viewport.x) / viewport.width : 0.5;
  const relativeY =
    viewport.height > 0 ? (anchor.y - viewport.y) / viewport.height : 0.5;

  return {
    x: anchor.x - relativeX * nextWidth,
    y: anchor.y - relativeY * nextHeight,
    width: nextWidth,
    height: nextHeight,
  };
}

function clientPointWithinElement(
  element: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const rect = element.getBoundingClientRect();

  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function interestNodeLabelFontSize(radius: number) {
  return Math.max(10, Math.min(20, radius * 1.6));
}

let interestLabelMeasureContext: CanvasRenderingContext2D | null | undefined;

function estimateInterestLabelWidth(label: string, fontSize: number) {
  if (interestLabelMeasureContext === undefined && typeof document !== "undefined") {
    interestLabelMeasureContext = document.createElement("canvas").getContext("2d");
  }

  if (interestLabelMeasureContext) {
    interestLabelMeasureContext.font =
      `500 ${fontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    const letterSpacing = Math.max(0, label.length - 1) * fontSize * 0.01;
    return Math.ceil(interestLabelMeasureContext.measureText(label).width + letterSpacing);
  }

  return Math.max(fontSize * 3.2, label.length * fontSize * 0.52 + 10);
}

function interestNodeScoreFontSize(radius: number) {
  return Math.max(8, Math.min(15, radius * 1.2));
}

function interestNodeChipRadius(radius: number) {
  return Math.max(radius, 12);
}

function buildInterestLabelBox(
  x: number,
  y: number,
  anchor: LabelAnchor,
  width: number,
  fontSize: number,
): LabelBox {
  const left =
    anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  const labelHeight = fontSize * 0.9;

  return {
    left,
    right: left + width,
    top: y - labelHeight / 2,
    bottom: y + labelHeight / 2,
  };
}

function buildInterestNodeBox(
  node: { x: number; y: number; radius: number },
  padding = 0,
): LabelBox {
  const boxRadius = interestNodeChipRadius(node.radius) + padding;

  return {
    left: node.x - boxRadius,
    right: node.x + boxRadius,
    top: node.y - boxRadius,
    bottom: node.y + boxRadius,
  };
}

function mergeInterestBoxes(...boxes: LabelBox[]) {
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    right: Math.max(...boxes.map((box) => box.right)),
    top: Math.min(...boxes.map((box) => box.top)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

function padInterestBox(
  box: LabelBox,
  padding = 12,
): LabelBox {
  return {
    left: box.left - padding,
    right: box.right + padding,
    top: box.top - padding,
    bottom: box.bottom + padding,
  };
}

function preferredInterestLabelOrientation(
  dx: number,
  _dy: number,
): LabelOrientation {
  return dx < 0 ? "left" : "right";
}

function buildInterestBubblePlacement(
  node: { x: number; y: number; radius: number },
  orientation: LabelOrientation,
  labelWidth: number,
  labelFontSize: number,
) {
  const chipRadius = interestNodeChipRadius(node.radius);
  const labelX =
    orientation === "left"
      ? node.x - chipRadius - 10
      : orientation === "right"
        ? node.x + chipRadius + 10
        : node.x;
  const labelY =
    orientation === "top"
      ? node.y - chipRadius - Math.max(10, labelFontSize * 0.9)
      : orientation === "bottom"
        ? node.y + chipRadius + Math.max(10, labelFontSize * 0.9)
        : node.y;
  const labelAnchor: LabelAnchor =
    orientation === "left"
      ? "end"
      : orientation === "right"
        ? "start"
        : "middle";
  const labelBox = buildInterestLabelBox(
    labelX,
    labelY,
    labelAnchor,
    labelWidth,
    labelFontSize,
  );
  const bubbleBox = padInterestBox(
    mergeInterestBoxes(labelBox, buildInterestNodeBox(node)),
  );
  const bubbleWidth = bubbleBox.right - bubbleBox.left;
  const bubbleHeight = bubbleBox.bottom - bubbleBox.top;
  const bubbleCenterX = (bubbleBox.left + bubbleBox.right) / 2;
  const bubbleCenterY = (bubbleBox.top + bubbleBox.bottom) / 2;

  return {
    labelX,
    labelY,
    labelAnchor,
    labelBox,
    bubbleBox,
    bubbleCenterX,
    bubbleCenterY,
    bubbleRadius: Math.hypot(bubbleWidth, bubbleHeight) / 2,
  };
}

const DEFAULT_ACTIVE_LAYERS: Set<NodeLayer> = new Set(["genre"]);

function InterestMapView({
  books,
  interests,
  authorCredentials = {},
  activeLayers = DEFAULT_ACTIVE_LAYERS,
  compact = false,
  selectedPath = [],
  onSelectTag,
  onClearSelection,
  onEditingNodeChange,
}: InterestMapProps) {
  const data = useMemo(() => {
    const genreLayerActive = activeLayers.has("genre");
    const credentialLayerActive = activeLayers.has("credential");

    // --- Genre nodes (existing logic) ---
    const tagCounts = new Map<string, number>();
    const pairCounts = new Map<string, number>();

    for (const book of books) {
      const tags = uniqueTags(book.genres).filter((tag) => interests[tag] != null);

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
          const key = `genre:${left}\u0000genre:${right}`;

          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }

    const genreNodes: Array<{ key: string; tag: string; layer: NodeLayer; count: number; interest: number }> = genreLayerActive
      ? Array.from(tagCounts.entries())
          .sort(
            ([leftTag, leftCount], [rightTag, rightCount]) =>
              rightCount - leftCount ||
              (interests[rightTag] ?? 0) - (interests[leftTag] ?? 0) ||
              leftTag.localeCompare(rightTag),
          )
          .map(([tag, count]) => ({
            key: nodeKey("genre", tag),
            tag,
            layer: "genre" as NodeLayer,
            count,
            interest: interests[tag] ?? 0,
          }))
      : [];

    // --- Credential nodes ---
    const credentialCounts = new Map<string, number>();

    if (credentialLayerActive) {
      for (const book of books) {
        const bookCredentials = new Set<string>();
        for (const author of book.authors) {
          const creds = authorCredentials[author.trim()];
          if (creds) {
            for (const cred of creds) {
              bookCredentials.add(cred);
            }
          }
        }
        for (const cred of bookCredentials) {
          credentialCounts.set(cred, (credentialCounts.get(cred) ?? 0) + 1);
        }
      }
    }

    const credentialNodes: Array<{ key: string; tag: string; layer: NodeLayer; count: number; interest: number }> = credentialLayerActive
      ? Array.from(credentialCounts.entries())
          .sort(
            ([leftTag, leftCount], [rightTag, rightCount]) =>
              rightCount - leftCount || leftTag.localeCompare(rightTag),
          )
          .map(([tag, count]) => ({
            key: nodeKey("credential", tag),
            tag,
            layer: "credential" as NodeLayer,
            count,
            interest: 0,
          }))
      : [];

    // --- Credential-genre cross links ---
    if (credentialLayerActive && genreLayerActive) {
      for (const book of books) {
        const tags = uniqueTags(book.genres).filter((tag) => interests[tag] != null);
        const bookCredentials = new Set<string>();
        for (const author of book.authors) {
          const creds = authorCredentials[author.trim()];
          if (creds) {
            for (const cred of creds) {
              bookCredentials.add(cred);
            }
          }
        }
        for (const cred of bookCredentials) {
          for (const tag of tags) {
            const [left, right] = [`credential:${cred}`, `genre:${tag}`].sort((a, b) =>
              a.localeCompare(b),
            );
            const key = `${left}\u0000${right}`;
            pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          }
        }
      }
    }

    const allNodes = [...genreNodes, ...credentialNodes];
    const selectedKeys = new Set(allNodes.map((node) => node.key));
    const links = Array.from(pairCounts.entries())
      .map(([key, count]) => {
        const [source, target] = key.split("\u0000");
        return { source, target, count };
      })
      .filter(
        ({ source, target }) =>
          selectedKeys.has(source) && selectedKeys.has(target),
      )
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.source.localeCompare(right.source) ||
          left.target.localeCompare(right.target),
      );

    return { nodes: allNodes, links };
  }, [books, interests, authorCredentials, activeLayers]);

  const initialLayout = useMemo(() => {
    if (data.nodes.length === 0) {
      return null;
    }

    const degreeMap = new Map<string, number>();

    for (const node of data.nodes) {
      degreeMap.set(node.key, 0);
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
      .filter((node) => (degreeMap.get(node.key) ?? 0) > 0)
      .sort(
        (left, right) =>
          (degreeMap.get(right.key) ?? 0) - (degreeMap.get(left.key) ?? 0) ||
          right.count - left.count ||
          right.interest - left.interest ||
          left.key.localeCompare(right.key),
      );
    const isolatedNodes = [...data.nodes]
      .filter((node) => (degreeMap.get(node.key) ?? 0) === 0)
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.interest - left.interest ||
          left.key.localeCompare(right.key),
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

    const positionedNodes: InterestMapNode[] = rankedNodes.map((node, index) => {
      const seed = hashTag(node.key);
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
        degree: degreeMap.get(node.key) ?? 0,
        x,
        y,
        vx: 0,
        vy: 0,
        homeX: x,
        homeY: y,
        radius,
        restX: x,
        restY: y,
      };
    });

    if (positionedNodes.length > 1) {
      const nodeIndex = new Map(
        positionedNodes.map((node, index) => [node.key, index] as const),
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
              : ((hashTag(`${node.key}:edge`) % 3) - 1) * 0.015;

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
      node.homeX = node.x;
      node.homeY = node.y;
      node.restX = node.x;
      node.restY = node.y;
    }

    const nodeIndexMap = new Map(
      positionedNodes.map((node, index) => [node.key, index] as const),
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

  const simRef = useRef<InterestMapNode[]>([]);
  const dragRef = useRef<{
    nodeIndex: number;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startViewport: InterestMapViewport;
    moved: boolean;
  } | null>(null);
  const wasDraggedRef = useRef(false);
  const animationTimeRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<InterestMapViewport | null>(null);
  const gestureRef = useRef<{
    startViewport: InterestMapViewport;
    anchor: { x: number; y: number };
  } | null>(null);
  const [viewport, setViewport] = useState<InterestMapViewport | null>(null);
  const [, setTick] = useState(0);
  const setEditingNode = onEditingNodeChange ?? (() => {});

  useEffect(() => {
    if (!initialLayout) {
      simRef.current = [];
      return;
    }

    simRef.current = initialLayout.nodes.map((node) => ({ ...node }));
    setTick((tick) => tick + 1);
  }, [initialLayout]);

  useEffect(() => {
    if (!initialLayout) {
      setViewport(null);
      return;
    }

    setViewport({
      x: 0,
      y: 0,
      width: initialLayout.width,
      height: initialLayout.height,
    });
  }, [initialLayout]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  function clientPointToSvg(clientX: number, clientY: number) {
    const svg = svgRef.current;

    if (!svg) {
      return null;
    }

    const ctm = svg.getScreenCTM();

    if (!ctm) {
      return null;
    }

    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  }

  useEffect(() => {
    if (compact || !initialLayout || simRef.current.length === 0) {
      return;
    }

    let frameId = 0;
    let lastTime = 0;
    const { width, height, nodeIndex, maxLinkCount } = initialLayout;
    const boundaryPadding = 12;

    function nodeOrientation(node: InterestMapNode) {
      return preferredInterestLabelOrientation(
        node.homeX - width / 2,
        node.homeY - height / 2,
      );
    }

    function step(now: number) {
      const nodes = simRef.current;

      if (nodes.length === 0) {
        frameId = window.requestAnimationFrame(step);
        return;
      }

      const dt = Math.min(2, Math.max(0.75, (now - lastTime || 16) / 16));
      lastTime = now;
      animationTimeRef.current = now / 1000;
      const forceX = new Array(nodes.length).fill(0);
      const forceY = new Array(nodes.length).fill(0);
      const placements = nodes.map((node) => {
        const labelText = shortenLabel(node.tag);
        const labelFontSize = interestNodeLabelFontSize(node.radius);
        const labelWidth = estimateInterestLabelWidth(labelText, labelFontSize);

        return buildInterestBubblePlacement(
          node,
          nodeOrientation(node),
          labelWidth,
          labelFontSize,
        );
      });

      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < nodes.length;
          rightIndex += 1
        ) {
          const leftPlacement = placements[leftIndex];
          const rightPlacement = placements[rightIndex];
          let dx = rightPlacement.bubbleCenterX - leftPlacement.bubbleCenterX;
          let dy = rightPlacement.bubbleCenterY - leftPlacement.bubbleCenterY;
          let distance = Math.hypot(dx, dy);

          if (distance < 0.001) {
            dx = 0.01;
            dy = 0;
            distance = 0.01;
          }

          const directionX = dx / distance;
          const directionY = dy / distance;
          const minDistance =
            leftPlacement.bubbleRadius + rightPlacement.bubbleRadius + 10;
          const baseRepulsion = 950 / (distance * distance);
          const overlapRepulsion =
            distance < minDistance ? (minDistance - distance) * 0.07 : 0;
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

        const sourceNode = nodes[sourceIndex];
        const targetNode = nodes[targetIndex];
        const sourcePlacement = placements[sourceIndex];
        const targetPlacement = placements[targetIndex];
        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const directionX = dx / distance;
        const directionY = dy / distance;
        const desiredDistance =
          sourcePlacement.bubbleRadius +
          targetPlacement.bubbleRadius +
          26 +
          (1 - link.count / maxLinkCount) * 40;
        const spring = (distance - desiredDistance) * 0.0024;
        const pull = spring * (0.8 + (link.count / maxLinkCount) * 0.85);

        forceX[sourceIndex] += directionX * pull;
        forceY[sourceIndex] += directionY * pull;
        forceX[targetIndex] -= directionX * pull;
        forceY[targetIndex] -= directionY * pull;
      }

      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const isDragged = dragRef.current?.nodeIndex === index;

        if (isDragged) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        const swaySeed = hashTag(node.key);
        const swayX =
          Math.sin(animationTimeRef.current * 0.44 + (swaySeed & 0xff) * 0.027) *
          0.0018;
        const swayY =
          Math.cos(
            animationTimeRef.current * 0.38 + ((swaySeed >> 8) & 0xff) * 0.025,
          ) * 0.0015;

        forceX[index] += (node.restX - node.x) * 0.009 + swayX;
        forceY[index] += (node.restY - node.y) * 0.009 + swayY;

        node.vx = (node.vx + forceX[index] * dt) * 0.86;
        node.vy = (node.vy + forceY[index] * dt) * 0.86;
        const speed = Math.hypot(node.vx, node.vy);

        if (speed > 2.2) {
          const clamp = 2.2 / speed;
          node.vx *= clamp;
          node.vy *= clamp;
        }

        node.x += node.vx * dt;
        node.y += node.vy * dt;
      }

      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const placement = buildInterestBubblePlacement(
          node,
          nodeOrientation(node),
          estimateInterestLabelWidth(
            shortenLabel(node.tag),
            interestNodeLabelFontSize(node.radius),
          ),
          interestNodeLabelFontSize(node.radius),
        );

        if (placement.bubbleBox.left < boundaryPadding) {
          const shift = boundaryPadding - placement.bubbleBox.left;
          node.x += shift;
          if (dragRef.current?.nodeIndex !== index) {
            node.homeX += shift * 0.12;
            node.restX += shift * 0.3;
          }
          node.vx *= 0.65;
        } else if (placement.bubbleBox.right > width - boundaryPadding) {
          const shift = width - boundaryPadding - placement.bubbleBox.right;
          node.x += shift;
          if (dragRef.current?.nodeIndex !== index) {
            node.homeX += shift * 0.12;
            node.restX += shift * 0.3;
          }
          node.vx *= 0.65;
        }

        if (placement.bubbleBox.top < boundaryPadding) {
          const shift = boundaryPadding - placement.bubbleBox.top;
          node.y += shift;
          if (dragRef.current?.nodeIndex !== index) {
            node.homeY += shift * 0.12;
            node.restY += shift * 0.3;
          }
          node.vy *= 0.65;
        } else if (placement.bubbleBox.bottom > height - boundaryPadding) {
          const shift = height - boundaryPadding - placement.bubbleBox.bottom;
          node.y += shift;
          if (dragRef.current?.nodeIndex !== index) {
            node.homeY += shift * 0.12;
            node.restY += shift * 0.3;
          }
          node.vy *= 0.65;
        }
      }

      frameId = window.requestAnimationFrame(step);
      setTick((tick) => tick + 1);
    }

    frameId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [compact, initialLayout, data.links]);

  function handleNodePointerDown(
    event: React.PointerEvent<SVGGElement>,
    nodeIdx: number,
  ) {
    if (compact || !svgRef.current) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    dragRef.current = {
      nodeIndex: nodeIdx,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };

    function onDocMove(nextEvent: PointerEvent) {
      const drag = dragRef.current;

      if (!drag || !svgRef.current) {
        return;
      }

      const dx = nextEvent.clientX - drag.startClientX;
      const dy = nextEvent.clientY - drag.startClientY;

      if (!drag.moved && Math.hypot(dx, dy) < 4) {
        return;
      }

      drag.moved = true;
      const ctm = svgRef.current.getScreenCTM();

      if (!ctm) {
        return;
      }

      const point = new DOMPoint(nextEvent.clientX, nextEvent.clientY).matrixTransform(
        ctm.inverse(),
      );
      const node = simRef.current[drag.nodeIndex];

      if (node) {
        node.x = point.x;
        node.y = point.y;
        node.homeX = point.x;
        node.homeY = point.y;
        node.restX = point.x;
        node.restY = point.y;
        node.vx = 0;
        node.vy = 0;
        setTick((tick) => tick + 1);
      }
    }

    function onDocUp() {
      if (dragRef.current) {
        wasDraggedRef.current = dragRef.current.moved;
        dragRef.current = null;
      }

      setTick((tick) => tick + 1);
      document.removeEventListener("pointermove", onDocMove);
      document.removeEventListener("pointerup", onDocUp);
    }

    document.addEventListener("pointermove", onDocMove);
    document.addEventListener("pointerup", onDocUp);
  }

  function handleSvgPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (compact || !svgRef.current || !viewport) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const target = event.target as Element | null;

    if (target?.closest(".interest-map-node")) {
      return;
    }

    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: viewport,
      moved: false,
    };

    function onDocMove(nextEvent: PointerEvent) {
      const pan = panRef.current;
      const svg = svgRef.current;

      if (!pan || !svg) {
        return;
      }

      const dx = nextEvent.clientX - pan.startClientX;
      const dy = nextEvent.clientY - pan.startClientY;

      if (!pan.moved && Math.hypot(dx, dy) < 4) {
        return;
      }

      pan.moved = true;
      const svgWidth = svg.clientWidth || svg.getBoundingClientRect().width;
      const svgHeight = svg.clientHeight || svg.getBoundingClientRect().height;

      if (svgWidth <= 0 || svgHeight <= 0) {
        return;
      }

      setViewport({
        x: pan.startViewport.x - (dx * pan.startViewport.width) / svgWidth,
        y: pan.startViewport.y - (dy * pan.startViewport.height) / svgHeight,
        width: pan.startViewport.width,
        height: pan.startViewport.height,
      });
    }

    function onDocUp() {
      if (panRef.current) {
        wasDraggedRef.current = panRef.current.moved;
        panRef.current = null;
      }

      setTick((tick) => tick + 1);
      document.removeEventListener("pointermove", onDocMove);
      document.removeEventListener("pointerup", onDocUp);
    }

    document.addEventListener("pointermove", onDocMove);
    document.addEventListener("pointerup", onDocUp);
  }

  function handleInterestMapWheel(
    event: Pick<
      WheelEvent,
      "preventDefault" | "ctrlKey" | "clientX" | "clientY" | "deltaX" | "deltaY"
    >,
  ) {
    if (compact || !svgRef.current || !initialLayout || !viewportRef.current) {
      return;
    }

    event.preventDefault();

    if (event.ctrlKey) {
      const anchor = clientPointToSvg(event.clientX, event.clientY);

      if (!anchor) {
        return;
      }

      setViewport((current) =>
        current
          ? zoomInterestMapViewport(
              current,
              initialLayout.width,
              initialLayout.height,
              (initialLayout.width / current.width) *
                Math.exp(-event.deltaY * INTEREST_MAP_WHEEL_ZOOM_SENSITIVITY),
              { x: anchor.x, y: anchor.y },
            )
          : current,
      );
      return;
    }

    const svgWidth =
      svgRef.current.clientWidth || svgRef.current.getBoundingClientRect().width;
    const svgHeight =
      svgRef.current.clientHeight || svgRef.current.getBoundingClientRect().height;

    if (svgWidth <= 0 || svgHeight <= 0) {
      return;
    }

    setViewport((current) =>
      current
        ? {
            x: current.x + (event.deltaX * current.width) / svgWidth,
            y: current.y + (event.deltaY * current.height) / svgHeight,
            width: current.width,
            height: current.height,
          }
        : current,
    );
  }

  useEffect(() => {
    if (compact || !initialLayout || !plotRef.current) {
      return;
    }

    const layout = initialLayout;
    const plotElement = plotRef.current;

    type WebkitGestureEvent = Event & {
      clientX: number;
      clientY: number;
      scale: number;
      preventDefault(): void;
      target: EventTarget | null;
    };

    function isGraphGestureTarget(event: {
      clientX: number;
      clientY: number;
      target?: EventTarget | null;
    }) {
      const target = event.target;

      if (target instanceof Node && plotElement.contains(target)) {
        return true;
      }

      return clientPointWithinElement(plotElement, event.clientX, event.clientY);
    }

    function handleNativeWheel(event: WheelEvent) {
      if (!isGraphGestureTarget(event)) {
        return;
      }

      handleInterestMapWheel(event);
    }

    function handleGestureStart(event: Event) {
      const gestureEvent = event as WebkitGestureEvent;

      if (!isGraphGestureTarget(gestureEvent)) {
        return;
      }

      const anchor = clientPointToSvg(gestureEvent.clientX, gestureEvent.clientY);

      if (!anchor) {
        return;
      }

      gestureEvent.preventDefault();
      const currentViewport = viewportRef.current;

      if (!currentViewport) {
        return;
      }

      gestureRef.current = {
        startViewport: currentViewport,
        anchor: { x: anchor.x, y: anchor.y },
      };
    }

    function handleGestureChange(event: Event) {
      const gestureEvent = event as WebkitGestureEvent;
      const gesture = gestureRef.current;

      if (!gesture || !isGraphGestureTarget(gestureEvent)) {
        return;
      }

      gestureEvent.preventDefault();
      const startZoom = layout.width / gesture.startViewport.width;

      setViewport(
        zoomInterestMapViewport(
          gesture.startViewport,
          layout.width,
          layout.height,
          startZoom *
            (1 +
              (gestureEvent.scale - 1) * INTEREST_MAP_PINCH_ZOOM_SENSITIVITY),
          gesture.anchor,
        ),
      );
    }

    function handleGestureEnd(event: Event) {
      if (!gestureRef.current) {
        return;
      }

      (event as WebkitGestureEvent).preventDefault();
      gestureRef.current = null;
    }

    document.addEventListener("wheel", handleNativeWheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
      capture: true,
    });
    document.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
      capture: true,
    });
    document.addEventListener("gestureend", handleGestureEnd, {
      passive: false,
      capture: true,
    });

    return () => {
      document.removeEventListener("wheel", handleNativeWheel, true);
      document.removeEventListener("gesturestart", handleGestureStart, true);
      document.removeEventListener("gesturechange", handleGestureChange, true);
      document.removeEventListener("gestureend", handleGestureEnd, true);
    };
  }, [compact, initialLayout]);

  function handleSvgClick(event: React.MouseEvent) {
    if (wasDraggedRef.current) {
      event.stopPropagation();
      wasDraggedRef.current = false;
      return;
    }

    setEditingNode(null);
    onClearSelection?.();
  }

  if (!initialLayout) {
    return (
      <p className={`interest-map-empty${compact ? " is-compact" : ""}`}>
        Add genre and topic tags to see how your interests connect.
      </p>
    );
  }

  const currentNodes =
    !compact && simRef.current.length > 0
      ? simRef.current
      : initialLayout.nodes;
  const activeViewport = viewport ?? {
    x: 0,
    y: 0,
    width: initialLayout.width,
    height: initialLayout.height,
  };
  const isInteracting = dragRef.current != null || panRef.current != null;
  const selectedPathSet = new Set(selectedPath.map((s) => nodeKey(s.layer, s.tag)));
  const centerX = initialLayout.width / 2;
  const centerY = initialLayout.height / 2;
  const renderNodes = currentNodes.map((node, index) => {
    const labelText = shortenLabel(node.tag);
    const labelFontSize = interestNodeLabelFontSize(node.radius);
    const labelWidth = estimateInterestLabelWidth(labelText, labelFontSize);
    const orientation =
      preferredInterestLabelOrientation(node.restX - centerX, node.restY - centerY);
    const placement = buildInterestBubblePlacement(
      node,
      orientation,
      labelWidth,
      labelFontSize,
    );

    return {
      ...node,
      index,
      labelText,
      labelFontSize,
      labelWidth,
      orientation,
      labelX: placement.labelX,
      labelY: placement.labelY,
      labelAnchor: placement.labelAnchor,
      bubbleBox: placement.bubbleBox,
    };
  });
  const nodeMap = new Map(renderNodes.map((node) => [node.key, node] as const));
  const hasLinks = data.links.length > 0;
  const interestLabel =
    data.nodes.length === 1 ? "1 interest" : `${data.nodes.length} interests`;
  const connectionLabel =
    data.links.length === 1 ? "1 link" : `${data.links.length} links`;
  const hasActiveSelection = selectedPathSet.size > 0;
  const connectedLinks = hasActiveSelection
    ? data.links.filter(
        (link) =>
          selectedPathSet.has(link.source) || selectedPathSet.has(link.target),
      )
    : [];
  const isSelectable = !compact && typeof onSelectTag === "function";

  function buildLinkSegment(
    source: { x: number; y: number; radius: number },
    target: { x: number; y: number; radius: number },
  ) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const unitX = dx / distance;
    const unitY = dy / distance;

    return {
      startX: source.x + unitX * (source.radius + 1),
      startY: source.y + unitY * (source.radius + 1),
      endX: target.x - unitX * (target.radius + 1),
      endY: target.y - unitY * (target.radius + 1),
    };
  }

  function handleNodeKeyDown(
    event: ReactKeyboardEvent<SVGGElement>,
    node: { tag: string; layer: NodeLayer; key: string; x: number; y: number },
  ) {
    if (!onSelectTag) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleNodeClick(event, node);
    }
  }

  function handleNodeClick(
    event: Pick<React.MouseEvent<SVGGElement>, "stopPropagation">,
    node: { tag: string; layer: NodeLayer; key: string; x: number; y: number },
  ) {
    event.stopPropagation();

    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }

    const willBeOnlySelectedNode =
      !selectedPath.some((s) => s.tag === node.tag && s.layer === node.layer) &&
      selectedPath.length === 0;

    // Only show editing popover for genre nodes
    if (willBeOnlySelectedNode && node.layer === "genre") {
      const svg = svgRef.current;

      if (svg) {
        const point = svg.createSVGPoint();
        point.x = node.x;
        point.y = node.y;
        const ctm = svg.getScreenCTM();

        if (ctm) {
          const screenPoint = point.matrixTransform(ctm);
          setEditingNode({
            tag: node.tag,
            screenX: screenPoint.x,
            screenY: screenPoint.y,
          });
        }
      }
    } else {
      setEditingNode(null);
    }

    onSelectTag?.({ tag: node.tag, layer: node.layer });
  }

  return (
    <div className={`interest-map${compact ? " is-compact" : ""}`}>
      {!compact ? (
        <div className="interest-map-meta">
          <span>{interestLabel}</span>
          <span>{hasLinks ? connectionLabel : "No links yet"}</span>
        </div>
      ) : null}
      <div ref={plotRef} className="interest-map-plot">
        <svg
          ref={svgRef}
          className={`interest-map-chart${isInteracting ? " is-dragging" : ""}`}
          preserveAspectRatio="xMidYMid meet"
          viewBox={`${activeViewport.x} ${activeViewport.y} ${activeViewport.width} ${activeViewport.height}`}
          aria-label="Interest graph showing how genre and topic tags connect across your books"
          onPointerDown={!compact ? handleSvgPointerDown : undefined}
          onClick={!compact ? handleSvgClick : undefined}
        >
          {data.links.map((link) => {
            const source = nodeMap.get(link.source);
            const target = nodeMap.get(link.target);

            if (!source || !target) {
              return null;
            }

            const segment = buildLinkSegment(source, target);
            const linkColor =
              source.layer === target.layer
                ? layerColor(source.layer).link
                : "rgba(148, 163, 184, 0.16)";

            return (
              <g key={`${link.source}-${link.target}`}>
                <line
                  x1={segment.startX}
                  y1={segment.startY}
                  x2={segment.endX}
                  y2={segment.endY}
                  stroke={linkColor}
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
          {connectedLinks.map((link) => {
            const source = nodeMap.get(link.source);
            const target = nodeMap.get(link.target);

            if (!source || !target) {
              return null;
            }

            const segment = buildLinkSegment(source, target);
            const highlightColor =
              source.layer === target.layer
                ? layerColor(source.layer).linkHighlight
                : "rgba(226, 232, 240, 0.54)";

            return (
              <line
                key={`connected:${link.source}:${link.target}`}
                x1={segment.startX}
                y1={segment.startY}
                x2={segment.endX}
                y2={segment.endY}
                stroke={highlightColor}
                strokeWidth={1.8 + (link.count / initialLayout.maxLinkCount) * 1.6}
                strokeLinecap="round"
              />
            );
          })}
          {renderNodes.map((node) => {
            const colors = layerColor(node.layer);
            const isSelected = selectedPathSet.has(node.key);
            const titleText = node.layer === "credential"
              ? `${node.tag}: ${node.count} book${node.count === 1 ? "" : "s"}`
              : `${node.tag}: ${node.count} book${node.count === 1 ? "" : "s"}, interest ${node.interest}/5`;

            return (
              <g
                key={node.key}
                className={`interest-map-node${isSelectable ? " is-selectable" : ""}${isSelected ? " is-selected" : ""}`}
                onClick={
                  onSelectTag
                    ? (event: React.MouseEvent) => handleNodeClick(event, node)
                    : undefined
                }
                onPointerDown={
                  !compact
                    ? (event) => handleNodePointerDown(event, node.index)
                    : undefined
                }
                onKeyDown={
                  onSelectTag
                    ? (event) => handleNodeKeyDown(event, node)
                    : undefined
                }
              >
                {!compact ? (
                  <rect
                    className="interest-map-bubble"
                    x={node.bubbleBox.left}
                    y={node.bubbleBox.top}
                    width={node.bubbleBox.right - node.bubbleBox.left}
                    height={node.bubbleBox.bottom - node.bubbleBox.top}
                    rx="16"
                    fill={isSelected ? colors.bubbleFillSelected : colors.bubbleFill}
                    stroke={isSelected ? colors.bubbleStrokeSelected : colors.bubbleStroke}
                    strokeWidth={isSelected ? "1.6" : "1"}
                  />
                ) : null}
                <title>{titleText}</title>
                {isSelected ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius + 5}
                    fill={colors.haloFill}
                    stroke={colors.haloStroke}
                    strokeWidth="2"
                  />
                ) : null}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={isSelected ? colors.fillSelected : colors.fill}
                  stroke={colors.stroke}
                  strokeWidth="1"
                />
                {node.count > 0 && node.layer === "genre" ? (
                  <text
                    className="interest-map-score"
                    x={node.x}
                    y={node.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={interestNodeScoreFontSize(node.radius)}
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
                    dominantBaseline="middle"
                    style={{ fontSize: `${node.labelFontSize}px` }}
                  >
                    {node.labelText}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {!compact ? (
        <p className="interest-map-note">
          {hasLinks
            ? "Lines connect interests that appear together on the same book. Scroll or drag the background to pan, pinch or use the controls to zoom, and drag nodes to rearrange."
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
    sameSelectedPath(previousProps.selectedPath ?? [], nextProps.selectedPath ?? []) &&
    sameGraphBooks(previousProps.books, nextProps.books) &&
    sameInterestMap(previousProps.interests, nextProps.interests) &&
    sameCredentialMap(previousProps.authorCredentials ?? {}, nextProps.authorCredentials ?? {}) &&
    sameLayers(previousProps.activeLayers ?? DEFAULT_ACTIVE_LAYERS, nextProps.activeLayers ?? DEFAULT_ACTIVE_LAYERS),
);

export default InterestMap;
