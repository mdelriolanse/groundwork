const INFER_URL = process.env.INFERENCE_URL || "http://127.0.0.1:8080/v1/chat/completions";
const INFER_MODEL = process.env.INFERENCE_MODEL || "Qwen3-0.6B";

export function inferenceTarget() {
  return { url: INFER_URL, model: INFER_MODEL };
}

export async function localChat({ messages, max_tokens = 400, temperature = 0.1, timeoutMs = 45000, fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetchImpl(INFER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: INFER_MODEL, messages, max_tokens, temperature, stream: false }),
      signal: ac.signal,
    });
    if (!response.ok) throw new Error(`inference ${response.status}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("inference empty");
    return { text, model: data.model || INFER_MODEL };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("inference timeout");
    if (error.cause?.code === "ECONNREFUSED" || /fetch failed|ECONNREFUSED/i.test(error.message)) throw new Error("inference unavailable");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
