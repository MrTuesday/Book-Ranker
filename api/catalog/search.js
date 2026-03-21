import { HttpError } from "../../server/lib/http.js";
import { createHardcoverClient } from "../../server/lib/hardcover.js";

const hardcoverClient = createHardcoverClient();

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  const query = typeof request.query?.query === "string" ? request.query.query : "";
  const limit = Number(request.query?.limit) || 10;

  try {
    const results = await hardcoverClient.autocompleteBooksByTitle(query, {
      limit: Math.max(1, Math.min(20, limit)),
    });

    response.status(200).json({
      provider: "hardcover",
      query,
      results,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      response.status(error.status).json({ message: error.message });
      return;
    }

    response.status(500).json({
      message:
        error instanceof Error && error.message
          ? error.message
          : "Catalog search failed.",
    });
  }
}
