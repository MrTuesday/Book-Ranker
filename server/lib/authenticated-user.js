import { createClient } from "@supabase/supabase-js";

import { HttpError } from "./http.js";

export const GLOBAL_TAG_AUTHORITY_EMAIL = "danlyndon@proton.me";

function readSupabaseUrl() {
  return (
    process.env.SUPABASE_URL?.trim() ??
    process.env.VITE_SUPABASE_URL?.trim() ??
    ""
  );
}

function readSupabasePublishableKey() {
  return (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ??
    ""
  );
}

export function readHeader(request, name) {
  if (typeof request.headers?.get === "function") {
    return request.headers.get(name);
  }

  const lowerName = name.toLowerCase();
  const value = request.headers?.[lowerName] ?? request.headers?.[name];

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

export function readBearerToken(request) {
  const authorization = readHeader(request, "authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function createSupabaseAdminClient() {
  const supabaseUrl = readSupabaseUrl();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE?.trim() ??
    "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(
      503,
      "Global tag editing is not configured. Add SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function createSupabaseAuthClient() {
  const supabaseUrl = readSupabaseUrl();
  const authKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE?.trim() ??
    readSupabasePublishableKey();

  if (!supabaseUrl || !authKey) {
    throw new HttpError(
      503,
      "Global tag editing is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY on the server.",
    );
  }

  return createClient(supabaseUrl, authKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getAuthenticatedUser(request) {
  const accessToken = readBearerToken(request);

  if (!accessToken) {
    throw new HttpError(401, "Log in required.");
  }

  const authClient = createSupabaseAuthClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(accessToken);

  if (userError || !user) {
    throw new HttpError(401, "Session expired. Log in again.");
  }

  return user;
}

export async function requireGlobalTagAuthority(request) {
  const user = await getAuthenticatedUser(request);
  const email = user.email?.trim().toLocaleLowerCase() ?? "";

  if (email !== GLOBAL_TAG_AUTHORITY_EMAIL) {
    throw new HttpError(
      403,
      "Global tag editing is only available to the site owner account.",
    );
  }

  return user;
}
