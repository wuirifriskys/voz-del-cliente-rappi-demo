import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.ts";

// Server-side client with service role — writes to raw_reviews, classified_reviews,
// weekly_briefs. NEVER expose the service role key to the browser or the Worker's
// public endpoints that return user-controlled data.
export function serverClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

// Anon client — read-only through RLS policies. Safe for public contexts
// (dashboard fetch, etc.). Still only exposes aggregate tables.
export function anonClient(url?: string, anonKey?: string): SupabaseClient {
  return createClient(url ?? requireEnv("SUPABASE_URL"), anonKey ?? requireEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
}
