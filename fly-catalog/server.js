import express from "express";
import Database from "better-sqlite3";
import { sortCredentials } from "./credential-order.js";

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || "/data/openlibrary.db";

// Open database — read-only for search, writable for credential edits
let db;
let dbWrite;
try {
  db = new Database(DB_PATH, { readonly: true });
  db.pragma("cache_size = -64000"); // 64MB cache
  db.pragma("mmap_size = 268435456"); // 256MB mmap
  console.log("Catalog read database opened successfully");
} catch (err) {
  db = undefined;
  console.error("Failed to open read database:", err.message);
}

try {
  dbWrite = new Database(DB_PATH);
  dbWrite.pragma("journal_mode = WAL");
  console.log("Catalog write database opened successfully");
} catch (err) {
  dbWrite = undefined;
  console.error("Failed to open write database:", err.message);
}

if (!db) {
  console.log("Starting without database — upload the DB then restart");
}

// Prepare FTS statements (only if DB loaded)
let searchFts, subjectFts;
if (db) {
  try {
    searchFts = db.prepare(`
      SELECT
        key AS work_key,
        title AS matched_title,
        bm25(works_fts) AS fts_score
      FROM works_fts
      WHERE works_fts MATCH ?
      ORDER BY fts_score
      LIMIT ?
    `);
  } catch (err) {
    console.error("Failed to prepare search statements:", err.message);
    db = undefined;
  }

  if (db) {
    try {
      const subjectSearchTable =
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('subjects_fts_v2', 'subjects_fts') ORDER BY name = 'subjects_fts_v2' DESC LIMIT 1",
          )
          .get()?.name ?? null;

      if (!subjectSearchTable) {
        console.warn("No subjects FTS table found");
      } else {
        subjectFts = db.prepare(`
          SELECT work_key FROM ${subjectSearchTable}
          WHERE ${subjectSearchTable} MATCH ?
          ORDER BY rank
          LIMIT ?
        `);
      }
    } catch (err) {
      console.error("Failed to prepare subject statements:", err.message);
    }
  }
}

function buildDetailQuery(count) {
  const placeholders = Array(count).fill("?").join(",");
  return db.prepare(`
    SELECT
      w.key AS work_key,
      w.title,
      w.subjects,
      w.series,
      w.series_number,
      MIN(e.publish_year) AS publish_year,
      COUNT(DISTINCT e.key) AS edition_count,
      GROUP_CONCAT(DISTINCT a.name) AS author_names
    FROM works w
    LEFT JOIN editions e ON e.work_key = w.key
    LEFT JOIN work_authors wa ON wa.work_key = w.key
    LEFT JOIN authors a ON a.key = wa.author_key
    WHERE w.key IN (${placeholders})
    GROUP BY w.key
  `);
}

