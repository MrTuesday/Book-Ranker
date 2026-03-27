#!/usr/bin/env node
/**
 * Step 2+3: Clean series formatting and add consensus series to works.
 * Step 1 (junk removal) already completed successfully.
 * Uses streaming iteration to avoid OOM on 512MB machine.
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "/data/openlibrary.db";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// --- Step 2: Clean series formatting in batches ---
console.log("Step 2: Extracting series numbers from series text...");

const countResult = db.prepare("SELECT COUNT(*) as c FROM editions WHERE series IS NOT NULL").get();
console.log(`  ${countResult.c} editions with series to process`);

const updateClean = db.prepare(
  "UPDATE editions SET series = ?, series_number = ? WHERE rowid = ?"
);

const BATCH_SIZE = 5000;
let offset = 0;
let cleaned = 0;
let total = 0;

while (true) {
  const batch = db.prepare(`
    SELECT rowid, series, series_number FROM editions
    WHERE series IS NOT NULL
    ORDER BY rowid
    LIMIT ? OFFSET ?
  `).all(BATCH_SIZE, offset);

  if (batch.length === 0) break;
  total += batch.length;

  const runBatch = db.transaction(() => {
    for (const row of batch) {
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
  runBatch();

  offset += batch.length;
  if (total % 100000 === 0) console.log(`  ...${total} processed, ${cleaned} cleaned`);
}
console.log(`  Done: ${total} processed, ${cleaned} cleaned`);

// --- Step 3: Add consensus series to works table ---
console.log("\nStep 3: Adding consensus series to works table...");

try { db.exec("ALTER TABLE works ADD COLUMN series TEXT"); } catch(e) { /* exists */ }
try { db.exec("ALTER TABLE works ADD COLUMN series_number REAL"); } catch(e) { /* exists */ }

// Do this in SQL — no need to load into JS
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

// --- Stats ---
const remaining = db.prepare("SELECT COUNT(*) as c FROM editions WHERE series IS NOT NULL").get();
const worksWithSeries = db.prepare("SELECT COUNT(*) as c FROM works WHERE series IS NOT NULL").get();

console.log(`\n=== Final stats ===`);
console.log(`Editions with series: ${remaining.c}`);
console.log(`Works with series: ${worksWithSeries.c}`);

// Sample
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
