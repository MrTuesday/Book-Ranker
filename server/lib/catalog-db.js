const CATALOG_API_URL =
  process.env.CATALOG_API_URL || "https://book-ranker-catalog.fly.dev";

export async function isCatalogDbAvailable() {
  try {
    const res = await fetch(`${CATALOG_API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}

export async function searchCatalogDb(query, limit = 6) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL("/search", CATALOG_API_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Catalog search failed (${res.status})`);
  return res.json();
}

export async function searchCatalogDbBySubject(tag, limit = 12) {
  const trimmed = tag.trim();
  if (!trimmed) return [];

  const url = new URL("/subjects", CATALOG_API_URL);
  url.searchParams.set("tags", trimmed);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Catalog subject search failed (${res.status})`);
  return res.json();
}

export async function searchCatalogDbBySubjects(tags, limit = 12) {
  if (tags.length === 0) return [];

  const url = new URL("/subjects", CATALOG_API_URL);
  url.searchParams.set("tags", tags.join(","));
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Catalog subjects search failed (${res.status})`);
  return res.json();
}
