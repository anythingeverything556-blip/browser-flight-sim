#!/usr/bin/env bash
# Build, test and deploy to Cloudflare Pages (project sr71-blackbird by default).
# Needs CLOUDFLARE_API_TOKEN (Pages: Edit) and CLOUDFLARE_ACCOUNT_ID in the environment. The functions/ folder (METAR, traffic) is deployed with it.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
npm ci --no-audit --no-fund && npm test && npm run build
npx --yes wrangler@4 pages deploy dist --project-name "${PAGES_PROJECT:-sr71-blackbird}" --branch main --commit-dirty=true
