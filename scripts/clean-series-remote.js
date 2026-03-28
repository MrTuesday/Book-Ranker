#!/usr/bin/env node
/**
 * Clean series data in the SQLite database on Fly.
 * Removes junk series (publisher imprints, digitization projects,
 * catalog collections, non-Latin text) and adds consensus series
 * to the works table.
 *
 * Run on Fly: fly ssh console -a book-ranker-catalog -C "node /app/scripts/clean-series-remote.js"
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "/data/openlibrary.db";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// --- Step 1: NULL out junk series in editions ---

const JUNK_PATTERNS = [
  // Digitization / archive projects
  "early english books",
  "nineteenth century collections",
  "women's studies archive",
  "three centuries of drama",
  "making of the modern world",
  "samp early",
  "landmarks ii",
  "landmarks of science",
  "essay index reprint",
  "reprints of economic classics",
  "american casebook series",
  "english and american drama",
  "Minguo ji cui",

  // Publisher imprints / collections (not real series)
  "penguin classics",
  "penguin books",
  "penguin modern classics",
  "vintage classics",
  "everyman's library",
  "oxford world's classics",
  "bantam classics",
  "signet classics",
  "dover thrift",
  "wordsworth classics",
  "virago modern classics",
  "faber and faber",
  "pelican books",
  "anchor books",
  "picador",
  "harper perennial",
  "vintage international",
  "modern library",
  "new york review books",
  "nyrb classics",
  "library of america",
  "broadview editions",
  "norton critical edition",
  "cambridge texts",
  "loeb classical library",

  // Generic/catalog labels
  "large print",
  "large type",
  "book club edition",
  "first edition",
  "limited edition",
  "collector's edition",
  "reader's digest",
  "mass market",
  "trade paperback",
  "audio cd",
  "audiobook",
  "unabridged",

  // Government / institutional
  "s. hrg.",
  "s. doc.",
  "s. rpt.",
  "h.r.",
  "house document",
  "senate document",
  "congressional",
  "committee print",
  "public law",
  "united nations",

  // Academic / generic series names
  "lecture notes",
  "springer",
  "wiley series",
  "cambridge studies",
  "oxford studies",
  "routledge",
  "world scientific",
  "elsevier",
  "academic press",
  "proceedings of",
  "annals of",
  "advances in",
  "journal of",
  "transactions of",
  "contributions to",
  "studies in",
  "research in",
  "monographs in",
  "handbook of",
  "encyclopedia of",
  "bibliography of",
  "catalogue of",
  "catalog of",

  // Foreign publisher imprints
  "collection folio",
  "livre de poche",
  "biblioteca",
  "bibliothek",
  "classici",
  "ediciones",
  "editorial",
  "verlag",
  "taschenbuch",
  "reclam",
  "gallimard",
  "suhrkamp",
];

// Build a single SQL with OR conditions for LIKE matching
console.log("Step 1: Cleaning junk series from editions...");

// First: NULL out non-Latin series (Cyrillic, CJK, Arabic, etc.)
// We keep only series that are primarily ASCII/Latin
const nonLatinResult = db.prepare(`
  UPDATE editions SET series = NULL, series_number = NULL
  WHERE series IS NOT NULL
  AND series != ''
  AND (
    -- Contains Cyrillic
    series GLOB '*[а-яА-ЯёЁ]*'
    -- Contains CJK
    OR series GLOB '*[一-鿿]*'
    -- Contains Arabic
    OR series GLOB '*[؀-ۿ]*'
    -- Contains Devanagari/Hindi
    OR series GLOB '*[ऀ-ॿ]*'
    -- Contains Thai
    OR series GLOB '*[ก-๛]*'
    -- Contains Korean
    OR series GLOB '*[가-힣]*'
  )
`).run();
console.log(`  Removed ${nonLatinResult.changes} non-Latin series`);

// NULL out series matching junk patterns (case-insensitive via LIKE)
let totalJunkRemoved = 0;
const updateStmt = db.prepare(`
  UPDATE editions SET series = NULL, series_number = NULL
  WHERE series IS NOT NULL AND LOWER(series) LIKE ?
`);

for (const pattern of JUNK_PATTERNS) {
  const result = updateStmt.run(`%${pattern.toLowerCase()}%`);
  if (result.changes > 0) {
    console.log(`  "${pattern}": ${result.changes} removed`);
    totalJunkRemoved += result.changes;
  }
}
console.log(`  Total junk patterns removed: ${totalJunkRemoved}`);

// NULL out very short series (1-2 chars) and pure numbers
const shortResult = db.prepare(`
  UPDATE editions SET series = NULL, series_number = NULL
  WHERE series IS NOT NULL AND (
    LENGTH(TRIM(series)) <= 2
    OR TRIM(series) GLOB '[0-9]*'
    OR TRIM(series) GLOB '[-;,. ]*'
  )
`).run();
console.log(`  Short/numeric series removed: ${shortResult.changes}`);

// NULL out series that are just a single work's title repeated
// (e.g., series = "1984" for the book "1984")
const selfRefResult = db.prepare(`
  UPDATE editions SET series = NULL, series_number = NULL
  WHERE series IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM works w
    WHERE w.key = editions.work_key
    AND LOWER(TRIM(w.title)) = LOWER(TRIM(editions.series))
  )
`).run();
console.log(`  Self-referencing series removed: ${selfRefResult.changes}`);

// --- Step 2: Clean remaining series formatting ---
console.log("\nStep 2: Extracting series numbers from series text...");

// Extract trailing numbers like "Series Name -- [1]" or "Series Name ; 3"
// We'll do this in JS since SQLite regex is limited
const editionsWithSeries = db.prepare(`
  SELECT rowid, series, series_number FROM editions
  WHERE series IS NOT NULL
`).all();

console.log(`  Processing ${editionsWithSeries.length} editions with series...`);

const updateClean = db.prepare(`
  UPDATE editions SET series = ?, series_number = ? WHERE rowid = ?
`);

let cleaned = 0;
const cleanBatch = db.transaction((rows) => {
  for (const row of rows) {
    let series = row.series.trim();
    let number = row.series_number;

    // Extract number from end of series string
    const numberMatch = series.match(
      /\s*(?:--|;|,|\|)\s*(?:\[?(\d+(?:\.\d+)?)\]?|vol\.?\s*(\d+)|book\s*(\d+)|#\s*(\d+)|no\.?\s*(\d+)|part\s*(\d+))\s*$/i
    );
    if (numberMatch) {
      if (number == null) {
        number = parseFloat(
          numberMatch[1] ?? numberMatch[2] ?? numberMatch[3] ??
          numberMatch[4] ?? numberMatch[5] ?? numberMatch[6]
        );
      }
      series = series.slice(0, numberMatch.index).trim();
    }

    // Remove trailing punctuation
    series = series.replace(/[\s;,|\-]+$/, "").trim();

    if (series !== row.series || number !== row.series_number) {
      updateClean.run(series || null, number, row.rowid);
      cleaned++;
    }
  }
});

// Process in batches
const BATCH = 50000;
for (let i = 0; i < editionsWithSeries.length; i += BATCH) {
  cleanBatch(editionsWithSeries.slice(i, i + BATCH));
  if (i % 200000 === 0 && i > 0) console.log(`  ...${i} processed`);
}
console.log(`  Cleaned formatting on ${cleaned} editions`);

// --- Step 3: Add consensus series to works table ---
console.log("\nStep 3: Adding consensus series to works table...");

// Add columns if they don't exist
try { db.exec("ALTER TABLE works ADD COLUMN series TEXT"); } catch(e) { /* exists */ }
try { db.exec("ALTER TABLE works ADD COLUMN series_number REAL"); } catch(e) { /* exists */ }

