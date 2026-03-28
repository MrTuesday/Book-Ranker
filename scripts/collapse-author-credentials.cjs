#!/usr/bin/env node

const path = require("node:path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "catalog.db");

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

function isProfessorCredential(credential) {
  return /^Professor(?:\b| of\b| for\b)/i.test(normalizeCredential(credential));
}

function degreeCredentialRank(credential) {
  const normalized = normalizeCredential(credential);
  const lowerNormalized = normalized.toLowerCase();

  for (const [index, degree] of DEGREE_CREDENTIALS.entries()) {
    const lowerDegree = degree.toLowerCase();
    if (
      normalized === degree ||
      lowerNormalized.startsWith(`${lowerDegree} in `) ||
      lowerNormalized.startsWith(`${lowerDegree} of `) ||
      normalized.startsWith(`${degree} (`)
    ) {
      return index;
    }
  }

  return null;
}

function degreeCredentialSpecificity(credential) {
  const normalized = normalizeCredential(credential);
  const lowerNormalized = normalized.toLowerCase();

  if (lowerNormalized.includes(" in ") || lowerNormalized.includes(" of ")) {
    return 2;
  }

  if (normalized.includes("(")) {
    return 1;
  }

  return 0;
}

function compareRankedCredentials(left, right) {
  const leftSpecificity = degreeCredentialSpecificity(left);
  const rightSpecificity = degreeCredentialSpecificity(right);

  if (leftSpecificity !== rightSpecificity) {
    return rightSpecificity - leftSpecificity;
  }

  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return left.localeCompare(right);
}

function highestDegreeCredential(credentials) {
  let best = null;
  let bestRank = null;

  for (const credential of credentials) {
    const rank = degreeCredentialRank(credential);

    if (rank == null) {
      continue;
    }

    if (bestRank == null || rank < bestRank) {
      best = credential;
      bestRank = rank;
      continue;
    }

    if (rank === bestRank && best != null && compareRankedCredentials(credential, best) < 0) {
      best = credential;
    }
  }

  return best;
}

function keptCredentialsForAuthor(credentials) {
  const normalizedCredentials = Array.from(
    new Set(credentials.map((credential) => normalizeCredential(credential)).filter(Boolean)),
  );
  const professorCredentials = normalizedCredentials
    .filter((credential) => isProfessorCredential(credential))
    .sort((left, right) => left.localeCompare(right));

  if (professorCredentials.length > 0) {
    return professorCredentials;
  }

  const highestDegree = highestDegreeCredential(normalizedCredentials);
  return highestDegree ? [highestDegree] : [];
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

const listAllCredentials = db.prepare(
  "SELECT author_key, credential FROM author_credentials ORDER BY author_key, credential COLLATE NOCASE",
);
const deleteCredentialForAuthor = db.prepare(
  "DELETE FROM author_credentials WHERE author_key = ? AND credential = ? COLLATE NOCASE",
);

let removedRows = 0;
let changedAuthors = 0;

const collapse = db.transaction(() => {
  const credentialsByAuthor = new Map();

  for (const row of listAllCredentials.all()) {
    const currentCredentials = credentialsByAuthor.get(row.author_key) ?? [];
    currentCredentials.push(row.credential);
    credentialsByAuthor.set(row.author_key, currentCredentials);
  }

  for (const [authorKey, credentials] of credentialsByAuthor) {
    const keep = new Set(keptCredentialsForAuthor(credentials));
    const distinctCredentials = Array.from(
      new Set(credentials.map((credential) => normalizeCredential(credential)).filter(Boolean)),
    );
    let authorChanged = false;

    for (const credential of distinctCredentials) {
      if (!keep.has(credential)) {
        const changes = deleteCredentialForAuthor.run(authorKey, credential).changes;
        removedRows += changes;
        if (changes > 0) {
          authorChanged = true;
        }
      }
    }

    if (authorChanged) {
      changedAuthors += 1;
    }
  }
});

collapse();
db.pragma("wal_checkpoint(TRUNCATE)");

console.log(`Collapsed author credentials for ${DB_PATH}`);
console.log(`Authors changed: ${changedAuthors}`);
console.log(`Rows removed: ${removedRows}`);

db.close();
