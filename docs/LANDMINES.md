# Landmines

Do not step here. Each one was expensive to find.

## Product / pitch

- Do not rebuild DSP. Call PMMCP.
- Do not attack PMMCP quality on stage.
- Do not claim ISO zones on a fan or on CWRU as if the 15 kW floor did not exist (`iso20816.py:294`).
- Do not claim industrial-OT software whitespace.
- Do not lead with "it's cheaper than the API."
- Do not cite the Italian Garante €15M OpenAI fine (annulled 18 Mar 2026).
- Do not invent manual page numbers.
- Do not ship a chat-with-PDFs UI. NVIDIA already tutorials that.
- Do not clone Nazar (air-gapped log triage, 2nd this series).

## Hardware / serving

- Do not serve models off the USB. `--no-mmap` reads the whole file; stick write was 13 MB/s.
- Do not skip NVMe copy.
- Do not trust `nvidia-smi` for thermals.
- Do not use PyPI torch for FFT/mel — NVRTC does not know sm_121 and crashes. PMMCP avoids this; keep it that way.
- Do not add Whisper / ASR / VL "because we have VRAM."
- Do not try ESP32+ADXL345 @ 1 kHz. Envelope throws `filter_high=499 < filter_low=500`. Need >1002 Hz; ISO ≥2106 Hz.
- Do not guess RPM. PMMCP requires it.
- Do not use a weak USB-C charger (Dell 280 W).
- Do not update the stack on the day.
- Do not wire Ollama at `/v1` (tools never execute).
- Do not assume GPU passthrough into OpenShell works.

## License / rules

- Do not include PMMCP `data/` (CC BY-NC-SA, non-commercial).
- Do not put Brave Search or web fetch on the allowlist.
- Do not commit `.env`, NGC keys, HF tokens.
- Do not write substantial application code into a shared repo *before* 09:50 (DQ). After kickoff, write it here.

## Differentiator ranking (if you have to cut)

1. OpenShell deny + audit (nobody in this space has it)
2. Always-on
3. Cited work order
4. Live ingest
5. Non-bearing fault modes (looseness)
