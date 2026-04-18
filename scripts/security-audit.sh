#!/usr/bin/env bash
# Pre-push security audit. Run before every git push to the public repo.
# Exits non-zero on any finding. If any check fails, the push MUST be aborted.

set -u
FAIL=0

say() { printf "[audit] %s\n" "$*"; }
fail() { printf "[audit] FAIL: %s\n" "$*"; FAIL=1; }
ok()   { printf "[audit] ok: %s\n" "$*"; }

# 1. .env files must not be staged or tracked
if git ls-files --error-unmatch .env 2>/dev/null; then
  fail ".env is tracked by git"
else
  ok ".env not tracked"
fi

# 2. Staged files cannot include any .env* (except .env.example)
staged_env=$(git diff --cached --name-only | grep -E '^\.env' | grep -v '^\.env\.example$' || true)
if [ -n "$staged_env" ]; then
  fail "staged .env files: $staged_env"
else
  ok "no forbidden .env files staged"
fi

# 3. Grep for common secret prefixes across tracked files
# - sk-ant-       (Anthropic)
# - sk-           (OpenAI)
# - apify_api_    (Apify, not placeholder)
# - eyJ           (JWT — Supabase service_role/anon real keys start this way)
# We allow matches inside .env.example with the PLACEHOLDER suffix.
scan() {
  local pattern="$1"
  local label="$2"
  # -I flag skips binary files so random JPEG/PNG bytes don't trigger false positives.
  local hits
  hits=$(git ls-files -z | xargs -0 grep -IlE "$pattern" 2>/dev/null | grep -v '^\.env\.example$' || true)
  if [ -n "$hits" ]; then
    fail "$label found in: $hits"
  else
    ok "no $label leak"
  fi
}

scan 'sk-ant-api[0-9]+-[A-Za-z0-9_-]{20,}' "Anthropic key"
scan '(^|[^A-Za-z])sk-[A-Za-z0-9]{20,}' "OpenAI-style key"
scan 'apify_api_[A-Za-z0-9]{20,}' "Apify token"
scan 'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}' "JWT (Supabase legacy)"
scan 'sb_secret_[A-Za-z0-9]{20,}' "Supabase service role (new format)"
scan 'sb_publishable_[A-Za-z0-9]{20,}' "Supabase publishable (new format, should only be in env)"
scan '[0-9]{6,12}:[A-Za-z0-9_-]{30,}' "Telegram bot token"

# 4. wrangler.toml must not contain a real key
if grep -E '(ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|TELEGRAM_BOT_TOKEN)\s*=' wrangler.toml 2>/dev/null; then
  fail "wrangler.toml contains a secret VALUE — secrets must be set via 'wrangler secret put'"
else
  ok "wrangler.toml has no secret values"
fi

# 5. gitleaks (if available)
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks detect --source . --no-banner --exit-code 1 --redact; then
    ok "gitleaks clean"
  else
    fail "gitleaks detected secrets"
  fi
else
  say "gitleaks not installed — skipping (install: brew install gitleaks)"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "[audit] ALL CHECKS PASSED"
  exit 0
else
  echo "[audit] AUDIT FAILED — do NOT push. Fix issues above."
  exit 1
fi