// For each work, pick the most common non-null series across its editions
const consensusResult = db.prepare(`
  UPDATE works SET
    series = (
      SELECT e.series FROM editions e
      WHERE e.work_key = works.key AND e.series IS NOT NULL
      GROUP BY e.series
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ),
    series_number = (
      SELECT e.series_number FROM editions e
      WHERE e.work_key = works.key AND e.series IS NOT NULL
      GROUP BY e.series
      ORDER BY COUNT(*) DESC
      LIMIT 1
    )
  WHERE EXISTS (
    SELECT 1 FROM editions e WHERE e.work_key = works.key AND e.series IS NOT NULL
  )
`).run();
console.log(`  Set consensus series on ${consensusResult.changes} works`);

// --- Step 4: Show stats ---
const remaining = db.prepare("SELECT COUNT(*) as c FROM editions WHERE series IS NOT NULL").get();
const worksWithSeries = db.prepare("SELECT COUNT(*) as c FROM works WHERE series IS NOT NULL").get();

console.log(`\n=== Final stats ===`);
console.log(`Editions with series: ${remaining.c}`);
console.log(`Works with series: ${worksWithSeries.c}`);

// Sample cleaned series
const samples = db.prepare(`
  SELECT w.title, w.series, w.series_number,
    GROUP_CONCAT(DISTINCT a.name) as authors
  FROM works w
  LEFT JOIN work_authors wa ON wa.work_key = w.key
  LEFT JOIN authors a ON a.key = wa.author_key
  WHERE w.series IS NOT NULL
  GROUP BY w.key
  ORDER BY RANDOM()
  LIMIT 15
`).all();
console.log("\nSample works with series:");
samples.forEach(r => {
  const num = r.series_number ? ` #${r.series_number}` : "";
  console.log(`  "${r.title}" by ${r.authors} → [${r.series}${num}]`);
});

db.close();
console.log("\nDone!");
