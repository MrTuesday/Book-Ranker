import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function findCatalogDb() {
  let dir = rootDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, "data", "catalog.db");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  return resolve(rootDir, "data", "catalog.db");
}

const DB_PATH = findCatalogDb();

let db = null;

function getDb() {
  if (!db) {
    try {
      db = new Database(DB_PATH);
      db.pragma("journal_mode = WAL");
    } catch {
      return null;
    }
  }
  return db;
}

// Generic writing labels that every author in the DB will have — not useful as credentials.
const HIDDEN_CREDENTIALS = new Set([
  "Writer",
  "Novelist",
  "Author",
  "Poet",
  "Screenwriter",
  "Playwright",
  "Children's Author",
  "Memoirist",
  "Essayist",
  "Lyricist",
  "Librettist",
  "Comics Creator",
]);

/**
 * Look up credentials for authors by name.
 * Merges Wikidata and manual credentials, filtering out generic writing labels.
 * @param {string[]} authorNames
 * @returns {Record<string, string[]>}
 */
export function getAuthorCredentials(authorNames) {
  const conn = getDb();
  if (!conn || authorNames.length === 0) return {};

  const stmt = conn.prepare(`
    SELECT a.name, ac.credential, ac.source
    FROM author_credentials ac
    JOIN authors a ON a.key = ac.author_key
    WHERE a.name IN (${authorNames.map(() => "?").join(", ")})
    ORDER BY a.name, ac.source, ac.credential
  `);

  const rows = stmt.all(...authorNames);
  const result = {};

  for (const row of rows) {
    if (HIDDEN_CREDENTIALS.has(row.credential)) continue;

    if (!result[row.name]) {
      result[row.name] = [];
    }
    if (!result[row.name].includes(row.credential)) {
      result[row.name].push(row.credential);
    }
  }

  return result;
}

/**
 * Add a manual credential for an author.
 * If the author doesn't exist in the authors table, creates a synthetic key.
 * @param {string} authorName
 * @param {string} credential
 */
export function addAuthorCredential(authorName, credential) {
  const conn = getDb();
  if (!conn) throw new Error("Catalog DB not available");

  const trimmedName = authorName.trim();
  const trimmedCred = credential.trim();
  if (!trimmedName || !trimmedCred) throw new Error("Author and credential are required");

  // Find existing author key, or create a synthetic one
  let authorKey = conn
    .prepare("SELECT key FROM authors WHERE name = ? COLLATE NOCASE")
    .get(trimmedName)?.key;

  if (!authorKey) {
    authorKey = `/authors/manual:${trimmedName.toLowerCase().replace(/\s+/g, "-")}`;
    conn.prepare("INSERT OR IGNORE INTO authors (key, name) VALUES (?, ?)").run(
      authorKey,
      trimmedName,
    );
  }

  // Check for duplicate
  const exists = conn
    .prepare(
      "SELECT 1 FROM author_credentials WHERE author_key = ? AND credential = ?",
    )
    .get(authorKey, trimmedCred);

  if (exists) return;

  conn
    .prepare(
      "INSERT INTO author_credentials (author_key, credential, wikidata_id, source) VALUES (?, ?, NULL, 'manual')",
    )
    .run(authorKey, trimmedCred);
}

/**
 * Remove a manual credential for an author.
 * Only removes manually-added credentials, not Wikidata ones.
 * @param {string} authorName
 * @param {string} credential
 */
export function removeAuthorCredential(authorName, credential) {
  const conn = getDb();
  if (!conn) throw new Error("Catalog DB not available");

  const authorKey = conn
    .prepare("SELECT key FROM authors WHERE name = ? COLLATE NOCASE")
    .get(authorName.trim())?.key;

  if (!authorKey) return;

  conn
    .prepare(
      "DELETE FROM author_credentials WHERE author_key = ? AND credential = ? AND source = 'manual'",
    )
    .run(authorKey, credential.trim());
}
