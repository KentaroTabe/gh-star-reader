#!/usr/bin/env bash
# Talks to the configured model provider directly, without going through the app.
# Prints the model list and the raw response to a one-word prompt, so a failure
# can be told apart from a bug in the app. Never prints the API key.
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
source .env.local
set +a

BASE="${LLM_BASE_URL:-https://generativelanguage.googleapis.com/v1beta/openai}"
BASE="${BASE%/}"
MODEL="${LLM_MODEL:-gemini-3.6-flash}"

if [ -z "${LLM_API_KEY:-}" ]; then
  echo "LLM_API_KEY が .env.local に入っていません。" >&2
  exit 1
fi

echo "== base: ${BASE}"
echo "== model: ${MODEL}"

echo
echo "== 利用できるモデル"
curl -sS "${BASE}/models" -H "authorization: Bearer ${LLM_API_KEY}" \
  --write-out '\n[HTTP %{http_code}]\n' \
  --output /dev/stdout | grep -oE '"id": *"[^"]+"' || true

echo
echo "== chat/completions"
curl -sS -X POST "${BASE}/chat/completions" \
  -H "authorization: Bearer ${LLM_API_KEY}" \
  -H "content-type: application/json" \
  --write-out '\n[HTTP %{http_code}]\n' \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":16}"
