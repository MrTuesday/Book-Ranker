#!/usr/bin/env node

const fs = require("node:fs");

const targetPath = process.argv[2];

if (!targetPath) {
  throw new Error("Usage: node patch-normalize-credential.cjs <target-file>");
}

const before = `function normalizeCredential(value) {
  const trimmed = String(value ?? "").trim().replace(/\\s+/g, " ");
  if (!trimmed) return "";

  return trimmed.replace(/(^|[\\s/-])(\\p{L})/gu, (_match, boundary, letter) => {
    return \`\${boundary}\${letter.toLocaleUpperCase()}\`;
  });
}`;

const after = `function normalizeCredential(value) {
  const trimmed = String(value ?? "").trim().replace(/\\s+/g, " ");
  if (!trimmed) return "";

  const titled = trimmed.replace(/(^|[\\s/-])(\\p{L})/gu, (_match, boundary, letter) => {
    return \`\${boundary}\${letter.toLocaleUpperCase()}\`;
  });

  return titled.replace(/\\b(In|Of|And|For|The)\\b/g, (match, _word, offset) => {
    return offset === 0 ? match : match.toLowerCase();
  });
}`;

const current = fs.readFileSync(targetPath, "utf8");

if (!current.includes(before)) {
  throw new Error(`Expected normalizeCredential block not found in ${targetPath}`);
}

fs.writeFileSync(targetPath, current.replace(before, after));
console.log(`Patched ${targetPath}`);
