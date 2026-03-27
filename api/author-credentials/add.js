const CATALOG_API_URL =
  process.env.CATALOG_API_URL || "https://book-ranker-catalog.fly.dev";

export default async function handler(request, response) {
  try {
    const res = await fetch(`${CATALOG_API_URL}/author-credentials/add`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    response.status(res.status).json(data);
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : "Catalog service unavailable",
    });
  }
}
