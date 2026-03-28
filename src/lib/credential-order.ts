const PREFERRED_CREDENTIAL_RANKS = new Map<string, number>([
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

const DEGREE_CREDENTIALS = new Set([
  "MD",
  "PhD",
  "DSc",
  "JD",
  "LLD",
  "DD",
  "ThD",
  "DBA",
  "MBA",
  "MPhil",
  "MSc",
  "MPH",
  "MEng",
  "MFA",
  "MA",
  "Master's",
]);

function preferredCredentialRank(credential: string) {
  const normalized = credential.trim();
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

function degreeCredentialRank(credential: string) {
  const normalized = credential.trim();
  const lowerNormalized = normalized.toLowerCase();
  const exactRank = DEGREE_CREDENTIALS.has(normalized)
    ? PREFERRED_CREDENTIAL_RANKS.get(normalized)
    : null;

  if (exactRank != null) {
    return exactRank;
  }

  for (const degree of DEGREE_CREDENTIALS) {
    const rank = PREFERRED_CREDENTIAL_RANKS.get(degree);
    const lowerDegree = degree.toLowerCase();

    if (
      rank != null &&
      (lowerNormalized.startsWith(`${lowerDegree} in `) ||
        lowerNormalized.startsWith(`${lowerDegree} of `) ||
        normalized.startsWith(`${degree} (`))
    ) {
      return rank;
    }
  }

  return null;
}

function degreeCredentialSpecificity(credential: string) {
  const normalized = credential.trim();
  const lowerNormalized = normalized.toLowerCase();

  if (lowerNormalized.includes(" in ") || lowerNormalized.includes(" of ")) {
    return 2;
  }

  if (normalized.includes("(")) {
    return 1;
  }

  return 0;
}

function compareRankedCredentials(left: string, right: string) {
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

function normalizeCredential(credential: string) {
  return credential.trim();
}

function isTeachingCredential(credential: string) {
  return /\b(professor|lecturer|docent)\b/i.test(credential);
}

export function compareCredentials(left: string, right: string) {
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

  return left.localeCompare(right);
}

export function sortCredentials(credentials: string[]) {
  return [...credentials].sort(compareCredentials);
}

export function highestDegreeCredential(credentials: string[]) {
  let best: string | null = null;
  let bestRank: number | null = null;

  for (const credential of credentials) {
    const rank = degreeCredentialRank(credential);

    if (rank == null) {
      continue;
    }

    if (bestRank == null || rank < bestRank) {
      best = credential;
      bestRank = rank;
      continue;
    }

    if (rank === bestRank && best != null && compareRankedCredentials(credential, best) < 0) {
      best = credential;
    }
  }

  return best;
}

export function bookCardCredentials(credentials: string[]) {
  const sorted = sortCredentials(Array.from(new Set(credentials.map(normalizeCredential).filter(Boolean))));
  const selected: string[] = [];
  const seen = new Set<string>();
  const highestDegree = highestDegreeCredential(sorted);

  function addCredential(credential: string) {
    const normalized = normalizeCredential(credential);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    selected.push(normalized);
  }

  for (const credential of sorted) {
    if (isTeachingCredential(credential)) {
      addCredential(credential);
    }
  }

  if (selected.length === 0 && highestDegree) {
    addCredential(highestDegree);
  }

  return selected;
}
