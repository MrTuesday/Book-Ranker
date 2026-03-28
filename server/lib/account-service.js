import { createSupabaseAdminClient, getAuthenticatedUser } from "./authenticated-user.js";
import { HttpError } from "./http.js";

export async function deleteAuthenticatedAccount(request) {
  const user = await getAuthenticatedUser(request);
  const adminClient = createSupabaseAdminClient();

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

  if (deleteError) {
    throw new HttpError(500, deleteError.message || "Unable to delete account.");
  }

  return {
    ok: true,
  };
}
