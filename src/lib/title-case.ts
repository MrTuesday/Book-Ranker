const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "down",
  "for",
  "from",
  "if",
  "in",
  "into",
  "like",
  "near",
  "nor",
  "of",
  "off",
  "on",
  "once",
  "onto",
  "or",
  "out",
  "over",
  "past",
  "per",
  "so",
  "than",
  "that",
  "the",
  "till",
  "to",
  "up",
  "upon",
  "v",
  "vs",
  "via",
  "when",
  "with",
  "yet",
]);

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
const DELIMITER_RE = /^[-\u2010-\u2015/]$/u;
const ROMAN_NUMERAL_RE = /^(?=[ivxlcdm]+$)[ivxlcdm]+$/i;
const ACRONYM_RE = /^(?:[A-Z0-9]+(?:[.&][A-Z0-9]+)+|[A-Z]{2,}\d*)$/;

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function hasWordChar(value: string) {
  return WORD_CHAR_RE.test(value);
}

function splitToken(value: string) {
  let start = 0;
  let end = value.length - 1;

  while (start <= end && !hasWordChar(value[start]!)) {
    start += 1;
  }

  while (end >= start && !hasWordChar(value[end]!)) {
    end -= 1;
  }

  if (start > end) {
    return { leading: value, core: "", trailing: "" };
  }

  return {
    leading: value.slice(0, start),
    core: value.slice(start, end + 1),
    trailing: value.slice(end + 1),
  };
}

function preserveOriginalCase(value: string) {
  const lower = value.toLocaleLowerCase();
  const upper = value.toLocaleUpperCase();

  if (value === lower || value === upper) {
    return false;
  }

  const canonicalTitle = lower.replace(
    /(^|['’])(\p{L})/gu,
    (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toLocaleUpperCase()}`,
  );

  return value !== canonicalTitle;
}

function formatWordSegment(value: string, forceCap: boolean) {
  if (!hasWordChar(value)) {
    return value;
  }

  if (preserveOriginalCase(value)) {
    return value;
  }

  if (ROMAN_NUMERAL_RE.test(value) && value.length > 1) {
    return value.toLocaleUpperCase();
  }

  if (ACRONYM_RE.test(value)) {
    return value.toLocaleUpperCase();
  }

  const lower = value.toLocaleLowerCase();
  const normalizedSmallWord = lower.replace(/\.+$/u, "");

  if (!forceCap && SMALL_WORDS.has(normalizedSmallWord)) {
    return lower;
  }

  return lower.replace(
    /(^|['’])(\p{L})/gu,
    (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toLocaleUpperCase()}`,
  );
}

function formatCoreWord(value: string, forceCap: boolean, isLastWord: boolean) {
  const parts = value.split(/([-\u2010-\u2015/])/u);
  const wordParts = parts.filter((part) => part.length > 0 && !DELIMITER_RE.test(part));
  const isCompound = wordParts.length > 1;
  let wordPartIndex = 0;

  return parts
    .map((part) => {
      if (part.length === 0 || DELIMITER_RE.test(part)) {
        return part;
      }

      const isFirstPart = wordPartIndex === 0;
      const isLastPart = wordPartIndex === wordParts.length - 1;
      wordPartIndex += 1;

      return formatWordSegment(
        part,
        forceCap || (isCompound && (isFirstPart || isLastPart)) || (isLastWord && isLastPart),
      );
    })
    .join("");
}

export function toChicagoTitleCase(value: string) {
  const normalized = normalizeWhitespace(String(value ?? ""));

  if (!normalized) {
    return "";
  }

  const rawTokens = normalized.split(" ");
  const wordCount = rawTokens.filter(hasWordChar).length;
  let seenWords = 0;
  let forceCapNext = true;

  return rawTokens
    .map((token) => {
      const { leading, core, trailing } = splitToken(token);

      if (!core) {
        return token;
      }

      const isFirstWord = seenWords === 0;
      const isLastWord = seenWords === wordCount - 1;
      const formatted = formatCoreWord(
        core,
        forceCapNext || isFirstWord || isLastWord,
        isLastWord,
      );

      seenWords += 1;
      forceCapNext = /[:.!?]$/u.test(trailing);

      return `${leading}${formatted}${trailing}`;
    })
    .join(" ");
}

export function normalizeTitleText(value: unknown) {
  return typeof value === "string" ? toChicagoTitleCase(value) : "";
}
