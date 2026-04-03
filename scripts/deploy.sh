#!/usr/bin/env bash
# The Logbook — one entrypoint for pre-deploy checks and optional CLI deploys.
# Usage:
#   ./scripts/deploy.sh check          # pnpm install + production build (default)
#   ./scripts/deploy.sh db             # supabase db push (linked project required)
#   ./scripts/deploy.sh vercel         # vercel deploy --prod
#   ./scripts/deploy.sh all            # check, then db, then vercel (each step skips if unavailable)
#
# Environment:
#   SKIP_INSTALL=1     Skip pnpm install in check
#   SKIP_DB=1          Skip db step in all
#   SKIP_VERCEL=1      Skip vercel step in all
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
DIM='\033[2m'
RST='\033[0m'

info() { echo -e "${GRN}▸${RST} $*"; }
warn() { echo -e "${YLW}▸${RST} $*"; }
err()  { echo -e "${RED}▸${RST} $*" >&2; }

need_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "Missing command: $1 — install it or skip this step."
    return 1
  fi
}

run_check() {
  need_cmd pnpm
  if [[ "${SKIP_INSTALL:-}" != "1" ]]; then
    info "Installing dependencies (pnpm install)…"
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  else
    warn "SKIP_INSTALL=1 — skipping pnpm install"
  fi
  info "Building (nuxt build)…"
  pnpm run build
  info "Build OK — safe to push to Git / let Vercel build."
}

run_db() {
  need_cmd supabase
  if [[ ! -f "$ROOT/supabase/config.toml" ]]; then
    err "No supabase/config.toml."
    err "supabase link alone often does not create it — run: supabase init"
    err "Then link again: supabase link --project-ref <your-ref>"
    err "Or apply SQL from supabase/migrations/ manually in the Supabase dashboard."
    return 1
  fi
  info "Pushing migrations (supabase db push)…"
  supabase db push
  info "Database migrations applied."
}

run_vercel() {
  if command -v vercel &>/dev/null; then
    VCMD=(vercel)
  else
    need_cmd npx
    VCMD=(npx --yes vercel)
  fi
  info "Deploying to Vercel production…"
  "${VCMD[@]}" deploy --prod
  info "Vercel deploy finished."
}

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

CMD="${1:-check}"
case "$CMD" in
  -h|--help|help) usage 0 ;;
  check)          run_check ;;
  db)             run_db ;;
  vercel)         run_vercel ;;
  all)
    run_check
    if [[ "${SKIP_DB:-}" != "1" ]]; then
      if command -v supabase &>/dev/null && [[ -f "$ROOT/supabase/config.toml" ]]; then
        run_db || warn "DB step failed — fix and run: ./scripts/deploy.sh db"
      else
        warn "Supabase CLI or config missing — skipping db (set up supabase link first)."
      fi
    fi
    if [[ "${SKIP_VERCEL:-}" != "1" ]]; then
      run_vercel || warn "Vercel step failed — try: ./scripts/deploy.sh vercel"
    fi
    info "All requested steps finished."
    ;;
  *)
    err "Unknown command: $CMD"
    usage 1
    ;;
esac
