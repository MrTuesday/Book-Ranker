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
  /\blecturer\b/i,
  /\bmathematician\b/i,
  /\bneuroscientist\b/i,
  /\bphilosopher\b/i,
  /\bphysicist\b/i,
  /\bpolitical scientist\b/i,
  /\bprofessor\b/i,
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
  if (ACADEMIC_CREDENTIALS.has(normalized)) return true;
  return ACADEMIC_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function compareCredentials(left, right) {
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
