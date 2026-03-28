#!/usr/bin/env node
/**
 * Step 1: Extract Wikidata IDs from OL authors dump.
 * Reads the gzipped dump, matches against authors in our DB,
 * and outputs a JSON mapping of OL author key -> Wikidata QID.
 *
 * Usage: node scripts/extract-wikidata-ids.js
 */

import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import Database from "better-sqlite3";

const DB_PATH = "data/catalog.db";
const DUMP_PATH = "data/ol_dump_authors.txt.gz";
const OUTPUT_PATH = "data/wikidata-ids.json";

const db = new Database(DB_PATH, { readonly: true });

// Load all our author keys into a Set for fast lookup
console.log("Loading author keys from DB...");
const authorKeys = new Set(
  db.prepare("SELECT key FROM authors").pluck().all()
);
console.log(`  ${authorKeys.size} authors in DB`);
db.close();

// Stream through the gzipped dump
console.log("Streaming OL authors dump...");
const gunzip = createGunzip();
const stream = createReadStream(DUMP_PATH).pipe(gunzip);
const rl = createInterface({ input: stream });

const mapping = {}; // OL key -> Wikidata QID
let processed = 0;
let matched = 0;
let withWikidata = 0;

for await (const line of rl) {
  processed++;
  if (processed % 500000 === 0) {
    console.log(`  ${processed} authors processed, ${matched} in our DB, ${withWikidata} with Wikidata`);
  }

  // OL dump format: type\tkey\trevision\tlast_modified\tjson
  const parts = line.split("\t");
  if (parts.length < 5) continue;

  const key = parts[1]; // e.g., /authors/OL12345A
  if (!authorKeys.has(key)) continue;
  matched++;

  try {
    const data = JSON.parse(parts[4]);
    const wikidataId =
      data.remote_ids?.wikidata ||
      // Some older records use different field names
      data.links?.find?.((l) => l.url?.includes("wikidata"))?.title;

    if (wikidataId) {
      // Normalize to just the QID
      const qid = wikidataId.match(/Q\d+/)?.[0];
      if (qid) {
        mapping[key] = qid;
        withWikidata++;
      }
    }
  } catch {
    // Skip malformed JSON
  }
}

console.log(`\nDone!`);
console.log(`  Total processed: ${processed}`);
console.log(`  Matched to our DB: ${matched}`);
console.log(`  With Wikidata QID: ${withWikidata}`);

await writeFile(OUTPUT_PATH, JSON.stringify(mapping, null, 2));
console.log(`  Saved to ${OUTPUT_PATH}`);
