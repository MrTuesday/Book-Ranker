const CANONICAL_GENRES = [
  "Adventure",
  "Anthropology",
  "Architecture",
  "Art",
  "Astronomy",
  "Biography",
  "Biology",
  "Biographical Fiction",
  "Business",
  "Children's Fiction",
  "Chemistry",
  "Christian Fiction",
  "Classics",
  "Coming Of Age",
  "Contemporary Fiction",
  "Crime",
  "Drama",
  "Dystopian",
  "Economics",
  "Education",
  "Engineering",
  "Environment",
  "Erotica",
  "Essays",
  "Espionage",
  "Family",
  "Fantasy",
  "Finance",
  "Folklore",
  "Gay Fiction",
  "Graphic Novels",
  "History",
  "Historical Fiction",
  "Horror",
  "Humor",
  "LGBTQ+",
  "Language",
  "Law",
  "Literary Fiction",
  "Mathematics",
  "Medical",
  "Memoir",
  "Medicine",
  "Mystery",
  "Music",
  "Poetry",
  "Police Procedural",
  "Philosophy",
  "Physics",
  "Politics",
  "Political Fiction",
  "Psychology",
  "Psychological Fiction",
  "Reference",
  "Religious Fiction",
  "Religion",
  "Romance",
  "Saga",
  "Satire",
  "Science",
  "Self-Help",
  "Science Fiction",
  "Short Stories",
  "Sociology",
  "Sports",
  "Suspense",
  "Technology",
  "Thriller",
  "Travel",
  "War",
  "Western",
  "Women's Fiction",
  "Women Sleuths",
  "Young Adult",
];

const NOISY_SUBJECT_PATTERNS = [
  /^open library/i,
  /^reading level-/i,
  /^juvenile works$/i,
  /^pictorial works$/i,
  /^characters?$/i,
  /^specimens$/i,
  /^translations into /i,
  /^spanish language materials$/i,
  /^untranslated$/i,
  /^open_syllabus_project$/i,
  /^open syllabus project$/i,
  /^general$/i,
  /^large type books?$/i,
  /^large print$/i,
  /^new york times reviewed$/i,
  /^new york times bestseller/i,
  /^ny times bestseller$/i,
  /^new york times$/i,
  /^bestsellers?$/i,
  /^catalogs$/i,
  /^handbooks?, manuals?$/i,
  /^case studies$/i,
  /^study and teaching$/i,
  /^guidebooks$/i,
  /^textbooks?$/i,
  /^commentaries$/i,
  /^sources$/i,
  /^research$/i,
  /^methods$/i,
  /^popular works$/i,
  /^readers$/i,
  /^miscellanea$/i,
  /^problems, exercises$/i,
  /^bibliography$/i,
  /^exhibitions$/i,
  /^fiction in english$/i,
  /^fiction$/i,
  /^fiction, general$/i,
  /^english fiction$/i,
  /^indic fiction \(english\)$/i,
  /^british and irish fiction \(fictional works by one author\)$/i,
  /^literature$/i,
  /^english literature$/i,
  /^language [&+] literary studies$/i,
  /^history and criticism$/i,
  /\bhistory and criticism\b/i,
  /^.+ in literature$/i,
  /\bin literature\b/i,
  /^.+ and literature$/i,
  /\band literature\b/i,
  /^correspondence(?:\.\.)?$/i,
  /^authors and publishers$/i,
  /^english authors$/i,
  /^manuscripts?$/i,
  /^english manuscripts$/i,
  /^translating and interpreting$/i,
  /^adaptations$/i,
  /^traducciones? al espa[ñn]ol$/i,
  /^romans?(, nouvelles)?$/i,
  /^novela(s)?(?: inglesa(s)?)?$/i,
  /^ficci[oó]n$/i,
];

const CALL_NUMBER_RE = /^[A-Z]{1,3}\d{2,4}(?:\s*\.[A-Z0-9]+)*$/i;

