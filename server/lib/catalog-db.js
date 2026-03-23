import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));

let client = null;

function getClient() {
  if (!client) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (tursoUrl) {
      // Production: connect to Turso
      client = createClient({
        url: tursoUrl,
        authToken: tursoToken,
      });
    } else {
      // Local development: use local SQLite file
      const dbPath =
        process.env.CATALOG_DB_PATH ??
        resolve(rootDir, "data", "openlibrary-trimmed.db");

      client = createClient({
        url: `file:${dbPath}`,
      });
    }
  }

  return client;
}

let dbAvailable = null;

export async function isCatalogDbAvailable() {
  if (dbAvailable !== null) {
    return dbAvailable;
  }

  try {
    const db = getClient();
    await db.execute("SELECT 1");
    dbAvailable = true;
    return true;
  } catch {
    dbAvailable = false;
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

export async function searchCatalogDb(query, limit = 6) {
  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  const db = getClient();
  const escaped = escapeLike(trimmed);
  const result = await db.execute({
    sql: SEARCH_QUERY,
    args: [`%${escaped}%`, trimmed, escaped, limit],
  });

  return result.rows.map((row) => ({
    key: row.work_key,
    title: row.title,
    authors: row.author_names
      ? String(row.author_names).split(",").map((name) => name.trim())
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

export async function searchCatalogDbBySubject(tag, limit = 12) {
  const trimmed = tag.trim();

  if (!trimmed) {
    return [];
  }

  const db = getClient();
  const escaped = escapeLike(trimmed);
  const result = await db.execute({
    sql: SUBJECT_SEARCH_QUERY,
    args: [`%"${escaped}"%`, limit],
  });

  return result.rows.map((row) => ({
    key: row.work_key,
    title: row.title,
    authors: row.author_names
      ? String(row.author_names).split(",").map((name) => name.trim())
      : [],
    subjects: row.subjects ? safeParseJson(row.subjects) : [],
    series: row.series ?? undefined,
    seriesNumber: row.series_number ?? undefined,
    publishYear: row.publish_year ?? undefined,
  }));
}

export async function searchCatalogDbBySubjects(tags, limit = 12) {
  if (tags.length === 0) {
    return [];
  }

  if (tags.length === 1) {
    return searchCatalogDbBySubject(tags[0], limit);
  }

  const db = getClient();
  const escaped = tags.map((tag) => `%"${escapeLike(tag.trim())}"%`);

  // Try the first two tags combined
  const result = await db.execute({
    sql: MULTI_SUBJECT_SEARCH_QUERY,
    args: [escaped[0], escaped[1], limit],
  });

  if (result.rows.length > 0) {
    return result.rows.map((row) => ({
      key: row.work_key,
      title: row.title,
      authors: row.author_names
        ? String(row.author_names).split(",").map((name) => name.trim())
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
