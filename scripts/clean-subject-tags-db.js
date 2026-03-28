#!/usr/bin/env node

import Database from "better-sqlite3";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSubjectList,
  sanitizeSubjectTags,
  subjectsToFtsText,
} from "../server/lib/subject-tags.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dbPath = process.argv[2] || resolve(rootDir, "data", "catalog.db");

const dbRead = new Database(dbPath, { readonly: true });
const dbWrite = new Database(dbPath);
dbRead.pragma("journal_mode = WAL");
dbRead.pragma("cache_size = -128000");
dbWrite.pragma("journal_mode = WAL");
dbWrite.pragma("synchronous = NORMAL");
dbWrite.pragma("cache_size = -128000");

const selectWorks = dbRead.prepare("SELECT key, subjects FROM works");
const updateSubjects = dbWrite.prepare("UPDATE works SET subjects = ? WHERE key = ?");
const insertSubjectFts = dbWrite.prepare(
  "INSERT INTO subjects_fts (work_key, subjects) VALUES (?, ?)",
);

const BATCH_SIZE = 5_000;
const PROGRESS_INTERVAL = 100_000;

function stableJson(value) {
  return JSON.stringify(value);
}

function topEntries(map, limit = 20) {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

console.log(`Cleaning subject tags in ${dbPath}`);

let totalWorks = 0;
let changedWorks = 0;
let invalidJsonWorks = 0;
let emptiedWorks = 0;
let totalRemoved = 0;
let totalAdded = 0;
const removedCounts = new Map();
const addedCounts = new Map();
let updateBatch = [];

const flushUpdates = dbWrite.transaction((rows) => {
  for (const row of rows) {
    updateSubjects.run(row.subjects, row.key);
  }
});

for (const row of selectWorks.iterate()) {
  totalWorks += 1;

  const beforeSubjects = parseSubjectList(row.subjects);
  const afterSubjects = sanitizeSubjectTags(row.subjects).subjects;
  let wasInvalidJson = false;

  if (typeof row.subjects === "string" && row.subjects.trim()) {
    try {
      JSON.parse(row.subjects);
    } catch {
      invalidJsonWorks += 1;
      wasInvalidJson = true;
    }
  }

  const beforeJson = stableJson(beforeSubjects);
  const afterJson = stableJson(afterSubjects);

  if (beforeJson !== afterJson || wasInvalidJson) {
    changedWorks += 1;
    if (afterSubjects.length === 0) {
      emptiedWorks += 1;
    }

    const beforeSet = new Set(beforeSubjects.map((subject) => subject.toLocaleLowerCase()));
    const afterSet = new Set(afterSubjects.map((subject) => subject.toLocaleLowerCase()));

    for (const subject of beforeSubjects) {
      if (!afterSet.has(subject.toLocaleLowerCase())) {
        totalRemoved += 1;
        removedCounts.set(subject, (removedCounts.get(subject) ?? 0) + 1);
      }
    }

    for (const subject of afterSubjects) {
      if (!beforeSet.has(subject.toLocaleLowerCase())) {
        totalAdded += 1;
        addedCounts.set(subject, (addedCounts.get(subject) ?? 0) + 1);
      }
    }

    updateBatch.push({
      key: row.key,
      subjects: afterJson,
    });

    if (updateBatch.length >= BATCH_SIZE) {
      flushUpdates(updateBatch);
      updateBatch = [];
    }
  }

  if (totalWorks % PROGRESS_INTERVAL === 0) {
    console.log(
      `  scanned ${totalWorks.toLocaleString()} works, updated ${changedWorks.toLocaleString()}`,
    );
  }
}

if (updateBatch.length > 0) {
  flushUpdates(updateBatch);
}

dbRead.close();

console.log(`Updated ${changedWorks.toLocaleString()} of ${totalWorks.toLocaleString()} works`);
console.log(`  invalid-json rows fixed: ${invalidJsonWorks.toLocaleString()}`);
console.log(`  works left with no subjects: ${emptiedWorks.toLocaleString()}`);
console.log(`  removed tags: ${totalRemoved.toLocaleString()}`);
console.log(`  added tags: ${totalAdded.toLocaleString()}`);

console.log("\nRebuilding subjects_fts...");
dbWrite.exec("DROP TABLE IF EXISTS subjects_fts");
dbWrite.exec("CREATE VIRTUAL TABLE subjects_fts USING fts5(work_key, subjects)");

const populateSubjectFts = dbWrite.transaction((rows) => {
  for (const row of rows) {
    insertSubjectFts.run(row.key, row.ftsText);
  }
});

const dbIndexRead = new Database(dbPath, { readonly: true });
dbIndexRead.pragma("journal_mode = WAL");
dbIndexRead.pragma("cache_size = -128000");

let ftsBatch = [];
let indexedWorks = 0;
for (const row of dbIndexRead.prepare("SELECT key, subjects FROM works").iterate()) {
  indexedWorks += 1;
  ftsBatch.push({
    key: row.key,
    ftsText: subjectsToFtsText(row.subjects),
  });

  if (ftsBatch.length >= BATCH_SIZE) {
    populateSubjectFts(ftsBatch);
    ftsBatch = [];
  }

  if (indexedWorks % PROGRESS_INTERVAL === 0) {
    console.log(`  indexed ${indexedWorks.toLocaleString()} works`);
  }
}

if (ftsBatch.length > 0) {
  populateSubjectFts(ftsBatch);
}

dbIndexRead.close();
dbWrite.exec("INSERT INTO subjects_fts(subjects_fts) VALUES('optimize')");
dbWrite.pragma("wal_checkpoint(TRUNCATE)");

console.log("\nTop removed tags:");
for (const [subject, count] of topEntries(removedCounts)) {
  console.log(`  ${count.toLocaleString()} | ${subject}`);
}

console.log("\nTop added tags:");
for (const [subject, count] of topEntries(addedCounts)) {
  console.log(`  ${count.toLocaleString()} | ${subject}`);
}

dbWrite.close();
console.log("\nDone.");
