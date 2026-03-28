/**
 * Rebuild catalog DB:
 * 1. Rebuild works_fts to include author names (enables author+title search)
 * 2. Clean junk series from works table
 * 3. Add missing author credentials
 */
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || "data/catalog.db";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("cache_size = -128000");

// ── Step 1: Rebuild works_fts with author names ──

console.log("Step 1: Rebuilding works_fts with author names...");

db.exec("DROP TABLE IF EXISTS works_fts");
db.exec(`
  CREATE VIRTUAL TABLE works_fts USING fts5(
    key UNINDEXED,
    title,
    authors
  )
`);

// Insert work titles + author names
const workCount = db.prepare(`
  INSERT INTO works_fts (key, title, authors)
  SELECT
    w.key,
    w.title,
    COALESCE(GROUP_CONCAT(DISTINCT a.name), '')
  FROM works w
  LEFT JOIN work_authors wa ON wa.work_key = w.key
  LEFT JOIN authors a ON a.key = wa.author_key
  GROUP BY w.key
`).run();
console.log(`  Inserted ${workCount.changes} work rows`);

// Insert distinct edition titles (for alternative title search)
const editionCount = db.prepare(`
  INSERT INTO works_fts (key, title, authors)
  SELECT DISTINCT
    e.work_key,
    e.title,
    COALESCE((
      SELECT GROUP_CONCAT(DISTINCT a2.name)
      FROM work_authors wa2
      JOIN authors a2 ON a2.key = wa2.author_key
      WHERE wa2.work_key = e.work_key
    ), '')
  FROM editions e
  WHERE e.title IS NOT NULL
    AND e.title != ''
    AND NOT EXISTS (
      SELECT 1 FROM works w WHERE w.key = e.work_key AND LOWER(w.title) = LOWER(e.title)
    )
`).run();
console.log(`  Inserted ${editionCount.changes} edition title rows`);

console.log("  FTS rebuild complete.");

// ── Step 2: Clean junk series ──

console.log("\nStep 2: Cleaning junk series...");

