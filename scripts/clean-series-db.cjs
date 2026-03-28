/**
 * Clean junk series data from the local catalog.db
 *
 * Applies the same filters used at query time in the Fly catalog server,
 * but writes the changes directly to the DB so the data is clean at rest.
 *
 * Usage: node scripts/clean-series-db.cjs [path-to-db]
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.argv[2] || path.join(__dirname, "..", "data", "catalog.db");

// --- Filters (mirrored from fly-catalog/server.js) ---

const JUNK_SERIES_RE =
  /[^\u0000-\u024F]|^\d+$|ISBN|OCLC|^\(|^vol\b|^edition\b|^series$/i;

// Publisher, imprint, and institutional patterns
const PUBLISHER_RE =
  /\b(penguin|vintage|signet|bantam|classic|library|collection|verlag|press|books|publishing|publications|edition|harper|random\s*house|scholastic|oxford|cambridge|mcgraw|wiley|springer|hachette|macmillan|doubleday|anchor|dell|fawcett|avon|pocket|tor|daw|ace|roc|harlequin|silhouette|zebra|romance|love\s*inspired|pelican|colophon|bollingen|phoenix|insight\s*guides|schaum|universitext|paperback|taschenbuch|touchstone|harvest\s*book|star\s*book|first\s*book|crime\s*club|i\s*can\s*read|for\s*dummies|redbooks|ibm|nistir|nbs|schiffer|spie|dover|outline|geography|opportunities|proceedings|bibliography|dummies|digitization|digest|theses|biographical|dictionaries|contemporary|university|canadiennes|textbook|catalogs|bulletin|monograph|pamphlet|leaflet|circular|imprint|reprint|facsimile|fiction\b(?!.*\b(?:cycle|saga|chronicles|trilogy|quartet|quintet)))\b/i;

// Academic, institutional, and technical series patterns
const ACADEMIC_RE =
  /\b(lecture\s*notes?|monographs?|dissertat|research\s*(paper|note|record|series|report|center)|technical\s*note|working\s*paper|acta\s*universit|contributions\s*(in|to)|developments\s*in|advances\s*in|progress\s*in|studies\s*in|annals\s*of|journal\s*for|cahiers|travaux|studi\s*e|biblioth[èe]que|sammlung|reihe|textes\s*litt|mathemat|linguist|casebook|nutshell\s*series|law\s*school|geological\s*survey|water[- ]supply|fact\s*sheet|handbook|professional\s*paper|intelligence\s*unit|focus\s*editions?|source\s*material|critical\s*literature|printings\s*and\s*reprintings|humanisme|renaissance|NEH\s*PA|ORNL|NASA|ESA\s*SP|AIP\s*conference|CIHM|ICMH|Fabian\s*(tract|research)|international\s*acts|quaestiones|disputatae|phaenomenologica|grundlehren|pragmatics|eclectic\s*educational|informatik|fachberichte|wissenschaftliche|semiotics|Forschung|Studien|ergebnisse|Untersuchung|analecta|classiques|cl[áa]sicos|expositor|newcomen\s*address|approaches\s*to|problems\s*in|essays\s*in|clinics\s*in|ceramic\s*transactions|Hakluyt|Palaestra|OCS\s*study|CBO\s*study|special\s*paper|applied\s*mathematical|mechanical\s*engineering|historical\s*studies|germanische|cistercian|astronomical\s*society|conference\s*series|preservation\s*project|outstanding\s*dissertations|Logiques\s*sociales|Archives\s*of\s*psychology|Public\s*administration|Prentice[- ]Hall|Pergamon|African\s*studies|Latin\s*American|European\s*civilization|cancer\s*research|Jossey[- ]Bass|Springer\s*series|Wiley\s*series)\b/i;

// Government, institutional, and document code patterns
const GOVT_RE =
  /\b(U\.?S\.?\s*Geological|agriculture\s*handbook|census|congressional|federal|S\.\s*prt|civil\s*liberties|gt\.\s*Brit|Central\s*Office|water\s*fact|Laws\s*of\s*Malaysia|Gifford\s*lectures|Smithsonian|American\s*Philosophical|NATO\s*(science|advanced)|symposium|symposia|Rand\s*(note|McNally)|colloques?\s*internationa|IWGIA|Ciba\s*Foundation)\b/i;

// Document codes / all-caps abbreviations (3+ chars, no lowercase)
const DOC_CODE_RE = /^[A-Z][A-Z0-9/ .-]{1,12}$/;

// Foreign-language academic/publisher series (Japanese bunko, Chinese collections, etc.)
const FOREIGN_ACADEMIC_RE =
  /\b(bunko|shinsho|sōsho|s[oō]sho|cong\s*shu|quan\s*shu|lei\s*bian|Laterza|Luchterhand|Göschen|Vandenhoeck|Garnier|chrétiennes|Metzler|Payot|ouverture\s*philosophique|Folio|Adelphi\s*papers|Bison\s*book|Galaxy\s*book|Delta\s*book|Fireside\s*book|Quest\s*book|Paragon|New\s*Directions\s*book|Faber\s*paper|Methuen|Pitman|Avebury)\b/i;

// Exact blocklist for series that slip through regex
const BLOCKED_SERIES = new Set([
  "Romance", "Historia", "Histoire", "Pocket", "Blake", "SP", "Cm",
  "Conflict studies", "Writers and their work", "College outline series",
  "Postcard history series", "Visual geography series",
  "VGM opportunities series", "Wiley finance series", "iFiction",
  "Cmnd", "Document", "Lehrbuch", "Narrativa", "Ensayo",
  "Temptation", "Max Reinhardt", "Catalogue", "Research paper",
  "Obras completas", "Lions", "PVP", "UCID", "Icon editions",
  "World of art", "J'ai lu", "Inside the minds", "My world",
  "Then & now", "Britain in pictures", "Modern war studies",
  "Landmarks in anthropology", "English men of letters",
  "The story of the nations", "Music in American life",
  "Mercury series", "A true book", "Ann Arbor paperbacks",
  "Casebook series", "Ecological studies", "Series in American studies",
  "Ancient peoples and places", "Food science and technology",
  "Cancer treatment and research", "Documento de trabajo",
  "A New true book", "Oberon modern plays", "French drama",
  "Italian drama", "Black drama, second ed", "Slave narratives",
  "Slavery, source material and critical literature",
  "American lecture series", "Hello reader!", "Read-it! readers.",
  "Ready-to-read", "Story chest", "East European monographs",
  "Harvard economic studies", "Harvard East Asian monographs",
  "Cornell paperbacks", "Princeton paperbacks",
  "Saunders golden sunburst series", "An everything series book",
  "Hodder Christian paperbacks", "Cassell military paperbacks",
  "A Harvest/HBJ book", "Burt Franklin research & source works series",
  "Burt Franklin research and source works series",
  "British trials, 1660-1900", "Twentieth century advice literature",
  "Thèse à la carte", "Beck'sche Reihe", "A Falcon guide",
  "VS research", "Indigenous Peoples: North America",
  "Heath's modern language series", "LEA's communication series",
  "Twayne's United States authors series", "Twayne's English authors series",
  "Twayne's world authors series", "International political economy series",
  "The Kluwer international series in engineering and computer science",
  "The Jossey-Bass higher and adult education series",
  "The Jossey-Bass management series",
  "The Jossey-Bass social and behavioral science series",
  "The Civilization of the American Indian series",
  "The Century psychology series", "The American Negro, his history and literature",
  "Tracts of the American Tract Society. General series",
  "Franklin D. Roosevelt and the era of the New Deal",
  "Preservation and Access for American and British Children's Literature, 1850-1869 (NEH PA-23536-00)",
  "Women and social movements, international",
  "Travels in the Old South",
  "Cultures of the world",
  "Black biographical dictionaries, 1790-1950",
  "Public administration series--bibliography",
  "New Canadian library",
  "Home university library of modern knowledge",
  "A Schiffer book for collectors",
  "A Schocken book",
  "Sage focus editions",
  "Pitt poetry series",
  "Little blue book",
  "Visual quickstart guide",
  "Eyewitness travel guides",
  "Haynes automotive repair manual series",
  "Owners workshop manual",
  "Charnwood",
  "West nutshell series",
  "Hornbook series",
  "Addison-Wesley series in mathematics",
  "London Mathematical Society lecture note series",
  "Pure and applied mathematics",
  "Graduate texts in mathematics",
  "Undergraduate texts in mathematics",
  "World bibliographical series",
  "Communications in Computer and Information Science",
  "Slavistic printings and reprintings",
  "Contributions in Afro-American and African studies",
  "Etudes africaines",
  "Voennye memuary",
  "Civil liberties in American history",
  "Aetas Kantiana",
  "Sources chrétiennes",
  "Phaenomenologica",
  "Quaestiones disputatae",
  // Round 3
  "Acta Universitatis Wratislaviensis",
  "Acta Universitatis Upsaliensis.",
  "Uni-Taschenbücher",
  "Janua linguarum.",
  "Janua linguarum. Series practica",
  "Fieldiana.",
  "Very short introductions",
  "Kultur- und Medientheorie",
  "Trends in linguistics.",
  "Lang man xin dian",
  "Xue jin tao yuan",
  "Self-counsel series",
  "FED", "HTD", "UCRL", "BLRDR",
  "Voices of the South",
  "English legal sources",
  "Manuali Hoepli",
  "Katalog",
  "Jeannie Willis Memorial Fund",
  "At issue",
  "American century series",
  "Picture lions",
  "Lectio divina",
  "Hommes et sociétés",
  "Everything series",
  "The Reference shelf",
  "The Expositor's Bible",
  "Poètes d'aujourd'hui",
  "His Obras completas",
  "Hale SF",
  "Fischer",
  "Essais",
  "BAR British series",
  "Red badge detective",
  "A Red badge novel of suspense",
  "Cornerstones of freedom",
  "American guide series",
  "Viz graphic novel",
  "Social science series",
  "Russia observed",
  "Si bu bei yao",
  "Revolution and romanticism, 1789-1834",
  "Dictionary of literary biography",
  "Science paperbacks",
  "Studium",
  "Tong li comics",
  "Five Star standard print western series",
  "Civil War America",
  "A Double D western",
  "Cliffs notes",
  "Childhood of famous Americans",
  "Black Americans of achievement",
  "Studia historica",
  "Pitt Latin American series",
  "Clásicos castellanos",
  "Classiques Larousse",
  "USAIN state and local literature preservation project",
  "Works issued by the Hakluyt Society",
  // Round 4
  "Mathematics and its applications",
  "Mathematics in science and engineering",
  "Forschungsberichte des Landes Nordrhein-Westfalen",
  "Anglistische Forschungen",
  "Texte und Untersuchungen zur Geschichte der altchristlichen Literatur",
  "Little apple",
  "Kultur und soziale Praxis",
  "ICPSR",
  "Harvard East Asian series",
  "Great Americana",
  "Golden treasury series",
  "Eyewitness travel",
  "Worldwide mystery",
  "Temas portugueses",
  "St. Antony's series",
  "Sifre mistorin",
  "Mills & Boon medical",
  "International series in pure and applied mathematics",
  "International series in pure and applied physics",
  "Frontiers in physics",
  "Early childhood education series",
  "Discovering series",
  "Current topics in microbiology and immunology",
  "Bibliotheca Ephemeridum theologicarum Lovaniensium",
  "Beck'sche Textausgaben",
  "Beck'sche Kurz-Kommentare",
  "Portraits of the nations series",
  "Multilingual matters",
  "Great lives",
  "Faber paperbacks",
  "We the people",
  "Trübner's oriental series",
  "Strategic forum",
  "Papermac",
  "Critiques littéraires",
  "Biblio 17",
  "Bell's cathedral series",
  "A Foulis motoring book",
  "Twentieth century views",
  "The compass series",
  "Rozprawy Uniwersytetu Warszawskiego",
  "Nations of the modern world",
  "International scientific series",
  "International Federation for Information Processing",
  "Corpus Christianorum",
  "Bouquins",
  "Verhandelingen van het Koninklijk Instituut voor Taal-, Land- en Volkenkunde",
  "Suomalaisen Kirjallisuuden Seuran toimituksia",
  "Schocken paperbacks",
  "Ricerche",
  "Legal almanac series",
  // Round 5 - massive cleanup
  "International chemical series",
  "From sea to shining sea",
  "Varia",
  "Stuttgarter Bibelstudien",
  "Russian titles for the specialist",
  "Rinehart editions",
  "Nanam sinsŏ",
  "Islamkundliche Untersuchungen",
  "Health reference series",
  "Faux titre",
  "Cultural memory in the present",
  "ArtScroll series",
  "Arco civil service test tutor",
  "Visual read less, learn more",
  "The master work series",
  "The Riverside literature series",
  "Sozialtheorie",
  "Praeger special studies",
  "KiWi",
  "International congress and symposium series",
  "European perspectives",
  "Early English Text Society",
  "Biblioteka Posebna izdanja",
  "A Borzoi book",
  "Work, its rewards and discontents",
  "Standard novels",
  "Prisma",
  "Posebna izdanja",
  "Point",
  // Round 6 - comprehensive sweep
  "[Great Britain. Parliament. Papers by command] cmnd.",
  "Memoirs of the American Philosophical Society",
  "Les Essais", "Lang man jing dian", "Documents", "Careers in depth",
  "Area planning studies", "World anthropology",
  "Smithsonian miscellaneous collections", "Scrittori italiani e stranieri",
  "Quest'Italia", "Percorsi",
  "Nineteenth century American literature and history",
  "Middle Ages series", "The Middle Ages series",
  "Locomotion papers", "Du monde entier",
  "Beihefte zur Zeitschrift für die alttestamentliche Wissenschaft",
  "An Evans novel of the West", "Actualités pédagogiques et psychologiques",
  "AAAS selected symposium", "A Continuum book",
  "Wesleyan poetry", "Voyages", "Memoir", "Loveswept",
  "Issues that concern you",
  "Historiae urbium et regionum Italiae rariores",
  "Headline series", "An Anvil original", "A Panther book",
  "Zhonghua jing ji yan jiu yuan jing ji zhuan lun",
  "The Critical heritage series", "Southern literary studies",
  "SepSetentas", "Picturemac", "Nederlandse staatswetten",
  "NHK bukkusu", "Lonely Planet travel survival kit",
  "Kleine Texte für Vorlesungen und Übungen", "Images of rail",
  "DA pam 621", "Concilium", "Anglistica & Americana",
  "An Evergreen book", "American labor (New York, N.Y.)",
  "Türk Dil Kurumu yayınları", "Twayne's masterwork studies",
  "Theory and history of literature", "Letras mexicanas",
  "Initiation philosophique", "Ideas in context", "Foi vivante",
  "Early English Text Society. Original series", "Clipper",
  "Chemical analysis", "The language of science",
  "The Practical approach series", "The practical approach series",
  "Surfactant science series",
  "Studies on Voltaire and the eighteenth century",
  "Questions of the day", "Politique",
  "Orbis biblicus et orientalis", "Filosofia",
  "CIS state constitutional conventions",
  "Bibliographical series of supplements to British book news on writers and their work",
  "Bank Street ready-to-read",
  "Abhandlungen zur Kunst-, Musik- und Literaturwissenschaft",
  "A Rand note", "Toronto Italian studies",
  "The states and their symbols", "The Modern Jewish experience",
  "The Master work series", "The English revolution",
  "Prima's secrets of the games",
  "Literatur und Gesellschaft", "Heroes of the nations",
  "Exploration series in education",
  "English recusant literature, 1558-1640",
  "Development Centre studies", "Communication and society",
  "An Inner sanctum mystery", "Writers and critics",
  "The Sources of science", "Soviet and East European studies",
  "Petite illustration. Théatre -- n.s.", "Overcoming common problems",
  "Neuromethods", "Magna", "Kerber art", "Kadokawa sensho",
  "Grandi opere", "Documenti di architettura", "De Gruyter Lehrbuch",
  "Constable crime", "Brown Judaic studies",
  "Ashgate popular and folk music series",
  "Addison-Wesley series in physics",
  "The Washington papers", "The Texas Pan American series",
  "The Roots of jazz", "Social science paperbacks", "Play file",
  "Nuovi coralli", "North-Holland mathematics studies",
  "New Directions paperbook", "Mills & Boon historical",
  "Irish studies", "Industry profile", "Gerritsen women's history",
  "Enchantment of the world.", "Discoveries",
  "Alter Orient und Altes Testament", "A Golden look-look book",
  "Torch Bible commentaries", "The Rise of commercial banking",
  "Tertiary level biology", "Steck-Vaughn portrait of America",
  "Read-it! readers", "Rand McNally education series",
  "Questions contemporaines",
  "Pitt series in policy and institutional studies",
  "Our debt to Greece and Rome", "New way",
  "NATO science series.", "Medical radiology",
  "International modern language series",
  "Fundamental theories of physics",
  "Compass series",
  "Colloques internationaux du Centre national de la recherche scientifique",
  "Celebrate the states", "Asahi sensho",
  "Arbeiten zur Kirchengeschichte", "[H.C.]",
  "The Rise of urban America", "Technology and society",
  "Science and culture series", "Ricerca",
  "Parents magazine read aloud original", "Oyez practice notes",
  "NATO advanced study institutes series.",
  "Lung biology in health and disease", "Lettre",
  "Law in context", "Kasama sensho", "Jackdaw", "Hello U.S.A.",
  "Gabler Research", "Fieldiana: zoology", "Faith and order paper",
  "Eyewitness accounts of the American Revolution", "Ensayos",
  "Current controversies", "Concrete series", "Collins pathways",
  "Adelphi paper", "A Magnet book",
  "Wisdom of the East series",
  "Untersuchungen zur deutschen Literaturgeschichte",
  "UCLA symposia on molecular and cellular biology",
  "Theory, culture & society", "The Best [American] Short Stories",
  "Storia", "Spanish drama", "Science study series",
  "Recent economic thought series", "Quadrige",
  "Psychologie et sciences humaines", "Pensamiento", "Le scie",
  "HUD-PDR", "Fieldiana -- new ser.", "European business",
  "Etudes bibliques", "Early American studies",
  "Deutsche Lande, deutsche Kunst", "Crosscurrents: modern critiques",
  "Corsi universitari", "Charnwood series",
  "Chandos information professional series", "Cadogan guides",
  "Blackwell companions to literature and culture",
  "Aspects of Greek and Roman life", "America and the Holy Land",
  "Acta Universitatis Upsaliensis", "A Rinehart suspense novel",
  "Variorum collected studies series", "Università",
  "Topics in English linguistics", "The Anti-slavery crusade in America",
  "Testimonianze fra cronaca e storia", "Tascabili Bompiani",
  "Silver star westerns", "Signature lives", "Positive health guide",
  "Persiles", "Let's-read-and-find-out science book",
  "Les Guides bleus", "Language and literacy series",
  "Forschungen zur Religion und Literatur des Alten und Neuen Testaments",
  "Falk symposium", "Drugs and the pharmaceutical sciences",
  "Documento", "Blueprints",
  "American education--its men, ideas, and institutions",
  "America in two centuries, an inventory",
  "Zhong yang yan jiu yuan jin dai shi yan jiu suo zhuan kan",
  "Ze gu zhai chong chao", "Yūhikaku sensho",
  "VGM careers for you series", "The Terry lectures",
  "The First American frontier",
  "The Dorsey series in political science", "Teatro",
  "Take the law into your own hands",
  "Supplements to Novum Testamentum", "Program aid", "Plus",
  "Lonely Planet phrasebooks", "Little craft book series",
  "La Vie quotidienne", "Kodansha globe",
  "Issues and practices in criminal justice",
  "His Gesammelte Werke", "Haworth gay & lesbian studies",
  "Environmental research brief", "Edizioni Ricordi",
  "Coeden ddarllen Rhydychen", "Babel", "A Quintet book",
  "A Grafton book", "Weale's rudimentary series",
  "The Literature of photography", "Russian studies",
  "Modern masters", "Janua linguarum. Series minor",
  "International series in operations research & management science",
  "Helps for students of history", "German drama",
  "European political thought", "Critical America",
  "Communication and information science", "CHES studies",
  "Applied clinical psychology", "American culture series",
  "Alcabala del viento", "A World's Work children's book",
  "A New Directions paperbook",
  "Women and gender in the early modern world",
  "Wissenschaft und Bildung", "Voices that matter",
  "Useful reference series",
  "The IMA volumes in mathematics and its applications",
  "The Bedford series in history and culture", "The American scene",
  "Cliffs notes", "Childhood of famous Americans",
  "Black Americans of achievement",
  // Round 7 - remaining stragglers
  "Studia historica Academiae Scientiarum Hungaricae", "Studia grammatica",
  "Starmont reader's guide", "Signal lives", "Science editions",
  "Pluriel", "King crime", "Héritage jeunesse",
  "Flight, its first seventy-five years", "Conditio Judaica",
  "Chemical industries", "Camfield", "Beacon paperbacks",
  "BBC music guides", "An Impact book", "All aboard reading.",
  "Écrivains de toujours", "York notes",
  "Yiddish children's literature from the YIVO Institute for Jewish Research",
  "Women in America: from colonial times to the 20th century",
  "What research says to the teacher",
  "Westview special studies on the Middle East",
  "Topics in current chemistry", "The Rand paper series",
  "The Railroads",
  "Pitt series in Russian and East European studies",
  "Philosophie de l'esprit",
  "Operator theory, advances and applications",
  "Makers of history", "Literary criticism and cultural theory",
  "Lexicographica.", "Getting and spending",
  "Chatham House papers", "American imperialism",
  "Alianza universidad", "Zur Kritik der bürgerlichen Ideologie",
  "The specialists' series", "The archive photographs series",
  "The Dorsey series in psychology", "The Development of science",
]);

function isJunkSeries(series) {
  if (!series || series.length < 2 || series.length > 120) return true;

  // Strip trailing number patterns before checking
  let cleaned = series
    .replace(/\s*(?:--|;|,)\s*(?:\[?\d+(?:\.\d+)?\]?|vol\.?\s*\d+)\s*$/i, "")
    .replace(/[\s;,\-]+$/, "")
    .trim();

  if (!cleaned || cleaned.length < 2) return true;
  if (JUNK_SERIES_RE.test(cleaned)) return true;
  if (PUBLISHER_RE.test(cleaned)) return true;
  if (ACADEMIC_RE.test(cleaned)) return true;
  if (GOVT_RE.test(cleaned)) return true;
  if (DOC_CODE_RE.test(cleaned)) return true;
  if (FOREIGN_ACADEMIC_RE.test(cleaned)) return true;
  if (BLOCKED_SERIES.has(cleaned)) return true;

  return false;
}

// --- Main ---

console.log(`Opening database: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const total = db.prepare("SELECT COUNT(*) as n FROM works WHERE series IS NOT NULL").get().n;
console.log(`Works with series: ${total}`);

// Process in batches
const BATCH_SIZE = 5000;
let nullified = 0;
let offset = 0;

const selectBatch = db.prepare(
  "SELECT key, series FROM works WHERE series IS NOT NULL LIMIT ? OFFSET ?"
);
const nullifySeries = db.prepare(
  "UPDATE works SET series = NULL, series_number = NULL WHERE key = ?"
);

const runBatch = db.transaction((rows) => {
  for (const row of rows) {
    if (isJunkSeries(row.series)) {
      nullifySeries.run(row.key);
      nullified++;
    }
  }
});

// We need to collect all keys first since we're modifying as we go
console.log("Scanning all series...");
const allRows = db.prepare("SELECT key, series FROM works WHERE series IS NOT NULL").all();
console.log(`Loaded ${allRows.length} rows, filtering...`);

for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
  const batch = allRows.slice(i, i + BATCH_SIZE);
  runBatch(batch);

  if ((i + BATCH_SIZE) % 50000 === 0 || i + BATCH_SIZE >= allRows.length) {
    console.log(
      `  Processed ${Math.min(i + BATCH_SIZE, allRows.length)}/${allRows.length} — nullified ${nullified} so far`
    );
  }
}

const remaining = db.prepare("SELECT COUNT(*) as n FROM works WHERE series IS NOT NULL").get().n;

console.log(`\nDone.`);
console.log(`  Nullified: ${nullified}`);
console.log(`  Remaining series: ${remaining}`);

db.close();