const DIRECT_SUBJECT_REPLACEMENTS = [
  [/^poetry \(poetic works by one author\)$/i, ["Poetry"]],
  [/^children'?s fiction$/i, ["Children's Fiction"]],
  [/^juvenile fiction$/i, ["Children's Fiction"]],
  [/^classic literature$/i, ["Classics"]],
  [/^fiction classics$/i, ["Classics"]],
  [/^contemporary fiction$/i, ["Contemporary Fiction"]],
  [/^literary$/i, ["Literary Fiction"]],
  [/^satirical literature$/i, ["Satire"]],
  [/^science fiction$/i, ["Science Fiction"]],
  [/^sci[- ]?fi$/i, ["Science Fiction"]],
  [/^scifi$/i, ["Science Fiction"]],
  [/^ciencia[- ]ficci[oó]n$/i, ["Science Fiction"]],
  [/^political fiction$/i, ["Political Fiction"]],
  [/^historical fiction$/i, ["Historical Fiction"]],
  [/^psychological fiction$/i, ["Psychological Fiction"]],
  [/^dystopian$/i, ["Dystopian"]],
  [/^dystopia$/i, ["Dystopian"]],
  [/^dystopias$/i, ["Dystopian"]],
  [/^dystopies$/i, ["Dystopian"]],
  [/^distop[ií]as$/i, ["Dystopian"]],
  [/^dystopian fiction$/i, ["Dystopian"]],
  [/^dystopian plays$/i, ["Dystopian"]],
  [/^history$/i, ["History"]],
  [/^biography$/i, ["Biography"]],
  [/^memoir$/i, ["Memoir"]],
  [/^politics and government$/i, ["Politics"]],
  [/^political science$/i, ["Politics"]],
  [/^government policy$/i, ["Politics"]],
  [/^public policy$/i, ["Politics"]],
  [/^foreign relations$/i, ["Politics"]],
  [/^law and legislation$/i, ["Law"]],
  [/^law$/i, ["Law"]],
  [/^criminal procedure$/i, ["Law"]],
  [/^description and travel$/i, ["Travel"]],
  [/^travel$/i, ["Travel"]],
  [/^journeys$/i, ["Travel"]],
  [/^religion$/i, ["Religion"]],
  [/^christianity$/i, ["Religion"]],
  [/^christian life$/i, ["Religion"]],
  [/^catholic church$/i, ["Religion"]],
  [/^islam$/i, ["Religion"]],
  [/^bible$/i, ["Religion"]],
  [/^spirituality$/i, ["Religion"]],
  [/^philosophy$/i, ["Philosophy"]],
  [/^ethics$/i, ["Philosophy"]],
  [/^psychology$/i, ["Psychology"]],
  [/^science$/i, ["Science"]],
  [/^mathematics$/i, ["Mathematics"]],
  [/^statistics$/i, ["Mathematics"]],
  [/^education$/i, ["Education"]],
  [/^economics$/i, ["Economics"]],
  [/^economic conditions$/i, ["Economics"]],
  [/^economic policy$/i, ["Economics"]],
  [/^economic aspects$/i, ["Economics"]],
  [/^finance$/i, ["Finance"]],
  [/^business$/i, ["Business"]],
  [/^business & economics$/i, ["Business", "Economics"]],
  [/^management$/i, ["Business"]],
  [/^self-help techniques$/i, ["Self-Help"]],
  [/^art$/i, ["Art"]],
  [/^design$/i, ["Art"]],
  [/^music$/i, ["Music"]],
  [/^architecture$/i, ["Architecture"]],
  [/^technology$/i, ["Technology"]],
  [/^engineering$/i, ["Engineering"]],
  [/^medicine$/i, ["Medicine"]],
  [/^physics$/i, ["Physics"]],
  [/^biology$/i, ["Biology"]],
  [/^chemistry$/i, ["Chemistry"]],
  [/^astronomy$/i, ["Astronomy"]],
  [/^environment$/i, ["Environment"]],
  [/^folklore$/i, ["Folklore"]],
  [/^english language$/i, ["Language"]],
  [/^chinese language$/i, ["Language"]],
  [/^german language$/i, ["Language"]],
  [/^language and language$/i, ["Language"]],
  [/^dictionaries?$/i, ["Reference"]],
  [/^computer science$/i, ["Technology"]],
  [/^sports?$/i, ["Sports"]],
  [/^softball$/i, ["Sports"]],
  [/^badminton(?: \(game\))?$/i, ["Sports"]],
  [/^war$/i, ["War"]],
  [/^conduct of life$/i, ["Self-Help"]],
  [/^wit and humor$/i, ["Humor"]],
  [/^humor, general$/i, ["Humor"]],
  [/^literature, collections$/i, ["Literary Fiction"]],
];

const FICTION_TOKEN_REPLACEMENTS = new Map([
  ["action & adventure", ["Adventure"]],
  ["action and adventure", ["Adventure"]],
  ["adventure", ["Adventure"]],
  ["biographical", ["Biographical Fiction"]],
  ["christian", ["Christian Fiction"]],
  ["coming of age", ["Coming Of Age"]],
  ["classics", ["Classics"]],
  ["contemporary", ["Contemporary Fiction"]],
  ["contemporary fiction", ["Contemporary Fiction"]],
  ["crime", ["Crime"]],
  ["dystopian", ["Dystopian"]],
  ["dystopian fiction", ["Dystopian"]],
  ["erotica", ["Erotica"]],
  ["espionage", ["Espionage"]],
  ["family life", ["Family"]],
  ["fantasy", ["Fantasy"]],
  ["gay", ["Gay Fiction"]],
  ["general", []],
  ["historical", ["Historical Fiction"]],
  ["history", ["History"]],
  ["horror", ["Horror"]],
  ["humorous", ["Humor"]],
  ["lgbtq+", ["LGBTQ+"]],
  ["literary", ["Literary Fiction"]],
  ["medical", ["Medical"]],
  ["memoir", ["Memoir"]],
  ["mystery & detective", ["Mystery"]],
  ["mystery", ["Mystery"]],
  ["poetry", ["Poetry"]],
  ["police procedural", ["Police Procedural"]],
  ["political", ["Political Fiction"]],
  ["psychological", ["Psychological Fiction"]],
  ["religious", ["Religious Fiction"]],
  ["romance", ["Romance"]],
  ["sagas", ["Saga"]],
  ["science fiction", ["Science Fiction"]],
  ["short stories (single author)", ["Short Stories"]],
  ["suspense", ["Suspense"]],
  ["satire", ["Satire"]],
  ["thrillers", ["Thriller"]],
  ["thriller", ["Thriller"]],
  ["war & military", ["War"]],
  ["westerns", ["Western"]],
  ["women", ["Women's Fiction"]],
  ["women sleuths", ["Women Sleuths"]],
  ["young adult", ["Young Adult"]],
]);

const CONTAINED_GENRE_PATTERNS = [
  [/\bscience fiction\b/i, ["Science Fiction"]],
  [/\bfantasy\b/i, ["Fantasy"]],
  [/\bdystopian\b|\bdystopia\b|\bdystopias\b|\bdystopies\b|\bdistopias\b/i, ["Dystopian"]],
  [/\bpolitical fiction\b/i, ["Political Fiction"]],
  [/\bhistorical fiction\b/i, ["Historical Fiction"]],
  [/\bpsychological fiction\b/i, ["Psychological Fiction"]],
  [/\bcontemporary fiction\b/i, ["Contemporary Fiction"]],
  [/\bclassic literature\b|\bfiction classics\b|\bclassics\b/i, ["Classics"]],
  [/\bsatirical\b|\bsatire\b/i, ["Satire"]],
  [/\bshort stories\b/i, ["Short Stories"]],
  [/\bdrama\b/i, ["Drama"]],
  [/\bessays?\b/i, ["Essays"]],
  [/\bpoetry\b/i, ["Poetry"]],
  [/\bbiography\b/i, ["Biography"]],
  [/\bmemoir\b/i, ["Memoir"]],
  [/\bhorror\b/i, ["Horror"]],
  [/\bromance\b/i, ["Romance"]],
  [/\bthrillers?\b/i, ["Thriller"]],
  [/\bsuspense\b/i, ["Suspense"]],
  [/\bmystery(?:\s*&\s*detective)?\b/i, ["Mystery"]],
  [/\bcrime\b/i, ["Crime"]],
  [/\bwesterns?\b/i, ["Western"]],
  [/\b(adventure|action and adventure|action & adventure)\b/i, ["Adventure"]],
  [/\bgraphic novels?\b|\bcomics?\b/i, ["Graphic Novels"]],
  [/\byoung adult\b|\bya\b/i, ["Young Adult"]],
  [/\bchildren'?s fiction\b|\bjuvenile fiction\b/i, ["Children's Fiction"]],
  [/\bhistory\b/i, ["History"]],
  [/\bpolitic(?:s|al)\b|\bgovernment\b|\bpublic policy\b|\bforeign relations\b/i, ["Politics"]],
  [/\blaw\b|\blegislation\b|\bcriminal procedure\b|\bpatent\b/i, ["Law"]],
  [/\btravel\b|\bjourneys\b|\bdescription and travel\b/i, ["Travel"]],
  [/\breligion\b|\bchristian(?:ity| life)?\b|\bchurch\b|\bislam\b|\bbible\b|\bsufism\b|\bspirituality\b|\btheology\b/i, ["Religion"]],
  [/\bphilosophy\b|\bethics\b/i, ["Philosophy"]],
  [/\bpsychology\b|\bpsychiatr(?:y|ic)\b|\bcognitive\b/i, ["Psychology"]],
  [/\bscience\b|\bgeology\b|\bweather\b|\bnatural disasters?\b/i, ["Science"]],
  [/\bmathematics?\b|\bstatistics\b|\bgroup theory\b/i, ["Mathematics"]],
  [/\beducation\b|\bteaching\b|\bschools?\b/i, ["Education"]],
  [/\beconom(?:ic|ics)\b|\bpublic welfare\b|\bsocial policy\b|\bincome maintenance\b/i, ["Economics"]],
  [/\bfinance\b/i, ["Finance"]],
  [/\bbusiness\b|\bmanagement\b|\bmarketing\b|\bleadership\b/i, ["Business"]],
  [/\bself-help\b|\bself help\b/i, ["Self-Help"]],
  [/\bart\b|\bdesign\b|\bdecoration\b|\bornament\b|\bpainting\b|\bsculpture\b|\bphotography\b/i, ["Art"]],
  [/\bmusic\b|\bopera\b|\btheat(?:er|re)\b/i, ["Music"]],
  [/\barchitecture\b|\bcity planning\b|\bregional planning\b|\burban(?:ization| policy| planning)?\b/i, ["Architecture"]],
  [/\bengineering\b|\btechnology\b|\bcomputer\b|\bsoftware\b|\bprogramming\b|\bsignal processing\b|\bcoding theory\b|\bdata processing\b|\bdigital techniques\b|\bfield programmable gate arrays\b/i, ["Technology"]],
  [/\bmedicine\b|\bmedical\b|\bgeriatrics\b|\bhealth\b|\bphysiology\b|\bdiseases\b/i, ["Medicine"]],
  [/\bphysics\b|\bmechanics\b|\bquantum\b/i, ["Physics"]],
  [/\bbiology\b|\bbotany\b|\bzoology\b|\bgenetics\b|\bneurobiology\b/i, ["Biology"]],
  [/\bchemistry\b|\bbiochemistry\b/i, ["Chemistry"]],
  [/\bastronomy\b|\bastrophysics\b|\bcosmology\b|\bspace\b/i, ["Astronomy"]],
  [/\benvironment\b|\benvironmental\b|\bconservation\b|\becology\b|\bclimate\b/i, ["Environment"]],
  [/\bfolklore\b|\bmythology\b|\blegends?\b/i, ["Folklore"]],
  [/\blanguage\b|\blinguistics\b|\bidioms\b|\bgrammar\b|\bjargon\b|\bterms and phrases\b/i, ["Language"]],
  [/\bdictionaries?\b|\bencyclopedias?\b|\breference\b/i, ["Reference"]],
  [/\bsociology\b|\bsocial conditions\b|\bsocial life and customs\b|\bsocial aspects\b/i, ["Sociology"]],
  [/\banthropology\b|\barchaeology\b|\bethnolog(?:y|ical)\b/i, ["Anthropology"]],
  [/\bsport\b|\bsoftball\b|\bbadminton\b|\bbaseball\b|\bbasketball\b|\bfootball\b|\bsoccer\b|\brecreation\b/i, ["Sports"]],
  [/\bmilitary\b|\bworld war\b|\bcivil war\b|\barmed forces\b/i, ["War"]],
  [/\b(?:american|arabic|canadian|chinese|english|french|german|greek|hellenistic greek|italian|japanese|russian|spanish|welsh|irish|french-canadian)\b.*\bliterature\b/i, ["Literary Fiction"]],
  [/\bmodern literature\b/i, ["Literary Fiction"]],
  [/\bwit and humor\b|\bhumor, general\b/i, ["Humor"]],
];

const CANONICAL_GENRE_LOOKUP = new Map(
  CANONICAL_GENRES.map((genre) => [genre.toLocaleLowerCase(), genre]),
);

const GENRE_DEMOTION = new Map([
  ["Classics", 3],
  ["Contemporary Fiction", 3],
  ["Literary Fiction", 3],
  ["History", 3],
  ["Reference", 3],
  ["Language", 3],
  ["Biography", 2],
  ["Memoir", 2],
  ["Poetry", 2],
  ["Graphic Novels", 1],
  ["Short Stories", 1],
  ["Drama", 1],
  ["Essays", 1],
]);

const FALLBACK_GENRE_BLOCKLIST = new Set([
  "american literature",
  "bills, private",
  "children",
  "civilization",
  "claims",
  "congresses",
  "conduct of life",
  "criticism and interpretation",
  "criticism, interpretation",
  "early works to 1800",
  "french literature",
  "interviews",
  "juvenile literature",
  "private bills",
  "spanish literature",
  "united states",
  "women",
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function normalizeSubjectLabel(value) {
  const trimmed = normalizeString(value);

  if (!trimmed) {
    return "";
  }

  const shouldRetitle =
    trimmed === trimmed.toLocaleLowerCase() ||
    trimmed === trimmed.toLocaleUpperCase();

  if (!shouldRetitle) {
    return trimmed;
  }

  return trimmed
    .toLocaleLowerCase()
    .replace(
      /(^|[\s/(:,&-])(\p{L})/gu,
      (_match, boundary, letter) => `${boundary}${letter.toLocaleUpperCase()}`,
    );
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = normalizeString(value);

    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function sortGenres(values) {
  return values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => {
      return (
        (GENRE_DEMOTION.get(left.value) ?? 0) -
          (GENRE_DEMOTION.get(right.value) ?? 0) ||
        left.index - right.index
      );
    })
    .map(({ value }) => value);
}

function isFallbackGenreSubject(subject) {
  const normalized = normalizeString(subject);
  const key = normalized.toLocaleLowerCase();

  if (!normalized || FALLBACK_GENRE_BLOCKLIST.has(key)) {
    return false;
  }

  if (normalized.length < 4 || normalized.length > 24) {
    return false;
  }

  if (/[0-9(),.:;/]/.test(normalized)) {
    return false;
  }

  if (
    /\b(authors?|bills?|claims?|congress(?:es)?|criticism|interviews?|juvenile|literature|works?)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);

  return tokens.length >= 1 && tokens.length <= 2;
}

function deriveFallbackGenres(subjects) {
  return subjects.filter(isFallbackGenreSubject).slice(0, 3);
}

function pruneSubjectTags(values) {
  let result = uniqueStrings(values);
  let lower = new Set(result.map((value) => value.toLocaleLowerCase()));

  const hasScienceSupport = result.some((value) =>
    [
      "Technology",
      "Engineering",
      "Mathematics",
      "Medicine",
      "Physics",
      "Chemistry",
      "Biology",
      "Astronomy",
      "Environment",
    ].includes(value),
  );

  if (lower.has("science") && lower.has("politics") && !hasScienceSupport) {
    result = result.filter((value) => value !== "Science");
    lower = new Set(result.map((value) => value.toLocaleLowerCase()));
  }

  if (lower.has("politics") && lower.has("political fiction")) {
    result = result.filter((value) => value !== "Politics");
    lower = new Set(result.map((value) => value.toLocaleLowerCase()));
  }

  const hasSpeculativeContext = result.some((value) =>
    ["Science Fiction", "Fantasy", "Dystopian"].includes(value),
  );
  const hasWarHistoryContext = result.includes("History");

  if (lower.has("war") && hasSpeculativeContext && !hasWarHistoryContext) {
    result = result.filter((value) => value !== "War");
  }

  return result;
}

function normalizeSubjectKey(value) {
  return normalizeString(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

export function parseSubjectList(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string")
      .map(normalizeSubjectLabel)
      .filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);

    return Array.isArray(parsed)
      ? parsed
          .filter((entry) => typeof entry === "string")
          .map(normalizeSubjectLabel)
          .filter(Boolean)
      : [];
  } catch {
    return trimmed
      .split(",")
      .map(normalizeSubjectLabel)
      .filter(Boolean);
  }
}

function isUsefulSubject(subject) {
  if (!subject || subject.length < 3 || subject.length > 64) {
    return false;
  }

  const letters = Array.from(subject).filter((character) =>
    /\p{L}/u.test(character),
  ).length;

  if (letters < 3) {
    return false;
  }

  if (CALL_NUMBER_RE.test(subject)) {
    return false;
  }

  return !isNoisySubject(subject);
}

function isNoisySubject(subject) {
  return NOISY_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));
}

function deriveFictionSubjectTags(subject) {
  const normalized = normalizeSubjectKey(subject);
  let remainder = null;
  const derived = [];

  if (normalized.startsWith("young adult fiction")) {
    derived.push("Young Adult");
    remainder = normalized.slice("young adult fiction".length);
  } else if (
    normalized.startsWith("juvenile fiction") ||
    normalized.startsWith("children's fiction") ||
    normalized.startsWith("childrens fiction")
  ) {
    derived.push("Children's Fiction");
    remainder = normalized
      .replace(/^juvenile fiction/, "")
      .replace(/^children'?s fiction/, "")
      .replace(/^childrens fiction/, "");
  } else if (normalized.startsWith("fiction")) {
    remainder = normalized.slice("fiction".length);
  }

  if (remainder == null) {
    return [];
  }

  remainder = remainder.replace(/^[\s:/,-]+/, "");

  if (!remainder) {
    return uniqueStrings(derived);
  }

  const tokens = remainder
    .split(/\s*[/,:;-]\s*/)
    .map((token) => token.trim())
    .filter(Boolean);

  const replacements = tokens.flatMap((token) => {
    const mapped = FICTION_TOKEN_REPLACEMENTS.get(token);

    return mapped ?? [normalizeSubjectLabel(token)];
  });

  return uniqueStrings(
    [...derived, ...replacements].filter(
      (tag) => tag.toLocaleLowerCase() !== "fiction",
    ),
  );
}

function deriveContainedGenreTags(subject) {
  const normalized = normalizeSubjectKey(subject);
  const matches = [];

  for (const [pattern, replacement] of CONTAINED_GENRE_PATTERNS) {
    if (pattern.test(normalized)) {
      matches.push(...replacement);
    }
  }

  return uniqueStrings(matches);
}

function deriveReplacementSubjects(subject) {
  if (isNoisySubject(subject)) {
    return [];
  }

  const canonicalGenre =
    CANONICAL_GENRE_LOOKUP.get(normalizeSubjectKey(subject)) ?? null;

  if (canonicalGenre) {
    return [canonicalGenre];
  }

  const fictionTags = deriveFictionSubjectTags(subject);

  if (fictionTags.length > 0) {
    return fictionTags;
  }

  for (const [pattern, replacement] of DIRECT_SUBJECT_REPLACEMENTS) {
    if (pattern.test(subject)) {
      return replacement;
    }
  }

  const containedGenres = deriveContainedGenreTags(subject);

  if (containedGenres.length > 0) {
    return containedGenres;
  }

  return [];
}

export function isGenreLikeSubject(subject) {
  return deriveReplacementSubjects(subject).length > 0;
}

export function sanitizeSubjectTags(value) {
  const subjects = [];
  const genres = [];

  for (const rawSubject of parseSubjectList(value)) {
    const replacements = deriveReplacementSubjects(rawSubject);

    if (replacements.length > 0) {
      for (const replacement of replacements) {
        subjects.push(replacement);

        if (isGenreLikeSubject(replacement)) {
          genres.push(replacement);
        }
      }
      continue;
    }

    if (!isUsefulSubject(rawSubject)) {
      continue;
    }

    subjects.push(rawSubject);

    if (isGenreLikeSubject(rawSubject)) {
      genres.push(rawSubject);
    }
  }

  const finalSubjects = pruneSubjectTags(subjects);
  const finalGenres = pruneSubjectTags(genres);

  return {
    subjects: finalSubjects,
    genres: sortGenres(
      uniqueStrings(
        finalGenres.length > 0
          ? finalGenres
          : [...finalGenres, ...deriveFallbackGenres(finalSubjects)],
      ),
    ),
  };
}

export function subjectsToFtsText(value) {
  return sanitizeSubjectTags(value).subjects.join("\n");
}
