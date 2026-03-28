#!/usr/bin/env node
/**
 * Step 2: Fetch occupation data from Wikidata for authors with QIDs.
 * Queries the Wikidata SPARQL endpoint in batches.
 * Stores results in the catalog DB as author_credentials table.
 *
 * Usage: node scripts/fetch-wikidata-occupations.js
 */

import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";

const DB_PATH = "data/catalog.db";
const WIKIDATA_IDS_PATH = "data/wikidata-ids.json";
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const BATCH_SIZE = 200; // QIDs per SPARQL query
const DELAY_MS = 1500; // Delay between requests to respect rate limits

// Load Wikidata ID mapping
console.log("Loading Wikidata IDs...");
const mapping = JSON.parse(await readFile(WIKIDATA_IDS_PATH, "utf-8"));
const entries = Object.entries(mapping); // [[olKey, qid], ...]
console.log(`  ${entries.length} authors with Wikidata IDs`);

// Set up DB
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS author_credentials (
    author_key TEXT NOT NULL,
    credential TEXT NOT NULL,
    wikidata_qid TEXT,
    PRIMARY KEY (author_key, credential)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_credential ON author_credentials(credential)`);

// Check what we've already fetched (for resumability)
const existingKeys = new Set(
  db.prepare("SELECT DISTINCT author_key FROM author_credentials").pluck().all()
);
const remaining = entries.filter(([olKey]) => !existingKeys.has(olKey));
console.log(`  Already fetched: ${existingKeys.size}, remaining: ${remaining.length}`);

const insertStmt = db.prepare(
  "INSERT OR IGNORE INTO author_credentials (author_key, credential, wikidata_qid) VALUES (?, ?, ?)"
);

// Occupation label normalization - map common Wikidata occupation labels to clean credentials
const CREDENTIAL_MAP = {
  // Academic/Research
  historian: "Historian",
  archaeologist: "Archaeologist",
  anthropologist: "Anthropologist",
  sociologist: "Sociologist",
  psychologist: "Psychologist",
  economist: "Economist",
  "political scientist": "Political Scientist",
  philosopher: "Philosopher",
  linguist: "Linguist",
  theologian: "Theologian",
  mathematician: "Mathematician",
  statistician: "Statistician",
  physicist: "Physicist",
  chemist: "Chemist",
  biologist: "Biologist",
  geneticist: "Geneticist",
  neuroscientist: "Neuroscientist",
  astronomer: "Astronomer",
  geologist: "Geologist",
  ecologist: "Ecologist",
  "computer scientist": "Computer Scientist",
  engineer: "Engineer",
  "university teacher": "Academic",
  "university professor": "Professor",
  professor: "Professor",
  researcher: "Researcher",
  scientist: "Scientist",
  scholar: "Scholar",
  academic: "Academic",
  lecturer: "Lecturer",

  // Writing
  writer: "Writer",
  novelist: "Novelist",
  poet: "Poet",
  playwright: "Playwright",
  dramatist: "Playwright",
  screenwriter: "Screenwriter",
  essayist: "Essayist",
  "literary critic": "Literary Critic",
  "science fiction writer": "Novelist",
  "children's writer": "Children's Author",
  "comics artist": "Comics Creator",
  autobiographer: "Memoirist",
  biographer: "Biographer",
  lyricist: "Lyricist",
  librettist: "Librettist",
  "short story writer": "Writer",
  "speculative fiction writer": "Novelist",
  "crime fiction writer": "Novelist",
  "fantasy writer": "Novelist",

  // Journalism/Media
  journalist: "Journalist",
  "investigative journalist": "Journalist",
  reporter: "Journalist",
  "war correspondent": "Journalist",
  broadcaster: "Broadcaster",
  "television presenter": "Broadcaster",
  "radio presenter": "Broadcaster",
  blogger: "Blogger",
  editor: "Editor",
  publisher: "Publisher",
  columnist: "Columnist",
  critic: "Critic",

  // Politics/Law/Military
  politician: "Politician",
  diplomat: "Diplomat",
  "statesperson": "Politician",
  "head of state": "Head of State",
  "prime minister": "Head of State",
  president: "Head of State",
  lawyer: "Lawyer",
  jurist: "Lawyer",
  judge: "Judge",
  "military officer": "Military",
  soldier: "Military",
  general: "Military",
  admiral: "Military",
  spy: "Intelligence",
  activist: "Activist",
  "civil rights advocate": "Activist",
  "human rights activist": "Activist",

  // Medicine/Health
  physician: "Physician",
  surgeon: "Physician",
  psychiatrist: "Psychiatrist",
  nurse: "Nurse",
  "medical doctor": "Physician",
  epidemiologist: "Epidemiologist",
  pharmacist: "Pharmacist",

  // Arts/Entertainment
  actor: "Actor",
  filmmaker: "Filmmaker",
  "film director": "Filmmaker",
  musician: "Musician",
  composer: "Composer",
  singer: "Singer",
  painter: "Painter",
  sculptor: "Sculptor",
  photographer: "Photographer",
  architect: "Architect",
  "graphic designer": "Designer",
  illustrator: "Illustrator",
  comedian: "Comedian",
  "stand-up comedian": "Comedian",

  // Religion
  priest: "Clergy",
  "catholic priest": "Clergy",
  bishop: "Clergy",
  rabbi: "Rabbi",
  imam: "Imam",
  monk: "Monk",
  pastor: "Clergy",
  missionary: "Missionary",

  // Business/Other
  entrepreneur: "Entrepreneur",
  businessperson: "Businessperson",
  "chief executive officer": "Business Executive",
  inventor: "Inventor",
  explorer: "Explorer",
  astronaut: "Astronaut",
  athlete: "Athlete",
  chef: "Chef",
  teacher: "Teacher",
  librarian: "Librarian",
  translator: "Translator",
};

// Fallback: title-case the raw label if not in the explicit map
function normalizeCredential(label) {
  const lower = label.toLowerCase().trim();

  // Skip QIDs (unresolved Wikidata entities like "q20723555")
  if (/^q\d+$/.test(lower)) return null;

  // Skip overly generic or irrelevant labels
  const SKIP = new Set([
    "human", "adult", "person", "people", "individual",
    "nobleman", "noblewoman", "aristocrat", "consort", "courtier", "seigneur",
    "slave", "serf", "prisoner", "prisoner of war",
    "saint", "martyr", "mystic",
  ]);
  if (SKIP.has(lower)) return null;

  // Use explicit map if available
  if (CREDENTIAL_MAP[lower]) return CREDENTIAL_MAP[lower];

  // Smart fallback: title-case and keep it
  // This preserves things like "cosmologist", "botanist", "art historian" etc.
  return label.trim().replace(/\b\w/g, c => c.toUpperCase());
}

async function querySparql(qids) {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  const query = `
    SELECT ?item ?itemLabel ?occupationLabel WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P106 ?occupation .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
  `;

  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": "BookRankerBot/1.0 (https://github.com/book-ranker)",
    },
  });

  if (response.status === 429) {
    console.log("  Rate limited, waiting 10s...");
    await new Promise((r) => setTimeout(r, 10000));
    return querySparql(qids); // Retry
  }

  if (!response.ok) {
    throw new Error(`SPARQL error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.results.bindings;
}

