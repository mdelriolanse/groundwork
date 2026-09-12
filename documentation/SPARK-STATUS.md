# GB10 (`spark`) setup — 2026-09-12

Copied from `/tmp/spark-setup.md` on the box. **Done work lives here. Remaining: [IMPLEMENT.md](IMPLEMENT.md).**

Exec host is `spark`, not the laptop.

## Host

- Hostname: `promaxgb10-8823` (aarch64, NVIDIA GB10)
- User: `dell` (uid 1000). Groups include `sudo` and `docker` (`docker:x:988:dell`).
- SSH from laptop: `ssh spark` → `dell@10.50.14.139`. Key: `~/.ssh/id_ed25519_tailnet`.
- GPU: NVIDIA GB10, ~43 °C, util ~3% when idle between completions. Unified memory (nvidia-smi MiB N/A).
- NVMe: `/dev/nvme0n1p2` 3.6T, ~100G used, **3.4T free**.
- HACKPACK USB: `/media/dell/HACKPACK` (`/dev/sda1`, 114G, ~48G free). Already mounted. Do not serve weights off USB.

`dell` is in `docker` in `/etc/group` but **new SSH shells still need `sg docker`** until a full re-login. `id`/`groups` in a leftover session may omit `docker`.

Sudo is **not** passwordless. Helpers:

- `~/opt/hackpack/sudo-askpass` — zenity on `DISPLAY=:1`, `XAUTHORITY=/run/user/1000/gdm/Xauthority`
- `~/enable-docker.sh` — desktop one-shot for docker group / socket

## PATH

In `~/.bashrc`:

```
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/opt/node/bin:$PATH"
```

Node: **v22.19.0** at `~/opt/node` (symlinked from `~/.local/bin/node`).

## Layout (NVMe)

| Path | What |
|---|---|
| `/home/dell/plant-floor-agent` | Product git checkout (rsync from laptop; this box has no GitHub key). Has `AGENTS.md`, `CLAUDE.md`, `docs/`, `data/` |
| `/home/dell/plant-floor-agent/data/cwru/` | CWRU mats (~187M, gitignored) |
| `/home/dell/weights/gguf/Qwen3.6-35B-A3B-Q4_K_M.gguf` | **Loaded** reasoner, 20G (`ggml-org`, 20419565568 B) |
| `/home/dell/weights/gguf/gpt-oss-20b-MXFP4.gguf` | Unloaded fallback, 12G. Restart: `~/opt/hackpack/serve-gpt-oss.sh` |
| `/home/dell/weights/gguf/gemma3-4b/` | Gemma 3 4B Q4 GGUF 2.3G, **unloaded** |
| `/home/dell/.cache/huggingface/` | 46G HF hub. Parked: Qwen3.6-35B-A3B-NVFP4 (needs vLLM/NGC), Nemotron 3.5 Lightning 30B NVFP4 (+ DSpark), Qwen3 embed/rerank 0.6B |
| `/home/dell/opt/hackpack/serve-qwen.sh` | Cutover script for the live Qwen GGUF |
| `/home/dell/opt/hackpack/serve-gpt-oss.sh` | Fallback restart |
| `/home/dell/opt/hackpack/llama.cpp-gb10/` | Packed llama.cpp sm_121a (run binaries from this tree so `.so`s resolve) |
| `/home/dell/opt/hackpack/nemoclaw.sh` | Official installer copy |
| `/home/dell/opt/hackpack/node-v22.19.0-linux-arm64.tar.xz` | Node tarball |
| `/home/dell/opt/hackpack/openshell_0.0.109-1_arm64.deb` | Stick pkg — **do not install**; NemoClaw LKG maxes OpenShell at 0.0.106 |
| `/home/dell/opt/node` | Unpacked Node 22.19.0 |
| `/home/dell/vendor/predictive-maintenance-mcp` | Third-party DSP (do not rebuild) |
| `/home/dell/logs/llama-server.log` | llama-server stdout |
| `/home/dell/logs/nemoclaw-install.log` | Installer log |
| `/home/dell/logs/nemoclaw-onboard.log` | Onboard log |
| `~/dashboard-url.txt` and `/tmp/dashboard-url.txt` | Control UI URL + token |

## Inference (live)

`llama-server` **pid 320545**, binds **`0.0.0.0:8000`** (must not be `127.0.0.1` — sandbox reaches `host.openshell.internal:8000`).

```
export LD_LIBRARY_PATH=$HOME/opt/hackpack/llama.cpp-gb10/bin
~/opt/hackpack/llama.cpp-gb10/bin/llama-server \
  --model ~/weights/gguf/Qwen3.6-35B-A3B-Q4_K_M.gguf \
  --alias Qwen3.6-35B-A3B \
  --n-gpu-layers 99 --no-mmap -c 32768 --port 8000 --host 0.0.0.0 \
  --jinja --reasoning off
```

