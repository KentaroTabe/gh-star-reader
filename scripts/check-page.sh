#!/usr/bin/env bash
# Fetches the page and every script it references, printing the status of each.
# A page that renders but does not react to clicks usually means one of these
# chunks is not being served.
set -euo pipefail

ORIGIN="${1:-http://localhost:3000}"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

curl -sS "${ORIGIN}/" --output "${WORK}/page.html" --write-out 'page: HTTP %{http_code}\n'

grep -oE 'src="/_next/[^"]+"' "${WORK}/page.html" | sed 's/^src="//; s/"$//' | sort -u > "${WORK}/chunks.txt"

echo "== chunks: $(wc -l < "${WORK}/chunks.txt" | tr -d ' ')"
while read -r path; do
  curl -sS -o /dev/null "${ORIGIN}${path}" --write-out "%{http_code} %{size_download}\t${path}\n"
done < "${WORK}/chunks.txt"

echo
echo "== RSC payload (self.__next_f)"
grep -c "__next_f" "${WORK}/page.html" || echo "0 — ハイドレーション用のデータがない"
