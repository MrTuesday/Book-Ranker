#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "catalog.db");
const WIKIDATA_IDS_PATH = path.join(ROOT, "data", "wikidata-ids.json");
const QUALIFICATIONS_PATH = path.join(ROOT, "data", "author-qualifications.json");

function normalizeWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function toTitleCase(value) {
  return value
    .split(/[\s/-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index > 0 && ["and", "in", "of", "the", "for"].includes(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function normalizeQualificationField(rawValue) {
  const value = normalizeWhitespace(rawValue);

  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value) || /wikidata\.org\/\.well-known\/genid/i.test(value)) {
    return null;
  }

  const lower = value.toLowerCase();
  const aliases = new Map([
    ["study of history", "History"],
    ["historical science", "History"],
  ]);

  if (aliases.has(lower)) {
    return aliases.get(lower);
  }

  const trimmed = value.replace(/^study of\s+/i, "");
  return toTitleCase(trimmed);
}

const FIELD_ELIGIBLE_DEGREES = new Set([
  "MD",
  "JD",
  "LLD",
  "DD",
  "ThD",
  "DSc",
  "PhD",
  "MBA",
  "DBA",
  "MPhil",
  "MFA",
  "MPH",
  "MSc",
  "MEng",
  "MA",
  "Master's",
]);

const REDUNDANT_FIELDS_BY_DEGREE = new Map([
  ["MD", new Set(["Medicine"])],
  ["JD", new Set(["Law"])],
  ["LLD", new Set(["Law"])],
  ["DD", new Set(["Divinity"])],
  ["ThD", new Set(["Theology"])],
  ["MBA", new Set(["Business Administration"])],
  ["DBA", new Set(["Business Administration"])],
  ["MPhil", new Set(["Philosophy"])],
  ["MFA", new Set(["Fine Arts"])],
  ["MPH", new Set(["Public Health"])],
  ["MSc", new Set(["Science"])],
  ["MEng", new Set(["Engineering"])],
  ["MA", new Set(["Arts"])],
]);

function applyQualificationField(credential, rawField) {
  const field = normalizeQualificationField(rawField);

  if (!field || !FIELD_ELIGIBLE_DEGREES.has(credential)) {
    return credential;
  }

  if (REDUNDANT_FIELDS_BY_DEGREE.get(credential)?.has(field)) {
    return credential;
  }

  return `${credential} in ${field}`;
}

function applyProfessorField(rawField) {
  const field = normalizeQualificationField(rawField);

  if (!field) {
    return null;
  }

  return `Professor of ${field}`;
}

function normalizeQualificationCredential(rawValue, rawField) {
  const value = normalizeWhitespace(rawValue);

  if (!value) {
    return null;
  }

  const lower = value.toLowerCase();

  if (
    /\b(high school diploma|baccalauréat|abitur|royal college of science|doctoral student)\b/.test(
      lower,
    )
  ) {
    return null;
  }

  if (/\bprofessor\b/.test(lower)) {
    return applyProfessorField(rawField);
  }

  if (/\blecturer\b/.test(lower) || /\bdocent\b/.test(lower) || /\bhabilitation\b/.test(lower)) {
    return null;
  }

  if (
    /\b(doctor of medicine|medical doctor|doctor rerum medicinalium|dipl[oô]me d['’]état de docteur en médecine)\b/.test(
      lower,
    )
  ) {
    return applyQualificationField("MD", rawField);
  }

  if (/\bjuris doctor\b/.test(lower)) {
    return applyQualificationField("JD", rawField);
  }

  if (
    /\b(doctor of laws|legum doctor|doctor of civil law|doctor of juridical science|doctor of law)\b/.test(
      lower,
    )
  ) {
    return applyQualificationField("LLD", rawField);
  }

  if (/\bdoctor of divinity\b/.test(lower)) {
    return applyQualificationField("DD", rawField);
  }

  if (/\bdoctor of theology\b/.test(lower)) {
    return applyQualificationField("ThD", rawField);
  }

  if (
    /\b(doctor of science|doctor of sciences|doctor of natural sciences|doctor of historical sciences|doctor of political science|doctor of economics|doctor of geological and mineralogical sciences|doctor of medical science|doktor.*sciences|candidate of sciences)\b/.test(
      lower,
    )
  ) {
    return applyQualificationField("DSc", rawField);
  }

  if (
    /\b(doctorate|doctor of philosophy|doctor of arts|doctor of letters|doctor of music|doctor of fine arts|doctor in engineering|doctor of engineering|doctor of philosophy \(|doctorate in |philosophiae doctor|phd)\b/.test(
      lower,
    )
  ) {
    return applyQualificationField("PhD", rawField);
  }

  if (/\bmaster of business administration\b/.test(lower)) {
    return applyQualificationField("MBA", rawField);
  }

  if (/\bdoctor of business administration\b/.test(lower)) {
    return applyQualificationField("DBA", rawField);
  }

  if (/\bmaster of philosophy\b/.test(lower)) {
    return applyQualificationField("MPhil", rawField);
  }

  if (/\bmaster of fine arts\b/.test(lower)) {
    return applyQualificationField("MFA", rawField);
  }

  if (/\bmaster of public health\b/.test(lower)) {
    return applyQualificationField("MPH", rawField);
  }

  if (
    /\b(master of science|master of sciences|licence ès sciences|master of science in engineering)\b/.test(
      lower,
    )
  ) {
    return applyQualificationField("MSc", rawField);
  }

  if (/\bmaster of engineering\b/.test(lower)) {
    return applyQualificationField("MEng", rawField);
  }

  if (
    /\b(master of arts|magister artium|french masters degree|french university master)\b/.test(
      lower,
    )
  ) {
    return applyQualificationField("MA", rawField);
  }

  if (/\bmaster's degree\b/.test(lower)) {
    return applyQualificationField("Master's", rawField);
  }

  return null;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const qualifications = loadJson(QUALIFICATIONS_PATH);
const wikidataIds = loadJson(WIKIDATA_IDS_PATH);

const qidToAuthorKeys = new Map();
for (const [authorKey, wikidataId] of Object.entries(wikidataIds)) {
  const normalizedQid = normalizeWhitespace(wikidataId);
  if (!normalizedQid) {
    continue;
  }

  const currentKeys = qidToAuthorKeys.get(normalizedQid) ?? new Set();
  currentKeys.add(authorKey);
  qidToAuthorKeys.set(normalizedQid, currentKeys);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_author_credentials_author_key ON author_credentials(author_key)",
);

const hasCredential = db.prepare(
  "SELECT 1 FROM author_credentials WHERE author_key = ? AND credential = ? COLLATE NOCASE LIMIT 1",
);
const insertCredential = db.prepare(
  "INSERT INTO author_credentials (author_key, credential, wikidata_id, source) VALUES (?, ?, ?, 'qualification')",
);
const deleteQualificationCredentials = db.prepare(
  "DELETE FROM author_credentials WHERE source = 'qualification'",
);

let inserted = 0;
let skippedUnmapped = 0;
let skippedUnusable = 0;

const insertMany = db.transaction((rows) => {
  deleteQualificationCredentials.run();

  for (const row of rows) {
    const qid = normalizeWhitespace(row.wikidata_id);
    const credential = normalizeQualificationCredential(row.degree, row.field);

    if (!qid) {
      skippedUnmapped += 1;
      continue;
    }

    if (!credential) {
      skippedUnusable += 1;
      continue;
    }

    const authorKeys = qidToAuthorKeys.get(qid);

    if (!authorKeys || authorKeys.size === 0) {
      skippedUnmapped += 1;
      continue;
    }

    for (const authorKey of authorKeys) {
      if (hasCredential.get(authorKey, credential)) {
        continue;
      }

      insertCredential.run(authorKey, credential, qid);
      inserted += 1;
    }
  }
});

insertMany(qualifications);

const summary = db
  .prepare(
    `
      SELECT credential, COUNT(*) AS count
      FROM author_credentials
      WHERE source = 'qualification'
      GROUP BY credential
      ORDER BY count DESC, credential ASC
    `,
  )
  .all();

db.close();

console.log(`Inserted ${inserted} qualification credentials`);
console.log(`Skipped ${skippedUnmapped} rows with no mapped author`);
console.log(`Skipped ${skippedUnusable} rows with no supported credential`);
console.log("Qualification credential totals:");
for (const row of summary) {
  console.log(`  ${row.count} | ${row.credential}`);
}
