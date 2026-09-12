# Stack and hardware

## Layers (not a menu)

| Project | Job |
| ------- | --- |
| **OpenClaw** (MIT, TS) | Agent: runtime, tools, skills, memory, Gateway. [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **OpenShell** (Apache-2.0, Rust) | Sandbox + seccomp/Landlock/netns + L7 egress YAML + credential custody + `inference.local` router. [github.com/NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) |
| **NemoClaw** (Apache-2.0) | NVIDIA installer/lifecycle. `nemoclaw setup-spark`, **not** plain setup. [github.com/NVIDIA/NemoClaw](https://github.com/NVIDIA/NemoClaw) |

OpenShell replaces real secrets with **placeholder tokens inside the sandbox** and resolves them only at egress. The agent never holds a credential.

Inference path: agent → `https://inference.local` → OpenShell privacy router → `host.openshell.internal:8000` → local vLLM or llama.cpp. `inference.local` speaks OpenAI- **and** Anthropic-shaped APIs. No cloud key.

Harness: **OpenClaw** (`nemoclaw` / port 18789). Hermes and LangChain Deep Agents exist; we do not use them.

Best install walkthrough (no official starter for this series): [NVIDIA DGX Spark NemoClaw playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/main/nvidia/nemoclaw/README.md).

## The box

Dell Pro Max FCM1253 = **DGX Spark silicon**.

- GB10 Grace Blackwell: 6,144 CUDA cores, 48 SMs, 5th-gen Tensor Cores + 20-core Arm (10× X925 + 10× A725)
- **128 GB** LPDDR5X-8533 unified, 256-bit, **273 GB/s** (~121 GB usable)
- DGX OS 7 = Ubuntu 24.04 **aarch64**, CUDA 13, driver 580.x, **sm_121**
- Dell PSU **280 W** USB-C — do not swap a weaker charger

Decode law (say it on stage):

> tok/s ≈ 273 GB/s ÷ bytes of **active** weights per token

Measured on this silicon:

| Model | Active | Decode |
| ----- | ------ | ------ |
| Dense 70B FP8 | 70B | **2.7 tok/s** — unusable |
| Qwen3.6-35B-A3B NVFP4 | ~3B | **~90–92 tok/s** peak (vLLM + Marlin + MTP-3) |
| gpt-oss-20b MXFP4 | ~3B | **83 tok/s** (official llama.cpp) |
| Soft ceiling | — | ~80–85 tok/s below ~10 GB weights |

Prefill 2,400–6,000 tok/s. Batch-32 aggregate 350–680 tok/s. **Design for MoE + long context + many concurrent jobs.** Never a dense 70B chat window.

Thermal: EC firmware can lie. Watch `/sys/class/thermal/thermal_zone{0,5}/temp`. `nvidia-smi` under-reports ~30 °C. `--no-mmap` mandatory on unified memory. `GGML_CUDA_NO_VMM=1` if any load >32 GB hangs.

## Models (HACKPACK)

Packed 2026-09-12 on Kingston DataTraveler 70 (`HACKPACK`, ext4, 60/114 GB). Read-back `MANIFEST.sha256` 90/90 OK.

| Role | What | On stick |
| ---- | ---- | -------- |
| Primary | `nvidia/Qwen3.6-35B-A3B-NVFP4` 22G | HF cache |
| Plan B | Nemotron 3.5 Lightning 30B-A3B NVFP4 21G + DSpark 1.3G | HF cache |
| Offline engine | llama.cpp sm_121a (`merve/llama.cpp-dgx-spark-gb10-sm121a`) + `gpt-oss-20b-MXFP4.gguf` 12G | tools + gguf |
| Last resort | Gemma 3 4B bartowski Q4_0 2.3G | gguf |
| Embed / rerank | Qwen3-Embedding-0.6B + Qwen3-Reranker-0.6B | HF cache |
| Runtime | OpenShell `0.0.109` arm64 `.deb`, Node 22.19.0 arm64 | tools |
| DSP | PMMCP clone, **no `data/`** | vendor |
| Data | CWRU 64/64 mats, SKF PDF, ISO notes, synthetic WOs | data |

**Not packed:** `nvcr.io` vLLM images (no NGC), OpenShell container tars (`docker save` of arm64 foreign layers failed on the x86 pack host), official Gemma QAT, PMMCP aarch64 wheels, `npm pack` openclaw.

If Express vLLM is already on the loaner: seed `~/.cache/huggingface` from the stick and serve Qwen. If not: llama.cpp + gpt-oss-20b on `:8000`, then `openshell inference set`.

## Day-of copy (do this before serving)

```bash
sudo mkdir -p /mnt/hackpack && sudo mount -L HACKPACK /mnt/hackpack
rsync -aH --info=progress2 /mnt/hackpack/models/huggingface/ ~/.cache/huggingface/
rsync -aH --info=progress2 /mnt/hackpack/models/gguf/ ~/models/gguf/
rsync -aH /mnt/hackpack/tools/ ~/hackpack-tools/
rsync -aH /mnt/hackpack/vendor/ ~/hackpack-vendor/
rsync -aH /mnt/hackpack/data/ ~/hackpack-data/
```

llama.cpp offline:

```bash
export LD_LIBRARY_PATH="$HOME/hackpack-tools/llama.cpp-gb10/bin:/usr/local/cuda-13/compat:$LD_LIBRARY_PATH"
chmod +x $HOME/hackpack-tools/llama.cpp-gb10/bin/llama-*
$HOME/hackpack-tools/llama.cpp-gb10/bin/llama-server \
  --model $HOME/models/gguf/gpt-oss-20b-MXFP4.gguf \
  --n-gpu-layers 99 --no-mmap -c 32768 --port 8000 --jinja
```

OpenShell host package: `sudo dpkg -i ~/hackpack-tools/openshell_0.0.109-1_arm64.deb`

## Install landmines

| Issue | Fix |
| ----- | --- |
| cgroup v2 kills embedded k3s | `"default-cgroupns-mode": "host"` in `/etc/docker/daemon.json` — `setup-spark` does this |
| CoreDNS CrashLoop | `fix-coredns.sh` (container gateway IP, not 127.0.0.11) |
| k3s can't find image | `openshell gateway destroy && openshell gateway start` |
| OpenShell <0.0.7 | issue #878 regression; we packed **0.0.109** |
| GPU passthrough | **Untested on Spark.** Host-side inference is the plan. |
| Ollama wired at `/v1` | Agent looks fine, emits raw tool JSON, never executes tools |
| Local NIM | Some images have no `linux/arm64`; NIM caps memory at 50% on Spark |

## Sensor hardware (buy / bring)

- USB audio interface + piezo or accelerometer (~$20–40)
- Benchtop fan/motor, washers (imbalance), shims (looseness)
- **IR tachometer** — PMMCP requires RPM
- Fast external NVMe if HACKPACK is the only copy; power strip; ethernet cable; own laptop
