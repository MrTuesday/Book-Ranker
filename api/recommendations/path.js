import { searchOpenLibraryRecommendations } from "../../server/lib/open-library.js";

function readRequestBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return typeof body === "object" ? body : {};
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  const body = readRequestBody(request.body);

  try {
    const payload = await searchOpenLibraryRecommendations(body.selectedTags, {
      limit: body.limit,
    });
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({
      message:
        error instanceof Error && error.message
          ? error.message
          : "Open Library lookup failed.",
    });
  }
}
