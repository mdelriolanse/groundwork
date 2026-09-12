#!/usr/bin/env bash
# Optional: outer race via 130.mat. Hop-loop never stops.
exec "$(cd "$(dirname "$0")" && pwd)/_common.sh" or "${1:-30}"
