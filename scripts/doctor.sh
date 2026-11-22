#!/bin/sh
# Vuurtoren doctor: checks a running Vuurtoren from the outside, the way a browser sees it.
#
#   scripts/doctor.sh                         http://127.0.0.1:8080
#   scripts/doctor.sh https://vuurtoren.example.com
#
# With sign-in on, the checks behind it need credentials (from the environment):
#   VUURTOREN_TOKEN=...                         the bearer token, or
#   VUURTOREN_USER=... VUURTOREN_PASSWORD=...     signs in with a cookie and signs out again
#
# Needs only curl. Exit code 0 when everything works, 1 otherwise. CI runs it as the
# smoke test against freshly built images (.github/workflows/ci.yml).
set -u

BASE=${1:-http://127.0.0.1:8080}
BASE=${BASE%/}
FAILED=0
TMP=$(mktemp -d)
JAR="$TMP/cookies"
trap 'rm -rf "$TMP"' EXIT

ok() { printf '  \033[32mok\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$*"; }
fail() {
  printf '  \033[31mFAIL\033[0m  %s\n' "$*"
  FAILED=1
}
# get PATH [curl args...] -> body in $TMP/body, status in $STATUS
get() {
  path=$1
  shift
  STATUS=$(curl -sS -m 20 -o "$TMP/body" -w '%{http_code}' -b "$JAR" -c "$JAR" "$@" "$BASE$path" 2>"$TMP/err") ||
    STATUS="000 ($(cat "$TMP/err"))"
}
body() { tr -d '\n' <"$TMP/body" | cut -c1-200; }
field() { sed -nE "s/.*\"$1\":(\"[^\"]*\"|[^,}]*).*/\1/p" "$TMP/body" | tr -d '"'; }

echo "Vuurtoren doctor: $BASE"

echo "web"
get /
if [ "$STATUS" = 200 ] && grep -q 'id="devices"' "$TMP/body"; then ok "the Your devices page loads"; else fail "GET / -> $STATUS (is the web container up? docker compose ps)"; fi
if curl -sS -m 10 -I "$BASE/" 2>/dev/null | grep -qi '^content-security-policy:'; then
  ok "security headers present"
else
  warn "no Content-Security-Policy header (a proxy in front may strip it)"
fi

echo "api"
get /api/health
if [ "$STATUS" != 200 ]; then
  fail "GET /api/health -> $STATUS (api container down? docker compose logs api)"
  AUTH=unknown
else
  AUTH=$(field authRequired)
  ok "health: sign-in required=$AUTH"
  [ "$AUTH" = true ] || warn "sign-in is OFF: fine on localhost only (deploy/README.md, Sign-in)"
fi

AUTHED=1
if [ "$AUTH" = true ]; then
  get "/api/sync/list?dir="
  if [ "$STATUS" = 401 ]; then ok "sync files are refused without a sign-in"; else fail "GET /api/sync/list without sign-in -> $STATUS (expected 401)"; fi
  get /nlp/health
  if [ "$STATUS" = 401 ]; then ok "the language server is refused without a sign-in"; else fail "GET /nlp/health without sign-in -> $STATUS (expected 401; is VUURTOREN_NLP_AUTH off?)"; fi
  if [ -n "${VUURTOREN_TOKEN:-}" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$VUURTOREN_TOKEN" >"$TMP/auth.conf"
  elif [ -n "${VUURTOREN_USER:-}" ] && [ -n "${VUURTOREN_PASSWORD:-}" ]; then
    : >"$TMP/auth.conf"
    # JSON-escape backslashes and quotes in the credentials.
    esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
    get /api/auth/login -X POST -H 'Content-Type: application/json' \
      --data-binary "{\"user\":\"$(esc "$VUURTOREN_USER")\",\"password\":\"$(esc "$VUURTOREN_PASSWORD")\"}"
    if [ "$STATUS" = 200 ]; then ok "signed in as $(field user)"; else
      fail "sign-in -> $STATUS: $(body)"
      AUTHED=0
    fi
  else
    warn "sign-in is on: set VUURTOREN_TOKEN or VUURTOREN_USER + VUURTOREN_PASSWORD to check the rest"
    AUTHED=0
  fi
else
  : >"$TMP/auth.conf"
fi

if [ "$AUTHED" = 1 ]; then
  get /api/auth/me -K "$TMP/auth.conf"
  if [ "$STATUS" = 200 ]; then ok "session: $(body)"; else fail "GET /api/auth/me -> $STATUS"; fi
  get "/api/sync/list?dir=vuurtoren%2Fdevices" -K "$TMP/auth.conf"
  if [ "$STATUS" = 200 ]; then ok "sync place: $(body)"; else fail "GET /api/sync/list -> $STATUS: $(body)"; fi

  echo "nlp"
  get /nlp/health -K "$TMP/auth.conf"
  # Data packs install in the background after the first start; VUURTOREN_DOCTOR_WAIT=<seconds>
  # waits until every data file is there (CI), otherwise missing data during an install is only
  # a warning.
  waited=0
  while [ "$STATUS" = 200 ] && [ "$(field busy)" = true ] && grep -q '"data":{[^}]*false' "$TMP/body" &&
    [ "$waited" -lt "${VUURTOREN_DOCTOR_WAIT:-0}" ]; do
    sleep 10
    waited=$((waited + 10))
    get /nlp/health -K "$TMP/auth.conf"
  done
  if [ "$STATUS" = 200 ]; then
    ok "language server $(field version), analyzer $(field analyzerVersion)"
    BUSY=$(field busy)
    for d in dictionary sentences translation grammarExamples; do
      v=$(field "$d")
      if [ "$v" = true ]; then
        ok "data: $d"
      elif [ "$v" = false ] && [ "$BUSY" = true ]; then
        warn "data: $d is still being installed (data packs; see GET /nlp/admin/packs)"
      elif [ "$v" = false ]; then
        fail "data missing: $d (data packs: check VUURTOREN_PACKS_URL and docker compose logs nlp)"
      fi
    done
    if grep -q '"activity":"error' "$TMP/body"; then
      warn "a data pack failed: $(sed -nE 's/.*"activity":"(error[^"]*)".*/\1/p' "$TMP/body" | cut -c1-160)"
    fi
    if [ "$(field ocr)" = false ]; then warn "no OCR in this image (-slim): photo/scan import is off"; fi
  else
    fail "GET /nlp/health -> $STATUS (the language server needs up to a minute after start: docker compose logs nlp)"
  fi

  if [ -s "$JAR" ] && [ -z "${VUURTOREN_TOKEN:-}" ] && [ "$AUTH" = true ]; then
    get /api/auth/logout -X POST -H 'Content-Type: application/json' --data-binary '{}'
    if [ "$STATUS" = 200 ]; then ok "signed out"; else fail "sign-out -> $STATUS"; fi
  fi
fi

echo "Anki: checked by your browser, not the server (Settings > Advanced > Server status)."
if [ "$FAILED" = 0 ]; then echo "All good."; else echo "Some checks failed (see above and deploy/README.md, Troubleshooting)."; fi
exit "$FAILED"
