import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "/data/openlibrary.db";
const BATCH_SIZE = 5_000;
const PROGRESS_INTERVAL = 100_000;

const dbRead = new Database(DB_PATH, { readonly: true });
const dbWrite = new Database(DB_PATH);

dbRead.pragma("journal_mode = WAL");
dbRead.pragma("cache_size = -64000");
dbWrite.pragma("journal_mode = WAL");
dbWrite.pragma("synchronous = NORMAL");
dbWrite.pragma("cache_size = -64000");

console.log(`Rebuilding subjects_fts_v2 in ${DB_PATH}`);

dbWrite.exec("DROP TABLE IF EXISTS subjects_fts_v2");
dbWrite.exec("CREATE VIRTUAL TABLE subjects_fts_v2 USING fts5(work_key, subjects)");

const insertSubjectFts = dbWrite.prepare(
  "INSERT INTO subjects_fts_v2 (work_key, subjects) VALUES (?, ?)",
);
const flushBatch = dbWrite.transaction((rows) => {
  for (const row of rows) {
    insertSubjectFts.run(row.key, row.subjects);
  }
});

let batch = [];
let indexed = 0;

for (const row of dbRead.prepare("SELECT key, subjects FROM works").iterate()) {
  indexed += 1;

  let subjectText = "";
  if (typeof row.subjects === "string" && row.subjects.trim()) {
    try {
      const parsed = JSON.parse(row.subjects);
      if (Array.isArray(parsed)) {
        subjectText = parsed
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => value.trim())
          .join("\n");
      }
    } catch {
      subjectText = "";
    }
  }

  batch.push({
    key: row.key,
    subjects: subjectText,
  });

  if (batch.length >= BATCH_SIZE) {
    flushBatch(batch);
    batch = [];
  }

  if (indexed % PROGRESS_INTERVAL === 0) {
    console.log(`  indexed ${indexed.toLocaleString()} works`);
  }
}

if (batch.length > 0) {
  flushBatch(batch);
}

dbRead.close();
dbWrite.exec("INSERT INTO subjects_fts_v2(subjects_fts_v2) VALUES('optimize')");
dbWrite.pragma("wal_checkpoint(TRUNCATE)");

const count = dbWrite.prepare("SELECT COUNT(*) AS count FROM subjects_fts_v2").get();
console.log(`Done. subjects_fts_v2 rows: ${count.count.toLocaleString()}`);

dbWrite.close();
