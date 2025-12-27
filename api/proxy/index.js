import axios from "axios";

export default async function handler(req, res) {
  // ----- CORS -----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // ----- INPUT VALIDATION -----
  const body = req.body || {};
  const { model, messages, temperature, max_tokens, ...rest } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing required field: messages (array)" });
    return;
  }
  // model is optional — your frontend always sends it, but we keep it defensive

  // ----- KEYS -----
  const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // ----- HELPERS -----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function withRetry(fn, { tries = 2, delayMs = 600 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn(i);
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await sleep(delayMs * (i + 1));
      }
    }
    throw lastErr;
  }

  function errMsg(e) {
    const data = e?.response?.data;
    if (typeof data === "string") return data;
    if (data?.error) return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    if (data?.message) return data.message;
    return e?.message || "Unknown error";
  }

  /**
   * Ensure the response ALWAYS looks like:
   * { choices: [{ message: { content: "..." } }] }
   * even if provider returns a slightly different shape.
   */
  function normalizeChatResponse(raw) {
    // Already OpenAI/xAI shape
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content === "string") return raw;

    // Some providers put content here
    const alt =
      raw?.output_text ||
      raw?.text ||
      raw?.message?.content ||
      raw?.choices?.[0]?.text;

    if (typeof alt === "string") {
      return { ...raw, choices: [{ message: { content: alt } }] };
    }

    // Worst-case: stringify something readable
    return {
      choices: [{ message: { content: JSON.stringify(raw ?? {}, null, 2) } }],
    };
  }

  // ----- 1) xAI (Grok) -----
  async function tryXAI() {
    if (!XAI_API_KEY) throw new Error("XAI_API_KEY (or GROK_API_KEY) not set");

    const url = "https://api.x.ai/v1/chat/completions";

    const payload = {
      model: model || "grok-4-1-fast-reasoning",
      messages,
      ...(typeof temperature !== "undefined" ? { temperature } : {}),
      ...(typeof max_tokens !== "undefined" ? { max_tokens } : {}),
      ...rest,
    };

    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
      validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`xAI ${resp.status}: ${errMsg({ response: resp })}`);
    }

    return normalizeChatResponse(resp.data || {});
  }

  // ----- 2) OpenAI fallback -----
  async function tryOpenAI() {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

    const url = "https://api.openai.com/v1/chat/completions";

    // Use a safe default; you can swap later
    const openaiModel = "gpt-4.1-mini";

    const payload = {
      model: openaiModel,
      messages,
      ...(typeof temperature !== "undefined" ? { temperature } : {}),
      ...(typeof max_tokens !== "undefined" ? { max_tokens } : {}),
    };

    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
      validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`OpenAI ${resp.status}: ${errMsg({ response: resp })}`);
    }

    return normalizeChatResponse(resp.data || {});
  }

  // ----- 3) Gemini fallback (stub for now) -----
  async function tryGemini() {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    throw new Error("Gemini fallback not implemented yet");
  }

  // ----- EXECUTION: retry + fallback chain -----
  try {
    const data = await withRetry(() => tryXAI(), { tries: 2, delayMs: 700 });
    res.status(200).json(data);
    return;
  } catch (xaiErr) {
    try {
      const data = await withRetry(() => tryOpenAI(), { tries: 2, delayMs: 700 });
      res.status(200).json(data);
      return;
    } catch (openaiErr) {
      try {
        const data = await withRetry(() => tryGemini(), { tries: 1, delayMs: 700 });
        res.status(200).json(data);
        return;
      } catch (geminiErr) {
        res.status(502).json({
          error: "All chat providers failed",
          details: {
            xai: errMsg(xaiErr),
            openai: errMsg(openaiErr),
            gemini: errMsg(geminiErr),
          },
        });
      }
    }
  }
}

export const config = {
  api: { bodyParser: true },
};
