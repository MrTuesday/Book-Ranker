import { HttpError } from "../server/lib/http.js";
import { deleteAuthenticatedAccount } from "../server/lib/account-service.js";

export default async function handler(request, response) {
  if (request.method !== "DELETE") {
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  try {
    const payload = await deleteAuthenticatedAccount(request);
    response.status(200).json(payload);
  } catch (error) {
    if (error instanceof HttpError) {
      response.status(error.status).json({ message: error.message });
      return;
    }

    response.status(500).json({
      message: error instanceof Error && error.message
        ? error.message
        : "Unable to delete account.",
    });
  }
}
