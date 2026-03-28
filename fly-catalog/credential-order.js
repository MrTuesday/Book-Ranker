const PREFERRED_CREDENTIAL_RANKS = new Map([
  ["MD", 0],
  ["PhD", 1],
  ["DSc", 2],
  ["JD", 3],
  ["LLD", 4],
  ["DD", 5],
  ["ThD", 6],
  ["DBA", 7],
  ["MBA", 8],
  ["MPhil", 9],
  ["MSc", 10],
  ["MPH", 11],
  ["MEng", 12],
  ["MFA", 13],
  ["MA", 14],
  ["Master's", 15],
  ["Habilitation", 20],
  ["Professor", 30],
  ["Lecturer", 31],
  ["Docent", 32],
]);

const ACADEMIC_CREDENTIALS = new Set([
  "Academic",
  "Archaeologist",
  "Anthropologist",
  "Astronomer",
  "Biologist",
  "Chemist",
  "Computer Scientist",
  "Ecologist",
  "Economist",
  "Epidemiologist",
  "Geneticist",
  "Geologist",
  "Historian",
  "Linguist",
  "Mathematician",
  "Neuroscientist",
  "Philosopher",
  "Physicist",
  "Political Scientist",
  "Psychologist",
  "Researcher",
  "Scholar",
  "Scientist",
  "Sociologist",
  "Statistician",
  "Theologian",
]);

const ACADEMIC_CREDENTIAL_PATTERNS = [
  /\bprofessor\b/i,
  /\blecturer\b/i,
  /\bdocent\b/i,
  /\bhabilitation\b/i,
  /\bphd\b/i,
  /\bmd\b/i,
  /\bmsc\b/i,
  /\bma\b/i,
  /\bmba\b/i,
  /\bjd\b/i,
  /\blld\b/i,
  /\bdsc\b/i,
  /\bacademic\b/i,
  /\barchaeologist\b/i,
  /\banthropologist\b/i,
  /\bastronomer\b/i,
  /\bart historian\b/i,
  /\bbiologist\b/i,
  /\bbotanist\b/i,
  /\bchemist\b/i,
  /\bcomputer scientist\b/i,
  /\bcosmologist\b/i,
  /\becologist\b/i,
  /\beconomist\b/i,
  /\bepidemiologist\b/i,
  /\bgeneticist\b/i,
  /\bgeologist\b/i,
  /\bhistorian\b/i,
  /\blinguist\b/i,
  /\bmathematician\b/i,
  /\bneuroscientist\b/i,
  /\bphilosopher\b/i,
  /\bphysicist\b/i,
  /\bpolitical scientist\b/i,
  /\bpsychologist\b/i,
  /\bresearcher\b/i,
  /\bscholar\b/i,
  /\bscientist\b/i,
  /\bsociologist\b/i,
  /\bstatistician\b/i,
  /\btheologian\b/i,
];

export function isAcademicCredential(credential) {
  const normalized = String(credential || "").trim();
  if (!normalized) return false;
  if (PREFERRED_CREDENTIAL_RANKS.has(normalized)) return true;
  if (ACADEMIC_CREDENTIALS.has(normalized)) return true;
  return ACADEMIC_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function preferredCredentialRank(credential) {
  const normalized = String(credential || "").trim();
  const lowerNormalized = normalized.toLowerCase();
  const exactRank = PREFERRED_CREDENTIAL_RANKS.get(normalized);

  if (exactRank != null) {
    return exactRank;
  }

  for (const [baseCredential, rank] of PREFERRED_CREDENTIAL_RANKS) {
    const lowerBase = baseCredential.toLowerCase();
    if (
      lowerNormalized.startsWith(`${lowerBase} in `) ||
      lowerNormalized.startsWith(`${lowerBase} of `) ||
      normalized.startsWith(`${baseCredential} (`)
    ) {
      return rank;
    }
  }

  return null;
}

function degreeCredentialSpecificity(credential) {
  const normalized = String(credential || "").trim();
  const lowerNormalized = normalized.toLowerCase();

  if (lowerNormalized.includes(" in ") || lowerNormalized.includes(" of ")) {
    return 2;
  }

  if (normalized.includes("(")) {
    return 1;
  }

  return 0;
}

function compareRankedCredentials(left, right) {
  const leftSpecificity = degreeCredentialSpecificity(left);
  const rightSpecificity = degreeCredentialSpecificity(right);

  if (leftSpecificity !== rightSpecificity) {
    return rightSpecificity - leftSpecificity;
  }

  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return left.localeCompare(right);
}

export function compareCredentials(left, right) {
  const leftPreferredRank = preferredCredentialRank(left);
  const rightPreferredRank = preferredCredentialRank(right);

  if (leftPreferredRank != null || rightPreferredRank != null) {
    if (leftPreferredRank == null) {
      return 1;
    }

    if (rightPreferredRank == null) {
      return -1;
    }

    return leftPreferredRank - rightPreferredRank || compareRankedCredentials(left, right);
  }

  const leftAcademic = isAcademicCredential(left);
  const rightAcademic = isAcademicCredential(right);

  if (leftAcademic !== rightAcademic) {
    return leftAcademic ? -1 : 1;
  }

  return left.localeCompare(right);
}

export function sortCredentials(credentials) {
  return [...credentials].sort(compareCredentials);
}
