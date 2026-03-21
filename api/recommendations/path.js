import { HttpError } from "../../server/lib/http.js";
import { createGoodreadsClient } from "../../server/lib/goodreads.js";
import { fetchPathRecommendations } from "../../server/lib/recommendations.js";

const goodreadsClient = createGoodreadsClient();

function parseJsonBody(body) {
  if (!body) {
    return null;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  if (typeof body === "object") {
    return body;
  }

  return null;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  const body = parseJsonBody(request.body);

  try {
    const result = await fetchPathRecommendations(goodreadsClient, body);
    response.status(200).json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      response.status(error.status).json({ message: error.message });
      return;
    }

    if (
      error instanceof Error &&
      error.message.startsWith("Choose at least ")
    ) {
      response.status(400).json({ message: error.message });
      return;
    }

    response.status(500).json({
      message:
        error instanceof Error && error.message
          ? error.message
          : "Recommendation lookup failed.",
    });
  }
}