const JUNK_SERIES_RE = /[^\u0000-\u024F]|^\d+$|ISBN|OCLC|^\(|^vol\b|^edition\b|^series$/i;
const PUBLISHER_RE = /\b(penguin|vintage|signet|bantam|classic|library|collection|verlag|press|books|publishing|publications|edition|harper|random\s*house|scholastic|oxford|cambridge|mcgraw|wiley|springer|hachette|macmillan|doubleday|anchor|dell|fawcett|avon|pocket|tor|daw|ace|roc|harlequin|silhouette|zebra|romance|love\s*inspired|pelican|colophon|bollingen|phoenix|insight\s*guides|schaum|universitext|paperback|taschenbuch|touchstone|harvest\s*book|star\s*book|first\s*book|crime\s*club|i\s*can\s*read|for\s*dummies|redbooks|ibm|nistir|nbs|schiffer|spie|dover|outline|geography|opportunities|proceedings|bibliography|dummies|digitization|digest|theses|biographical|dictionaries|contemporary|university|canadiennes|textbook|catalogs|bulletin|monograph|pamphlet|leaflet|circular|imprint|reprint|facsimile|fiction\b(?!.*\b(?:cycle|saga|chronicles|trilogy|quartet|quintet)))\b/i;
const ACADEMIC_RE = /\b(lecture\s*notes?|monographs?|dissertat|research\s*(paper|note|record|series|report|center)|technical\s*note|working\s*paper|acta\s*universit|contributions\s*(in|to)|developments\s*in|advances\s*in|progress\s*in|studies\s*in|annals\s*of|journal\s*for|cahiers|travaux|studi\s*e|biblioth[èe]que|sammlung|textes\s*litt|mathemat|linguist|casebook|nutshell\s*series|law\s*school|geological\s*survey|water[- ]supply|fact\s*sheet|handbook|professional\s*paper|intelligence\s*unit|focus\s*editions?|source\s*material|critical\s*literature|printings\s*and\s*reprintings|humanisme|renaissance|NEH\s*PA|ORNL|NASA|ESA\s*SP|AIP\s*conference|CIHM|ICMH|Fabian\s*(tract|research)|international\s*acts|quaestiones|disputatae|phaenomenologica|grundlehren|pragmatics|eclectic\s*educational|informatik|fachberichte|wissenschaftliche|semiotics|Forschung|Studien|ergebnisse|Untersuchung|analecta|classiques|cl[áa]sicos|expositor|newcomen\s*address|approaches\s*to|problems\s*in|essays\s*in|clinics\s*in|ceramic\s*transactions|Hakluyt|Palaestra|OCS\s*study|CBO\s*study|special\s*paper|applied\s*mathematical|mechanical\s*engineering|historical\s*studies|germanische|cistercian|astronomical\s*society|conference\s*series|preservation\s*project|outstanding\s*dissertations|Logiques\s*sociales|Archives\s*of\s*psychology|Public\s*administration|Prentice[- ]Hall|Pergamon|African\s*studies|Latin\s*American|European\s*civilization|cancer\s*research|Jossey[- ]Bass|Springer\s*series|Wiley\s*series|Paradigm)\b/i;
const GOVT_RE = /\b(U\.?S\.?\s*Geological|agriculture\s*handbook|census|congressional|federal|S\.\s*prt|civil\s*liberties|gt\.\s*Brit|Central\s*Office|water\s*fact|Laws\s*of\s*Malaysia|Gifford\s*lectures)\b/i;
const FOREIGN_ACADEMIC_RE = /\b(bunko|shinsho|sōsho|s[oō]sho|cong\s*shu|quan\s*shu|lei\s*bian|Laterza|Luchterhand|Göschen|Vandenhoeck|Garnier|chrétiennes|Metzler|Payot|ouverture\s*philosophique|Folio|Adelphi\s*papers?|Bison\s*book|Galaxy\s*book|Delta\s*book|Fireside\s*book|Quest\s*book|Paragon|New\s*Directions|Faber\s*paper|Methuen|Pitman|Avebury)\b|reihe\b/i;
// Additional patterns for series that slip through
const EXTRA_JUNK_RE = /\b(La\s+cultura|Instinct\s+de\s+libert|iFiction|Que\s+sais|Points|Folio\s+essais|Repères|Découvertes?\s+Gallimard|Texto|Champs|Idées|Agora|Tel|Documents?\b(?!\s+(?:of|about|on)\b)|Mémoir|Colección|Ediciones|Serie\s+(?:de|del)|Opere\s+di|Piccola\s+biblioteca|Saggi|Tascabili|Einaudi|Feltrinelli|Laterza|Bompiani|Rizzoli|Mondadori|Adelphi|Sellerio|Marsilio|Bollati|Minimum\s+fax|Iperborea|Sur|Alianza|Anagrama|Seix\s+Barral|Tusquets|Planeta|Alfaguara)\b/i;

function isJunkSeries(series) {
  if (!series) return true;
  const s = String(series).trim();
  if (!s || s.length < 2 || s.length > 120) return true;
  if (JUNK_SERIES_RE.test(s)) return true;
  if (PUBLISHER_RE.test(s)) return true;
  if (ACADEMIC_RE.test(s)) return true;
  if (GOVT_RE.test(s)) return true;
  if (FOREIGN_ACADEMIC_RE.test(s)) return true;
  if (EXTRA_JUNK_RE.test(s)) return true;
  return false;
}

const allSeries = db.prepare(
  "SELECT DISTINCT series FROM works WHERE series IS NOT NULL"
).all();

const junkSet = new Set();
for (const row of allSeries) {
  if (isJunkSeries(row.series)) {
    junkSet.add(row.series);
  }
}

console.log(`  Found ${junkSet.size} junk series patterns out of ${allSeries.length} total`);

// Batch update in chunks
const junkArray = Array.from(junkSet);
const BATCH = 500;
const updateStmt = (count) => {
  const placeholders = Array(count).fill("?").join(",");
  return db.prepare(`UPDATE works SET series = NULL, series_number = NULL WHERE series IN (${placeholders})`);
};

let cleaned = 0;
for (let i = 0; i < junkArray.length; i += BATCH) {
  const batch = junkArray.slice(i, i + BATCH);
  const result = updateStmt(batch.length).run(...batch);
  cleaned += result.changes;
}
console.log(`  Cleaned ${cleaned} works`);

// Check what's left
const remaining = db.prepare(
  "SELECT series, COUNT(*) as cnt FROM works WHERE series IS NOT NULL GROUP BY series ORDER BY cnt DESC LIMIT 20"
).all();
console.log("  Top 20 remaining series:");
for (const r of remaining) {
  console.log(`    ${r.cnt} | ${r.series}`);
}

// ── Step 3: Add missing credentials ──

console.log("\nStep 3: Adding missing author credentials...");

const manualCredentials = [
  ["Gabor Maté", "Physician"],
  ["Gabor Maté", "Addiction Expert"],
  ["David Graeber", "Activist"],
  ["Siddhartha Mukherjee", "Oncologist"],
  ["Siddhartha Mukherjee", "Biologist"],
  ["Robert A. Caro", "Biographer"],
];

const findAuthor = db.prepare("SELECT key FROM authors WHERE name = ? COLLATE NOCASE");
const checkCred = db.prepare("SELECT 1 FROM author_credentials WHERE author_key = ? AND credential = ?");
const insertCred = db.prepare(
  "INSERT INTO author_credentials (author_key, credential, wikidata_id, source) VALUES (?, ?, NULL, 'manual')"
);
const insertAuthor = db.prepare("INSERT OR IGNORE INTO authors (key, name) VALUES (?, ?)");

for (const [name, credential] of manualCredentials) {
  let authorKey = findAuthor.get(name)?.key;
  if (!authorKey) {
    authorKey = `/authors/manual:${name.toLowerCase().replace(/\s+/g, "-")}`;
    insertAuthor.run(authorKey, name);
    console.log(`  Created author entry for ${name}`);
  }
  const exists = checkCred.get(authorKey, credential);
  if (!exists) {
    insertCred.run(authorKey, credential);
    console.log(`  Added "${credential}" for ${name}`);
  } else {
    console.log(`  "${credential}" already exists for ${name}`);
  }
}

// ── Done ──

db.close();
console.log("\nDone! Run the upload script to deploy to Fly.");