Or `~/opt/hackpack/serve-qwen.sh`.

- OpenAI-compat: `http://127.0.0.1:8000/v1/models` and `/v1/chat/completions`
- Model id: **`Qwen3.6-35B-A3B`** (alias). 34.7B MoE, Q4_K_M, n_ctx 32768 (train 262144)
- Smoke 2026-09-12: reply `qwen-ok`; **~73 tok/s** decode, ~2k tok/s prompt eval on a warm slot
- `--reasoning off` so thinking does not eat `max_tokens`. Do not set `LLAMA_ARG_CHAT_TEMPLATE_KWARGS` without quoted JSON — llama.cpp parse-fails and the process exits
- `--no-mmap` stays. File is on NVMe (downloaded over Wi‑Fi; `enP7s7` had no carrier)

**Not running / do not start this session:**

- Qwen3.6-35B **NVFP4** — HF safetensors still cached. Needs NGC + `nvcr.io/nvidia/vllm:26.05.post1-py3`. NemoClaw profile `vllm.dgx-spark-gb10.single.qwen3-6-35b-a3b-nvfp4` is **readiness incompatible**. llama.cpp cannot serve NVFP4.
- Nemotron 3.5 Lightning NVFP4
- Embed / rerank
- Express `install-vllm` (fights :8000, needs NGC, profiles incompatible)

## NemoClaw / OpenShell (live)

- CLI: `nemoclaw v0.0.123` at `~/.local/bin/nemoclaw` (also `nemoclaw-acp`, `nemo-deepagents`, `nemohermes`)
- Installed with `NEMOCLAW_NO_EXPRESS=1` `NEMOCLAW_PROVIDER=vllm` against existing :8000
- State: `~/.nemoclaw/` (`sandboxes.json`, `onboard-session.json`, `source/`, `state/`)
- OpenShell user-local **0.0.106**: `~/.local/bin/openshell{,-gateway,-sandbox}`
- Apt `openshell` **0.0.109 removed** (`dpkg` status `rc`). Stick 0.0.109 fights LKG.

### Sandbox `plant-floor`

- Id: `7b93a196-e4bf-4915-b4b8-572c3d940483`
- Phase: **Ready**. OpenClaw **running** (v2026.7.1). Docker health **healthy**.
- Container: `openshell-default--plant-floor-7b93a196-e4bf-4915-b4b8-572c3d940483`
- Image: `ghcr.io/nvidia/nemoclaw/openclaw-sandbox`
- Provider: `vllm-local`
- Model: `Qwen3.6-35B-A3B`
- Inference: healthy at `https://inference.local/v1/models` and backend `http://127.0.0.1:8000/v1/models`
- Sandbox GPU: enabled (auto), CUDA verified
- Policies still **balanced** (brew, huggingface, local-inference, npm, openclaw-pricing, pypi). Tighten later for the deny-demo.

Host processes:

- `openshell-gateway` (nemoclaw, port 8080)
- `/opt/openshell/bin/openshell-sandbox`
- `openshell ... forward service plant-floor --target-port 18789 --local 127.0.0.1:18789` (pid ~100707)
- `openshell forward list` may print **empty** even while :18789 is listening — ignore that if `ss` shows the port

## Dashboard (Control UI)

Listens **`127.0.0.1:18789`** only (on-box browser). Origin check wants **`127.0.0.1`**, not `localhost`.

Bare `http://127.0.0.1:18789` loads HTML then prompts for **gw token + password** and fails the gateway WS.

Reprint the capability URL (do not paste tokens into git):

```
nemoclaw plant-floor dashboard-url --quiet
```

Also in `~/dashboard-url.txt` on the box. Leave password blank unless one was set.

If WS still fails:

```
openshell forward stop 18789 plant-floor || true
openshell forward start 18789 plant-floor --background
```

`:18789` is already in use by the existing forward process; `forward start` will error until that is stopped.

## Product work **not** started

- Register PMMCP MCP
- CWRU diagnose skill
- sqlite + cron + cited work-order skill
- FPR
- OpenShell egress deny demo
- No application code written in `plant-floor-agent` this session

## Do not

- Serve GGUF off `/media/dell/HACKPACK`
- Bind llama-server to `127.0.0.1` only
- `apt install` stick OpenShell 0.0.109
- Pull NGC / Express `install-vllm` (fights :8000; profiles incompatible)
- Load NVFP4 Qwen/Nemotron or embed without a vLLM image
- Point OpenClaw at the unloaded gpt-oss GGUF path while Qwen is the alias on `:8000`
- Rebuild `predictive-maintenance-mcp`
- Claim ISO 20816 zones on a benchtop fan
- `pip` / `docker` / serve models on the laptop
