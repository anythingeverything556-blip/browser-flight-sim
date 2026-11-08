#!/usr/bin/env bash
# Build, test and deploy to Cloudflare Pages. The same build goes to BOTH sites:
#   earthwing      -> https://earthwing.pages.dev      (main address)
#   sr71-blackbird -> https://sr71-blackbird.pages.dev (old address, kept so existing links work)
# Needs CLOUDFLARE_API_TOKEN (Pages: Edit) and CLOUDFLARE_ACCOUNT_ID in the environment. The functions/ folder (METAR, traffic) is deployed with it.
# PAGES_PROJECTS="earthwing" deploys to one site only (for a test); PAGES_PROJECT is still honoured for old scripts.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
read -r -a projects <<<"${PAGES_PROJECTS:-${PAGES_PROJECT:-earthwing sr71-blackbird}}"
npm ci --no-audit --no-fund && npm test && npm run build
for project in "${projects[@]}"; do
  npx --yes wrangler@4 pages deploy dist --project-name "$project" --branch main --commit-dirty=true
done
# a site that was skipped is now behind the other one
[[ ${#projects[@]} -ge 2 ]] || echo "WARNING: only ${projects[*]} was deployed; deploy the other site too (see AGENTS.md)" >&2
