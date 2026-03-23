#!/usr/bin/env node

/**
 * Import Open Library bulk data dumps into a local SQLite database.
 *
 * Usage:
 *   node scripts/import-openlibrary.js \
 *     --works ./dumps/ol_dump_works_latest.txt.gz \
 *     --editions ./dumps/ol_dump_editions_latest.txt.gz \
 *     --authors ./dumps/ol_dump_authors_latest.txt.gz \
 *     --output ./data/openlibrary.db
 *
 * Each dump file is a gzipped TSV where each line is:
 *   type \t key \t revision \t last_modified \t json
 *
 * Downloads available at: https://openlibrary.org/developers/dumps
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const BATCH_SIZE = 10_000;
const PROGRESS_INTERVAL = 100_000;

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    works: null,
    editions: null,
    authors: null,
    output: resolve("data/openlibrary.db"),
  };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]?.replace(/^--/, "");
    const value = args[i + 1];

    if (flag && value && flag in parsed) {
      parsed[flag] = resolve(value);
    }
  }

  if (!parsed.works || !parsed.editions || !parsed.authors) {
    console.error(
      "Usage: node scripts/import-openlibrary.js \\\n" +
        "  --works <works_dump.txt.gz> \\\n" +
        "  --editions <editions_dump.txt.gz> \\\n" +
        "  --authors <authors_dump.txt.gz> \\\n" +
        "  [--output <output.db>]",
    );
    process.exit(1);
  }

  return parsed;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS works (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subjects TEXT
    );

    CREATE TABLE IF NOT EXISTS editions (
      key TEXT PRIMARY KEY,
      work_key TEXT NOT NULL,
      title TEXT,
      series TEXT,
      series_number REAL,
      publish_year INTEGER,
      isbn_13 TEXT,
      isbn_10 TEXT,
      number_of_pages INTEGER
    );

    CREATE TABLE IF NOT EXISTS authors (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_authors (
      work_key TEXT NOT NULL,
      author_key TEXT NOT NULL,
      PRIMARY KEY (work_key, author_key)
    );
  `);
}

function createIndexes(db) {
  console.log("Creating indexes...");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_works_title ON works(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_editions_work ON editions(work_key);
    CREATE INDEX IF NOT EXISTS idx_editions_series ON editions(series) WHERE series IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_editions_publish_year ON editions(publish_year) WHERE publish_year IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_authors_name ON authors(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_work_authors_work ON work_authors(work_key);
    CREATE INDEX IF NOT EXISTS idx_work_authors_author ON work_authors(author_key);
    CREATE INDEX IF NOT EXISTS idx_editions_isbn13 ON editions(isbn_13) WHERE isbn_13 IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_editions_isbn10 ON editions(isbn_10) WHERE isbn_10 IS NOT NULL;
  `);
  console.log("Indexes created.");
}

function openLineReader(filePath) {
  const gunzip = createGunzip();
  const stream = createReadStream(filePath).pipe(gunzip);

  return createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
}

function parseDumpLine(line) {
  const parts = line.split("\t");

  if (parts.length < 5) {
    return null;
  }

  try {
    return {
      type: parts[0],
      key: parts[1],
      json: JSON.parse(parts[4]),
    };
  } catch {
    return null;
  }
}

function extractSubjects(json) {
  const subjects = json?.subjects;

  if (!Array.isArray(subjects)) {
    return null;
  }

  const filtered = subjects
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());

  return filtered.length > 0 ? JSON.stringify(filtered) : null;
}

function extractAuthorKeys(json) {
  const authors = json?.authors;

  if (!Array.isArray(authors)) {
    return [];
  }

  return authors
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const ref = entry?.author ?? entry;
      return typeof ref?.key === "string" ? ref.key : null;
    })
    .filter(Boolean);
}

function extractSeriesNumber(value) {
  if (value == null) {
    return null;
  }

  const str = String(value).trim();
  const match = str.match(/[\d.]+/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractYear(json) {
  const date = json?.publish_date ?? json?.first_publish_date;

  if (typeof date !== "string") {
    return null;
  }

  const match = date.match(/\b(\d{4})\b/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  return year >= 1000 && year <= 2100 ? year : null;
}

function extractIsbn(json, field) {
  const values = json?.[field];

  if (!Array.isArray(values)) {
    return null;
  }

  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function extractWorkKey(json) {
  const works = json?.works;

  if (Array.isArray(works) && works.length > 0) {
    const key = works[0]?.key;

    if (typeof key === "string") {
      return key;
    }
  }

  return null;
}

async function importAuthors(db, filePath) {
  console.log("Importing authors...");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO authors (key, name) VALUES (?, ?)",
  );
  const reader = openLineReader(filePath);
  let count = 0;
  let batch = [];

  const flush = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(row.key, row.name);
    }
  });

  for await (const line of reader) {
    const parsed = parseDumpLine(line);

    if (!parsed) {
      continue;
    }

    const name =
      typeof parsed.json?.name === "string" ? parsed.json.name.trim() : "";

    if (!name) {
      continue;
    }

    batch.push({ key: parsed.key, name });
    count += 1;

    if (batch.length >= BATCH_SIZE) {
      flush(batch);
      batch = [];
    }

    if (count % PROGRESS_INTERVAL === 0) {
      console.log(`  Authors: ${(count / 1_000_000).toFixed(1)}M processed`);
    }
  }

  if (batch.length > 0) {
    flush(batch);
  }

  console.log(`  Authors: ${count.toLocaleString()} imported.`);
}

async function importWorks(db, filePath) {
  console.log("Importing works...");
  const insertWork = db.prepare(
    "INSERT OR IGNORE INTO works (key, title, subjects) VALUES (?, ?, ?)",
  );
  const insertWorkAuthor = db.prepare(
    "INSERT OR IGNORE INTO work_authors (work_key, author_key) VALUES (?, ?)",
  );
  const reader = openLineReader(filePath);
  let count = 0;
  let batch = [];

  const flush = db.transaction((rows) => {
    for (const row of rows) {
      insertWork.run(row.key, row.title, row.subjects);

      for (const authorKey of row.authorKeys) {
        insertWorkAuthor.run(row.key, authorKey);
      }
    }
  });

  for await (const line of reader) {
    const parsed = parseDumpLine(line);

    if (!parsed) {
      continue;
    }

    const title =
      typeof parsed.json?.title === "string" ? parsed.json.title.trim() : "";

    if (!title) {
      continue;
    }

    batch.push({
      key: parsed.key,
      title,
      subjects: extractSubjects(parsed.json),
      authorKeys: extractAuthorKeys(parsed.json),
    });
    count += 1;

    if (batch.length >= BATCH_SIZE) {
      flush(batch);
      batch = [];
    }

    if (count % PROGRESS_INTERVAL === 0) {
      console.log(`  Works: ${(count / 1_000_000).toFixed(1)}M processed`);
    }
  }

  if (batch.length > 0) {
    flush(batch);
  }

  console.log(`  Works: ${count.toLocaleString()} imported.`);
}

async function importEditions(db, filePath) {
  console.log("Importing editions...");
  const insert = db.prepare(
    `INSERT OR IGNORE INTO editions
      (key, work_key, title, series, series_number, publish_year, isbn_13, isbn_10, number_of_pages)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const reader = openLineReader(filePath);
  let count = 0;
  let batch = [];

  const flush = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(
        row.key,
        row.workKey,
        row.title,
        row.series,
        row.seriesNumber,
        row.publishYear,
        row.isbn13,
        row.isbn10,
        row.numberOfPages,
      );
    }
  });

  for await (const line of reader) {
    const parsed = parseDumpLine(line);

    if (!parsed) {
      continue;
    }

    const workKey = extractWorkKey(parsed.json);

    if (!workKey) {
      continue;
    }

    const title =
      typeof parsed.json?.title === "string" ? parsed.json.title.trim() : null;

    const rawSeries = parsed.json?.series;
    const series =
      typeof rawSeries === "string" && rawSeries.trim()
        ? rawSeries.trim()
        : Array.isArray(rawSeries) && typeof rawSeries[0] === "string"
          ? rawSeries[0].trim()
          : null;

    batch.push({
      key: parsed.key,
      workKey,
      title,
      series: series || null,
      seriesNumber: extractSeriesNumber(parsed.json?.series_number),
      publishYear: extractYear(parsed.json),
      isbn13: extractIsbn(parsed.json, "isbn_13"),
      isbn10: extractIsbn(parsed.json, "isbn_10"),
      numberOfPages:
        typeof parsed.json?.number_of_pages === "number"
          ? parsed.json.number_of_pages
          : null,
    });
    count += 1;

    if (batch.length >= BATCH_SIZE) {
      flush(batch);
      batch = [];
    }

    if (count % PROGRESS_INTERVAL === 0) {
      console.log(`  Editions: ${(count / 1_000_000).toFixed(1)}M processed`);
    }
  }

  if (batch.length > 0) {
    flush(batch);
  }

  console.log(`  Editions: ${count.toLocaleString()} imported.`);
}

async function main() {
  const args = parseArgs();
  console.log(`Output database: ${args.output}`);

  const db = new Database(args.output);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -256000"); // 256MB cache

  createSchema(db);

  const start = Date.now();

  await importAuthors(db, args.authors);
  await importWorks(db, args.works);
  await importEditions(db, args.editions);
  createIndexes(db);

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  console.log(`\nImport complete in ${elapsed} minutes.`);

  db.close();
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
