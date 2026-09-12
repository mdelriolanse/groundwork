#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$HOME/.config/systemd/user"
install -m 0644 "$ROOT/deploy/plant-floor-board.service" "$HOME/.config/systemd/user/plant-floor-board.service"
systemctl --user daemon-reload
systemctl --user enable --now plant-floor-board.service
systemctl --user --no-pager status plant-floor-board.service
