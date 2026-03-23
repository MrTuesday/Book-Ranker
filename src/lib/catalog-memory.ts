export type CatalogBook = {
  title: string;
  series?: string;
  seriesNumber?: number;
  authors: string[];
  genres: string[];
};

type CatalogSource = Partial<CatalogBook> & {
  author?: unknown;
  genre?: unknown;
  authors?: unknown;
  genres?: unknown;
};

function normalizeTitledTag(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "";
  }

  return trimmed.replace(
    /(^|[\s/-])(\p{L})/gu,
    (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toLocaleUpperCase()}`,
  );
}

function normalizeSeriesName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeSeriesNumber(value: unknown) {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Number(parsed.toString());
}

function normalizeTagList(
  value: unknown,
  normalizeValue: (value: string) => string = (tag) => tag.trim(),
) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set<string>();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const trimmed = normalizeValue(rawValue);

    if (trimmed) {
      seen.add(trimmed);
    }
  }

  return Array.from(seen);
}

function normalizeIdentityPart(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

export function normalizeCatalogBook(value: unknown): CatalogBook | null {
  const book = value as CatalogSource | null;
  const title = typeof book?.title === "string" ? book.title.trim() : "";
  const authors = normalizeTagList(book?.authors ?? book?.author);
  const genres = normalizeTagList(book?.genres ?? book?.genre, normalizeTitledTag);
  const series = normalizeSeriesName(book?.series);
  const seriesNumber = normalizeSeriesNumber(book?.seriesNumber);

  if (!title) {
    return null;
  }

  return {
    title,
    ...(series ? { series } : {}),
    ...(seriesNumber != null ? { seriesNumber } : {}),
    authors,
    genres,
  };
}

export function cloneCatalogBooks(catalogBooks: CatalogBook[]) {
  return catalogBooks.map((book) => ({
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
  }));
}

export function buildCatalogIdentityKey(book: Pick<CatalogBook, "title" | "authors">) {
  const title = normalizeIdentityPart(book.title);
  const authors = uniqueStrings(book.authors)
    .map(normalizeIdentityPart)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  return `${title}::${authors}`;
}

function mergeCatalogBook(current: CatalogBook, incoming: CatalogBook): CatalogBook {
  return {
    title: incoming.title,
    ...(incoming.series || current.series
      ? { series: incoming.series ?? current.series }
      : {}),
    ...(incoming.seriesNumber != null || current.seriesNumber != null
      ? { seriesNumber: incoming.seriesNumber ?? current.seriesNumber }
      : {}),
    authors:
      incoming.authors.length > 0
        ? uniqueStrings(incoming.authors)
        : uniqueStrings(current.authors),
    genres:
      incoming.genres.length > 0
        ? uniqueStrings(incoming.genres)
        : uniqueStrings(current.genres),
  };
}

export function upsertCatalogBooks(
  catalogBooks: CatalogBook[],
  sourceBooks: unknown[],
) {
  const byIdentity = new Map<string, CatalogBook>();

  for (const catalogBook of catalogBooks) {
    const normalized = normalizeCatalogBook(catalogBook);

    if (!normalized) {
      continue;
    }

    byIdentity.set(buildCatalogIdentityKey(normalized), normalized);
  }

  for (const sourceBook of sourceBooks) {
    const normalized = normalizeCatalogBook(sourceBook);

    if (!normalized) {
      continue;
    }

    const identityKey = buildCatalogIdentityKey(normalized);
    const current = byIdentity.get(identityKey);

    byIdentity.set(
      identityKey,
      current ? mergeCatalogBook(current, normalized) : normalized,
    );
  }

  return Array.from(byIdentity.values()).sort((left, right) =>
    left.title.localeCompare(right.title),
  );
}
