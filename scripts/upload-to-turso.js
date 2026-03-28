#!/usr/bin/env node
/**
 * Uploads the trimmed SQLite database to Turso in batches.
 * Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/upload-to-turso.js
 */

import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dbPath = process.env.LOCAL_DB_PATH ?? resolve(rootDir, "data", "openlibrary-trimmed.db");

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoToken) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables");
  process.exit(1);
}

const local = new Database(dbPath, { readonly: true });
const remote = createClient({ url: tursoUrl, authToken: tursoToken });

// Turso max batch size and concurrency
const BATCH_SIZE = 500;
const CONCURRENCY = 6;

async function uploadTable(tableName, columns, skipExisting = 0) {
  const colList = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insertSql = `INSERT OR IGNORE INTO ${tableName} (${colList}) VALUES (${placeholders})`;

  const total = local.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get().cnt;
  console.log(`\nUploading ${tableName}: ${total.toLocaleString()} rows (skipping first ${skipExisting.toLocaleString()})`);

  const selectAll = local.prepare(`SELECT ${colList} FROM ${tableName}`);
  let batch = [];
  let uploaded = skipExisting;
  let skipped = 0;
  let inflight = [];

  for (const row of selectAll.iterate()) {
    // Skip rows already uploaded
    if (skipped < skipExisting) {
      skipped++;
      continue;
    }

    const values = columns.map((col) => row[col] ?? null);
    batch.push({ sql: insertSql, args: values });

    if (batch.length >= BATCH_SIZE) {
      const currentBatch = batch;
      batch = [];

      inflight.push(
        remote.batch(currentBatch, "write").then(() => {
          uploaded += currentBatch.length;
        })
      );

      // Limit concurrency
      if (inflight.length >= CONCURRENCY) {
        await Promise.all(inflight);
        inflight = [];
        if (uploaded % 100000 < BATCH_SIZE * CONCURRENCY) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const rate = (uploaded / ((Date.now() - startTime) / 1000)).toFixed(0);
          console.log(`  ${uploaded.toLocaleString()} / ${total.toLocaleString()} (${((uploaded / total) * 100).toFixed(1)}%) - ${rate} rows/s - ${elapsed}s`);
        }
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    inflight.push(
      remote.batch(batch, "write").then(() => {
        uploaded += batch.length;
      })
    );
  }
  if (inflight.length > 0) {
    await Promise.all(inflight);
  }

  console.log(`  Done: ${uploaded.toLocaleString()} rows uploaded`);
}

const startTime = Date.now();

async function main() {
  console.log("Source:", dbPath);
  console.log("Target:", tursoUrl);

  // Check what's already uploaded
  const existingWorks = (await remote.execute("SELECT COUNT(*) as cnt FROM works")).rows[0].cnt;
  const existingAuthors = (await remote.execute("SELECT COUNT(*) as cnt FROM authors")).rows[0].cnt;
  const existingWorkAuthors = (await remote.execute("SELECT COUNT(*) as cnt FROM work_authors")).rows[0].cnt;
  const existingEditions = (await remote.execute("SELECT COUNT(*) as cnt FROM editions")).rows[0].cnt;

  console.log(`\nExisting data: works=${existingWorks}, authors=${existingAuthors}, work_authors=${existingWorkAuthors}, editions=${existingEditions}`);

  // Drop indexes for faster inserts (ignore if already dropped)
  console.log("\nDropping indexes for faster inserts...");
  await remote.batch([
    "DROP INDEX IF EXISTS idx_works_title",
    "DROP INDEX IF EXISTS idx_editions_work",
    "DROP INDEX IF EXISTS idx_editions_series",
    "DROP INDEX IF EXISTS idx_authors_name",
  ], "write");

  if (existingWorks < 3973658) {
    await uploadTable("works", ["key", "title", "subjects"], Number(existingWorks));
  } else {
    console.log("\nworks: already complete");
  }

  if (existingAuthors < 2287696) {
    await uploadTable("authors", ["key", "name"], Number(existingAuthors));
  } else {
    console.log("\nauthors: already complete");
  }

  if (existingWorkAuthors < 4813171) {
    await uploadTable("work_authors", ["work_key", "author_key"], Number(existingWorkAuthors));
  } else {
    console.log("\nwork_authors: already complete");
  }

  if (existingEditions < 12965854) {
    await uploadTable("editions", [
      "key", "work_key", "title", "series", "series_number",
      "publish_year", "isbn_13", "isbn_10", "number_of_pages",
    ], Number(existingEditions));
  } else {
    console.log("\neditions: already complete");
  }

  console.log("\nCreating indexes...");
  await remote.batch([
    "CREATE INDEX IF NOT EXISTS idx_works_title ON works(title COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_editions_work ON editions(work_key)",
    "CREATE INDEX IF NOT EXISTS idx_editions_series ON editions(series)",
    "CREATE INDEX IF NOT EXISTS idx_authors_name ON authors(name COLLATE NOCASE)",
  ], "write");

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nUpload complete in ${totalElapsed} minutes!`);
  local.close();
}

main().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
