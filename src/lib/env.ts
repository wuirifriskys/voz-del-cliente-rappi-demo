// Strict env-var accessor. Fails loud when a required secret is missing
// instead of silently falling back to an empty string or hardcoded default.
// Never hardcode keys — this is a repo-wide rule.

export function requireEnv(name: string, source: Record<string, string | undefined> = process.env): string {
  const value = source[name];
  if (!value || value.trim() === "" || value.includes("PLACEHOLDER") || value.includes("REPLACE_ME")) {
    throw new Error(
      `Missing env var: ${name}. Set it in .env (local) or via 'wrangler secret put ${name}' (deploy).`
    );
  }
  return value;
}

// Cloudflare Worker env: pass the env object from the fetch handler.
export function requireWorkerEnv<T>(env: T, name: keyof T): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "" || value.includes("REPLACE_ME")) {
    throw new Error(`Missing worker binding: ${String(name)}. Set via 'wrangler secret put ${String(name)}'.`);
  }
  return value;
}
