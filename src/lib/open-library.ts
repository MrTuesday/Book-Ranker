import type { CatalogSearchResponse } from "./catalog-api";
import { normalizeTitleText } from "./title-case";

const DEFAULT_LIMIT = 6;

function normalizeLimit(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(10, Math.floor(value))) : DEFAULT_LIMIT;
}

export async function searchOpenLibraryCatalog(
  query: string,
  limit = DEFAULT_LIMIT,
  signal?: AbortSignal,
): Promise<CatalogSearchResponse> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return {
      provider: "openlibrary",
      query,
      results: [],
    };
  }

  const response = await fetch(
    `/api/catalog/search?query=${encodeURIComponent(trimmedQuery)}&limit=${normalizeLimit(limit)}`,
    {
      signal,
      headers: {
        Accept: "application/json",
      },
    },
  );
  const isJson =
    response.headers.get("content-type")?.includes("application/json") ?? false;

  if (!isJson) {
    throw new Error("Catalog lookup is unavailable.");
  }

  const payload = (await response.json()) as {
    message?: string;
    provider?: string;
    query?: string;
    results?: CatalogSearchResponse["results"];
  };

  if (!response.ok) {
    throw new Error(payload.message || "Catalog lookup failed.");
  }

  return {
    provider:
      typeof payload.provider === "string" ? payload.provider : "openlibrary",
    query: typeof payload.query === "string" ? payload.query : query,
    results: Array.isArray(payload.results)
      ? payload.results.map((result) => ({
          ...result,
          title: normalizeTitleText(result.title),
          ...(result.series ? { series: normalizeTitleText(result.series) } : {}),
        }))
      : [],
  };
}
