#!/usr/bin/env bash
# Shared inject helper. Never stops hop-loop — only sets sqlite hop_override
# (or POSTs the board API, which does the same). Next hops pick it up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOARD="${PFA_BOARD:-http://127.0.0.1:8765}"
SOURCE="${1:?usage: _common.sh <ir|or|ball|clear> [hops]}"
HOPS="${2:-30}"

inject_via_api() {
  curl -sf -X POST "${BOARD%/}/api/demo/inject" \
    -H 'content-type: application/json' \
    -d "{\"source\":\"${SOURCE}\",\"hops\":${HOPS}}"
}

inject_via_sqlite() {
  node "${ROOT}/scripts/inject-fault.mjs" "${SOURCE}" "${HOPS}"
}

if out="$(inject_via_api 2>/dev/null)"; then
  echo "${out}"
  echo "ok: inject ${SOURCE} via ${BOARD} (hop-loop keeps running)" >&2
  exit 0
fi

echo "api unreachable — writing hop_override to sqlite directly" >&2
out="$(inject_via_sqlite)"
echo "${out}"
echo "ok: inject ${SOURCE} via sqlite (hop-loop keeps running)" >&2
