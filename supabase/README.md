## Supabase setup

1. Create a Supabase project.
2. In the SQL editor, run [`schema.sql`](/Users/danlyndon/Book-Ranker/supabase/schema.sql).
3. In Authentication:
   - enable email/password sign-in
   - enable email confirmations if you want account verification before first login
   - set the site URL to your Vercel production URL
4. Add these env vars in Vercel and locally:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` if you want the in-app account deletion button to work
5. Redeploy after the env vars are present.

Behavior notes:
- The app migrates the current browser-local profiles/lists into Supabase the first time a signed-in user loads the app and no remote profiles exist yet.
- If the Supabase env vars are missing, the app stays on the existing local-storage behavior instead of breaking production.
- The client still accepts the older `VITE_SUPABASE_ANON_KEY` name as a fallback, but `VITE_SUPABASE_PUBLISHABLE_KEY` is now the preferred variable.
