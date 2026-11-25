import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role Supabase client — bypasses RLS. Server-only, NEVER import this
 * into a Client Component or expose the key to the browser.
 *
 * Used by contexts that have no signed-in staff session and therefore can't go
 * through the cookie-based `createClient()` in ./server.ts — currently the
 * Google Calendar push webhook (`/api/google/notifications`), which Google
 * calls directly with no user cookie. It resolves the clinic from the channel
 * token, so it must be able to read/write that clinic's rows without RLS.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
