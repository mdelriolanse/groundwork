#!/usr/bin/env bash
# Optional: ball fault via 118.mat. Hop-loop never stops.
exec "$(cd "$(dirname "$0")" && pwd)/_common.sh" ball "${1:-30}"
