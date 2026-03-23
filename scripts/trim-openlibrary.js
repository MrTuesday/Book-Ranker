#!/usr/bin/env node

/**
 * Trim the Open Library SQLite database to only include works that are
 * likely to be useful for search and recommendations.
 *
 * Criteria for keeping a work:
 *   - Has at least one subject (tag)
 *   - Has at least 2 editions (proxy for relevance/popularity)
 *
 * Usage:
 *   node scripts/trim-openlibrary.js [--input ./data/openlibrary.db] [--output ./data/openlibrary-trimmed.db]
 */

import Database from "better-sqlite3";
import { resolve } from "node:path";

const BATCH_SIZE = 50_000;

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    input: resolve("data/openlibrary.db"),
    output: resolve("data/openlibrary-trimmed.db"),
  };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]?.replace(/^--/, "");
    const value = args[i + 1];

    if (flag && value && flag in parsed) {
      parsed[flag] = resolve(value);
    }
  }

  return parsed;
}

function main() {
  const config = parseArgs();

  console.log(`Input database:  ${config.input}`);
  console.log(`Output database: ${config.output}`);

  const source = new Database(config.input, { readonly: true });
  const dest = new Database(config.output);

  // Enable WAL mode for faster writes
  dest.pragma("journal_mode = WAL");
  dest.pragma("synchronous = OFF");
  dest.pragma("cache_size = -512000"); // 500MB cache

  // Create schema in destination
  dest.exec(`
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
      number_of_pages INTEGER,
      FOREIGN KEY (work_key) REFERENCES works(key)
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

  // Step 1: Find qualifying work keys (has subjects + 2 or more editions)
  console.log("\nStep 1: Finding qualifying works...");
  const qualifyingWorks = source.prepare(`
    SELECT w.key
    FROM works w
    WHERE w.subjects IS NOT NULL
      AND w.subjects != '[]'
      AND (SELECT COUNT(*) FROM editions e WHERE e.work_key = w.key) >= 2
  `);

  // Collect qualifying work keys into a set
  const workKeys = new Set();
  for (const row of qualifyingWorks.iterate()) {
    workKeys.add(row.key);
    if (workKeys.size % 500_000 === 0) {
      console.log(`  Found ${workKeys.size.toLocaleString()} qualifying works so far...`);
    }
  }
  console.log(`  Total qualifying works: ${workKeys.size.toLocaleString()}`);

  // Step 2: Copy qualifying works
  console.log("\nStep 2: Copying works...");
  const insertWork = dest.prepare(
    "INSERT OR IGNORE INTO works (key, title, subjects) VALUES (?, ?, ?)"
  );
  const selectWorks = source.prepare("SELECT key, title, subjects FROM works WHERE key = ?");

  let copied = 0;
  const insertWorkBatch = dest.transaction((keys) => {
    for (const key of keys) {
      const row = selectWorks.get(key);
      if (row) {
        insertWork.run(row.key, row.title, row.subjects);
        copied++;
      }
    }
  });

  let batch = [];
  for (const key of workKeys) {
    batch.push(key);
    if (batch.length >= BATCH_SIZE) {
      insertWorkBatch(batch);
      console.log(`  Copied ${copied.toLocaleString()} works...`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    insertWorkBatch(batch);
  }
  console.log(`  Done: ${copied.toLocaleString()} works copied`);

  // Step 3: Copy editions for qualifying works
  console.log("\nStep 3: Copying editions...");
  const insertEdition = dest.prepare(
    `INSERT OR IGNORE INTO editions (key, work_key, title, series, series_number, publish_year, isbn_13, isbn_10, number_of_pages)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const selectEditions = source.prepare(
    "SELECT key, work_key, title, series, series_number, publish_year, isbn_13, isbn_10, number_of_pages FROM editions WHERE work_key = ?"
  );

  let editionsCopied = 0;
  const insertEditionBatch = dest.transaction((keys) => {
    for (const key of keys) {
      for (const row of selectEditions.iterate(key)) {
        insertEdition.run(
          row.key, row.work_key, row.title, row.series,
          row.series_number, row.publish_year, row.isbn_13,
          row.isbn_10, row.number_of_pages
        );
        editionsCopied++;
      }
    }
  });

  batch = [];
  for (const key of workKeys) {
    batch.push(key);
    if (batch.length >= BATCH_SIZE) {
      insertEditionBatch(batch);
      console.log(`  Copied ${editionsCopied.toLocaleString()} editions...`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    insertEditionBatch(batch);
  }
  console.log(`  Done: ${editionsCopied.toLocaleString()} editions copied`);

  // Step 4: Copy work_authors for qualifying works, and collect author keys
  console.log("\nStep 4: Copying work-author links...");
  const insertWorkAuthor = dest.prepare(
    "INSERT OR IGNORE INTO work_authors (work_key, author_key) VALUES (?, ?)"
  );
  const selectWorkAuthors = source.prepare(
    "SELECT work_key, author_key FROM work_authors WHERE work_key = ?"
  );

  const authorKeys = new Set();
  let linksCopied = 0;
  const insertLinkBatch = dest.transaction((keys) => {
    for (const key of keys) {
      for (const row of selectWorkAuthors.iterate(key)) {
        insertWorkAuthor.run(row.work_key, row.author_key);
        authorKeys.add(row.author_key);
        linksCopied++;
      }
    }
  });

  batch = [];
  for (const key of workKeys) {
    batch.push(key);
    if (batch.length >= BATCH_SIZE) {
      insertLinkBatch(batch);
      console.log(`  Copied ${linksCopied.toLocaleString()} links...`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    insertLinkBatch(batch);
  }
  console.log(`  Done: ${linksCopied.toLocaleString()} links copied`);
  console.log(`  Unique authors referenced: ${authorKeys.size.toLocaleString()}`);

  // Step 5: Copy referenced authors
  console.log("\nStep 5: Copying authors...");
  const insertAuthor = dest.prepare(
    "INSERT OR IGNORE INTO authors (key, name) VALUES (?, ?)"
  );
  const selectAuthor = source.prepare("SELECT key, name FROM authors WHERE key = ?");

  let authorsCopied = 0;
  const insertAuthorBatch = dest.transaction((keys) => {
    for (const key of keys) {
      const row = selectAuthor.get(key);
      if (row) {
        insertAuthor.run(row.key, row.name);
        authorsCopied++;
      }
    }
  });

  batch = [];
  for (const key of authorKeys) {
    batch.push(key);
    if (batch.length >= BATCH_SIZE) {
      insertAuthorBatch(batch);
      console.log(`  Copied ${authorsCopied.toLocaleString()} authors...`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    insertAuthorBatch(batch);
  }
  console.log(`  Done: ${authorsCopied.toLocaleString()} authors copied`);

  // Step 6: Create indexes
  console.log("\nStep 6: Creating indexes...");
  dest.exec(`
    CREATE INDEX IF NOT EXISTS idx_works_title ON works(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_editions_work ON editions(work_key);
    CREATE INDEX IF NOT EXISTS idx_editions_series ON editions(series);
    CREATE INDEX IF NOT EXISTS idx_authors_name ON authors(name COLLATE NOCASE);
  `);
  console.log("  Indexes created");

  // Step 7: Compact
  console.log("\nStep 7: Compacting database...");
  dest.pragma("journal_mode = DELETE");
  dest.exec("VACUUM");

  // Summary
  const destWorks = dest.prepare("SELECT COUNT(*) as c FROM works").get().c;
  const destEditions = dest.prepare("SELECT COUNT(*) as c FROM editions").get().c;
  const destAuthors = dest.prepare("SELECT COUNT(*) as c FROM authors").get().c;

  console.log("\n--- Summary ---");
  console.log(`Works:    ${destWorks.toLocaleString()}`);
  console.log(`Editions: ${destEditions.toLocaleString()}`);
  console.log(`Authors:  ${destAuthors.toLocaleString()}`);
  console.log(`Output:   ${config.output}`);

  source.close();
  dest.close();

  console.log("\nDone!");
}

main();
