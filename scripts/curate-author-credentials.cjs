#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const { removeCredentials, authors } = require("./author-credential-curation.cjs");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "catalog.db");
const REPORT_ONLY = process.argv.includes("--report-only");

const DEGREE_CREDENTIALS = [
  "MD",
  "PhD",
  "DSc",
  "JD",
  "LLD",
  "DD",
  "ThD",
  "DBA",
  "MBA",
  "MPhil",
  "MSc",
  "MPH",
  "MEng",
  "MFA",
  "MA",
  "Master's",
];

function normalizeWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeCredential(value) {
  return normalizeWhitespace(value);
}

function isDegreeCredential(credential) {
  const normalized = normalizeCredential(credential);
  const lowerNormalized = normalized.toLowerCase();

  return DEGREE_CREDENTIALS.some((degree) => {
    const lowerDegree = degree.toLowerCase();
    return (
      normalized === degree ||
      lowerNormalized.startsWith(`${lowerDegree} in `) ||
      lowerNormalized.startsWith(`${lowerDegree} of `) ||
      normalized.startsWith(`${degree} (`)
    );
  });
}

function isProfessorCredential(credential) {
  return /^Professor(?:\b| of\b| for\b)/i.test(normalizeCredential(credential));
}

function isAllowedCredential(credential) {
  const normalized = normalizeCredential(credential);
  return normalized && (isDegreeCredential(normalized) || isProfessorCredential(normalized));
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

const findAuthorByKey = db.prepare("SELECT key, name FROM authors WHERE key = ?");
const findAuthorsByName = db.prepare("SELECT key, name FROM authors WHERE name = ? COLLATE NOCASE ORDER BY key");
const hasCredential = db.prepare(
  "SELECT 1 FROM author_credentials WHERE author_key = ? AND credential = ? COLLATE NOCASE LIMIT 1",
);
const insertCredential = db.prepare(
  "INSERT INTO author_credentials (author_key, credential, wikidata_id, source) VALUES (?, ?, NULL, 'manual')",
);
const deleteByCredential = db.prepare(
  "DELETE FROM author_credentials WHERE credential = ? COLLATE NOCASE",
);
const deleteCredentialForAuthor = db.prepare(
  "DELETE FROM author_credentials WHERE author_key = ? AND credential = ? COLLATE NOCASE",
);
const listDistinctCredentials = db.prepare("SELECT DISTINCT credential FROM author_credentials");

const removalSet = new Set();
const targetedRemovals = [];
const insertions = [];
const missing = [];
const ambiguous = [];
let duplicateCredentials = 0;
let skippedDisallowedInsertions = 0;

for (const credential of removeCredentials) {
  const normalized = normalizeCredential(credential);
  if (normalized) {
    removalSet.add(normalized);
  }
}

for (const row of listDistinctCredentials.iterate()) {
  const normalized = normalizeCredential(row.credential);
  if (normalized && !isAllowedCredential(normalized)) {
    removalSet.add(normalized);
  }
}

for (const entry of authors) {
  const targetName = normalizeWhitespace(entry.name);
  const resolvedAuthors = [];

  if (Array.isArray(entry.authorKeys) && entry.authorKeys.length > 0) {
    for (const authorKey of entry.authorKeys) {
      const author = findAuthorByKey.get(authorKey) || null;
      if (!author) {
        missing.push({ name: targetName, authorKey, reason: "missing key" });
        continue;
      }
      resolvedAuthors.push(author);
    }
  } else if (entry.authorKey) {
    const author = findAuthorByKey.get(entry.authorKey) || null;
    if (!author) {
      missing.push({ name: targetName, authorKey: entry.authorKey, reason: "missing key" });
      continue;
    }
    resolvedAuthors.push(author);
  } else {
    const rows = findAuthorsByName.all(targetName);
    if (rows.length === 0) {
      missing.push({ name: targetName, reason: "missing name" });
      continue;
    }
    if (rows.length > 1) {
      ambiguous.push({
        name: targetName,
        matches: rows.map((row) => row.key),
      });
      continue;
    }
    resolvedAuthors.push(rows[0]);
  }

  for (const author of resolvedAuthors) {
    for (const rawCredential of entry.removeCredentials || []) {
      const credential = normalizeCredential(rawCredential);
      if (!credential) continue;
      targetedRemovals.push({
        authorKey: author.key,
        authorName: author.name,
        credential,
      });
    }

    for (const rawCredential of entry.credentials || []) {
      const credential = normalizeCredential(rawCredential);
      if (!credential) continue;
      if (!isAllowedCredential(credential)) {
        skippedDisallowedInsertions += 1;
        continue;
      }
      if (hasCredential.get(author.key, credential)) {
        duplicateCredentials += 1;
        continue;
      }
      insertions.push({
        authorKey: author.key,
        authorName: author.name,
        credential,
      });
    }
  }
}

let removedRows = 0;
let insertedRows = 0;
const removals = Array.from(removalSet);

if (!REPORT_ONLY) {
  const applyChanges = db.transaction(() => {
    for (const credential of removals) {
      removedRows += deleteByCredential.run(credential).changes;
    }

    for (const row of targetedRemovals) {
      removedRows += deleteCredentialForAuthor.run(row.authorKey, row.credential).changes;
    }

    for (const row of insertions) {
      insertedRows += insertCredential.run(row.authorKey, row.credential).changes;
    }
  });

  applyChanges();
  db.pragma("wal_checkpoint(TRUNCATE)");
}

console.log(`${REPORT_ONLY ? "Report" : "Applied"} credential curation for ${DB_PATH}`);
console.log(`Global removals configured: ${removals.length}`);
console.log(`Curated author entries: ${authors.length}`);
console.log(`Rows removed: ${removedRows}`);
console.log(`Rows inserted: ${insertedRows}`);
console.log(`Already present credentials skipped: ${duplicateCredentials}`);
console.log(`Disallowed curated credentials skipped: ${skippedDisallowedInsertions}`);
console.log(`Missing authors: ${missing.length}`);
console.log(`Ambiguous authors: ${ambiguous.length}`);

if (missing.length > 0) {
  console.log("\nMissing authors:");
  for (const row of missing.slice(0, 50)) {
    const suffix = row.authorKey ? ` (${row.authorKey})` : "";
    console.log(`  ${row.name}${suffix} - ${row.reason}`);
  }
}

if (ambiguous.length > 0) {
  console.log("\nAmbiguous author names:");
  for (const row of ambiguous.slice(0, 50)) {
    console.log(`  ${row.name} -> ${row.matches.join(", ")}`);
  }
}

if (insertions.length > 0) {
  console.log("\nSample planned inserts:");
  for (const row of insertions.slice(0, 20)) {
    console.log(`  ${row.authorName} -> ${row.credential}`);
  }
}

db.close();

if (!REPORT_ONLY) {
  const collapseResult = spawnSync(
    process.execPath,
    [path.join(__dirname, "collapse-author-credentials.cjs")],
    {
      cwd: ROOT,
      env: { ...process.env, DB_PATH },
      stdio: "inherit",
    },
  );

  if (collapseResult.status !== 0) {
    process.exit(collapseResult.status ?? 1);
  }
}
