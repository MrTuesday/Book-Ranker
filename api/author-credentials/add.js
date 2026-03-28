import { HttpError } from "../../server/lib/http.js";
import { requireGlobalTagAuthority } from "../../server/lib/authenticated-user.js";

const CATALOG_API_URL =
  process.env.CATALOG_API_URL || "https://book-ranker-catalog.fly.dev";

export default async function handler(request, response) {
  if (request.method !== "PUT") {
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  try {
    await requireGlobalTagAuthority(request);

    const res = await fetch(`${CATALOG_API_URL}/author-credentials/add`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    response.status(res.status).json(data);
  } catch (error) {
    if (error instanceof HttpError) {
      response.status(error.status).json({ message: error.message });
      return;
    }

    response.status(502).json({
      message:
        error instanceof Error ? error.message : "Catalog service unavailable",
    });
  }
}
