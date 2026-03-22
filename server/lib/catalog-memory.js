function normalizeTitledTag(value) {
  const trimmed = String(value ?? "").trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/(^|[\s/-])(\p{L})/gu, (_match, boundary, letter) => {
    return `${boundary}${letter.toLocaleUpperCase()}`;
  });
}

function normalizeSeriesName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeSeriesNumber(value) {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Number(parsed.toString());
}

function normalizeTagList(value, normalizeValue = (tag) => tag.trim()) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set();

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

function normalizeIdentityPart(value) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

export function normalizeCatalogBook(value) {
  const book = value ?? null;
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

export function cloneCatalogBooks(catalogBooks) {
  return catalogBooks.map((book) => ({
    ...book,
    authors: [...book.authors],
    genres: [...book.genres],
  }));
}

export function buildCatalogIdentityKey(book) {
  const title = normalizeIdentityPart(book.title);
  const authors = uniqueStrings(book.authors)
    .map(normalizeIdentityPart)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  return `${title}::${authors}`;
}

function mergeCatalogBook(current, incoming) {
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
    genres: uniqueStrings([...current.genres, ...incoming.genres]),
  };
}

export function upsertCatalogBooks(catalogBooks, sourceBooks) {
  const byIdentity = new Map();

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
