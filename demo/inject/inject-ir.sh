#!/usr/bin/env bash
# Stage: force next hops onto CWRU 105.mat (inner race). Hop-loop never stops.
exec "$(cd "$(dirname "$0")" && pwd)/_common.sh" ir "${1:-30}"