// Junk series patterns: non-Latin text, publisher imprints, catalog numbers, etc.
const JUNK_SERIES_RE = /[^\u0000-\u024F]|^\d+$|ISBN|OCLC|^\(|^vol\b|^edition\b|^series$/i;
const PUBLISHER_RE = /\b(penguin|vintage|signet|bantam|classic|library|collection|verlag|press|books|publishing|publications|edition|harper|random\s*house|scholastic|oxford|cambridge|mcgraw|wiley|springer|hachette|macmillan|doubleday|anchor|dell|fawcett|avon|pocket|tor|daw|ace|roc|harlequin|silhouette|zebra|romance|love\s*inspired|pelican|colophon|bollingen|phoenix|insight\s*guides|schaum|universitext|paperback|taschenbuch|touchstone|harvest\s*book|star\s*book|first\s*book|crime\s*club|i\s*can\s*read|for\s*dummies|redbooks|ibm|nistir|nbs|schiffer|spie|dover|outline|geography|opportunities|proceedings|bibliography|dummies|digitization|digest|theses|biographical|dictionaries|contemporary|university|canadiennes|textbook|catalogs|bulletin|monograph|pamphlet|leaflet|circular|imprint|reprint|facsimile|fiction\b(?!.*\b(?:cycle|saga|chronicles|trilogy|quartet|quintet)))\b/i;
const ACADEMIC_RE = /\b(lecture\s*notes?|monographs?|dissertat|research\s*(paper|note|record|series|report|center)|technical\s*note|working\s*paper|acta\s*universit|contributions\s*(in|to)|developments\s*in|advances\s*in|progress\s*in|studies\s*in|annals\s*of|journal\s*for|cahiers|travaux|studi\s*e|biblioth[èe]que|sammlung|reihe|textes\s*litt|mathemat|linguist|casebook|nutshell\s*series|law\s*school|geological\s*survey|water[- ]supply|fact\s*sheet|handbook|professional\s*paper|intelligence\s*unit|focus\s*editions?|source\s*material|critical\s*literature|printings\s*and\s*reprintings|humanisme|renaissance|NEH\s*PA|ORNL|NASA|ESA\s*SP|AIP\s*conference|CIHM|ICMH|Fabian\s*(tract|research)|international\s*acts|quaestiones|disputatae|phaenomenologica|grundlehren|pragmatics|eclectic\s*educational|informatik|fachberichte|wissenschaftliche|semiotics|Forschung|Studien|ergebnisse|Untersuchung|analecta|classiques|cl[áa]sicos|expositor|newcomen\s*address|approaches\s*to|problems\s*in|essays\s*in|clinics\s*in|ceramic\s*transactions|Hakluyt|Palaestra|OCS\s*study|CBO\s*study|special\s*paper|applied\s*mathematical|mechanical\s*engineering|historical\s*studies|germanische|cistercian|astronomical\s*society|conference\s*series|preservation\s*project|outstanding\s*dissertations|Logiques\s*sociales|Archives\s*of\s*psychology|Public\s*administration|Prentice[- ]Hall|Pergamon|African\s*studies|Latin\s*American|European\s*civilization|cancer\s*research|Jossey[- ]Bass|Springer\s*series|Wiley\s*series)\b/i;
const GOVT_RE = /\b(U\.?S\.?\s*Geological|agriculture\s*handbook|census|congressional|federal|S\.\s*prt|civil\s*liberties|gt\.\s*Brit|Central\s*Office|water\s*fact|Laws\s*of\s*Malaysia|Gifford\s*lectures)\b/i;
const FOREIGN_ACADEMIC_RE = /\b(bunko|shinsho|sōsho|s[oō]sho|cong\s*shu|quan\s*shu|lei\s*bian|Laterza|Luchterhand|Göschen|Vandenhoeck|Garnier|chrétiennes|Metzler|Payot|ouverture\s*philosophique|Folio|Adelphi\s*papers|Bison\s*book|Galaxy\s*book|Delta\s*book|Fireside\s*book|Quest\s*book|Paragon|New\s*Directions\s*book|Faber\s*paper|Methuen|Pitman|Avebury)\b/i;

function cleanSeries(rawSeries, rawNumber) {
  if (!rawSeries) return { series: undefined, seriesNumber: undefined };
  let series = String(rawSeries).trim();
  let number = rawNumber ?? undefined;

  // Strip trailing number patterns like "-- [1]" or "; vol. 3"
  const numberMatch = series.match(
    /\s*(?:--|;|,)\s*(?:\[?(\d+(?:\.\d+)?)\]?|vol\.?\s*(\d+))\s*$/i
  );
  if (numberMatch) {
    if (number == null) {
      number = parseFloat(numberMatch[1] ?? numberMatch[2]);
    }
    series = series.slice(0, numberMatch.index).trim();
  }
  series = series.replace(/[\s;,\-]+$/, "").trim();

  // Filter out junk series
  if (!series || series.length < 2 || series.length > 120) return { series: undefined, seriesNumber: undefined };
  if (JUNK_SERIES_RE.test(series)) return { series: undefined, seriesNumber: undefined };
  if (PUBLISHER_RE.test(series)) return { series: undefined, seriesNumber: undefined };
  if (ACADEMIC_RE.test(series)) return { series: undefined, seriesNumber: undefined };
  if (GOVT_RE.test(series)) return { series: undefined, seriesNumber: undefined };
  if (FOREIGN_ACADEMIC_RE.test(series)) return { series: undefined, seriesNumber: undefined };

  return { series: series || undefined, seriesNumber: number ?? undefined };
}

function safeParseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRow(row) {
  const { series, seriesNumber } = cleanSeries(row.series, row.series_number);
  const result = {
    key: row.work_key,
    title: row.title,
    authors: row.author_names
      ? String(row.author_names).split(",").map((n) => n.trim())
      : [],
    subjects: row.subjects ? safeParseJson(row.subjects) : [],
    series,
    seriesNumber,
    publishYear: row.publish_year ?? undefined,
    editionCount: row.edition_count ?? 0,
  };
  return result;
}

function fetchDetailsByKeys(keys) {
  if (keys.length === 0) return [];
  const stmt = buildDetailQuery(keys.length);
  const rows = stmt.all(...keys);
  const byKey = new Map(rows.map((r) => [r.work_key, r]));
  return keys
    .map((k) => byKey.get(k))
    .filter(Boolean)
    .map(mapRow);
}

// --- Routes ---

app.get("/health", (req, res) => {
  if (!db) return res.status(503).json({ status: "no_db", message: "Database not loaded" });
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/search", (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not loaded" });
  try {
    const query = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit) || 6, 50);
    if (!query) return res.json([]);

    const sanitized = query.replace(/["*^(){}:]/g, " ").trim();
    if (!sanitized) return res.json([]);

    // Tokenize: each word matches as a prefix (enables typeahead + cross-column matching)
    // e.g. "Money McWilliams" → "Money* McWilliams*" which matches title=Money AND authors=McWilliams
    const tokens = sanitized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return res.json([]);
    const ftsQuery = tokens.map((t) => `"${t}"*`).join(" ");

    // Overfetch generously because works_fts contains edition-title aliases,
    // and we need enough unique works left after de-duplicating by key.
    const overfetch = Math.max(limit * 40, 200);
    let candidateRows = searchFts.all(ftsQuery, overfetch);

    // Fallback: try phrase match if tokenized prefix match returns nothing
    if (candidateRows.length === 0) {
      candidateRows = searchFts.all(`"${sanitized}"`, overfetch);
    }
    if (candidateRows.length === 0) return res.json([]);

    const bestCandidateByKey = new Map();
    for (const row of candidateRows) {
      const current = bestCandidateByKey.get(row.work_key);
      if (!current || row.fts_score < current.fts_score) {
        bestCandidateByKey.set(row.work_key, row);
      }
    }

    const keys = Array.from(bestCandidateByKey.keys());
    const results = fetchDetailsByKeys(keys);

    // Score and sort results: balance match quality with popularity
    const lowerQuery = query.toLowerCase();
    const lowerTokens = tokens.map((t) => t.toLowerCase());
    results.sort((a, b) => {
      const matchScore = (r) => {
        const t = r.title.toLowerCase();
        const matchedTitle =
          bestCandidateByKey.get(r.key)?.matched_title?.toLowerCase() ?? "";
        const authorStr = (r.authors || []).join(" ").toLowerCase();
        const titleCandidates = [t, matchedTitle].filter(Boolean);
        // Best: exact title match
        if (titleCandidates.some((candidate) => candidate === lowerQuery)) return 0;
        // Great: title starts with query
        if (titleCandidates.some((candidate) => candidate.startsWith(lowerQuery))) {
          return 0.3;
        }
        // Good: all tokens found in title, matched alias, or author combined
        const allTokensMatch = lowerTokens.every(
          (tok) =>
            titleCandidates.some((candidate) => candidate.includes(tok)) ||
            authorStr.includes(tok)
        );
        if (allTokensMatch) {
          const titleStartsWithToken = lowerTokens.some((tok) =>
            titleCandidates.some((candidate) => candidate.startsWith(tok))
          );
          return titleStartsWithToken ? 0.4 : 0.6;
        }
        // OK: partial match
        return 1;
      };
      // Popularity score: log scale so 500 editions >> 2 editions
      const popScore = (r) => Math.log10(Math.max(r.editionCount || 1, 1));
      const ftsScore = (r) => bestCandidateByKey.get(r.key)?.fts_score ?? 0;
      // Combined: match quality matters most, popularity breaks ties
      const score = (r) => popScore(r) - matchScore(r) * 4;
      return score(b) - score(a) || ftsScore(a) - ftsScore(b);
    });

    res.json(results.slice(0, limit));
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/subjects", (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not loaded" });
  if (!subjectFts) {
    return res.status(503).json({ error: "Subject search is unavailable" });
  }
  try {
    const tags = (req.query.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const limit = Math.min(parseInt(req.query.limit) || 12, 50);
    if (tags.length === 0) return res.json([]);

    const escapeFts = (tag) => `"${tag.replace(/"/g, '""')}"`;

    let keyRows;
    if (tags.length > 1) {
      const ftsQuery = tags.slice(0, 2).map(escapeFts).join(" AND ");
      keyRows = subjectFts.all(ftsQuery, limit);
      // Fall back to single tag if no results
      if (keyRows.length === 0) {
        keyRows = subjectFts.all(escapeFts(tags[0]), limit);
      }
    } else {
      keyRows = subjectFts.all(escapeFts(tags[0]), limit);
    }

    const keys = keyRows.map((r) => r.work_key);
    res.json(fetchDetailsByKeys(keys));
  } catch (err) {
    console.error("Subjects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Author credentials ---

// Generic writing labels filtered out of credential results
const HIDDEN_CREDENTIALS = new Set([
  "Writer", "Novelist", "Author", "Poet", "Screenwriter", "Playwright",
  "Children's Author", "Memoirist", "Essayist", "Lyricist", "Librettist",
  "Comics Creator",
]);

function normalizeCredential(value) {
  const trimmed = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const titled = trimmed.replace(/(^|[\s/-])(\p{L})/gu, (_match, boundary, letter) => {
    return `${boundary}${letter.toLocaleUpperCase()}`;
  });

  return titled.replace(/\b(In|Of|And|For|The)\b/g, (match, _word, offset) => {
    return offset === 0 ? match : match.toLowerCase();
  });
}

app.use(express.json());

app.post("/author-credentials", (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not loaded" });
  try {
    const authors = Array.isArray(req.body?.authors) ? req.body.authors : [];
    if (authors.length === 0) return res.json({});

    const placeholders = authors.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT a.name, ac.credential
      FROM author_credentials ac
      JOIN authors a ON a.key = ac.author_key
      WHERE ac.author_key IN (
        SELECT key
        FROM authors
        WHERE name IN (${placeholders})
      )
      ORDER BY a.name, ac.source, ac.credential
    `).all(...authors);

    const result = {};
    for (const row of rows) {
      const normalizedCredential = normalizeCredential(row.credential);
      if (!normalizedCredential || HIDDEN_CREDENTIALS.has(normalizedCredential)) continue;
      if (!result[row.name]) result[row.name] = [];
      if (!result[row.name].includes(normalizedCredential)) {
        result[row.name].push(normalizedCredential);
      }
    }

    for (const author of Object.keys(result)) {
      result[author] = sortCredentials(result[author]);
    }

    res.json(result);
  } catch (err) {
    console.error("Credentials lookup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/author-credentials/add", (req, res) => {
  if (!dbWrite) return res.status(503).json({ error: "Database not writable" });
  try {
    const authorName = (req.body?.author || "").trim();
    const credential = normalizeCredential(req.body?.credential || "");
    if (!authorName || !credential) {
      return res.status(400).json({ error: "author and credential are required" });
    }

    let authorKey = dbWrite
      .prepare("SELECT key FROM authors WHERE name = ? COLLATE NOCASE")
      .get(authorName)?.key;

    if (!authorKey) {
      authorKey = `/authors/manual:${authorName.toLowerCase().replace(/\s+/g, "-")}`;
      dbWrite.prepare("INSERT OR IGNORE INTO authors (key, name) VALUES (?, ?)").run(
        authorKey, authorName,
      );
    }

    const exists = dbWrite
      .prepare("SELECT 1 FROM author_credentials WHERE author_key = ? AND credential = ? COLLATE NOCASE")
      .get(authorKey, credential);
    if (!exists) {
      dbWrite
        .prepare("INSERT INTO author_credentials (author_key, credential, wikidata_id, source) VALUES (?, ?, NULL, 'manual')")
        .run(authorKey, credential);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Add credential error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/author-credentials/remove", (req, res) => {
  if (!dbWrite) return res.status(503).json({ error: "Database not writable" });
  try {
    const authorName = (req.body?.author || "").trim();
    const credential = normalizeCredential(req.body?.credential || "");
    if (!authorName || !credential) {
      return res.status(400).json({ error: "author and credential are required" });
    }

    const authorKey = dbWrite
      .prepare("SELECT key FROM authors WHERE name = ? COLLATE NOCASE")
      .get(authorName)?.key;

    if (authorKey) {
      dbWrite
        .prepare("DELETE FROM author_credentials WHERE author_key = ? AND credential = ? COLLATE NOCASE AND source = 'manual'")
        .run(authorKey, credential);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Remove credential error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Catalog API listening on port ${PORT}`);
});
