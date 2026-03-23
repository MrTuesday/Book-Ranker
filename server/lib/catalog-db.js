import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultDbPath =
  process.env.CATALOG_DB_PATH ?? resolve(rootDir, "data", "openlibrary.db");

let db = null;

function getDb() {
  if (!db) {
    db = new Database(defaultDbPath, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000"); // 64MB cache
  }

  return db;
}

export function isCatalogDbAvailable() {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

const SEARCH_QUERY = `
  SELECT
    w.key AS work_key,
    w.title,
    w.subjects,
    e.series,
    e.series_number,
    e.publish_year,
    GROUP_CONCAT(DISTINCT a.name) AS author_names
  FROM works w
  LEFT JOIN editions e ON e.work_key = w.key AND e.series IS NOT NULL
  LEFT JOIN work_authors wa ON wa.work_key = w.key
  LEFT JOIN authors a ON a.key = wa.author_key
  WHERE w.title LIKE ? ESCAPE '\\'
  GROUP BY w.key
  ORDER BY
    CASE WHEN LOWER(w.title) = LOWER(?) THEN 0 ELSE 1 END,
    CASE WHEN LOWER(w.title) LIKE LOWER(? || '%') ESCAPE '\\' THEN 0 ELSE 1 END,
    (SELECT COUNT(*) FROM editions e2 WHERE e2.work_key = w.key) DESC
  LIMIT ?
`;

function escapeLike(value) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function searchCatalogDb(query, limit = 6) {
  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  const db = getDb();
  const escaped = escapeLike(trimmed);
  const rows = db
    .prepare(SEARCH_QUERY)
    .all(`%${escaped}%`, trimmed, escaped, limit);

  return rows.map((row) => ({
    key: row.work_key,
    title: row.title,
    authors: row.author_names
      ? row.author_names.split(",").map((name) => name.trim())
      : [],
    subjects: row.subjects ? safeParseJson(row.subjects) : [],
    series: row.series ?? undefined,
    seriesNumber: row.series_number ?? undefined,
    publishYear: row.publish_year ?? undefined,
  }));
}

const SUBJECT_SEARCH_QUERY = `
  SELECT
    w.key AS work_key,
    w.title,
    w.subjects,
    e.series,
    e.series_number,
    e.publish_year,
    GROUP_CONCAT(DISTINCT a.name) AS author_names
  FROM works w
  LEFT JOIN editions e ON e.work_key = w.key AND e.series IS NOT NULL
  LEFT JOIN work_authors wa ON wa.work_key = w.key
  LEFT JOIN authors a ON a.key = wa.author_key
  WHERE w.subjects LIKE ? ESCAPE '\\'
  GROUP BY w.key
  ORDER BY (SELECT COUNT(*) FROM editions e2 WHERE e2.work_key = w.key) DESC
  LIMIT ?
`;

const MULTI_SUBJECT_SEARCH_QUERY = `
  SELECT
    w.key AS work_key,
    w.title,
    w.subjects,
    e.series,
    e.series_number,
    e.publish_year,
    GROUP_CONCAT(DISTINCT a.name) AS author_names
  FROM works w
  LEFT JOIN editions e ON e.work_key = w.key AND e.series IS NOT NULL
  LEFT JOIN work_authors wa ON wa.work_key = w.key
  LEFT JOIN authors a ON a.key = wa.author_key
  WHERE w.subjects LIKE ? ESCAPE '\\' AND w.subjects LIKE ? ESCAPE '\\'
  GROUP BY w.key
  ORDER BY (SELECT COUNT(*) FROM editions e2 WHERE e2.work_key = w.key) DESC
  LIMIT ?
`;

export function searchCatalogDbBySubject(tag, limit = 12) {
  const trimmed = tag.trim();

  if (!trimmed) {
    return [];
  }

  const db = getDb();
  const escaped = escapeLike(trimmed);
  const rows = db
    .prepare(SUBJECT_SEARCH_QUERY)
    .all(`%"${escaped}"%`, limit);

  return rows.map((row) => ({
    key: row.work_key,
    title: row.title,
    authors: row.author_names
      ? row.author_names.split(",").map((name) => name.trim())
      : [],
    subjects: row.subjects ? safeParseJson(row.subjects) : [],
    series: row.series ?? undefined,
    seriesNumber: row.series_number ?? undefined,
    publishYear: row.publish_year ?? undefined,
  }));
}

export function searchCatalogDbBySubjects(tags, limit = 12) {
  if (tags.length === 0) {
    return [];
  }

  if (tags.length === 1) {
    return searchCatalogDbBySubject(tags[0], limit);
  }

  const db = getDb();
  const escaped = tags.map((tag) => `%"${escapeLike(tag.trim())}"%`);

  // Try the first two tags combined
  const rows = db
    .prepare(MULTI_SUBJECT_SEARCH_QUERY)
    .all(escaped[0], escaped[1], limit);

  if (rows.length > 0) {
    return rows.map((row) => ({
      key: row.work_key,
      title: row.title,
      authors: row.author_names
        ? row.author_names.split(",").map((name) => name.trim())
        : [],
      subjects: row.subjects ? safeParseJson(row.subjects) : [],
      series: row.series ?? undefined,
      seriesNumber: row.series_number ?? undefined,
      publishYear: row.publish_year ?? undefined,
    }));
  }

  // Fall back to single tag search
  return searchCatalogDbBySubject(tags[0], limit);
}

function safeParseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
