import { searchOpenLibraryCatalog } from "../../server/lib/open-library.js";

export default async function handler(request, response) {
  const rawQuery = request.query?.query ?? request.query?.q ?? "";
  const rawLimit = request.query?.limit;

  try {
    const payload = await searchOpenLibraryCatalog(rawQuery, {
      limit: rawLimit,
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