// Process in batches
const qidToOlKey = new Map();
for (const [olKey, qid] of remaining) {
  qidToOlKey.set(qid, olKey);
}

const allQids = remaining.map(([, qid]) => qid);
let totalCredentials = 0;
let batchNum = 0;
const totalBatches = Math.ceil(allQids.length / BATCH_SIZE);

for (let i = 0; i < allQids.length; i += BATCH_SIZE) {
  batchNum++;
  const batch = allQids.slice(i, i + BATCH_SIZE);

  try {
    const results = await querySparql(batch);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const qid = row.item.value.split("/").pop();
        const olKey = qidToOlKey.get(qid);
        const rawLabel = row.occupationLabel?.value;
        if (!olKey || !rawLabel) continue;

        const credential = normalizeCredential(rawLabel);
        if (credential) {
          insertStmt.run(olKey, credential, qid);
          totalCredentials++;
        }
      }
    });
    insertMany(results);

    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      console.log(
        `  Batch ${batchNum}/${totalBatches}: ${totalCredentials} credentials stored`
      );
    }
  } catch (err) {
    console.error(`  Batch ${batchNum} error: ${err.message}`);
    // Wait longer on error
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Rate limit delay
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

// Stats
const credentialCounts = db
  .prepare(
    "SELECT credential, COUNT(*) as c FROM author_credentials GROUP BY credential ORDER BY c DESC"
  )
  .all();

console.log(`\n=== Final Stats ===`);
console.log(`Total credentials stored: ${totalCredentials}`);
console.log(`\nTop credentials:`);
credentialCounts.slice(0, 25).forEach((r) => {
  console.log(`  ${r.credential}: ${r.c} authors`);
});

// Sample authors with credentials
const samples = db
  .prepare(
    `SELECT a.name, GROUP_CONCAT(ac.credential, ', ') as creds
     FROM author_credentials ac
     JOIN authors a ON a.key = ac.author_key
     GROUP BY ac.author_key
     ORDER BY RANDOM() LIMIT 15`
  )
  .all();
console.log(`\nSample authors:`);
samples.forEach((r) => console.log(`  ${r.name}: ${r.creds}`));

db.close();
console.log("\nDone!");
