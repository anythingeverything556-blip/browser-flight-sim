#!/usr/bin/env bash
# Point the live-traffic function at your relay, then rebuild and redeploy (direct-upload deployments cannot be retried, so this runs tools/deploy.sh).
# usage: CLOUDFLARE_API_TOKEN=... RELAY_URL=https://relay.example RELAY_TOKEN=secret bash tools/set-traffic-relay.sh
# optional: CLOUDFLARE_ACCOUNT_ID (looked up if missing), PAGES_PROJECT (sr71-blackbird), ENV_NAME (production | preview)
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" "${RELAY_URL:?set RELAY_URL (https origin, no path)}"
PROJECT="${PAGES_PROJECT:-sr71-blackbird}"; ENV_NAME="${ENV_NAME:-production}"; API=https://api.cloudflare.com/client/v4
auth=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-$(curl -sf "${auth[@]}" "$API/accounts" | jq -r '.result[0].id')}"
HOST="$(printf '%s' "$RELAY_URL" | sed -E 's#^https://([^/:]+).*#\1#')"
[[ "$RELAY_URL" == https://* && "$RELAY_URL" != *"?"* && "$RELAY_URL" != *"@"* ]] || { echo "RELAY_URL must be a plain https origin"; exit 1; }
vars=$(jq -n --arg u "${RELAY_URL%/}" --arg h "$HOST" --arg k "${RELAY_TOKEN:-}" '
  {TRAFFIC_PROXY_URL: {type: "plain_text", value: $u}, TRAFFIC_ALLOWED_HOSTS: {type: "plain_text", value: $h}}
  + (if $k != "" then {TRAFFIC_API_KEY: {type: "secret_text", value: $k}} else {} end)')
body=$(jq -n --argjson v "$vars" --arg e "$([[ "$ENV_NAME" == preview ]] && echo preview || echo production)" '{deployment_configs: {($e): {env_vars: $v}}}')
resp=$(curl -s -X PATCH "${auth[@]}" "$API/accounts/$ACCOUNT/pages/projects/$PROJECT" -d "$body")
[[ "$(jq -r .success <<<"$resp")" == true ]] || { jq -c .errors <<<"$resp"; exit 1; }
echo "variables set on $PROJECT ($ENV_NAME): TRAFFIC_PROXY_URL=${RELAY_URL%/} TRAFFIC_ALLOWED_HOSTS=$HOST TRAFFIC_API_KEY=$([[ -n "${RELAY_TOKEN:-}" ]] && echo '(secret)' || echo '(none)')"
if [[ "$ENV_NAME" == production ]]; then
  export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT"
  exec bash "$(dirname "$0")/deploy.sh"
fi
echo "preview variables saved; they apply to the next preview deployment"
