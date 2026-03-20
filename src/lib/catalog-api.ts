export type CatalogSearchResult = {
  id: string;
  title: string;
  authors: string[];
  genres: string[];
  tags: string[];
  moods: string[];
  topics: string[];
  averageRating?: number;
  ratingsCount?: number;
  description?: string;
  coverUrl?: string;
};

export type CatalogSearchResponse = {
  provider: "hardcover";
  query: string;
  results: CatalogSearchResult[];
};

export async function searchCatalog(
  query: string,
  limit = 10,
): Promise<CatalogSearchResponse> {
  let response: Response;

  try {
    response = await fetch(
      `/api/catalog/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    );
  } catch {
    throw new Error("Catalog search is unavailable until the backend is deployed.");
  }

  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Catalog search is unavailable until the backend is deployed.");
  }

  const payload = (await response.json()) as { message?: string };

  if (!response.ok) {
    throw new Error(payload.message || "Catalog search failed.");
  }

  return payload as CatalogSearchResponse;
}
