import type { Session } from "@supabase/supabase-js";

import { isSupabaseConfigured, requireSupabase, supabase } from "./supabase";

export { isSupabaseConfigured };
export type AuthSession = Session;

export async function getAuthSession() {
  if (!supabase) {
    return null;
  }

  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export function subscribeToAuthChanges(
  listener: (session: Session | null) => void,
) {
  if (!supabase) {
    return () => {};
  }

  const client = requireSupabase();
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    listener(session);
  });

  return () => {
    subscription.unsubscribe();
  };
}

export async function signInWithEmail(email: string, password: string) {
  const client = requireSupabase();
  const { error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw error;
  }
}

export async function signUpWithEmail(email: string, password: string) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo:
        typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
    },
  });

  if (error) {
    throw error;
  }

  return {
    needsEmailConfirmation: data.session == null,
  };
}

export async function requestPasswordReset(email: string) {
  const client = requireSupabase();
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo:
      typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
  });

  if (error) {
    throw error;
  }
}

export async function signOutUser() {
  if (!supabase) {
    return;
  }

  const client = requireSupabase();
  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}
