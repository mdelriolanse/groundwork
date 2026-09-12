#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEMO="${NEMOCLAW:-/home/dell/.local/bin/nemoclaw}"
OPEN="${OPENSHELL:-/home/dell/.local/bin/openshell}"
SANDBOX="${SANDBOX:-plant-floor}"
USB_MANUAL="/media/dell/HACKPACK/data/manuals/skf-bearing-damage-analysis.pdf"
RUNTIME="$ROOT/runtime/corpus"
VENDOR="/home/dell/vendor/predictive-maintenance-mcp"

mkdir -p "$RUNTIME/manuals" "$RUNTIME/cwru" "$RUNTIME/history"
install -m 0644 "$USB_MANUAL" "$RUNTIME/manuals/skf-bearing-damage-analysis.pdf"
install -m 0644 "$ROOT/data/cwru/97.mat" "$RUNTIME/cwru/97.mat"
install -m 0644 "$ROOT/data/cwru/105.mat" "$RUNTIME/cwru/105.mat"
install -m 0644 "$ROOT/data/history/work-orders.csv" "$RUNTIME/history/work-orders.csv"
/home/dell/.local/bin/node "$ROOT/scripts/index-corpus.mjs" >/dev/null

"$NEMO" "$SANDBOX" agents apply -f "$ROOT/agent/agents.yaml" --yes --non-interactive
"$NEMO" "$SANDBOX" skill install "$ROOT/agent/maintenance"
"$NEMO" "$SANDBOX" upload "$RUNTIME" /sandbox/plant-floor-data
"$NEMO" "$SANDBOX" upload "$VENDOR" /sandbox/vendor/predictive-maintenance-mcp

"$OPEN" sandbox exec -n "$SANDBOX" -- /bin/sh -lc '
  set -eu
  PMMCP=/sandbox/vendor/predictive-maintenance-mcp/predictive-maintenance-mcp
  if [ ! -x /sandbox/.venv/bin/predictive-maintenance-mcp ]; then
    python3 -m venv /sandbox/.venv
    /sandbox/.venv/bin/pip install --disable-pip-version-check "$PMMCP"
  fi
  rm -rf /sandbox/.openclaw/workspace-maintenance/AGENTS.md /sandbox/.openclaw/workspace-maintenance/TOOLS.md
  cp /sandbox/.openclaw/workspace/skills/plant-floor-maintenance/AGENTS.md /sandbox/.openclaw/workspace-maintenance/AGENTS.md
  cp /sandbox/.openclaw/workspace/skills/plant-floor-maintenance/TOOLS.md /sandbox/.openclaw/workspace-maintenance/TOOLS.md
  mkdir -p /sandbox/.openclaw/workspace-maintenance/skills
  rm -rf /sandbox/.openclaw/workspace-maintenance/skills/plant-floor-maintenance
  cp -R /sandbox/.openclaw/workspace/skills/plant-floor-maintenance /sandbox/.openclaw/workspace-maintenance/skills/
  mkdir -p "$PMMCP/resources/machine_manuals"
  cp /sandbox/plant-floor-data/corpus/manuals/skf-bearing-damage-analysis.pdf "$PMMCP/resources/machine_manuals/"
  cp /sandbox/plant-floor-data/corpus/manuals/*.txt "$PMMCP/resources/machine_manuals/"
  /usr/local/bin/openclaw mcp set predictive-maintenance '\''{"enabled":true,"command":"/sandbox/.venv/bin/predictive-maintenance-mcp","args":[],"cwd":"/sandbox/vendor/predictive-maintenance-mcp/predictive-maintenance-mcp","connectionTimeoutMs":30000,"requestTimeoutMs":120000,"include":["load_signal","diagnose_vibration","check_bearing_faults","list_machine_manuals","search_documentation","read_manual_excerpt","search_bearing_catalog"]}'\''
  /usr/local/bin/openclaw mcp reload predictive-maintenance || /usr/local/bin/openclaw mcp reload
  /usr/local/bin/openclaw mcp probe predictive-maintenance
'

printf 'maintenance agent provisioned in %s\n' "$SANDBOX"
